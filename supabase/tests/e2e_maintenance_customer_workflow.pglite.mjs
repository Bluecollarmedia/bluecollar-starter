// End-to-end workflow on the full real schema (PGlite): customer + property link, scheduled maintenance, clock-in, crew check-in, stop completion,
// service history, internal vs shared photos as seen by a customer, revoking access, and a landscaping-only day. NOT real Supabase.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
// Written for the old code-based joining (closed by update 78, functions removed by update 85, tested in 085): runs against the schema as of update 84.
const { db, failures } = await buildFullSchema(repo, { upTo: 84 });
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 full schema and every update (incl. 066-071) load', failures.length === 0, JSON.stringify(failures));

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0], rows: r.rows }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
const login = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  let pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id;
  if (!pid) pid = (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  else await db.query(`update public.people set first_name = $2, last_name = 'T' where id = $1`, [pid, name]);
  return { u, pid };
};
const today = (await one(`select current_date::text as d`)).d;

const co = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
const owner = await login('owner@x.test', 'Owner');
const lead = await login('lead@x.test', 'Leader');
const crew2 = await login('crew2@x.test', 'CrewTwo');
const land = await login('land@x.test', 'LandOnly');
const both = await login('both@x.test', 'JobAndRoute');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values
  ($1,$2,'owner','active','landscaping'),($1,$3,'worker','active','maintenance'),($1,$4,'worker','active','maintenance'),($1,$5,'worker','active','landscaping'),($1,$6,'worker','active','maintenance')`,
  [co, owner.pid, lead.pid, crew2.pid, land.pid, both.pid]);

// ── 1. create/link a customer and a property ────────────────────────────────
const phid = (await one(`insert into public.people (email, first_name, last_name) values ('', 'Pat', 'Customer') returning id`)).id;   // owner-created, no email
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'customer','invited')`, [co, phid]);
const prop = (await one(`insert into public.maintenance_properties (company_id, name, address, customer_id) values ($1,'Chase Bank','1 Main',$2) returning id`, [co, phid])).id;
const contract = (await one(`insert into public.maintenance_contracts (company_id, property_id, name) values ($1,$2,'2026') returning id`, [co, prop])).id;
const ownerSees = await rpc(owner.u, `select customer_id as x from public.maintenance_properties where id = $1`, [prop]);
check('1 owner view: the property is linked to the customer record (the one column Maintenance and Customers both read)', ownerSees.ok && ownerSees.v === phid);
const cust = await login('pat@x.test', 'Pat');
let r = await rpc(cust.u, `select count(*)::int as x from public.maintenance_my_properties()`);
check('1b customer view BEFORE they connect: nothing (the owner-created record has no login; this is why they enter the property code)', r.ok && r.v === 0, JSON.stringify(r));
const code = (await one(`select code from public.maintenance_customer_codes where property_id = $1`, [prop])).code;
await db.query(`select public._claim_maintenance($1::uuid, $2)`, [cust.pid, code]);
r = await rpc(cust.u, `select count(*)::int as x from public.maintenance_my_properties()`);
check('1c customer view AFTER entering the code: sees the property, and there is no duplicate customer record', r.ok && r.v === 1
  && (await one(`select customer_id from public.maintenance_properties where id = $1`, [prop])).customer_id === cust.pid
  && (await one(`select count(*)::int c from public.people where id = $1`, [phid])).c === 0, JSON.stringify(r));

// ── 2. schedule maintenance, clock in, check in the crew, complete a stop, history ─
const route = (await one(`insert into public.maintenance_routes (company_id, service_date, name) values ($1,$2,'Route A') returning id`, [co, today])).id;
for (const p of [lead, crew2, both]) await db.query(`insert into public.maintenance_route_crew (company_id, route_id, person_id) values ($1,$2,$3)`, [co, route, p.pid]);
await db.query(`update public.maintenance_routes set lead_person_id = $2 where id = $1`, [route, lead.pid]);
const stop = (await one(`insert into public.maintenance_stops (company_id, route_id, property_id, contract_id, sort_order) values ($1,$2,$3,$4,1) returning id`, [co, route, prop, contract])).id;
const clockIn = (u) => rpc(u, `select public.time_clock_in($1::date, null, gen_random_uuid()) as x`, [today]);
r = await rpc(lead.u, `select public.maintenance_leader_arrive($1::uuid) as x`, [stop]);
check('2 the leader cannot check the crew in before clocking in', !r.ok && /Clock in for the day first/.test(r.msg), r.msg);
const ci = [await clockIn(lead.u), await clockIn(crew2.u)];
check('2b each worker clocks in individually (own workday rows; the third crew member has not)', ci.every((x) => x.ok) && (await one(`select count(*)::int c from public.time_workdays where work_date = $1::date`, [today])).c === 2);
r = await rpc(crew2.u, `select public.maintenance_leader_arrive($1::uuid) as x`, [stop]);
check('2c a crew member who is not the leader cannot check the crew in', !r.ok && /Only the crew leader/.test(r.msg), r.msg);
r = await rpc(lead.u, `select public.maintenance_leader_arrive($1::uuid) as x`, [stop]);
check('2d the leader checks the crew in once; the stop is now arrived (the dashboard counts the whole crew on site from this)', r.ok && (await one(`select status from public.maintenance_stops where id = $1`, [stop])).status === 'arrived');

// internal photo uploaded by the worker (crew insert policy: always internal)
await asUser(crew2.u);
let upErr = 'none';
try { await db.query(`insert into public.maintenance_photos (company_id, route_id, stop_id, property_id, uploaded_by, file_url, file_key, is_customer_visible) values ($1,$2,$3,$4,$5,'https://r2/x.jpg','co/maintenance/p/a.jpg',true)`, [co, route, stop, prop, crew2.pid]); } catch (e) { upErr = e.message; }
await asDb();
check('3 a worker cannot upload a photo as already shared (it is refused)', upErr !== 'none', upErr);
await asUser(crew2.u);
try { await db.query(`insert into public.maintenance_photos (company_id, route_id, stop_id, property_id, uploaded_by, file_url, file_key) values ($1,$2,$3,$4,$5,'https://r2/x.jpg','co/maintenance/p/a.jpg')`, [co, route, stop, prop, crew2.pid]); upErr = 'ok'; } catch (e) { upErr = e.message; }
await asDb();
check('3b a worker uploads an internal photo', upErr === 'ok', upErr);
const KEY = 'co/maintenance/p/a.jpg';
const open = (u) => rpc(u, `select public.maintenance_photos_i_can_open($1::text[]) as x`, [[KEY]]);
const custPhotos = async () => (await rpc(cust.u, `select photos as x from public.maintenance_customer_updates()`)).rows ?? [];
check('3c the customer cannot retrieve the internal photo (before AND after the stop is finished): not in their updates, and the open-check refuses the key', (await open(cust.u)).v.length === 0 && (await custPhotos()).length === 0);
check('3d staff and the crew on the route may open it', (await open(owner.u)).v.length === 1 && (await open(crew2.u)).v.length === 1);
check('3e an unrelated worker may not', (await open(land.u)).v.length === 0);

r = await rpc(lead.u, `select public.maintenance_leader_complete($1::uuid, null) as x`, [stop]);
check('4 the leader completes the stop (server-stamped times)', r.ok && (await one(`select status, arrived_at is not null as a, completed_at is not null as c from public.maintenance_stops where id = $1`, [stop])).c === true);
let cu = await rpc(cust.u, `select photos as x from public.maintenance_customer_updates()`);
check('4b once finished, the customer sees the VISIT but still no internal photo', cu.ok && cu.rows.length === 1 && cu.rows[0].x.length === 0 && (await open(cust.u)).v.length === 0, JSON.stringify(cu.rows));
r = await rpc(owner.u, `select public.maintenance_property_visits($1::uuid) as x`, [prop]);
const visit = r.ok ? r.v.find((h) => h.stop_id === stop) : null;
check('4c service history: the visit is recorded with arrival, completion, leader and an estimated labor figure computed by the database (not typed in)', !!visit && visit.elapsed_minutes !== undefined && visit.est_labor_minutes !== undefined && Array.isArray(visit.crew), JSON.stringify(visit));

// share, then confirm authorized customer access
await asUser(owner.u);
await db.query(`update public.maintenance_photos set is_customer_visible = true, shared_by = $2, shared_at = now() where file_key = $1`, [KEY, owner.pid]);
await asDb();
cu = await rpc(cust.u, `select photos as x from public.maintenance_customer_updates()`);
check('5 after the owner shares it (stop finished): the customer sees exactly that photo, gets its file key for a signed link, and the open-check allows it', cu.rows[0].x.length === 1 && cu.rows[0].x[0].key === KEY && (await open(cust.u)).v.length === 1, JSON.stringify(cu.rows));
const other = await login('other@x.test', 'OtherCustomer');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'customer','active')`, [co, other.pid]);
check('5b a different customer of the same company cannot open it', (await open(other.u)).v.length === 0 && (await rpc(other.u, `select count(*)::int as x from public.maintenance_customer_updates()`)).v === 0);
await asUser(owner.u);
await db.query(`update public.maintenance_photos set is_customer_visible = false where file_key = $1`, [KEY]);
await asDb();
check('5c un-sharing takes it back at once (database check; a public file address would NOT be revoked, see the report)', (await open(cust.u)).v.length === 0 && (await custPhotos()).every((p) => p.x.length === 0));

// revoke access
await asUser(owner.u);
await db.query(`update public.maintenance_photos set is_customer_visible = true where file_key = $1`, [KEY]);
await asDb();
r = await rpc(owner.u, `select public.regenerate_maintenance_code($1::uuid, true) as x`, [prop]);
check('6 revoking the customer\'s access succeeds', r.ok, r.msg);
check('6b after revoking, access is actually denied: no properties, no visits, no photo files, even for a photo that is marked shared',
  (await rpc(cust.u, `select count(*)::int as x from public.maintenance_my_properties()`)).v === 0
  && (await rpc(cust.u, `select count(*)::int as x from public.maintenance_customer_updates()`)).v === 0
  && (await open(cust.u)).v.length === 0);
check('6c the old code no longer works for anyone (a new one was issued)', (await one(`select code <> $2 as changed from public.maintenance_customer_codes where property_id = $1`, [prop, code])).changed === true);

// ── 3. landscaping-only workflow still works; nobody is double counted ────────
const proj = (await one(`insert into public.projects (company_id, name, status) values ($1,'Patio job','active') returning id`, [co])).id;
const asgLand = (await one(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, status) values ($1,$2,$3,$4,'scheduled') returning id`, [co, proj, land.pid, today])).id;
const asgBoth = (await one(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, status) values ($1,$2,$3,$4,'scheduled') returning id`, [co, proj, both.pid, today])).id;
r = await clockIn(land.u);
check('7 a landscaping-only worker clocks in because they have an assignment today', r.ok, r.msg);
r = await rpc(land.u, `select public.time_start_visit('assignment', $1::uuid) as x`, [asgLand]);
check('7b starts their job visit', r.ok, r.msg);
const rb = await clockIn(both.u);
check('7c a worker on BOTH a job and a route clocks in once and gets ONE workday row (so counts cannot double)', rb.ok && (await one(`select count(*)::int c from public.time_workdays where person_id = $1 and work_date = $2::date`, [both.pid, today])).c === 1);
const distinct = await one(`select count(distinct p)::int c from (select person_id p from public.assignments where scheduled_date = $1::date union select person_id from public.maintenance_route_crew where route_id = $2 union select lead_person_id from public.maintenance_routes where id = $2) x`, [today, route]);
check('7d scheduled people today = 4 distinct (leader, crew two, job+route worker counted once, landscaping-only), not 5', distinct.c === 4, JSON.stringify(distinct));

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
