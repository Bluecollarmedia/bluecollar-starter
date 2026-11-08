// Update 98: a workday closes by itself after the last stop; a forgotten day gets a suggested end the owner accepts in one tap;
// daily alert hours add up every session of a date. Real full schema + every update on PGlite (not real Supabase).
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 98) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/098_auto_close_workday.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 98 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
const today = (await db.query(`select current_date::text as d`)).rows[0].d;

const co = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
const mk = async (email, name) => {
  await asDb();
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  await db.query(`update public.people set first_name = $2 where id = $1`, [pid, name]);
  return { u, pid };
};
const owner = await mk('owner@x.test', 'Owner');
const lead = await mk('lead@x.test', 'Lead');
const ann = await mk('ann@x.test', 'Ann');
const bo = await mk('bo@x.test', 'Bo');
const idle = await mk('idle@x.test', 'Idle');
const lan = await mk('lan@x.test', 'Lan');
const ot = await mk('ot@x.test', 'Ott');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'owner','active','landscaping'),($1,$3,'worker','active','maintenance'),($1,$4,'worker','active','maintenance'),($1,$5,'worker','active','maintenance'),($1,$6,'worker','active','maintenance'),($1,$7,'worker','active','landscaping'),($1,$8,'worker','active','landscaping')`,
  [co, owner.pid, lead.pid, ann.pid, bo.pid, idle.pid, lan.pid, ot.pid]);
const prop = (await one(`insert into public.maintenance_properties (company_id, name, address) values ($1,'Chase','1 St') returning id`, [co])).id;
const contract = (await one(`insert into public.maintenance_contracts (company_id, property_id, name) values ($1,$2,'2026') returning id`, [co, prop])).id;
const route = (await one(`insert into public.maintenance_routes (company_id, service_date, name) values ($1,$2,'Route 1') returning id`, [co, today])).id;
await db.query(`insert into public.maintenance_route_crew (company_id, route_id, person_id) values ($1,$2,$3),($1,$2,$4),($1,$2,$5)`, [co, route, lead.pid, ann.pid, bo.pid]);
await db.query(`update public.maintenance_routes set lead_person_id = $2 where id = $1`, [route, lead.pid]);
const mkStop = async (n) => (await one(`insert into public.maintenance_stops (company_id, route_id, property_id, contract_id, sort_order) values ($1,$2,$3,$4,$5) returning id`, [co, route, prop, contract, n])).id;
const s1 = await mkStop(1);
const s2 = await mkStop(2);

const clockIn = (u) => rpc(u, `select public.time_clock_in($1::date, null, gen_random_uuid()) as x`, [today]);
const days = async (pid) => (await db.query(`select * from public.time_workdays where person_id = $1 order by clock_in_at`, [pid])).rows;
for (const p of [lead, ann, bo]) await clockIn(p.u);
await db.query(`insert into public.time_workdays (company_id, person_id, work_date) values ($1,$2,current_date)`, [co, idle.pid]);
const bd = (await days(bo.pid))[0];
await db.query(`insert into public.time_breaks (company_id, workday_id, person_id) values ($1,$2,$3)`, [co, bd.id, bo.pid]);

// ── 1. Maintenance: the last stop closes the day ──
await db.query(`update public.maintenance_stops set status = 'completed', completed_at = now() where id = $1`, [s1]);
check('1 finishing the FIRST of two stops closes nobody', (await days(lead.pid))[0].status === 'active' && (await days(ann.pid))[0].status === 'active');
let r = await rpc(ann.u, `select public.time_my_day($1::date) as x`, [today]);
check('2 the phone says work is still open', r.ok && r.v.has_open_work === true, JSON.stringify(r.v));
await db.query(`update public.maintenance_stops set status = 'skipped', skipped_at = now() where id = $1`, [s2]);
const a1 = (await days(ann.pid))[0];
check('3 finishing (or skipping) the LAST stop closes each crew member\'s day at that moment', a1.status === 'closed' && !!a1.clock_out_at && (await days(lead.pid))[0].status === 'closed', JSON.stringify(a1));
check('4 someone on a break is left open', (await days(bo.pid))[0].status === 'active' && !(await days(bo.pid))[0].clock_out_at);
check('5 someone with no work today is left open', !(await days(idle.pid))[0].clock_out_at);
check('6 each close is written to the history', +(await one(`select count(*) from public.time_audit where action = 'auto_clock_out'`)).count === 2);
r = await rpc(ann.u, `select public.time_my_day($1::date) as x`, [today]);
check('7 the phone now says nothing is open', r.ok && r.v.has_open_work === false, JSON.stringify(r.v));
await db.query(`update public.time_breaks set ended_at = now() where workday_id = $1`, [bd.id]);
check('8 when the break ends, that day closes too', (await days(bo.pid))[0].status === 'closed');

// ── 2. Work added later: clock in again, the closed session stays as it was ──
const first = (await days(ann.pid))[0];
const s3 = await mkStop(3);
r = await rpc(ann.u, `select public.time_my_day($1::date) as x`, [today]);
check('9 new work shows as open again', r.ok && r.v.has_open_work === true, JSON.stringify(r.v));
r = await clockIn(ann.u);
const ds = await days(ann.pid);
check('10 she can clock in again: a NEW session; the closed one is untouched', r.ok && ds.length === 2 && ds[0].id === first.id && +new Date(ds[0].clock_out_at) === +new Date(first.clock_out_at) && !ds[1].clock_out_at, r.msg);
await db.query(`update public.maintenance_stops set status = 'completed', completed_at = now() where id = $1`, [s3]);
check('11 finishing that stop closes the second session', !!(await days(ann.pid))[1].clock_out_at);

// ── 3. Landscaping: the property timer ends last, then the day closes ──
const proj = (await one(`insert into public.projects (company_id, name, status) values ($1,'Job','active') returning id`, [co])).id;
const asg = (await one(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, status) values ($1,$2,$3,$4,'scheduled') returning id`, [co, proj, lan.pid, today])).id;
await db.query(`insert into public.time_settings (company_id, breaks_enabled, breaks_paid, overtime_alerts_enabled) values ($1, true, false, true) on conflict (company_id) do update set overtime_alerts_enabled = true`, [co]);
await clockIn(lan.u);
r = await rpc(lan.u, `select public.time_start_visit('assignment', $1::uuid) as x`, [asg]);
check('12 setup: she is timing the property', r.ok, r.msg);
const vis = (await one(`select visit_id from public.time_intervals where person_id = $1 and ended_at is null`, [lan.pid])).visit_id;
r = await rpc(lan.u, `select public.time_complete_visit($1::uuid) as x`, [vis]);
check('13 completing her only job closes her day', r.ok && (await days(lan.pid))[0].status === 'closed' && !!(await days(lan.pid))[0].clock_out_at, r.msg);

// ── 4. Forgotten day: zero hours, a suggested end, one-tap accept ──
const f1 = await mk('f1@x.test', 'Fay');
const f2 = await mk('f2@x.test', 'Gus');
const f3 = await mk('f3@x.test', 'Hal');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'worker','active','maintenance'),($1,$3,'worker','active','maintenance'),($1,$4,'worker','active','maintenance')`, [co, f1.pid, f2.pid, f3.pid]);
const route2 = (await one(`insert into public.maintenance_routes (company_id, service_date, name) values ($1,$2,'Route 2') returning id`, [co, today])).id;
const route3 = (await one(`insert into public.maintenance_routes (company_id, service_date, name) values ($1,$2,'Route 3') returning id`, [co, today])).id;
await db.query(`insert into public.maintenance_route_crew (company_id, route_id, person_id) values ($1,$2,$3),($1,$4,$5)`, [co, route2, f1.pid, route3, f2.pid]);
const mkStopOn = async (rt) => (await one(`insert into public.maintenance_stops (company_id, route_id, property_id, contract_id, sort_order) values ($1,$2,$3,$4,1) returning id`, [co, rt, prop, contract])).id;
const t1 = await mkStopOn(route2);
const t2 = await mkStopOn(route3);
await clockIn(f1.u); await clockIn(f2.u);
// Both clocked in 15 hours ago (stale). Fay's route has a stop finished 6 hours ago; Gus's route (a different one) has nothing finished yet.
await db.query(`update public.time_workdays set clock_in_at = now() - interval '15 hours' where person_id in ($1, $2)`, [f1.pid, f2.pid]);
await db.query(`update public.maintenance_stops set status = 'completed', completed_at = now() - interval '6 hours' where id = $1`, [t1]);
check('14 a stale day is NOT closed at "now" by finishing a stop', !(await days(f1.pid))[0].clock_out_at, JSON.stringify((await days(f1.pid))[0]));
await rpc(f1.u, `select public.time_my_day($1::date) as x`, [today]);
await rpc(f2.u, `select public.time_my_day($1::date) as x`, [today]);
const fd = (await days(f1.pid))[0];
check('15 the 14-hour rule still flags it with zero length', fd.status === 'needs_review' && +new Date(fd.clock_out_at) === +new Date(fd.clock_in_at), JSON.stringify(fd));
r = await rpc(f1.u, `select public.time_review_list() as x`);
check('16 a worker cannot read the owner\'s review list', !r.ok && /Only the owner/.test(r.msg), r.msg);
r = await rpc(owner.u, `select public.time_review_list() as x`);
const list = r.v ?? [];
const fay = list.find((x) => x.person_id === f1.pid);
const gus = list.find((x) => x.person_id === f2.pid);
check('17 the owner sees both, Fay\'s suggestion is her last finished stop', r.ok && list.length === 2 && fay?.suggestion_source === 'last_stop' && Math.abs(+new Date(fay.suggested_end_at) - (Date.now() - 6 * 3600000)) < 120000, JSON.stringify(list));
check('18 a day with nothing finished has no suggestion', gus && gus.suggested_end_at === null, JSON.stringify(gus));
r = await rpc(f1.u, `select public.time_accept_suggested_end($1::uuid) as x`, [fd.id]);
check('19 a worker cannot accept', !r.ok, r.msg);
r = await rpc(owner.u, `select public.time_accept_suggested_end($1::uuid) as x`, [gus?.workday_id]);
check('20 accepting a day that has no suggestion says so', !r.ok && /no suggested end time/i.test(r.msg), r.msg);
r = await rpc(owner.u, `select public.time_accept_suggested_end($1::uuid) as x`, [fd.id]);
const fa = (await days(f1.pid))[0];
check('21 one tap: the day is settled at the suggested time and waits for approval', r.ok && fa.status === 'closed' && Math.abs(+new Date(fa.clock_out_at) - (Date.now() - 6 * 3600000)) < 120000, r.msg + JSON.stringify(fa));
check('22 it is in the history with the owner\'s reason', +(await one(`select count(*) from public.time_audit where workday_id = $1 and action = 'clock_out_set' and reason = 'Accepted the suggested end time'`, [fd.id])).count === 1 || +(await one(`select count(*) from public.time_audit where workday_id = $1 and reason = 'Accepted the suggested end time'`, [fd.id])).count >= 1);
r = await rpc(owner.u, `select public.time_accept_suggested_end($1::uuid) as x`, [fd.id]);
check('23 accepting twice is refused (already settled)', !r.ok && /already settled/.test(r.msg), r.msg);
// Accept all: give Gus a finished stop too (his own route), plus a day with no suggestion stays waiting.
await db.query(`update public.maintenance_stops set status = 'completed', completed_at = now() - interval '5 hours' where id = $1`, [t2]);
r = await rpc(owner.u, `select public.time_accept_all_suggested_ends() as x`);
check('24 accept-all settles the days that have a suggestion', r.ok && r.v.accepted === 1 && r.v.left.length === 0 && (await days(f2.pid))[0].status === 'closed', JSON.stringify(r.v));

// ── 5. Daily alert hours across two sessions ──
await db.query(`insert into public.time_person_settings (person_id, company_id, daily_alert_hours) values ($1,$2,8)`, [ot.pid, co]);
await db.query(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, clock_out_at, status) values ($1,$2,current_date, now() - interval '10 hours', now() - interval '5 hours', 'closed'), ($1,$2,current_date, now() - interval '4 hours', now(), 'closed')`, [co, ot.pid]);
r = await rpc(owner.u, `select public.time_scan_alerts() as x`);
const alerts = (await db.query(`select kind, dedupe_key from public.time_alerts where person_id = $1`, [ot.pid])).rows;
check('25 two sessions of 5h and 4h reach the 8-hour alert (they didn\'t before)', r.ok && alerts.some((a) => a.kind === 'overtime_reached'), JSON.stringify(alerts));
const first_ = (await db.query(`select id from public.time_workdays where person_id = $1 order by clock_in_at limit 1`, [ot.pid])).rows[0].id;
check('26 it is filed under the first session of the date (a one-session day keeps its old key)', alerts.some((a) => a.dedupe_key === 'ot_reached:' + first_), JSON.stringify(alerts));
await rpc(owner.u, `select public.time_scan_alerts() as x`);
check('27 it fires only once', (await db.query(`select 1 from public.time_alerts where person_id = $1 and kind = 'overtime_reached'`, [ot.pid])).rows.length === 1);

// ── 6. The older "clock the crew out" button is harmless after an automatic close ──
r = await rpc(lead.u, `select public.maintenance_clock_out_crew($1::uuid) as x`, [route]);
check('28 the leader\'s crew clock-out after an automatic close just reports nothing left to close', r.ok && r.v.closed.length === 0, JSON.stringify(r));

console.log(results.every(Boolean) ? '\nall passed' : '\nsome failed');
process.exit(results.every(Boolean) ? 0 : 1);
