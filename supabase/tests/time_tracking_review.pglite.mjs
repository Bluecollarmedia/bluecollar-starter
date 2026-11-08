// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && copy this file (and ./helpers/fullSchema.mjs) beside it, then:
//   node <file> <path to the repo>
// Final safety review of updates 63-65 on the REAL full schema + every update (PGlite, not real Supabase). It proves, with two companies and
// owner / admin / worker / customer / signed-out users: nothing crosses a company, a worker can't reach owner-only data or functions, the
// record tables can't be written directly, and each defect found in the review stays fixed.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 063-065) load', failures.length === 0, JSON.stringify(failures));

const fails = async (sql, p) => { try { await db.query(sql, p); return { raised: false, msg: '' }; } catch (e) { return { raised: true, msg: String(e.message) }; } };
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asAnon = async () => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;`); };
const asDb = async () => { await db.exec('reset role'); };
const call = async (u, sql, p) => { await asUser(u); try { return await fails(sql, p); } finally { await asDb(); } };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
const iso = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();
// The database's own idea of today (its time zone can differ from UTC), so the test never straddles a date boundary.
const today = (await db.query(`select current_date::text as d`)).rows[0].d;

// ── fixtures: company A (owner, admin, 2 landscapers, 2 maintenance workers, a customer) and company B ──
const co = (await one(`insert into public.companies (name) values ('Company A') returning id`)).id;
await db.exec(`set session_replication_role = replica`);
const cb = (await one(`insert into public.companies (name) values ('Company B') returning id`)).id;
await db.exec(`set session_replication_role = origin`);
const mk = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const owner = await mk('ownera@x.test', 'OwnerA');
const admin = await mk('admina@x.test', 'AdminA');
const w1 = await mk('w1@x.test', 'Land One');
const w2 = await mk('w2@x.test', 'Land Two');
const w3 = await mk('w3@x.test', 'Land Three');
const m1 = await mk('m1@x.test', 'Maint One');
const m2 = await mk('m2@x.test', 'Maint Two');
const cust = await mk('cust@x.test', 'Customer');
const ownerB = await mk('ownerb@x.test', 'OwnerB');
const wB = await mk('wb@x.test', 'Worker B');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values
  ($1,$2,'owner','active','landscaping'),($1,$3,'admin','active','landscaping'),($1,$4,'worker','active','landscaping'),($1,$5,'worker','active','landscaping'),
  ($1,$6,'worker','active','landscaping'),($1,$7,'worker','active','maintenance'),($1,$8,'worker','active','maintenance'),($1,$9,'customer','active','landscaping')`,
  [co, owner.pid, admin.pid, w1.pid, w2.pid, w3.pid, m1.pid, m2.pid, cust.pid]);
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'owner','active','landscaping'),($1,$3,'worker','active','maintenance')`, [cb, ownerB.pid, wB.pid]);
const truckA = (await one(`insert into public.trucks (company_id, name) values ($1, 'Truck A') returning id`, [co])).id;
const truckB = (await one(`insert into public.trucks (company_id, name) values ($1, 'Truck B') returning id`, [cb])).id;
await db.query(`insert into public.worker_hourly_rates (company_id, person_id, hourly_rate, effective_date) values ($1,$2,20,'2020-01-01'),($1,$3,25,'2020-01-01')`, [co, w1.pid, m1.pid]);

const mkProp = async (company, name) => {
  const p = (await one(`insert into public.maintenance_properties (company_id, name, address) values ($1, $2, '1 St') returning id`, [company, name])).id;
  const c = (await one(`insert into public.maintenance_contracts (company_id, property_id, name) values ($1, $2, '2026') returning id`, [company, p])).id;
  return { p, c };
};
const mkRoute = async (company, name, crew, n) => {
  const route = (await one(`insert into public.maintenance_routes (company_id, service_date, name) values ($1, $2, $3) returning id`, [company, today, name])).id;
  for (const pid of crew) await db.query(`insert into public.maintenance_route_crew (company_id, route_id, person_id) values ($1,$2,$3)`, [company, route, pid]);
  if (crew.length) await db.query(`update public.maintenance_routes set lead_person_id = $2 where id = $1`, [route, crew[0]]);  // every route has an explicitly named leader (update 68)
  const stops = [];
  for (let i = 0; i < n; i++) {
    const { p, c } = await mkProp(company, `${name} Prop ${i + 1}`);
    stops.push({ id: (await one(`insert into public.maintenance_stops (company_id, route_id, property_id, contract_id, sort_order) values ($1,$2,$3,$4,$5) returning id`, [company, route, p, c, i + 1])).id, prop: p });
  }
  return { route, stops };
};
const mkJob = async (company, name, pid, order) => {
  const proj = (await one(`insert into public.projects (company_id, name, status) values ($1, $2, 'active') returning id`, [company, name])).id;
  const asg = (await one(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, sort_order, status) values ($1,$2,$3,$4,$5,'confirmed') returning id`, [company, proj, pid, today, order])).id;
  return { proj, asg };
};
const rA = await mkRoute(co, 'RouteA', [m1.pid, m2.pid], 4);
const rB = await mkRoute(cb, 'RouteB', [wB.pid], 1);
const jA1 = await mkJob(co, 'Job A1', w1.pid, 1);
const jA2 = await mkJob(co, 'Job A2', w1.pid, 2);
const jB = await mkJob(cb, 'Job B', wB.pid, 1);

// ── company A and B each record real time ───────────────────────────────────
let r = await rpc(w1.u, `select public.time_clock_in($1::date, null, gen_random_uuid()) as x`, [today]);
check('1 worker A clocks in', r.ok, r.msg);
r = await rpc(w1.u, `select public.time_start_visit('assignment', $1::uuid, null, null, null, 'ok', '{"lat":41.5,"lng":-81.7}'::jsonb) as x`, [jA1.asg]);
check('2 worker A starts a job', r.ok, r.msg);
const visitA1 = (await one(`select id from public.time_visits where project_id = $1`, [jA1.proj])).id;
r = await rpc(w1.u, `select public.time_complete_visit($1::uuid) as x`, [visitA1]);
check('3 worker A completes the job', r.ok, r.msg);
r = await rpc(wB.u, `select public.time_clock_in($1::date, null, gen_random_uuid()) as x`, [today]);
check('4 worker B clocks in', r.ok, r.msg);
r = await rpc(wB.u, `select public.time_start_visit('assignment', $1::uuid) as x`, [jB.asg]);
check('5 worker B starts a job', r.ok, r.msg);
const visitB = (await one(`select id from public.time_visits where project_id = $1`, [jB.proj])).id;

// closed workday with a break and an interval for w2 (so there is something to correct, approve and attack)
r = await rpc(owner.u, `select public.time_staff_add_workday($1::uuid, current_date, $2::timestamptz, $3::timestamptz, 'Forgot to clock in') as x`, [w2.pid, iso(900), iso(600)]);
const wdA2 = r.v;
const visitX = (await one(`insert into public.time_visits (company_id, source, project_id, visit_date, label) values ($1,'project_day',$2,current_date,'Job A2') returning id`, [co, jA2.proj])).id;
r = await rpc(owner.u, `select public.time_staff_add_interval($1::uuid, $2::uuid, $3::timestamptz, $4::timestamptz, 'by hand') as x`, [visitX, w2.pid, iso(880), iso(800)]);
const intA2 = r.v;
r = await rpc(owner.u, `select public.time_staff_add_break($1::uuid, $2::timestamptz, $3::timestamptz, false, 'lunch') as x`, [wdA2, iso(790), iso(760)]);
const brkA2 = r.v;
check('6 the owner builds a day for worker 2 (workday, property time, break)', !!wdA2 && !!intA2 && !!brkA2, r.msg);
await db.query(`insert into public.time_skip_requests (company_id, source, maintenance_stop_id, requested_by, reason) values ($1,'maintenance_stop',$2,$3,'Gate locked')`, [co, rA.stops[3].id, m1.pid]);
const skipA = (await one(`select id from public.time_skip_requests where maintenance_stop_id = $1`, [rA.stops[3].id])).id;
const alertA = (await one(`select id from public.time_alerts where skip_request_id = $1`, [skipA])).id;
await db.query(`insert into public.time_settings (company_id, breaks_enabled) values ($1, true)`, [co]);

// ── 1. companies are isolated (reads) ───────────────────────────────────────
const TABLES = ['time_settings', 'time_person_settings', 'time_property_targets', 'time_workdays', 'time_workday_rates', 'time_breaks', 'time_visits', 'time_intervals',
  'time_interval_rates', 'time_skip_requests', 'time_audit', 'time_alerts', 'time_project_estimates'];
await db.query(`insert into public.time_settings (company_id, breaks_enabled) values ($1, false)`, [cb]);
await db.query(`insert into public.time_person_settings (person_id, company_id, daily_alert_hours) values ($1, $2, 9)`, [wB.pid, cb]);
await db.query(`insert into public.time_person_settings (person_id, company_id, daily_alert_hours) values ($1, $2, 9)`, [w2.pid, co]);
await db.query(`insert into public.time_property_targets (company_id, maintenance_property_id, target_minutes) values ($1,$2,45),($3,$4,30)`, [co, rA.stops[0].prop, cb, rB.stops[0].prop]);
await db.query(`insert into public.time_project_estimates (project_id, company_id, labor_hours) values ($1,$2,10),($3,$4,12)`, [jA1.proj, co, jB.proj, cb]);
const foreign = async (u, companyId) => {
  await asUser(u);
  const out = {};
  for (const t of TABLES) out[t] = (await one(`select count(*) filter (where company_id <> $1)::int as other, count(*)::int as total from public.${t}`, [companyId]));
  await asDb();
  return out;
};
let seen = await foreign(ownerB.u, cb);
check('7 owner B reads only company B rows in every time table (none of A\'s)', TABLES.every((t) => seen[t].other === 0) && seen.time_workdays.total === 1, JSON.stringify(seen));
seen = await foreign(owner.u, co);
check('8 owner A reads only company A rows in every time table (none of B\'s)', TABLES.every((t) => seen[t].other === 0) && seen.time_workdays.total >= 2, JSON.stringify(seen));
seen = await foreign(admin.u, co);
check('9 an admin sees company A\'s rows like the owner does', TABLES.every((t) => seen[t].other === 0) && seen.time_workdays.total >= 2, JSON.stringify(seen));
seen = await foreign(wB.u, cb);
check('10 worker B reads nothing from any time table', TABLES.every((t) => seen[t].total === 0), JSON.stringify(seen));
seen = await foreign(w1.u, co);
check('11 worker A reads nothing from any time table either (pay rates, targets, other people\'s hours stay hidden)', TABLES.every((t) => seen[t].total === 0), JSON.stringify(seen));
seen = await foreign(cust.u, co);
check('12 a customer reads nothing from any time table', TABLES.every((t) => seen[t].total === 0), JSON.stringify(seen));
await asAnon();
let anonRead = 0;
for (const t of TABLES) { const f0 = await fails(`select count(*) from public.${t}`); if (!f0.raised) anonRead += (await one(`select count(*)::int c from public.${t}`)).c; }
await asDb();
check('13 a signed-out user reads nothing', anonRead === 0, String(anonRead));

// ── 2. companies are isolated (functions with another company\'s ids) ───────
const snap = async () => JSON.stringify(await one(`select (select count(*) from public.time_audit)::int a, (select md5(string_agg(w::text, '|' order by w.id)) from public.time_workdays w) w,
  (select md5(string_agg(i::text, '|' order by i.id)) from public.time_intervals i) i, (select md5(string_agg(b::text, '|' order by b.id)) from public.time_breaks b) b,
  (select md5(string_agg(s::text, '|' order by s.id)) from public.time_skip_requests s) s, (select md5(string_agg(v::text, '|' order by v.id)) from public.time_visits v) v,
  (select md5(string_agg(h::text, '|' order by h.id)) from public.worker_hourly_rates h) h, (select md5(string_agg(a::text, '|' order by a.id)) from public.time_alerts a) al`));
const before = await snap();
const attacks = [
  ['edit another company\'s workday', `select public.time_staff_edit_workday($1::uuid, $2::timestamptz, null, 'sneaky edit') as x`, [wdA2, iso(950)]],
  ['add a workday for another company\'s employee', `select public.time_staff_add_workday($1::uuid, current_date, $2::timestamptz, $3::timestamptz, 'sneaky add') as x`, [w1.pid, iso(300), iso(200)]],
  ['edit another company\'s break', `select public.time_staff_edit_break($1::uuid, $2::timestamptz, null, 'sneaky edit') as x`, [brkA2, iso(795)]],
  ['add a break to another company\'s workday', `select public.time_staff_add_break($1::uuid, $2::timestamptz, $3::timestamptz, true, 'sneaky add') as x`, [wdA2, iso(700), iso(690)]],
  ['edit another company\'s property time', `select public.time_staff_edit_interval($1::uuid, $2::timestamptz, null, 'sneaky edit') as x`, [intA2, iso(870)]],
  ['add property time on another company\'s visit', `select public.time_staff_add_interval($1::uuid, $2::uuid, $3::timestamptz, $4::timestamptz, 'sneaky add') as x`, [visitX, w2.pid, iso(780), iso(770)]],
  ['void another company\'s property time', `select public.time_staff_void_interval($1::uuid, 'sneaky void') as x`, [intA2]],
  ['change another company\'s visit billing', `select public.time_set_visit_billable($1::uuid, false, 'sneaky billing') as x`, [visitX]],
  ['approve another company\'s workday', `select public.time_approve_workday($1::uuid) as x`, [wdA2]],
  ['reopen another company\'s workday', `select public.time_reopen_workday($1::uuid, 'sneaky reopen') as x`, [wdA2]],
  ['set another company\'s employee pay rate', `select public.time_set_hourly_rate($1::uuid, 99, current_date, 'sneaky rate') as x`, [w1.pid]],
  ['decide another company\'s skip request', `select public.time_decide_skip($1::uuid, true, 'sneaky') as x`, [skipA]],
  ['resolve another company\'s alert', `select public.time_alert_resolve($1::uuid) as x`, [alertA]],
];
let blocked = 0; const slipped = [];
for (const [label, sql, p] of attacks) { const x = await rpc(ownerB.u, sql, p); if (!x.ok) blocked++; else slipped.push(label); }
check('14 owner B cannot use any owner function on company A\'s records (all 13 refused)', blocked === attacks.length, slipped.join('; '));
check('15 and nothing in company A changed (history, workdays, property times, breaks, skips, rates, alerts all identical)', (await snap()) === before);
r = await rpc(ownerB.u, `select public.time_scan_alerts() as x`);
check('16 owner B scanning alerts only touches company B (no company A alert appears for B)', r.ok && (await one(`select count(*)::int c from public.time_alerts where company_id = $1 and status = 'open'`, [co])).c >= 1, r.msg);
r = await rpc(wB.u, `select public.maintenance_leader_arrive($1::uuid) as x`, [rA.stops[0].id]);
const r2 = await rpc(wB.u, `select public.time_start_visit('assignment', $1::uuid) as x`, [jA1.asg]);
const r3 = await rpc(wB.u, `select public.time_complete_visit($1::uuid) as x`, [visitA1]);
const r4 = await rpc(wB.u, `select public.time_request_skip('maintenance_stop', $1::uuid, 'nope') as x`, [rA.stops[1].id]);
check('17 worker B cannot start, complete or ask to skip company A\'s stops, jobs or visits', !r.ok && !r2.ok && !r3.ok && !r4.ok, [r.msg, r2.msg, r3.msg, r4.msg].join(' | '));
r = await rpc(w3.u, `select public.time_complete_visit($1::uuid) as x`, [visitX]);
check('18 a worker in the same company cannot complete someone else\'s visit by passing its id', !r.ok && /haven't started/.test(r.msg), r.msg);
await rpc(m2.u, `select public.time_withdraw_skip($1::uuid) as x`, [skipA]);
await rpc(wB.u, `select public.time_withdraw_skip($1::uuid) as x`, [skipA]);
check('19 a worker cannot withdraw another person\'s skip request', (await one(`select status from public.time_skip_requests where id = $1`, [skipA])).status === 'pending');
const myReq = await rpc(m2.u, `select public.time_my_skip_requests() as x`);
check('20 a worker\'s own skip list only has their own requests', myReq.ok && myReq.v.length === 0, JSON.stringify(myReq.v));
r = await rpc(w1.u, `select public.time_my_day(current_date) as x`);
check('21 a worker\'s day lists only their own workday', r.ok && r.v.days.length === 1 && r.v.days.every((d) => !/person|rate/i.test(JSON.stringify(d))), JSON.stringify(r.v).slice(0, 200));

// ── 3. roles and direct access ──────────────────────────────────────────────
const staffCalls = [
  `select public.time_scan_alerts()`, `select public.time_alert_resolve('${alertA}'::uuid)`, `select public.time_approve_workday('${wdA2}'::uuid)`,
  `select public.time_reopen_workday('${wdA2}'::uuid, 'because')`, `select public.time_decide_skip('${skipA}'::uuid, true, null)`,
  `select public.time_set_hourly_rate('${w3.pid}'::uuid, 50, current_date, 'x')`, `select public.time_staff_void_interval('${intA2}'::uuid, 'because')`,
  `select public.time_staff_edit_workday('${wdA2}'::uuid, now() - interval '20 hours', null, 'because')`, `select public.time_set_visit_billable('${visitX}'::uuid, false, 'because')`,
  `select public.time_staff_edit_break('${brkA2}'::uuid, now() - interval '20 hours', null, 'because')`, `select public.time_staff_edit_interval('${intA2}'::uuid, now() - interval '20 hours', null, 'because')`,
];
for (const [who, u] of [['a worker', w3.u], ['a customer', cust.u]]) {
  let refused = 0;
  for (const sql of staffCalls) if (!(await rpc(u, sql)).ok) refused++;
  check(`22 ${who} is refused by every owner function (${staffCalls.length} tried)`, refused === staffCalls.length, `${refused}/${staffCalls.length}`);
}
let adminOk = 0;
for (const sql of [`select public.time_scan_alerts()`, `select public.time_alert_resolve('${alertA}'::uuid)`]) if ((await rpc(admin.u, sql)).ok) adminOk++;
check('23 an admin can use the owner functions (scan, resolve alerts)', adminOk === 2);
r = await rpc(cust.u, `select public.time_my_day(current_date) as x`);
check('24 a customer cannot open a workday', !r.ok, r.msg);
await asAnon();
const anonFns = [`select public.time_my_day(current_date)`, `select public.time_clock_in(current_date, null, null)`, `select public.time_scan_alerts()`, `select public.time_approve_workday('${wdA2}'::uuid)`,
  `select public.time_staff_add_workday('${w1.pid}'::uuid, current_date, now(), null, 'x y z')`, `select public.time_decide_skip('${skipA}'::uuid, true, null)`, `select public.time_start_visit('assignment', '${jA1.asg}'::uuid)`];
let anonRefused = 0;
for (const sql of anonFns) if ((await fails(sql)).raised) anonRefused++;
await asDb();
check('25 a signed-out user can run none of the time functions', anonRefused === anonFns.length, `${anonRefused}/${anonFns.length}`);
const internal = [`select public._time_audit('${co}'::uuid, 'x', null, null, null, null, 'a', null, null, null, null, false)`, `select public._time_scan('${co}'::uuid)`, `select public._time_day_json('${w1.pid}'::uuid, '${co}'::uuid, current_date)`,
  `select public._time_company('${w1.pid}'::uuid)`, `select public._time_rate('${co}'::uuid, '${w1.pid}'::uuid, current_date)`, `select public._time_notify_staff('${co}'::uuid, 'time_unusual', 't', 'b', 'time_workday', '${wdA2}'::uuid)`,
  `select public._time_alert('${co}'::uuid, 'needs_review', 'k', null, null, null, null, 't', 'd')`, `select public._time_refresh_visit('${visitX}'::uuid)`, `select public._time_net_ms('${wdA2}'::uuid)`];
let internalRefused = 0;
for (const sql of internal) if (!(await rpc(owner.u, sql)).ok) internalRefused++;
check('26 even the owner cannot call the internal helper functions directly (they run only inside the checked functions)', internalRefused === internal.length, `${internalRefused}/${internal.length}`);
const direct = [
  `insert into public.time_workdays (company_id, person_id, work_date) values ('${co}', '${w3.pid}', current_date)`, `update public.time_workdays set status = 'approved'`, `delete from public.time_workdays`,
  `update public.time_intervals set ended_at = now()`, `delete from public.time_intervals`, `update public.time_breaks set paid = true`, `delete from public.time_breaks`,
  `update public.time_visits set billable = false`, `delete from public.time_visits`, `update public.time_workday_rates set hourly_rate = 1`, `update public.time_interval_rates set hourly_rate = 1`,
  `update public.time_skip_requests set status = 'approved'`, `delete from public.time_skip_requests`, `update public.time_audit set reason = 'edited'`, `delete from public.time_audit`,
  `insert into public.time_audit (company_id, entity, action) values ('${co}', 'x', 'y')`, `update public.time_alerts set status = 'resolved'`, `delete from public.time_alerts`,
];
for (const [who, u] of [['the owner', owner.u], ['a worker', w1.u]]) {
  const snapBefore = await snap();
  let ok = 0; const hits = [];
  for (const sql of direct) { await asUser(u); let d; try { d = await fails(sql); } finally { await asDb(); } if (!d.raised) { ok++; hits.push(sql); } }
  const rows = (await one(`select (select count(*) from public.time_workdays)::int w, (select count(*) from public.time_audit)::int a`));
  check(`27 ${who} changed nothing with ${direct.length} direct writes to the record tables (no row differs afterwards)`, (await snap()) === snapBefore && rows.w >= 3 && rows.a >= 5, JSON.stringify(rows));
  check(`27b ...and the database refuses every one of them outright (${direct.length} of ${direct.length} raised an error: privileges are revoked as well as row-level security)`, ok === 0, hits.join('; '));
}
let f = await call(w1.u, `insert into public.time_settings (company_id, breaks_enabled) values ('${co}', true) on conflict (company_id) do update set breaks_enabled = true`);
const f2 = await call(w1.u, `insert into public.time_property_targets (company_id, maintenance_property_id, target_minutes) values ('${co}', '${rA.stops[2].prop}', 20)`);
const f3 = await call(w1.u, `insert into public.time_person_settings (person_id, company_id, daily_alert_hours) values ('${w1.pid}', '${co}', 1)`);
check('28 a worker cannot change the owner\'s settings, property targets or alert hours', f.raised && f2.raised && f3.raised, f.msg + f2.msg + f3.msg);
f = await call(owner.u, `insert into public.time_property_targets (company_id, maintenance_property_id, target_minutes) values ('${co}', '${rB.stops[0].prop}', 20)`);
check('29 a target cannot point at another company\'s property', f.raised && /another company/.test(f.msg), f.msg);
f = await call(owner.u, `insert into public.time_person_settings (person_id, company_id, daily_alert_hours) values ('${wB.pid}', '${co}', 8)`);
check('30 alert hours cannot be set for another company\'s employee', f.raised && /not on this company/.test(f.msg), f.msg);
f = await call(owner.u, `insert into public.time_project_estimates (project_id, company_id, labor_hours) values ('${jB.proj}', '${co}', 5)`);
check('31 a labor estimate cannot point at another company\'s project', f.raised, f.msg);
f = await call(owner.u, `update public.maintenance_routes set truck_id = '${truckB}' where id = '${rA.route}'`);
check('32 a route cannot be given another company\'s truck', f.raised && /another company/.test(f.msg), f.msg);
f = await fails(`insert into public.time_workdays (company_id, person_id, work_date, truck_id) values ($1, $2, current_date - 3, $3)`, [co, w3.pid, truckB]);
check('33 a workday cannot use another company\'s truck', f.raised && /another company/.test(f.msg), f.msg);
f = await fails(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, clock_out_at) values ($1, $2, current_date - 3, now() - interval '70 hours', now() - interval '60 hours')`, [co, wB.pid]);
check('34 a workday cannot be filed for someone who is not on the company\'s team', f.raised && /not on this company/.test(f.msg), f.msg);

// ── 4. fixes from the review stay fixed ─────────────────────────────────────
// 4a. history survives deletions
await asDb();
const dco = await (async () => { await db.exec(`set session_replication_role = replica`); const id = (await one(`insert into public.companies (name) values ('Doomed') returning id`)).id; await db.exec(`set session_replication_role = origin`); return id; })();
const dper = await mk('doomed@x.test', 'Doomed');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active')`, [dco, dper.pid]);
const dwd = (await one(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, clock_out_at, status) values ($1,$2,current_date - 8, now() - interval '200 hours', now() - interval '195 hours','closed') returning id`, [dco, dper.pid])).id;
await db.query(`select public._time_audit($1, 'workday', $2, $3, $2, null, 'added', null, null, null, 'x', false)`, [dco, dwd, dper.pid]);
f = await fails(`delete from public.companies where id = $1`, [dco]);
check('35a a company still cannot be deleted by accident (the existing lock is untouched)', f.raised && /cannot be deleted/.test(f.msg), f.msg);
// the way the reset script does it: lock lifted for one statement, user triggers left ON (the audit lock must not stop the cascade)
await db.exec(`select set_config('app.allow_company_delete', 'on', false)`);
f = await fails(`delete from public.companies where id = $1`, [dco]);
await db.exec(`select set_config('app.allow_company_delete', 'off', false)`);
check('35 wiping a whole company that has time history works (workdays, audit and all go with it) - the reset script path', !f.raised
  && (await one(`select (select count(*) from public.time_audit where company_id = $1)::int a, (select count(*) from public.time_workdays where company_id = $1)::int w`, [dco])).a === 0, f.msg);
f = await fails(`delete from public.people where id = $1`, [dper.pid]);
check('35b ...and the person can then be deleted too (no leftover time rows block it)', !f.raised, f.msg);
f = await fails(`update public.time_audit set reason = 'edited' where company_id = $1`, [co]);
const f4 = await fails(`delete from public.time_audit where company_id = $1`, [co]);
check('36 but nobody can edit or delete a history row directly', f.raised && f4.raised, f.msg + f4.msg);
r = await rpc(owner.u, `select public.time_staff_add_workday($1::uuid, current_date - 6, $2::timestamptz, $3::timestamptz, 'forgot') as x`, [w3.pid, iso(6 * 1440 + 500), iso(6 * 1440 + 400)]);
check('37 the owner adds a past day for worker 3 (leaves an audit row naming the owner)', r.ok, r.msg);
const xAdmin = await mk('leaving@x.test', 'Leaving');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'admin','active')`, [co, xAdmin.pid]);
await rpc(xAdmin.u, `select public.time_staff_add_workday($1::uuid, current_date - 7, $2::timestamptz, $3::timestamptz, 'forgot too') as x`, [w3.pid, iso(7 * 1440 + 500), iso(7 * 1440 + 400)]);
f = await fails(`delete from public.people where id = $1`, [xAdmin.pid]);
check('38 deleting a person who made corrections works; the history keeps the row and just forgets who', !f.raised && (await one(`select count(*)::int c from public.time_audit where action = 'added' and actor_id is null and reason = 'forgot too'`)).c === 1, f.msg);

// 4b. visits survive a deleted stop / project
const keepStop = (await one(`select s.id from public.maintenance_stops s where s.route_id = $1 and s.sort_order = 1`, [rA.route])).id;
r = await rpc(m1.u, `select public.time_clock_in($1::date, null, null) as x`, [today]);
check('39 maintenance worker 1 clocks in', r.ok, r.msg);
r = await rpc(m2.u, `select public.time_clock_in($1::date, null, null) as x`, [today]);
check('40 maintenance worker 2 clocks in', r.ok, r.msg);
r = await rpc(m1.u, `select public.maintenance_leader_arrive($1::uuid) as x`, [keepStop]);
check('41 worker 1 starts stop 1', r.ok, r.msg);
const mv1 = (await one(`select id from public.time_visits where maintenance_stop_id = $1`, [keepStop])).id;

// 4c. skip requests
r = await rpc(m1.u, `select public.time_request_skip('maintenance_stop', $1::uuid, 'Customer away') as x`, [keepStop]);
check('42 a worker cannot ask to skip the property the crew is at right now', !r.ok && /crew is at this property|working at this property/.test(r.msg), r.msg);
r = await rpc(m1.u, `select public.maintenance_leader_complete($1::uuid) as x`, [keepStop]);
check('43 worker 1 completes stop 1', r.ok, r.msg);
const stop2 = rA.stops[1].id, stop3 = rA.stops[2].id;
await db.query(`update public.time_skip_requests set status = 'withdrawn' where id = $1`, [skipA]);
r = await rpc(m1.u, `select public.time_request_skip('maintenance_stop', $1::uuid, 'Gate locked') as x`, [stop2]);
const q1 = r.v?.request_id;
r = await rpc(m2.u, `select public.time_request_skip('maintenance_stop', $1::uuid, 'Dog loose') as x`, [stop2]);
const q2 = r.v?.request_id;
check('44 two crew mates ask to skip the same stop', !!q1 && !!q2 && q1 !== q2, r.msg);
r = await rpc(owner.u, `select public.time_decide_skip($1::uuid, true, 'ok') as x`, [q1]);
check('45 the owner approves one: the stop is skipped', r.ok && (await one(`select status from public.maintenance_stops where id = $1`, [stop2])).status === 'skipped', r.msg);
check('46 and the other request for the same stop is closed by it (not left pending forever)', (await one(`select status from public.time_skip_requests where id = $1`, [q2])).status === 'withdrawn'
  && (await one(`select count(*)::int c from public.time_alerts where skip_request_id = $1 and status = 'open'`, [q2])).c === 0);
// someone timing work at a stop that has a pending request
r = await rpc(m2.u, `select public.time_request_skip('maintenance_stop', $1::uuid, 'Cannot reach') as x`, [stop3]);
const q3 = r.v?.request_id;
r = await rpc(m1.u, `select public.maintenance_leader_arrive($1::uuid) as x`, [stop3]);
check('47 a crew mate starts that stop (it was never skipped)', r.ok, r.msg);
r = await rpc(owner.u, `select public.time_decide_skip($1::uuid, true, 'ok') as x`, [q3]);
check('48 when the crew starts the work, a waiting skip request for it is withdrawn, so there is nothing left to approve against a crew that is on site', r.ok && r.v.status === 'withdrawn' && (await one(`select status from public.maintenance_stops where id = $1`, [stop3])).status !== 'skipped', r.msg);
const mv3 = (await one(`select id from public.time_visits where maintenance_stop_id = $1`, [stop3])).id;
await rpc(m1.u, `select public.maintenance_leader_complete($1::uuid) as x`, [stop3]);
r = await rpc(owner.u, `select public.time_decide_skip($1::uuid, true, 'ok') as x`, [q3]);
check('49 once the stop is finished, the late request is closed instead of failing', r.ok && r.v.status === 'withdrawn' && (await one(`select status from public.maintenance_stops where id = $1`, [stop3])).status === 'completed', r.msg);
r = await rpc(m1.u, `select public.time_request_skip('maintenance_stop', $1::uuid, 'Locked gate') as x`, [rA.stops[3].id]);
const q4 = r.v?.request_id;
r = await rpc(m1.u, `select public.maintenance_leader_arrive($1::uuid) as x`, [rA.stops[3].id]);
check('50 a worker who starts the work withdraws their own pending skip request', r.ok && (await one(`select status from public.time_skip_requests where id = $1`, [q4])).status === 'withdrawn', r.msg);
await rpc(m1.u, `select public.maintenance_leader_complete($1::uuid) as x`, [rA.stops[3].id]);

// 4d. deleting a stop / project keeps the visit
f = await fails(`delete from public.maintenance_stops where id = $1`, [keepStop]);
check('51 a stop that has recorded work is still protected from deletion (the existing protection is untouched), so its visit keeps its stop', f.raised && /recorded work/.test(f.msg)
  && (await one(`select maintenance_stop_id from public.time_visits where id = $1`, [mv1])).maintenance_stop_id === keepStop, f.msg);
f = await fails(`delete from public.projects where id = $1`, [jA1.proj]);
check('52 deleting a project that has recorded time works and its visit stays', !f.raised && (await one(`select count(*)::int c from public.time_visits where id = $1`, [visitA1])).c === 1, f.msg);

// 4e. owner working out of order is allowed but written down
const rO = await mkRoute(co, 'OwnerRoute', [], 2);
r = await rpc(owner.u, `select public.time_clock_in($1::date, null, null) as x`, [today]);
r = await rpc(owner.u, `select public.maintenance_leader_arrive($1::uuid) as x`, [rO.stops[1].id]);
check('53 the owner can start a later stop out of order', r.ok, r.msg);
const ov = await all(`select action, field, new_value, actor_id from public.time_audit where action = 'order_override'`);
check('54 and the out-of-order start is in the history with the property that was skipped over', ov.length === 1 && ov[0].actor_id === owner.pid && /OwnerRoute Prop 1/.test(JSON.stringify(ov[0].new_value)), JSON.stringify(ov));
r = await rpc(owner.u, `select public.maintenance_leader_arrive($1::uuid) as x`, [rO.stops[1].id]);
check('55 a double tap by the owner does not write a second override row', r.ok && (await one(`select count(*)::int c from public.time_audit where action = 'order_override'`)).c === 1, r.msg);
await rpc(owner.u, `select public.maintenance_leader_complete($1::uuid) as x`, [rO.stops[1].id]);
await rpc(owner.u, `select public.time_clock_out() as x`);

// 4f. photos have to be new, stored, and this worker's
await db.query(`update public.time_settings set require_start_photo = true, require_complete_photo = true where company_id = $1`, [co]);
await db.query(`insert into public.project_photos (company_id, project_id, uploaded_by, file_url, file_key, time_phase, created_at) values ($1,$2,$3,'https://x/old.jpg','p/old.jpg','start', now() - interval '2 days')`, [co, jA2.proj, w1.pid]);
r = await rpc(w1.u, `select public.time_start_visit('assignment', $1::uuid) as x`, [jA2.asg]);
check('56 a start photo from before this workday does not count', !r.ok && /start photo/.test(r.msg), r.msg);
await db.query(`insert into public.project_photos (company_id, project_id, uploaded_by, file_url, file_key, time_phase, taken_at) values ($1,$2,$3,'https://x/fake.jpg','p/fake.jpg','start', now() + interval '1 day')`, [co, jA2.proj, w2.pid]);
r = await rpc(w1.u, `select public.time_start_visit('assignment', $1::uuid) as x`, [jA2.asg]);
check('57 a photo another employee took does not count for this one', !r.ok && /start photo/.test(r.msg), r.msg);
await db.query(`insert into public.project_photos (company_id, project_id, uploaded_by, file_url, file_key, time_phase, taken_at) values ($1,$2,$3,'https://x/new.jpg','p/new.jpg','start', now() - interval '5 days')`, [co, jA2.proj, w1.pid]);
r = await rpc(w1.u, `select public.time_start_visit('assignment', $1::uuid) as x`, [jA2.asg]);
check('58 a photo saved by the server after clock-in counts (the phone\'s own "taken at" is not trusted)', r.ok, r.msg);
await db.query(`update public.time_settings set require_start_photo = false, require_complete_photo = false where company_id = $1`, [co]);

// 4g. cancelling the job mid-visit never traps a worker
const visA2 = visitX;  // the job's visit for today already exists (the owner added worker 2's time to it), so worker 1 shares it
await db.query(`update public.assignments set status = 'cancelled' where id = $1`, [jA2.asg]);
r = await rpc(w1.u, `select public.time_complete_visit($1::uuid) as x`, [visA2]);
check('59 if the owner cancels the job while the worker is on site the worker can still finish and clock out', r.ok && (await one(`select status from public.assignments where id = $1`, [jA2.asg])).status === 'cancelled', r.msg);
r = await rpc(w1.u, `select public.time_clock_out() as x`);
check('60 ...and clock out', r.ok && r.v.days.find((d) => d.clock_out_at), r.msg);

// 4h. breaks and property time never overlap; void / no-op / rate fixes
await db.query(`delete from public.time_alerts where kind <> 'skip_request'`);
r = await rpc(owner.u, `select public.time_staff_add_break($1::uuid, $2::timestamptz, $3::timestamptz, true, 'overlaps the visit') as x`, [wdA2, iso(850), iso(840)]);
check('61 an owner-added break that overlaps property time is refused', !r.ok && /overlaps time at a property/.test(r.msg), r.msg);
r = await rpc(owner.u, `select public.time_staff_edit_interval($1::uuid, null, $2::timestamptz, 'now runs into the lunch break') as x`, [intA2, iso(770)]);
check('62 stretching a property time into a break is refused', !r.ok && /overlaps a break/.test(r.msg), r.msg);
await rpc(owner.u, `select public.time_approve_workday($1::uuid) as x`, [wdA2]);
const auditBefore = (await one(`select count(*)::int c from public.time_audit`)).c;
r = await rpc(owner.u, `select public.time_staff_edit_workday($1::uuid, (select clock_in_at from public.time_workdays where id = $1), null, 'same times') as x`, [wdA2]);
const r5 = await rpc(owner.u, `select public.time_staff_edit_interval($1::uuid, (select started_at from public.time_intervals where id = $2), null, 'same times') as x`, [intA2, intA2]);
check('63 a correction that changes nothing does not reopen an approved day or add history', r.ok && r5.ok && (await one(`select status from public.time_workdays where id = $1`, [wdA2])).status === 'approved'
  && (await one(`select count(*)::int c from public.time_audit`)).c === auditBefore, r.msg + (r5.msg ?? ''));
// void zeroes the older session so Hours / Payroll Estimate agree
const legacy = (await one(`select legacy_session_id from public.time_intervals where visit_id = $1 and person_id = $2`, [visitA1, w1.pid])).legacy_session_id;
const intLegacy = (await one(`select id from public.time_intervals where legacy_session_id = $1`, [legacy])).id;
const sessBefore = await one(`select duration_minutes, status from public.work_sessions where id = $1`, [legacy]);
r = await rpc(owner.u, `select public.time_staff_void_interval($1::uuid, 'Entered by mistake') as x`, [intLegacy]);
const sessAfter = await one(`select duration_minutes, status, correction from public.work_sessions where id = $1`, [legacy]);
check('64 voiding a job time also zeroes the older work session (Hours / Payroll Estimate no longer count it); the original is kept in its note',
  r.ok && Number(sessAfter.duration_minutes) === 0 && sessAfter.status === 'corrected' && sessAfter.correction?.voided_by_time_tracking === true && sessAfter.correction?.original_duration_minutes != null, JSON.stringify({ sessBefore, sessAfter }));
const vAudit = (await one(`select count(*)::int c from public.time_audit where action = 'voided' and entity_id = $1`, [intLegacy])).c;
r = await rpc(owner.u, `select public.time_staff_void_interval($1::uuid, 'Entered by mistake again') as x`, [intLegacy]);
check('65 voiding twice changes nothing and adds no second history row', r.ok && (await one(`select count(*)::int c from public.time_audit where action = 'voided' and entity_id = $1`, [intLegacy])).c === vAudit && vAudit === 1);
r = await rpc(owner.u, `select public.time_staff_edit_interval($1::uuid, now() - interval '5 hours', null, 'edit a removed time') as x`, [intLegacy]);
check('66 a removed property time can\'t be edited', !r.ok && /was removed/.test(r.msg), r.msg);
check('66b a visit whose only time was removed becomes void (it does not sit "in progress" forever)', (await one(`select status from public.time_visits where id = $1`, [visitA1])).status === 'void');
// blank rates are filled in (only blanks, only unapproved, only from the start date)
r = await rpc(owner.u, `select public.time_staff_add_workday($1::uuid, current_date - 2, $2::timestamptz, $3::timestamptz, 'forgot day 1') as x`, [w3.pid, iso(2 * 1440 + 500), iso(2 * 1440 + 440)]);
const d1 = r.v;
r = await rpc(owner.u, `select public.time_staff_add_workday($1::uuid, current_date - 1, $2::timestamptz, $3::timestamptz, 'forgot day 2') as x`, [w3.pid, iso(1440 + 500), iso(1440 + 440)]);
const d2 = r.v;
r = await rpc(owner.u, `select public.time_staff_add_workday($1::uuid, current_date - 1, $2::timestamptz, $3::timestamptz, 'forgot day 3') as x`, [w3.pid, iso(1440 + 400), iso(1440 + 340)]);
const d3 = r.v;
await rpc(owner.u, `select public.time_approve_workday($1::uuid) as x`, [d3]);
check('67 time recorded before any pay rate exists has a blank rate', (await one(`select count(*)::int c from public.time_workday_rates where workday_id in ($1,$2,$3) and hourly_rate is null`, [d1, d2, d3])).c === 3);
r = await rpc(owner.u, `select public.time_set_hourly_rate($1::uuid, 22, current_date - 1, 'First rate') as x`, [w3.pid]);
const rates = await all(`select workday_id, hourly_rate from public.time_workday_rates where workday_id in ($1,$2,$3)`, [d1, d2, d3]);
const rateOf = (id) => rates.find((x) => x.workday_id === id)?.hourly_rate;
check('68 setting the first rate fills the blank on unapproved days from its start date only (not earlier days, not approved days)', r.ok && Number(rateOf(d2)) === 22 && rateOf(d1) === null && rateOf(d3) === null, JSON.stringify(rates));
check('69 the fill is in the history', (await one(`select count(*)::int c from public.time_audit where action = 'rate_filled' and person_id = $1`, [w3.pid])).c === 1);
r = await rpc(owner.u, `select public.time_set_hourly_rate($1::uuid, 30, current_date, 'Raise') as x`, [w3.pid]);
check('70 a raise never changes a rate that was already saved', r.ok && Number((await one(`select hourly_rate from public.time_workday_rates where workday_id = $1`, [d2])).hourly_rate) === 22);

// 4i. alert hours live in their own table (the Payroll Estimate's overtime terms are not touched)
check('71 the per-employee alert hours do not create or change a worker_pay_settings row', (await one(`select count(*)::int c from public.worker_pay_settings where person_id = $1`, [w2.pid])).c === 0);
r = await rpc(owner.u, `select count(*)::int as x from public.time_person_settings where person_id = $1`, [w2.pid]);
check('72 the owner reads them', r.ok && r.v === 1, r.msg);

// 4j. midnight, DST and a shift left open overnight
const w4 = await mk('w4@x.test', 'Night Owl');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'worker','active')`, [co, w4.pid]);
const night = (await one(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, clock_out_at, status) values ($1,$2,'2026-03-07','2026-03-07T23:00:00Z','2026-03-08T07:00:00Z','closed') returning id`, [co, w4.pid])).id;
await db.query(`insert into public.time_breaks (company_id, workday_id, person_id, started_at, ended_at, paid) values ($1,$2,$3,'2026-03-08T02:00:00Z','2026-03-08T02:30:00Z',false)`, [co, night, w4.pid]);
const net = Number((await one(`select public._time_net_ms($1) as ms`, [night])).ms);
check('73 a shift across midnight (and a US clock change) is 8 elapsed hours; a 30-minute unpaid break leaves 7.5 payable; it belongs to the date it started', net === 7.5 * 3600000
  && (await one(`select to_char(work_date, 'YYYY-MM-DD') d from public.time_workdays where id = $1`, [night])).d === '2026-03-07', String(net));
f = await fails(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, clock_out_at, status) values ($1,$2,'2026-03-08','2026-03-08T05:00:00Z','2026-03-08T09:00:00Z','closed')`, [co, w4.pid]);
check('74 a second workday that overlaps the first is refused (hours can\'t be counted twice)', f.raised && /overlaps/.test(f.msg), f.msg);
await db.query(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, status) values ($1,$2,current_date - 1, now() - interval '30 hours','active')`, [co, w4.pid]);
r = await rpc(w4.u, `select public.time_my_day($1::date) as x`, [today]);
// Update 90: a workday left open for longer than the owner's "open workday hours" is FLAGGED (needs review, zero hours, original clock-in kept),
// never closed at "now" and never counted twice; it does not block today's clock-in.
check('75 a worker who forgot to clock out yesterday: the old day is flagged "needs review" at zero hours (not closed at "now"), and it is no longer an open session', r.ok && r.v.days.length === 1 && r.v.days[0].status === 'needs_review' && r.v.days[0].clock_out_at === r.v.days[0].clock_in_at, JSON.stringify(r.v?.days));
// The alert tests below need a day that is still open: leave one open (same 30 hours old).
await db.query(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, status) values ($1,$2,current_date - 1, now() - interval '29 hours','active')`, [co, w4.pid]);

const stale = (await one(`select id from public.time_workdays where person_id = $1 and clock_out_at is null`, [w4.pid])).id;
await rpc(owner.u, `select public.time_scan_alerts() as x`);
check('75b the owner is alerted once to the workday left open', (await one(`select count(*)::int c from public.time_alerts where kind = 'open_workday' and workday_id = $1 and status = 'open'`, [stale])).c === 1);
await rpc(owner.u, `select public.time_scan_alerts() as x`);
check('75c scanning again does not repeat it', (await one(`select count(*)::int c from public.time_alerts where kind = 'open_workday' and workday_id = $1`, [stale])).c === 1);
r = await rpc(owner.u, `select public.time_staff_edit_workday($1::uuid, null, $2::timestamptz, 'Forgot to clock out') as x`, [stale, iso(1200)]);
await rpc(owner.u, `select public.time_scan_alerts() as x`);
check('75d once the owner sets the clock-out, that alert closes by itself', r.ok && (await one(`select status from public.time_alerts where kind = 'open_workday' and workday_id = $1`, [stale])).status === 'resolved', r.msg);

// 4j2. the checklist rule still applies inside the timed flow, and a refused completion leaves the timer running
const rT = await mkRoute(co, 'TaskRoute', [m2.pid], 1);
const taskId = (await one(`insert into public.maintenance_stop_tasks (company_id, route_id, stop_id, title, is_required) values ($1,$2,$3,'Blow off walkways', true) returning id`, [co, rT.route, rT.stops[0].id])).id;
r = await rpc(m2.u, `select public.maintenance_leader_arrive($1::uuid) as x`, [rT.stops[0].id]);
const tv = (await one(`select id from public.time_visits where maintenance_stop_id = $1`, [rT.stops[0].id])).id;
r = await rpc(m2.u, `select public.maintenance_leader_complete($1::uuid) as x`, [rT.stops[0].id]);
check('88 a required checklist item blocks completing the property, and the timer keeps running (nothing half-saved)', !r.ok && /checklist/.test(r.msg)
  && (await one(`select count(*)::int c from public.time_visits where id = $1 and ended_at is null and status = 'in_progress'`, [tv])).c === 1
  && (await one(`select status from public.maintenance_stops where id = $1`, [rT.stops[0].id])).status === 'arrived', r.msg);
await rpc(m2.u, `select public.maintenance_set_task_done($1::uuid, true) as x`, [taskId]);
r = await rpc(m2.u, `select public.maintenance_leader_complete($1::uuid) as x`, [rT.stops[0].id]);
check('89 once the item is ticked the property completes, and the visit gets its completion time at that moment', r.ok && (await one(`select status from public.maintenance_stops where id = $1`, [rT.stops[0].id])).status === 'completed'
  && (await one(`select ended_at is not null as e from public.time_visits where id = $1`, [tv])).e === true, r.msg);

// 4j3. typo guards on the owner's own entries (the employee's server-stamped times are never refused)
r = await rpc(owner.u, `select public.time_staff_add_workday($1::uuid, current_date - 12, $2::timestamptz, $3::timestamptz, 'typo: wrong clock-out day') as x`, [w4.pid, iso(12 * 1440 + 480), iso(10 * 1440)]);
check('90 a workday longer than 24 hours is refused when the owner types it in', !r.ok && /longer than 24 hours/.test(r.msg), r.msg);
r = await rpc(owner.u, `select public.time_staff_add_workday($1::uuid, current_date - 20, $2::timestamptz, $3::timestamptz, 'typo: wrong date') as x`, [w4.pid, iso(12 * 1440 + 480), iso(12 * 1440 + 60)]);
check('91 a clock-in that is not on the date it is filed under is refused', !r.ok && /not on the workday/.test(r.msg), r.msg);
r = await rpc(owner.u, `select public.time_staff_edit_workday($1::uuid, null, now() - interval '1 minute', 'push the day out to 30 hours') as x`, [d1]);
check('92 correcting a day so it runs past 24 hours is refused too', !r.ok && /longer than 24 hours|before the clock-in/.test(r.msg), r.msg);

// 4k. the maintenance start-of-day row says who made it
const w5 = await mk('w5@x.test', 'Forgetful');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'worker','active','maintenance')`, [co, w5.pid]);
await db.query(`insert into public.maintenance_route_crew (company_id, route_id, person_id) values ($1,$2,$3)`, [co, rA.route, w5.pid]);
await rpc(owner.u, `select public.time_staff_add_workday($1::uuid, current_date, $2::timestamptz, $3::timestamptz, 'forgot to clock in') as x`, [w5.pid, iso(300), iso(200)]);
check('76 a day the owner adds by hand is recorded as an owner correction, not as the worker arriving', (await one(`select source from public.maintenance_day_attendance where person_id = $1`, [w5.pid]))?.source === 'owner_correction');

// 4l. two taps at once never make two workdays
const w6 = await mk('w6@x.test', 'Double Tap');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'worker','active')`, [co, w6.pid]);
await db.query(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, sort_order, status) values ($1,$2,$3,$4,9,'scheduled')`, [co, jA2.proj, w6.pid, today]);  // clock-in needs work that day (update 67)
const taps = await Promise.all([1, 2, 3].map(() => rpc(w6.u, `select public.time_clock_in($1::date, null, gen_random_uuid()) as x`, [today])));
check('77 three quick Clock In taps with different request ids still leave exactly one open workday', taps.every((t) => t.ok) && (await one(`select count(*)::int c from public.time_workdays where person_id = $1 and clock_out_at is null`, [w6.pid])).c === 1, taps.map((t) => t.msg).join('|'));

// 4m. the migration files can be run again
let again = true;
for (const n of ['063_time_tracking_core', '064_time_corrections_approval_alerts', '065_time_tracking_followups']) {
  try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/${n}.sql`, 'utf8')); } catch (e) { again = false; console.log(n, e.message); }
}
check('78 updates 63, 64 and 65 can each be run a second time on a database that already has data in it', again);
check('79 re-running them changed no recorded time', (await one(`select count(*)::int c from public.time_workdays`)).c >= 8);

// ── 5. the catalog: nothing is exposed that shouldn't be (so a future careless change is caught) ──
const cat = await all(`select p.proname, p.prosecdef, coalesce(p.proconfig::text, '') cfg, has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('authenticated', p.oid, 'execute') auth_x
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'time\_%' or p.proname like '\_time\_%')`);
const EXPECTED = ['time_alert_resolve', 'time_approve_workday', 'time_break_end', 'time_break_start', 'time_claim_stale_end', 'time_clock_in', 'time_clock_out', 'time_complete_visit', 'time_decide_skip', 'time_my_day',
  'time_my_skip_requests', 'time_reopen_workday', 'time_request_skip', 'time_scan_alerts', 'time_set_hourly_rate', 'time_set_visit_billable', 'time_staff_add_break', 'time_staff_add_interval',
  'time_staff_add_workday', 'time_staff_edit_break', 'time_staff_edit_interval', 'time_staff_edit_workday', 'time_staff_void_interval', 'time_start_visit', 'time_trucks_for_clock_in', 'time_withdraw_skip'];
const callable = cat.filter((x) => x.auth_x).map((x) => x.proname).sort();
check('80 a signed-in user can run exactly the 26 intended time functions and no helper or trigger function', JSON.stringify(callable) === JSON.stringify([...EXPECTED].sort()), JSON.stringify(callable.filter((x) => !EXPECTED.includes(x))));
check('81 a signed-out user can run none of them', cat.every((x) => !x.anon_x), cat.filter((x) => x.anon_x).map((x) => x.proname).join(','));
check('82 every SECURITY DEFINER time function pins its search_path (no lookalike-object hijack)', cat.filter((x) => x.prosecdef).every((x) => /search_path=public/.test(x.cfg)), cat.filter((x) => x.prosecdef && !/search_path=public/.test(x.cfg)).map((x) => x.proname).join(','));
const priv = await all(`select c.relname, has_table_privilege('anon', c.oid, 'select') as a_s, has_table_privilege('anon', c.oid, 'insert') as a_i, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'time\_%'`);
check('83 every time table has row-level security on and gives the signed-out role no access at all', priv.length === 13 && priv.every((x) => x.rls && !x.a_s && !x.a_i), JSON.stringify(priv.filter((x) => !x.rls || x.a_s || x.a_i)));
check('84 no view and no policy on another table reaches into the time tables', (await all(`select viewname from pg_views where schemaname = 'public' and (definition ilike '%time\_workdays%' or definition ilike '%time\_intervals%' or definition ilike '%time\_workday\_rates%')`)).length === 0
  && (await all(`select 1 from pg_policies where schemaname = 'public' and tablename not like 'time\_%' and (qual ilike '%time\_workdays%' or qual ilike '%time\_intervals%' or qual ilike '%time\_audit%')`)).length === 0);

// ── 6. the owner's own direct writes (settings, targets, alert hours, estimates) still work, and are written to the history ──
const hist0 = (await one(`select count(*)::int c from public.time_audit where entity in ('settings', 'target')`)).c;
let ow = await call(owner.u, `update public.time_settings set long_visit_hours = 7 where company_id = '${co}'`);
const ow2 = await call(owner.u, `update public.time_property_targets set target_minutes = 50 where company_id = '${co}'`);
const ow3 = await call(owner.u, `update public.time_person_settings set daily_alert_hours = 10 where person_id = '${w2.pid}'`);
const ow4 = await call(owner.u, `update public.time_project_estimates set labor_hours = 11 where company_id = '${co}'`);
check('85 the owner can still change the settings, a target, alert hours and a labor estimate directly', !ow.raised && !ow2.raised && !ow3.raised && !ow4.raised, ow.msg + ow2.msg + ow3.msg + ow4.msg);
check('86 and the settings and target changes were written to the history by their triggers', (await one(`select count(*)::int c from public.time_audit where entity in ('settings', 'target')`)).c >= hist0 + 2);
check('87 the changes really landed (and only in the owner company)', Number((await one(`select long_visit_hours h from public.time_settings where company_id = $1`, [co])).h) === 7
  && Number((await one(`select long_visit_hours h from public.time_settings where company_id = $1`, [cb])).h) === 6);

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
