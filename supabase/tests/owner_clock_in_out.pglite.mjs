// The owner clocks a worker in and out by hand, using the EXISTING audited functions (update 64: time_staff_add_workday and
// time_staff_edit_workday). No new SQL: this proves the screen's assumptions about those functions on the real full schema (PGlite).
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates load', failures.length === 0, JSON.stringify(failures));

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0], row: r.rows[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
const today = (await db.query(`select current_date::text as d`)).rows[0].d;

const coA = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
const mk = async (email, name) => {
  await asDb();
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const owner = await mk('owner@x.test', 'Owner');
const w1 = await mk('w1@x.test', 'Worker');
const w2 = await mk('w2@x.test', 'Second');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'owner','active','landscaping'),($1,$3,'worker','active','landscaping'),($1,$4,'worker','active','landscaping')`, [coA, owner.pid, w1.pid, w2.pid]);
const proj = (await one(`insert into public.projects (company_id, name, status) values ($1,'Job','active') returning id`, [coA])).id;
const a1 = (await one(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, status) values ($1,$2,$3,$4,'scheduled') returning id`, [coA, proj, w1.pid, today])).id;
// A second job that stays open, so finishing the first one does not close the day by itself (update 98): the owner closes it here.
const proj2 = (await one(`insert into public.projects (company_id, name, status) values ($1,'Second job','active') returning id`, [coA])).id;
await db.query(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, status) values ($1,$2,$3,$4,'scheduled')`, [coA, proj2, w1.pid, today]);
await db.query(`insert into public.time_settings (company_id, breaks_enabled, breaks_paid) values ($1, true, false)`, [coA]);

const wds = async (pid) => (await db.query(`select * from public.time_workdays where person_id = $1 order by clock_in_at`, [pid])).rows;
const ownerIn = (who, person, reason) => rpc(who.u, `select public.time_staff_add_workday($1::uuid, $2::date, now(), null, $3) as x`, [person.pid, today, reason]);
const ownerOut = (who, wid, reason) => rpc(who.u, `select public.time_staff_edit_workday($1::uuid, null, now(), $2) as x`, [wid, reason]);
const myDay = (u) => rpc(u, `select public.time_my_day($1::date) as x`, [today]);

// ── 1. Clock a worker IN by hand ──
let r = await ownerIn(owner, w1, 'Forgot to clock in');
let rows = await wds(w1.pid);
check('1 the owner starts an open workday for a worker', r.ok && rows.length === 1 && !rows[0].clock_out_at && rows[0].status === 'active', r.msg);
check('2 it has a pay-rate row like a normal clock-in', (await one(`select count(*)::int c from public.time_workday_rates where workday_id = $1`, [rows[0].id])).c === 1);
check('3 it is written to the time history with the owner\'s reason', (await one(`select count(*)::int c from public.time_audit where workday_id = $1 and action = 'added' and reason = 'Forgot to clock in'`, [rows[0].id])).c === 1);
r = await myDay(w1.u);
check('4 the worker\'s own phone sees an ACTIVE day (so Today shows his work)', r.ok && r.v.days.length === 1 && r.v.days[0].status === 'active' && !r.v.days[0].clock_out_at, JSON.stringify(r.v?.days));
r = await ownerIn(owner, w1, 'Again by mistake');
check('5 clocking in someone who is already clocked in is refused (never a second open day)', !r.ok && /overlaps another workday|uq_time_workday_open|duplicate key/i.test(r.msg), r.msg);
check('5b ...and nothing extra was created', (await wds(w1.pid)).length === 1);

// ── 2. Who may do it ──
r = await ownerIn(w2, w1, 'A coworker tries');
check('6 a worker cannot clock another worker in', !r.ok && /owner/i.test(r.msg), r.msg);
r = await ownerOut(w2, rows[0].id, 'A coworker tries');
check('7 a worker cannot clock another worker out', !r.ok, r.msg);
r = await ownerIn(owner, w2, 'x');
check('8 a reason is required (at least 3 letters)', !r.ok && /reason/i.test(r.msg), r.msg);

// ── 3. Clock OUT is refused while a break or a property timer is running, exactly like the worker's own clock ──
r = await rpc(w1.u, `select public.time_break_start() as x`);
check('10 setup: the worker is on a break', r.ok, r.msg);
r = await ownerOut(owner, rows[0].id, 'Sent home');
check('11 the owner cannot clock him out while his break is running (and is told why)', !r.ok && /break is still running/i.test(r.msg), r.msg);
r = await rpc(w1.u, `select public.time_break_end() as x`);
r = await rpc(w1.u, `select public.time_start_visit('assignment', $1::uuid) as x`, [a1]);
check('12 setup: the worker is timing a property', r.ok, r.msg);
r = await ownerOut(owner, rows[0].id, 'Sent home');
check('13 ...nor while a property timer is running (and is told why)', !r.ok && /property visit is still running/i.test(r.msg), r.msg);
const vis = (await one(`select visit_id from public.time_intervals where person_id = $1 and ended_at is null`, [w1.pid])).visit_id;
r = await rpc(w1.u, `select public.time_complete_visit($1::uuid) as x`, [vis]);

// ── 4. Clock OUT by hand ──
r = await ownerOut(owner, rows[0].id, 'Sent home');
rows = await wds(w1.pid);
check('14 the owner closes the running day at the real time, status closed', r.ok && !!rows[0].clock_out_at && rows[0].status === 'closed', r.msg);
check('15 the close is in the time history with the reason', (await one(`select count(*)::int c from public.time_audit where workday_id = $1 and action = 'clock_out_set' and reason = 'Sent home'`, [rows[0].id])).c === 1);
r = await myDay(w1.u);
check('16 the worker\'s phone sees the day CLOSED (nothing active, so Today asks him to clock in again)', r.ok && r.v.days.length === 1 && !!r.v.days[0].clock_out_at && r.v.days[0].status === 'closed', JSON.stringify(r.v?.days));

// ── 5. A second session the same day ──
r = await ownerIn(owner, w1, 'Came back');
rows = await wds(w1.pid);
check('17 the owner can start a NEW session the same day; the closed one is never reopened or edited', r.ok && rows.length === 2 && !!rows[0].clock_out_at && !rows[1].clock_out_at, r.msg);
r = await ownerOut(owner, rows[1].id, 'Done');
r = await rpc(owner.u, `select public.time_staff_add_workday($1::uuid, $2::date, now() - interval '30 minutes', null, 'Overlap test') as x`, [w1.pid, today]);
check('18 a day that would overlap an earlier one is refused', !r.ok && /overlaps another workday/i.test(r.msg), r.msg);

console.log(results.every(Boolean) ? '\nall passed' : '\nsome failed');
process.exit(results.every(Boolean) ? 0 : 1);
