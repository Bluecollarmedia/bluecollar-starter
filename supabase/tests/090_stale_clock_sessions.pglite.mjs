
// Update 90: a clock session that was never closed never blocks the next day and is never given an invented end time.
// Real full schema + every update on PGlite (not real Supabase). A "next day" is made by aging a session, so no waiting is needed.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 90) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/090_stale_clock_sessions.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 90 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0], row: r.rows[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
const today = (await db.query(`select current_date::text as d`)).rows[0].d;

const co = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
const mk = async (email, name) => {
  await asDb();
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const owner = await mk('owner@x.test', 'Owner');
const w1 = await mk('w1@x.test', 'Closed');     // closed yesterday correctly
const w2 = await mk('w2@x.test', 'Forgot');     // forgot to clock out, with a property timer and a break still running
const w3 = await mk('w3@x.test', 'Fresh');      // 5 hours into today's day: NOT stale
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'owner','active','landscaping'),($1,$3,'worker','active','landscaping'),($1,$4,'worker','active','landscaping'),($1,$5,'worker','active','landscaping')`, [co, owner.pid, w1.pid, w2.pid, w3.pid]);
const proj = (await one(`insert into public.projects (company_id, name, status) values ($1,'Job','active') returning id`, [co])).id;
const mkAsg = async (pid, date) => (await one(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, status) values ($1,$2,$3,$4,'scheduled') returning id`, [co, proj, pid, date])).id;
const a1 = await mkAsg(w1.pid, today); const a2 = await mkAsg(w2.pid, today); const a3 = await mkAsg(w3.pid, today);
const day = (u) => rpc(u, `select public.time_my_day($1::date) as x`, [today]);
const clockIn = (u) => rpc(u, `select public.time_clock_in($1::date, null, gen_random_uuid()) as x`, [today]);
const clockOut = (u) => rpc(u, `select public.time_clock_out() as x`);
const wd = async (pid) => (await db.query(`select * from public.time_workdays where person_id = $1 order by clock_in_at`, [pid])).rows;

// ── 1. A correctly CLOSED day from yesterday never blocks today ──
await db.query(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, clock_out_at, status) values ($1,$2,current_date - 1, now() - interval '30 hours', now() - interval '22 hours', 'closed')`, [co, w1.pid]);
let r = await day(w1.u);
check('1 yesterday\'s closed day is not shown as today\'s session', r.ok && r.v.days.length === 0, JSON.stringify(r.v?.days));
r = await clockIn(w1.u);
check('2 the worker clocks in for today at once', r.ok && r.v.days.length === 1 && !r.v.days[0].clock_out_at, r.msg);
check('3 yesterday\'s record is untouched', (await wd(w1.pid))[0].status === 'closed' && (await wd(w1.pid)).length === 2);

// ── 2. A day that is still genuinely open and not stale is left alone ──
r = await clockIn(w3.u);
await db.query(`update public.time_workdays set clock_in_at = now() - interval '5 hours' where person_id = $1`, [w3.pid]);
r = await day(w3.u);
check('4 a day open for 5 hours is current: not flagged, still running', r.ok && r.v.days.length === 1 && r.v.days[0].status === 'active' && !r.v.days[0].clock_out_at, JSON.stringify(r.v?.days));

// ── 3. Forgot to clock out: a property timer and a break are still running ──
r = await clockIn(w2.u);
r = await rpc(w2.u, `select public.time_start_visit('assignment', $1::uuid) as x`, [a2]);
check('5 setup: the forgetful worker is at a property', r.ok, r.msg);
await db.query(`update public.time_workdays set clock_in_at = now() - interval '30 hours', work_date = current_date - 1 where person_id = $1`, [w2.pid]);
await db.query(`update public.time_intervals set started_at = now() - interval '29 hours' where person_id = $1`, [w2.pid]);
const before = (await wd(w2.pid))[0];
r = await day(w2.u);
const flagged = (await wd(w2.pid))[0];
check('6 opening the app flags the old day as needs_review', flagged.status === 'needs_review' && !!flagged.flagged_at, JSON.stringify(flagged));
check('7 its clock-in is untouched and its end is the ZERO-length placeholder (no invented time)', new Date(flagged.clock_in_at).getTime() === new Date(before.clock_in_at).getTime() && new Date(flagged.clock_out_at).getTime() === new Date(flagged.clock_in_at).getTime());
check('8 the running property timer stopped at its own start (zero time), not at "now"', (await one(`select count(*)::int c from public.time_intervals where person_id = $1 and ended_at is null`, [w2.pid])).c === 0 && (await one(`select (ended_at = started_at) as z from public.time_intervals where person_id = $1`, [w2.pid])).z === true);
check('9 the phone is told about it (so it shows ONE card), and no current property is reported', r.ok && r.v.days.some((d) => d.status === 'needs_review') && !r.v.current, JSON.stringify(r.v));
check('10 the owner is notified', (await one(`select count(*)::int c from public.app_notifications where recipient_id = $1 and title like 'Needs review: no clock-out%'`, [owner.pid])).c === 1);
check('11 the audit log records the flag', (await one(`select count(*)::int c from public.time_audit where workday_id = $1 and action = 'flagged'`, [flagged.id])).c >= 2);
r = await clockIn(w2.u);
const rows2 = await wd(w2.pid);
check('12 today\'s clock-in works at once, as a SEPARATE row', r.ok && rows2.length === 2 && rows2[1].status === 'active' && !rows2[1].clock_out_at, r.msg);
check('13 hours cannot be counted twice: the flagged day is zero length, today\'s day is its own', (await one(`select sum(extract(epoch from (coalesce(clock_out_at, now()) - clock_in_at)))::int s from public.time_workdays where id = $1`, [flagged.id])).s === 0);
r = await clockOut(w2.u);
check('14 clocking out closes TODAY\'s day only and never touches the flagged one', r.ok && (await wd(w2.pid))[0].status === 'needs_review' && (await wd(w2.pid))[1].status === 'closed', r.msg);

// ── 4. The worker's answer is saved, never paid by itself ──
const stopped = (await one(`select (clock_in_at + interval '9 hours') as t from public.time_workdays where id = $1`, [flagged.id])).t;
r = await rpc(w2.u, `select public.time_claim_stale_end($1::uuid, $2::timestamptz, 'Left the yard at 5') as x`, [flagged.id, stopped]);
const afterClaim = (await wd(w2.pid))[0];
check('15 the claimed stop time is saved with the note', r.ok && new Date(afterClaim.claimed_out_at).getTime() === new Date(stopped).getTime() && afterClaim.claim_note === 'Left the yard at 5', r.msg);
check('16 the claim changes NO hours: still zero length, still needs_review', afterClaim.status === 'needs_review' && new Date(afterClaim.clock_out_at).getTime() === new Date(afterClaim.clock_in_at).getTime());
r = await rpc(w2.u, `select public.time_claim_stale_end($1::uuid, now() + interval '1 hour', null) as x`, [flagged.id]);
check('17 a time in the future is refused', !r.ok && /future/.test(r.msg), r.msg);
r = await rpc(w2.u, `select public.time_claim_stale_end($1::uuid, $2::timestamptz, null) as x`, [flagged.id, new Date(new Date(flagged.clock_in_at).getTime() - 3600000).toISOString()]);
check('18 a time before the clock-in is refused', !r.ok && /after you clocked in/.test(r.msg), r.msg);
r = await rpc(w1.u, `select public.time_claim_stale_end($1::uuid, null, null) as x`, [flagged.id]);
check('19 nobody can answer for someone else\'s day', !r.ok, r.msg);
r = await rpc(w2.u, `select public.time_claim_stale_end($1::uuid, null, 'Not sure') as x`, [flagged.id]);
check('20 "I\'m not sure" is saved too', r.ok && (await wd(w2.pid))[0].claimed_out_at === null && (await wd(w2.pid))[0].claim_note === 'Not sure');

// ── 5. The owner settles it ──
r = await rpc(owner.u, `select public.time_approve_workday($1::uuid) as x`, [flagged.id]);
check('21 an unresolved day cannot be approved for payroll', !r.ok && /end time/.test(r.msg), r.msg);
r = await rpc(owner.u, `select public.time_staff_edit_workday($1::uuid, null, $2::timestamptz, 'Worker said they left at 5') as x`, [flagged.id, stopped]);
const settled = (await wd(w2.pid))[0];
check('22 the owner sets the real end time with the existing edit: the day becomes a normal closed day', r.ok && settled.status === 'closed' && new Date(settled.clock_out_at).getTime() === new Date(stopped).getTime(), r.msg);
check('23 the original clock-in is still the original', new Date(settled.clock_in_at).getTime() === new Date(before.clock_in_at).getTime());
r = await rpc(w2.u, `select public.time_claim_stale_end($1::uuid, null, null) as x`, [flagged.id]);
check('24 a settled day can no longer be claimed', !r.ok && /settled/.test(r.msg), r.msg);

// ── 6. The retry path answers for the workday's own date ──
r = await clockOut(w2.u);
check('25 a repeated clock-out says "already closed" and still returns the day (not an empty UTC-date day)', r.ok && r.v.already_closed === true && r.v.days.length >= 1, JSON.stringify(r.v));

// ── 7. Snow shifts ──
await db.query(`insert into public.snow_staff (company_id, person_id, status, granted_at) values ($1,$2,'active',now())`, [co, owner.pid]).catch(() => null);
const snowCid = await rpc(owner.u, `select public._snow_my_company() as x`).catch(() => ({ ok: false }));
const stormId = (await db.query(`select id from public.snow_storms where company_id = $1 limit 1`, [co])).rows[0]?.id ?? null;
const mkShift = async (pid, hoursAgo, outHoursAgo) => (await one(`insert into public.snow_shifts (company_id, person_id, clock_in_at, clock_out_at) values ($1,$2, now() - ($3 || ' hours')::interval, ${outHoursAgo == null ? 'null' : `now() - ('${outHoursAgo}' || ' hours')::interval`}) returning id`, [co, pid, String(hoursAgo)])).id;
const s1 = await mkShift(owner.pid, 25, null);   // open for 25 hours: stale (20h)
r = await rpc(owner.u, `select public.snow_check_my_shift() as x`);
const sh = await one(`select * from public.snow_shifts where id = $1`, [s1]);
check('26 a Snow shift open for 25 hours is flagged when the phone looks at its clock', r.ok && r.v === 1 && !!sh.flagged_at && new Date(sh.clock_out_at).getTime() === new Date(sh.clock_in_at).getTime(), JSON.stringify([r, sh]));
check('27 its clock-in is untouched and it counts for zero hours', Math.abs(new Date(sh.clock_in_at).getTime() - (Date.now() - 25 * 3600000)) < 120000);
check('28 the owner is notified', (await one(`select count(*)::int c from public.app_notifications where recipient_id = $1 and title like 'Needs review: no snow clock-out%'`, [owner.pid])).c === 1);
const s2 = await mkShift(owner.pid, 6, null);    // a long overnight storm shift: NOT stale
r = await rpc(owner.u, `select public.snow_check_my_shift() as x`);
check('29 a 6-hour (overnight storm) shift is current and is left alone', r.ok && r.v === 0 && !(await one(`select flagged_at from public.snow_shifts where id = $1`, [s2])).flagged_at);
r = await rpc(owner.u, `select public.snow_clock_out() as x`);
check('30 Clock Out closes the CURRENT shift at the real time, never the flagged one', r.ok && (await one(`select (clock_out_at > clock_in_at) as ok from public.snow_shifts where id = $1`, [s2])).ok === true && (await one(`select (clock_out_at = clock_in_at) as z from public.snow_shifts where id = $1`, [s1])).z === true, r.msg);
const claimAt = (await one(`select (clock_in_at + interval '8 hours') as t from public.snow_shifts where id = $1`, [s1])).t;
r = await rpc(owner.u, `select public.snow_claim_stale_end($1::uuid, $2::timestamptz, 'Finished the lot') as x`, [s1, claimAt]);
check('31 the Snow worker\'s claim is saved and changes no hours', r.ok && (await one(`select claim_note n, (clock_out_at = clock_in_at) z from public.snow_shifts where id = $1`, [s1])).n === 'Finished the lot' && (await one(`select (clock_out_at = clock_in_at) z from public.snow_shifts where id = $1`, [s1])).z === true, r.msg);
r = await rpc(owner.u, `select public.snow_claim_stale_end($1::uuid, null, null) as x`, [s2]);
check('32 a normal (unflagged) shift cannot be "claimed"', !r.ok && /settled/.test(r.msg), r.msg);

console.log(results.every(Boolean) ? '\nall passed' : '\nsome failed');
process.exit(results.every(Boolean) ? 0 : 1);
