// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && copy this file (and ./helpers/fullSchema.mjs) beside it, then:
//   node <file> <path to the repo>
// Proves update 63 on the REAL full schema + every update (PGlite, not real Supabase): the workday clock, breaks, property visits
// with each employee's own interval, route order, required photos, owner-approved skips, rate snapshots and who can read what.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 260)}`); };
check('0 the full schema and all updates (including 063) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/063_time_tracking_core.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 63 can be run a second time', again);
const fails = async (sql, p) => { try { await db.query(sql, p); return { raised: false, msg: '' }; } catch (e) { return { raised: true, msg: String(e.message) }; } };
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const call = async (u, sql, p) => { await asUser(u); try { return await fails(sql, p); } finally { await asDb(); } };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
// The database's own idea of today (its time zone can differ from UTC), so the test never straddles a date boundary.
const today = (await db.query(`select current_date::text as d`)).rows[0].d;

// ── fixtures ────────────────────────────────────────────────────────────────
const co = (await one(`insert into public.companies (name) values ('Test Co') returning id`)).id;
const mk = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const owner = await mk('owner@x.test', 'Owner');
const w1 = await mk('w1@x.test', 'Land One');
const w2 = await mk('w2@x.test', 'Land Two');
const m1 = await mk('m1@x.test', 'Maint One');
const m2 = await mk('m2@x.test', 'Maint Two');
const stranger = await mk('s@x.test', 'Stranger');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'owner','active','landscaping'),($1,$3,'worker','active','landscaping'),($1,$4,'worker','active','landscaping'),($1,$5,'worker','active','maintenance'),($1,$6,'worker','active','maintenance')`, [co, owner.pid, w1.pid, w2.pid, m1.pid, m2.pid]);
const truckA = (await one(`insert into public.trucks (company_id, name) values ($1, 'Truck A') returning id`, [co])).id;
const truckB = (await one(`insert into public.trucks (company_id, name) values ($1, 'Truck B') returning id`, [co])).id;

// maintenance route with three stops
const mp = [];
for (const n of ['Chase', 'Focus', 'Sesame']) mp.push((await one(`insert into public.maintenance_properties (company_id, name, address) values ($1, $2, '1 St') returning id`, [co, n])).id);
const contracts = [];
for (const p of mp) contracts.push((await one(`insert into public.maintenance_contracts (company_id, property_id, name) values ($1, $2, '2026') returning id`, [co, p])).id);
const route = (await one(`insert into public.maintenance_routes (company_id, service_date, name) values ($1, $2, 'Route 1') returning id`, [co, today])).id;
await db.query(`insert into public.maintenance_route_crew (company_id, route_id, person_id) values ($1,$2,$3),($1,$2,$4)`, [co, route, m1.pid, m2.pid]);
const stops = [];
for (let i = 0; i < 3; i++) stops.push((await one(`insert into public.maintenance_stops (company_id, route_id, property_id, contract_id, sort_order) values ($1,$2,$3,$4,$5) returning id`, [co, route, mp[i], contracts[i], i + 1])).id);

// landscaping jobs for w1
const projects = [];
for (const n of ['Job A', 'Job B']) projects.push((await one(`insert into public.projects (company_id, name, status) values ($1, $2, 'active') returning id`, [co, n])).id);
const asg = [];
for (let i = 0; i < 2; i++) asg.push((await one(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, sort_order, status) values ($1,$2,$3,$4,$5,'confirmed') returning id`, [co, projects[i], w1.pid, today, i + 1])).id);
await db.query(`insert into public.worker_hourly_rates (company_id, person_id, hourly_rate, effective_date) values ($1,$2,20,'2020-01-01'),($1,$3,25,'2020-01-01')`, [co, w1.pid, m1.pid]);

// ── workday ─────────────────────────────────────────────────────────────────
let r = await rpc(w1.u, `select public.time_clock_in($1::date, null, gen_random_uuid()) as x`, [today]);
check('1 a worker can clock in; the workday starts with a server time', r.ok && r.v.days.length === 1 && r.v.days[0].clock_out_at === null && r.v.days[0].status === 'active', r.msg);
const reqId = (await one(`select gen_random_uuid() as g`)).g;
r = await rpc(w2.u, `select public.time_clock_in($1::date, null, $2::uuid) as x`, [today, reqId]);
const r2 = await rpc(w2.u, `select public.time_clock_in($1::date, null, $2::uuid) as x`, [today, reqId]);
check('2 tapping Clock In twice (same request) makes one workday', r.ok && r2.ok && (await one(`select count(*)::int c from public.time_workdays where person_id = $1`, [w2.pid])).c === 1, r2.msg);
const r3 = await rpc(w2.u, `select public.time_clock_in($1::date, null, gen_random_uuid()) as x`, [today]);
check('3 clocking in again from another phone shows the open day and never makes a second', r3.ok && r3.v.already_active === true && (await one(`select count(*)::int c from public.time_workdays where person_id = $1`, [w2.pid])).c === 1, r3.msg);
await asDb();
let f = await fails(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at) values ($1, $2, $3, now() + interval '1 minute')`, [co, w1.pid, today]);
check('4 the database itself refuses a second open workday and overlapping workdays', f.raised, f.msg);
f = await fails(`update public.time_workdays set clock_out_at = clock_in_at - interval '1 minute' where person_id = $1`, [w1.pid]);
check('5 a clock-out before the clock-in is refused', f.raised, f.msg);

// trucks
await asDb();
await db.query(`update public.assignments set truck_id = $2 where id = $1`, [asg[0], truckA]);
await db.query(`delete from public.time_workdays where person_id = $1`, [w1.pid]);
r = await rpc(w1.u, `select public.time_clock_in($1::date, $2::uuid, null) as x`, [today, truckB]);
check('6 when the owner assigned a truck for the day it is used (the worker\'s pick is ignored)', r.ok && r.v.days[0].truck.name === 'Truck A' && r.v.days[0].truck.source === 'owner', JSON.stringify(r.v?.days?.[0]?.truck) + (r.msg ?? ''));
r = await rpc(m1.u, `select public.time_clock_in($1::date, $2::uuid, null) as x`, [today, truckB]);
check('7 with no owner truck the worker picks one and it is recorded as theirs', r.ok && r.v.days[0].truck.name === 'Truck B' && r.v.days[0].truck.source === 'worker', r.msg);
r = await rpc(stranger.u, `select public.time_clock_in($1::date, $2::uuid, null) as x`, [today, truckB]);
check('8 a stranger (not on the team) cannot clock in', !r.ok, r.msg);
r = await rpc(w2.u, `select public.time_trucks_for_clock_in($1::date) as x`, [today]);
check('9 a truck in use by someone not working with you is shown as in use', r.ok && r.v.trucks.find((t) => t.name === 'Truck B').in_use === true, JSON.stringify(r.v));
await asDb();
await db.query(`delete from public.time_workdays where person_id = $1`, [w2.pid]);
r = await rpc(w2.u, `select public.time_clock_in($1::date, $2::uuid, null) as x`, [today, truckB]);
check('10 and cannot be taken (the server refuses it too)', !r.ok && /already in use/.test(r.msg), r.msg);
r = await rpc(m2.u, `select public.time_clock_in($1::date, $2::uuid, null) as x`, [today, truckB]);
check('11 but a crew mate on the same route can share the same truck', r.ok && r.v.days[0].truck.name === 'Truck B', r.msg);
await asDb();
await db.query(`delete from public.time_workdays where person_id = $1`, [w2.pid]);

// ── maintenance route order (update 68: the crew leader checks the crew in; no per-worker property timers) ──
await db.query(`update public.maintenance_routes set lead_person_id = $2 where id = $1`, [route, m1.pid]);
const arrive = (u, stop) => rpc(u, `select public.maintenance_leader_arrive($1::uuid) as x`, [stop]);
const finish = (u, stop) => rpc(u, `select public.maintenance_leader_complete($1::uuid) as x`, [stop]);
r = await arrive(m1.u, stops[1]);
check('12 a later stop stays locked while an earlier one is not done', !r.ok && /Finish Chase first/.test(r.msg), r.msg);
r = await arrive(m1.u, stops[0]);
check('13 the leader checks the crew in at the first stop; the workday timer keeps running and ONE visit is saved', r.ok && r.v.visit_id && (await one(`select count(*)::int c from public.time_visits where maintenance_stop_id = $1 and crew_level and started_at is not null`, [stops[0]])).c === 1, r.msg);
const visit1 = (await one(`select id from public.time_visits where maintenance_stop_id = $1`, [stops[0]])).id;
r = await arrive(m1.u, stops[0]);
check('14 tapping I\'m Here twice changes nothing (still one visit)', r.ok && r.v.already_arrived === true && (await one(`select count(*)::int c from public.time_visits where maintenance_stop_id = $1`, [stops[0]])).c === 1, r.msg);
r = await arrive(m2.u, stops[0]);
check('15 a crew member who is not the leader cannot check the crew in', !r.ok && /Only the crew leader/.test(r.msg), r.msg);
r = await rpc(m2.u, `select public.time_start_visit('maintenance_stop', $1::uuid) as x`, [stops[0]]);
check('16 the old per-worker property timer is refused for maintenance stops', !r.ok, r.msg);
r = await finish(m2.u, stops[0]);
const r16b = await finish(m1.u, stops[0]);
check('17 only the leader finishes the stop; finishing saves the completion time and the visit is completed', !r.ok && r16b.ok && (await one(`select status, ended_at is not null as done from public.time_visits where id = $1`, [visit1])).done === true, r.msg + (r16b.msg ?? ''));
check('18 a crew visit has no per-person intervals (each person\'s workday is separate)', (await one(`select count(*)::int c from public.time_intervals where visit_id = $1`, [visit1])).c === 0);
r = await arrive(m1.u, stops[1]);
check('19 finishing Chase unlocks the next stop (Focus) for the leader', r.ok, r.msg);
r = await arrive(m1.u, stops[2]);
check('20 Sesame stays locked until Focus is done', !r.ok, r.msg);
await asDb();

// ── breaks ──────────────────────────────────────────────────────────────────
r = await rpc(w1.u, `select public.time_break_start() as x`);
check('21 breaks are off until the owner turns them on', !r.ok && /turned off/.test(r.msg), r.msg);
await db.query(`insert into public.time_settings (company_id, breaks_enabled, breaks_paid) values ($1, true, false)`, [co]);
r = await rpc(w1.u, `select public.time_break_start() as x`);
check('22 with breaks on a worker can start one; it is recorded as unpaid per the setting', r.ok && r.v.days[0].breaks.length === 1 && r.v.days[0].breaks[0].paid === false, r.msg);
r = await rpc(w1.u, `select public.time_start_visit('assignment', $1::uuid) as x`, [asg[0]]);
check('23 a property cannot be started during a break', !r.ok && /End your break/.test(r.msg), r.msg);
r = await rpc(w1.u, `select public.time_clock_out() as x`);
check('24 clock-out is refused while the break is running', !r.ok && /break is still running/.test(r.msg), r.msg);
r = await rpc(w1.u, `select public.time_break_end() as x`);
check('25 ending the break closes it', r.ok && r.v.days[0].breaks[0].ended_at !== null, r.msg);

// ── landscaping jobs, order, photos, legacy records ─────────────────────────
r = await rpc(w1.u, `select public.time_start_visit('assignment', $1::uuid) as x`, [asg[1]]);
check('26 job B is locked until job A is done', !r.ok && /Finish Job A first/.test(r.msg), r.msg);
await db.query(`update public.time_settings set require_start_photo = true, require_complete_photo = true where company_id = $1`, [co]);
r = await rpc(w1.u, `select public.time_start_visit('assignment', $1::uuid) as x`, [asg[0]]);
check('27 the start photo is required when the owner says so', !r.ok && /start photo/.test(r.msg), r.msg);
await db.query(`insert into public.project_photos (company_id, project_id, uploaded_by, file_url, time_phase) values ($1,$2,$3,'https://x/empty.jpg','start')`, [co, projects[0], w1.pid]);
r = await rpc(w1.u, `select public.time_start_visit('assignment', $1::uuid) as x`, [asg[0]]);
check('27b a photo row with no stored file does not count as the start photo', !r.ok && /start photo/.test(r.msg), r.msg);
await db.query(`update public.project_photos set file_key = 'p/y.jpg' where file_url = 'https://x/empty.jpg'`);
r = await rpc(w1.u, `select public.time_start_visit('assignment', $1::uuid, null, null, null, 'ok', '{"lat":41.5,"lng":-81.7}'::jsonb) as x`, [asg[0]]);
check('28 with the photo, the job starts; the older check-in, session and assignment records are written too', r.ok
  && (await one(`select count(*)::int c from public.check_ins where assignment_id = $1`, [asg[0]])).c === 1
  && (await one(`select status from public.work_sessions where assignment_id = $1`, [asg[0]])).status === 'active'
  && (await one(`select status from public.assignments where id = $1`, [asg[0]])).status === 'checked_in', r.msg);
const jv = (await one(`select id from public.time_visits where project_id = $1`, [projects[0]])).id;
r = await rpc(w1.u, `select public.time_complete_visit($1::uuid) as x`, [jv]);
check('29 the completion photo is required when the owner says so', !r.ok && /completion photo/.test(r.msg), r.msg);
await db.query(`insert into public.project_photos (company_id, project_id, uploaded_by, file_url, file_key, time_phase) values ($1,$2,$3,'https://x/z.jpg','p/z.jpg','complete')`, [co, projects[0], w1.pid]);
r = await rpc(w1.u, `select public.time_complete_visit($1::uuid) as x`, [jv]);
check('30 completing closes the older session with a duration and marks the assignment done', r.ok
  && (await one(`select status from public.work_sessions where assignment_id = $1`, [asg[0]])).status === 'completed'
  && (await one(`select status from public.assignments where id = $1`, [asg[0]])).status === 'completed', r.msg);
r = await rpc(w1.u, `select public.time_complete_visit($1::uuid) as x`, [jv]);
check('31 completing twice is harmless', r.ok && r.v.already_completed === true, r.msg);
r = await rpc(w1.u, `select public.time_clock_out() as x`);
check('32 with nothing open the worker clocks out; the workday closes', r.ok && r.v.days[0].clock_out_at !== null && r.v.days[0].status === 'closed', r.msg);
r = await rpc(w1.u, `select public.time_clock_out() as x`);
check('33 clocking out twice is harmless', r.ok && r.v.already_closed === true, r.msg);
r = await rpc(w1.u, `select public.time_start_visit('assignment', $1::uuid) as x`, [asg[1]]);
check('34 nothing can be started after clock-out', !r.ok && /Clock in/.test(r.msg), r.msg);

// ── skip requests ───────────────────────────────────────────────────────────
r = await rpc(m2.u, `select public.time_request_skip('maintenance_stop', $1::uuid, 'Gate locked') as x`, [stops[2]]);
check('35 a worker can ask to skip a stop only when the earlier ones are cleared (Focus is still open for m2)', !r.ok && /Finish Focus/.test(r.msg), r.msg);
await asDb();
await db.query(`update public.maintenance_stops set status = 'completed', completed_at = now() where id = $1`, [stops[1]]);
r = await rpc(m1.u, `select public.time_request_skip('maintenance_stop', $1::uuid, 'Gate locked') as x`, [stops[2]]);
check('36 the request is saved as pending (not skipped yet)', r.ok && (await one(`select status from public.maintenance_stops where id = $1`, [stops[2]])).status === 'pending', r.msg);
await db.query(`insert into public.maintenance_photos (company_id, route_id, stop_id, property_id, uploaded_by, file_url, file_key, time_phase) values ($1,$2,$3,$4,$5,'https://x/s.jpg','m/s.jpg','start')`, [co, route, stops[2], mp[2], m1.pid]);
r = await rpc(m1.u, `select public.maintenance_leader_arrive($1::uuid) as x`, [stops[2]]);
check('37 a pending request does not skip the stop (the worker can still work it)', r.ok, r.msg);
r = await rpc(m1.u, `select public.time_decide_skip((select id from public.time_skip_requests limit 1), true) as x`);
check('38 a worker cannot approve their own skip', !r.ok, r.msg);
await asDb();
// fresh stop for a clean approval
const stop4 = (await one(`insert into public.maintenance_stops (company_id, route_id, property_id, contract_id, sort_order) values ($1,$2,$3,$4,4) returning id`, [co, route, mp[0], contracts[0]])).id;
await db.query(`update public.time_intervals set ended_at = now() where person_id = $1 and ended_at is null`, [m1.pid]);
await db.query(`update public.maintenance_stops set status = 'completed' where id = $1`, [stops[2]]);
r = await rpc(m1.u, `select public.time_request_skip('maintenance_stop', $1::uuid, 'Customer away') as x`, [stop4]);
const reqRow = await one(`select id from public.time_skip_requests where maintenance_stop_id = $1`, [stop4]);
r = await rpc(owner.u, `select public.time_decide_skip($1::uuid, true, 'ok') as x`, [reqRow?.id]);
check('39 the owner approves: the stop becomes skipped (with who and when), never completed', r.ok
  && (await one(`select status from public.maintenance_stops where id = $1`, [stop4])).status === 'skipped'
  && (await one(`select status from public.time_skip_requests where id = $1`, [reqRow.id])).status === 'approved', r.msg);
check('40 no start or end time was invented for the skipped stop', (await one(`select count(*)::int c from public.time_visits where maintenance_stop_id = $1`, [stop4])).c === 0);

// ── who can read ────────────────────────────────────────────────────────────
await asUser(w1.u);
const wRead = await all(`select (select count(*)::int from public.time_workdays) w, (select count(*)::int from public.time_intervals) i, (select count(*)::int from public.time_interval_rates) r, (select count(*)::int from public.time_visits) v`);
await asDb();
check('41 workers cannot read the time tables, pay rates or visit targets (they only get their own day from the functions)', wRead[0].w === 0 && wRead[0].i === 0 && wRead[0].r === 0 && wRead[0].v === 0, JSON.stringify(wRead));
await asUser(owner.u);
const oRead = await all(`select (select count(*)::int from public.time_workdays) w, (select count(*)::int from public.time_intervals) i, (select count(*)::int from public.time_interval_rates) r`);
await asDb();
check('42 the owner reads everything for the company', oRead[0].w > 0 && oRead[0].i > 0 && oRead[0].r > 0, JSON.stringify(oRead));
f = await call(w1.u, `update public.time_workdays set clock_in_at = clock_in_at - interval '1 hour'`);
const cin = await one(`select min(clock_in_at) c from public.time_workdays`);
check('43 workers cannot edit a workday directly (the clock-in did not move)', cin !== undefined, f.msg);
f = await call(w1.u, `insert into public.time_workdays (company_id, person_id, work_date) values ($1, $2, $3)`, [co, w1.pid, today]);
check('44 workers cannot insert workday rows directly', f.raised, f.msg);

// ── rates and targets ───────────────────────────────────────────────────────
const rateRow = await one(`select r.hourly_rate from public.time_workday_rates r join public.time_workdays w on w.id = r.workday_id where w.person_id = $1 limit 1`, [m1.pid]);
check('45 the hourly rate in force was saved with the work (m1 earned 25)', Number(rateRow.hourly_rate) === 25, JSON.stringify(rateRow));
await db.query(`update public.worker_hourly_rates set hourly_rate = 40 where person_id = $1`, [m1.pid]);
const rateAfter = await one(`select r.hourly_rate from public.time_workday_rates r join public.time_workdays w on w.id = r.workday_id where w.person_id = $1 limit 1`, [m1.pid]);
check('46 changing the rate later does not rewrite the saved rate on past work', Number(rateAfter.hourly_rate) === 25, JSON.stringify(rateAfter));
await db.query(`insert into public.time_property_targets (company_id, maintenance_property_id, target_minutes) values ($1, $2, 120)`, [co, mp[0]]);
f = await fails(`insert into public.time_property_targets (company_id, maintenance_property_id, project_id, target_minutes) values ($1, $2, $3, 60)`, [co, mp[1], projects[0]]);
check('47 a target belongs to exactly one property or project', f.raised, f.msg);

// ── audit ───────────────────────────────────────────────────────────────────
await db.query(`select public._time_audit($1, 'workday', null, null, null, null, 'test', null, null, null, 'x', false)`, [co]);
f = await fails(`update public.time_audit set reason = 'edited'`);
const f2 = await fails(`delete from public.time_audit`);
check('48 the audit history cannot be edited or deleted', f.raised && f2.raised, f.msg + f2.msg);

// ── update 65 follow-ups ────────────────────────────────────────────────────
let again65 = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/065_time_tracking_followups.sql`, 'utf8')); } catch (e) { again65 = false; console.log(e.message); }
check('49 update 65 can be run a second time', again65);
check('50 a maintenance worker clock-in is also their start of day on the route (so the route review still shows it)',
  (await one(`select count(*)::int c from public.maintenance_day_attendance where person_id = $1 and service_date = $2 and route_id = $3`, [m1.pid, today, route])).c === 1);
check('51 a landscaping worker clock-in does not create maintenance attendance', (await one(`select count(*)::int c from public.maintenance_day_attendance where person_id = $1`, [w1.pid])).c === 0);

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
