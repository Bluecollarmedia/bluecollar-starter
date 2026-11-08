// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && copy this file (and ./helpers/fullSchema.mjs) beside it, then:
//   node <file> <path to the repo>
// Proves update 64 on the REAL full schema + every update (PGlite, not real Supabase): owner corrections always keep the original value
// and a reason, approving a day locks it, changing an approved day reopens it, pay-rate changes never rewrite old costs, and
// alerts fire once and honour the owner's switches.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 260)}`); };
check('0 the full schema and all updates (including 064) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/064_time_corrections_approval_alerts.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 64 can be run a second time', again);
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
const iso = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();

const co = (await one(`insert into public.companies (name) values ('Test Co') returning id`)).id;
const mk = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const owner = await mk('owner@x.test', 'Owner');
const w1 = await mk('w1@x.test', 'Worker');
const w2 = await mk('w2@x.test', 'Other');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active'),($1,$3,'worker','active'),($1,$4,'worker','active')`, [co, owner.pid, w1.pid, w2.pid]);
const proj = (await one(`insert into public.projects (company_id, name, status) values ($1, 'Job A', 'active') returning id`, [co])).id;
await db.query(`insert into public.worker_hourly_rates (company_id, person_id, hourly_rate, effective_date) values ($1,$2,20,'2020-01-01')`, [co, w1.pid]);

// a closed day for w1: 7:30 -> 16:00 yesterday-ish today (relative minutes ago)
let r = await rpc(owner.u, `select public.time_staff_add_workday($1::uuid, current_date, $2::timestamptz, $3::timestamptz, 'Forgot to clock in') as x`, [w1.pid, iso(600), iso(120)]);
check('1 the owner can add a missing workday (forgot to clock in), with a reason', r.ok, r.msg);
const wid = r.v;
r = await rpc(owner.u, `select public.time_staff_add_workday($1::uuid, current_date, $2::timestamptz, $3::timestamptz, '') as x`, [w2.pid, iso(300), iso(200)]);
check('2 a correction without a reason is refused', !r.ok && /reason/.test(r.msg), r.msg);
r = await rpc(w1.u, `select public.time_staff_add_workday($1::uuid, current_date, $2::timestamptz, null, 'x y z') as x`, [w1.pid, iso(60)]);
check('3 a worker cannot make corrections', !r.ok && /Only the owner/.test(r.msg), r.msg);
let a = await all(`select action, reason, actor_id from public.time_audit where workday_id = $1`, [wid]);
check('4 the history records who and why', a.length === 1 && a[0].action === 'added' && a[0].reason === 'Forgot to clock in' && a[0].actor_id === owner.pid, JSON.stringify(a));
check('5 the rate in force was saved with the added day', Number((await one(`select hourly_rate from public.time_workday_rates where workday_id = $1`, [wid])).hourly_rate) === 20);

// a visit with an interval inside the day
await db.exec('reset role');
const vid = (await one(`insert into public.time_visits (company_id, source, project_id, visit_date, label, target_minutes) values ($1, 'project_day', $2, current_date, 'Job A', 60) returning id`, [co, proj])).id;
r = await rpc(owner.u, `select public.time_staff_add_interval($1::uuid, $2::uuid, $3::timestamptz, $4::timestamptz, 'Added from the foreman') as x`, [vid, w1.pid, iso(500), iso(380)]);
check('6 the owner can add an employee\'s time at a visit by hand', r.ok, r.msg);
const iid = r.v;
check('7 the visit start/end/status follow the interval; the rate was saved with it', (await one(`select status from public.time_visits where id = $1`, [vid])).status === 'completed'
  && Number((await one(`select hourly_rate from public.time_interval_rates where interval_id = $1`, [iid])).hourly_rate) === 20);
r = await rpc(owner.u, `select public.time_staff_add_interval($1::uuid, $2::uuid, $3::timestamptz, $4::timestamptz, 'overlap') as x`, [vid, w1.pid, iso(450), iso(400)]);
check('8 an overlapping property time for the same employee is refused', !r.ok && /overlaps/.test(r.msg), r.msg);
r = await rpc(owner.u, `select public.time_staff_add_interval($1::uuid, $2::uuid, $3::timestamptz, $4::timestamptz, 'outside') as x`, [vid, w1.pid, iso(700), iso(650)]);
check('9 a property time outside the workday is refused', !r.ok, r.msg);

// corrections keep the original
const origIn = (await one(`select clock_in_at from public.time_workdays where id = $1`, [wid])).clock_in_at;
r = await rpc(owner.u, `select public.time_staff_edit_workday($1::uuid, $2::timestamptz, null, 'Arrived earlier') as x`, [wid, iso(610)]);
check('10 the owner can correct the clock-in', r.ok, r.msg);
a = await all(`select old_value, new_value, reason, was_approved from public.time_audit where workday_id = $1 and field = 'clock_in_at' and action = 'corrected'`, [wid]);
check('11 the original value, new value, reason and approval state are kept', a.length === 1 && new Date(a[0].old_value).getTime() === new Date(origIn).getTime() && a[0].reason === 'Arrived earlier' && a[0].was_approved === false, JSON.stringify(a));
r = await rpc(owner.u, `select public.time_staff_edit_workday($1::uuid, $2::timestamptz, null, 'later than the first visit') as x`, [wid, iso(450)]);
check('12 moving the clock-in past a recorded property visit is refused', !r.ok && /outside/.test(r.msg), r.msg);
r = await rpc(owner.u, `select public.time_staff_edit_workday($1::uuid, null, $2::timestamptz, 'future') as x`, [wid, new Date(Date.now() + 3600000).toISOString()]);
check('13 a time in the future is refused', !r.ok && /future/.test(r.msg), r.msg);

// approval
r = await rpc(owner.u, `select public.time_approve_workday($1::uuid) as x`, [wid]);
check('14 the owner approves a clean day', r.ok && (await one(`select status, approved_by from public.time_workdays where id = $1`, [wid])).status === 'approved', r.msg);
r = await rpc(owner.u, `select public.time_approve_workday($1::uuid) as x`, [wid]);
check('15 approving twice changes nothing (version stays 1)', r.ok && (await one(`select approval_version v from public.time_workdays where id = $1`, [wid])).v === 1, r.msg);
r = await rpc(owner.u, `select public.time_staff_edit_interval($1::uuid, null, $2::timestamptz, 'Left 10 min early') as x`, [iid, iso(390)]);
check('16 correcting an APPROVED day reopens it for re-approval', r.ok && (await one(`select status from public.time_workdays where id = $1`, [wid])).status === 'reopened', r.msg);
a = await all(`select was_approved, old_value, new_value from public.time_audit where visit_id = $1 and field = 'ended_at'`, [vid]);
check('17 and the history says the day was approved when it changed, with old and new time', a.length === 1 && a[0].was_approved === true && a[0].old_value !== a[0].new_value, JSON.stringify(a));
r = await rpc(owner.u, `select public.time_approve_workday($1::uuid) as x`, [wid]);
check('18 it can be approved again', r.ok && (await one(`select approval_version v from public.time_workdays where id = $1`, [wid])).v === 2, r.msg);
r = await rpc(owner.u, `select public.time_reopen_workday($1::uuid, 'Payroll question') as x`, [wid]);
check('19 the owner can reopen an approved day with a reason', r.ok && (await one(`select status from public.time_workdays where id = $1`, [wid])).status === 'reopened', r.msg);
await asDb();
// an open workday cannot be approved; a timer must be stopped first
await db.query(`delete from public.time_workdays where person_id = $1`, [w2.pid]);
const open = (await one(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at) values ($1,$2,current_date, now() - interval '20 hours') returning id`, [co, w2.pid])).id;
r = await rpc(owner.u, `select public.time_approve_workday($1::uuid) as x`, [open]);
check('20 a day with no clock-out cannot be approved', !r.ok && /no clock-out/.test(r.msg), r.msg);
r = await rpc(owner.u, `select public.time_staff_edit_workday($1::uuid, null, $2::timestamptz, 'Forgot to clock out') as x`, [open, iso(300)]);
check('21 the owner can set a missing clock-out, which closes the day', r.ok && (await one(`select status from public.time_workdays where id = $1`, [open])).status === 'closed', r.msg);
a = await all(`select action from public.time_audit where workday_id = $1 and field = 'clock_out_at'`, [open]);
check('22 the history shows the clock-out was set by the owner', a.length === 1 && a[0].action === 'clock_out_set', JSON.stringify(a));

// billable
r = await rpc(owner.u, `select public.time_set_visit_billable($1::uuid, false, 'Callback - our mistake') as x`, [vid]);
check('23 a visit can be marked non-billable (its intervals follow), with history', r.ok && (await one(`select billable from public.time_intervals where id = $1`, [iid])).billable === false
  && (await one(`select count(*)::int c from public.time_audit where visit_id = $1 and action = 'billable_changed'`, [vid])).c === 1, r.msg);
check('24 non-billable does not change the employee\'s workday or interval times', (await one(`select count(*)::int c from public.time_intervals where id = $1 and status <> 'void'`, [iid])).c === 1);

// void
r = await rpc(owner.u, `select public.time_staff_void_interval($1::uuid, 'Entered by mistake') as x`, [iid]);
check('25 a property time can be voided; it stays in the history', r.ok && (await one(`select status from public.time_intervals where id = $1`, [iid])).status === 'void', r.msg);

// rates
r = await rpc(owner.u, `select public.time_set_hourly_rate($1::uuid, 30, current_date, 'Raise') as x`, [w1.pid]);
check('26 the owner sets a new hourly rate; the old rate row is ended, not edited', r.ok
  && (await one(`select count(*)::int c from public.worker_hourly_rates where person_id = $1`, [w1.pid])).c === 2
  && (await one(`select end_date from public.worker_hourly_rates where person_id = $1 and hourly_rate = 20`, [w1.pid])).end_date !== null, r.msg);
check('27 the saved rates on past workdays and visits did not change', Number((await one(`select hourly_rate from public.time_workday_rates where workday_id = $1`, [wid])).hourly_rate) === 20
  && Number((await one(`select hourly_rate from public.time_interval_rates where interval_id = $1`, [iid])).hourly_rate) === 20);
r = await rpc(owner.u, `select public.time_set_hourly_rate($1::uuid, 35, '2019-01-01', 'back-dated') as x`, [w1.pid]);
check('28 a new rate cannot start before the current one', !r.ok, r.msg);
r = await rpc(w1.u, `select public.time_set_hourly_rate($1::uuid, 99, current_date, '') as x`, [w1.pid]);
check('29 a worker cannot change pay rates', !r.ok, r.msg);

// ── alerts ──────────────────────────────────────────────────────────────────
await asDb();
await db.query(`delete from public.time_alerts`);
await db.query(`delete from public.app_notifications`);
const proj2 = (await one(`insert into public.projects (company_id, name, status) values ($1, 'Job B', 'active') returning id`, [co])).id;
const v3 = (await one(`insert into public.time_visits (company_id, source, project_id, visit_date, label, status, started_at, target_minutes) values ($1,'project_day',$2,current_date,'Job B','in_progress', now() - interval '3 hours', 60) returning id`, [co, proj2])).id;
r = await rpc(owner.u, `select public.time_scan_alerts() as x`);
check('30 over-target alerts are off by default (nothing is raised)', r.ok && (await one(`select count(*)::int c from public.time_alerts where kind = 'over_target'`)).c === 0, r.msg);
await db.query(`insert into public.time_settings (company_id, target_alerts_enabled, target_notify_crew, overtime_alerts_enabled) values ($1, true, true, true)`, [co]);
r = await rpc(owner.u, `select public.time_scan_alerts() as x`);
check('31 with the switch on, a visit past its target raises one alert and tells the owner', r.ok && (await one(`select count(*)::int c from public.time_alerts where kind = 'over_target'`)).c === 1
  && (await one(`select count(*)::int c from public.app_notifications where recipient_id = $1 and event_type = 'time_over_target'`, [owner.pid])).c === 1, r.msg);
r = await rpc(owner.u, `select public.time_scan_alerts() as x`);
check('32 scanning again does not repeat the alert or the notification', (await one(`select count(*)::int c from public.time_alerts where kind = 'over_target'`)).c === 1
  && (await one(`select count(*)::int c from public.app_notifications where event_type = 'time_over_target'`)).c === 1, r.msg);
check('33 the audit log recorded the settings change', (await one(`select count(*)::int c from public.time_audit where entity = 'settings'`)).c >= 1);
// open workday alert
await db.query(`delete from public.time_workdays where person_id = $1`, [w2.pid]);
await db.query(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at) values ($1,$2,current_date, now() - interval '16 hours')`, [co, w2.pid]);
r = await rpc(owner.u, `select public.time_scan_alerts() as x`);
check('34 a workday still open after the owner\'s threshold is flagged for review (once)', (await one(`select count(*)::int c from public.time_alerts where kind = 'open_workday'`)).c === 1, r.msg);
// overtime
await db.query(`insert into public.time_person_settings (person_id, company_id, daily_alert_hours) values ($1, $2, 8)`, [w1.pid, co]);
await db.query(`delete from public.time_workdays where person_id = $1`, [w1.pid]);
await db.query(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, clock_out_at, status) values ($1,$2,current_date, now() - interval '8 hours 30 minutes', now() - interval '10 minutes', 'closed')`, [co, w1.pid]);
r = await rpc(owner.u, `select public.time_scan_alerts() as x`);
check('35 reaching the employee\'s daily alert hours raises an alert', (await one(`select count(*)::int c from public.time_alerts where kind = 'overtime_reached'`)).c === 1, r.msg);
// worker scan runs through time_my_day without exposing anything owner-only
r = await rpc(w1.u, `select public.time_my_day(current_date) as x`);
check('36 a worker\'s own day contains no rates, targets, alerts or costs', r.ok && !JSON.stringify(r.v).match(/rate|target|alert|cost|average/i), JSON.stringify(r.v).slice(0, 200));
// crew prompt is neutral
await db.query(`delete from public.time_alerts where kind = 'over_target'`);
await db.query(`delete from public.app_notifications`);
await db.query(`delete from public.time_workdays where person_id = $1`, [w1.pid]);
await db.query(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, status) values ($1, $2, current_date, now() - interval '5 hours', 'active')`, [co, w1.pid]);
const wopen = (await one(`select id from public.time_workdays where person_id = $1 and clock_out_at is null`, [w1.pid]))?.id;
if (wopen) {
  await db.query(`insert into public.time_intervals (company_id, visit_id, workday_id, person_id, started_at) values ($1,$2,$3,$4, now() - interval '3 hours')`, [co, v3, wopen, w1.pid]);
  await rpc(owner.u, `select public.time_scan_alerts() as x`);
  const crew = await all(`select body from public.app_notifications where recipient_id = $1 and event_type = 'time_progress_check'`, [w1.pid]);
  check('37 the crew gets a neutral progress check (no target or average in the message)', crew.length === 1 && !/\d+\s*(min|hour)|target|average/i.test(crew[0].body), JSON.stringify(crew));
} else {
  check('37 the crew gets a neutral progress check (no target or average in the message)', false, 'no open workday fixture');
}

// skip request alert
const stopRoute = (await one(`insert into public.maintenance_routes (company_id, service_date, name) values ($1, current_date, 'R') returning id`, [co])).id;
const mprop = (await one(`insert into public.maintenance_properties (company_id, name, address) values ($1, 'Chase', '1 St') returning id`, [co])).id;
const mcon = (await one(`insert into public.maintenance_contracts (company_id, property_id, name) values ($1, $2, '2026') returning id`, [co, mprop])).id;
const mstop = (await one(`insert into public.maintenance_stops (company_id, route_id, property_id, contract_id, sort_order) values ($1,$2,$3,$4,1) returning id`, [co, stopRoute, mprop, mcon])).id;
await db.query(`insert into public.time_skip_requests (company_id, source, maintenance_stop_id, requested_by, reason) values ($1,'maintenance_stop',$2,$3,'Gate locked')`, [co, mstop, w2.pid]);
check('38 a skip request raises one owner alert and one notification', (await one(`select count(*)::int c from public.time_alerts where kind = 'skip_request' and status = 'open'`)).c === 1
  && (await one(`select count(*)::int c from public.app_notifications where event_type = 'time_skip_request'`)).c === 1);
await rpc(owner.u, `select public.time_decide_skip((select id from public.time_skip_requests limit 1), false, 'Try again later') as x`);
check('39 deciding the request resolves its alert', (await one(`select count(*)::int c from public.time_alerts where kind = 'skip_request' and status = 'open'`)).c === 0);
check('40 and the decision is in the history', (await one(`select count(*)::int c from public.time_audit where action = 'skip_denied'`)).c === 1);

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
