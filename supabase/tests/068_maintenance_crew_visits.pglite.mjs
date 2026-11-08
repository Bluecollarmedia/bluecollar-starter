// Run: copy this file (and ./helpers/fullSchema.mjs) next to a folder with @electric-sql/pglite installed, then:
//   node <file> <path to the repo>
// Proves update 68 on the REAL full schema + every update (PGlite, not real Supabase): the crew leader checks the crew into a
// maintenance property, workers keep their own workdays, the visit's elapsed time is saved, and estimated labor-hours are derived
// from each assigned worker's own recorded workday.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 280)}`); };
check('0 the full schema and all updates (including 068) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try {
  // Update 74 later changes the cleanup functions' shape; for a re-run in the original order, put them back first.
  await db.exec(`drop function if exists public.storage_cleanup_claim(integer); drop function if exists public.storage_cleanup_finish(uuid, boolean, text, boolean);`);
  await db.exec(fs.readFileSync(`${repo}/supabase/updates/068_maintenance_crew_visits.sql`, 'utf8'));
  await db.exec(fs.readFileSync(`${repo}/supabase/updates/074_company_delete_sweeps_storage.sql`, 'utf8'));
} catch (e) { again = false; console.log(e.message); }
check('0b update 68 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
const today = (await db.query(`select current_date::text as d`)).rows[0].d;

const co = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
const mk = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  let pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id;
  if (!pid) pid = (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  else await db.query(`update public.people set first_name = $2, last_name = 'T' where id = $1`, [pid, name]);
  return { u, pid };
};
const owner = await mk('owner@x.test', 'Owner');
const lead = await mk('lead@x.test', 'Leader');
const a2 = await mk('a2@x.test', 'CrewTwo');
const a3 = await mk('a3@x.test', 'CrewThree');
const outsider = await mk('out@x.test', 'NotOnRoute');
const gone = await mk('gone@x.test', 'Deactivated');
const ownerB = await mk('ownerb@x.test', 'OwnerB');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values
  ($1,$2,'owner','active','landscaping'),($1,$3,'worker','active','maintenance'),($1,$4,'worker','active','maintenance'),($1,$5,'worker','active','maintenance'),
  ($1,$6,'worker','active','maintenance'),($1,$7,'worker','inactive','maintenance')`, [co, owner.pid, lead.pid, a2.pid, a3.pid, outsider.pid, gone.pid]);
await db.exec(`set session_replication_role = replica`);
const cb = (await one(`insert into public.companies (name) values ('Other') returning id`)).id;
await db.exec(`set session_replication_role = origin`);
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active')`, [cb, ownerB.pid]);

const prop = (await one(`insert into public.maintenance_properties (company_id, name, address) values ($1,'Chase Bank','1 Main') returning id`, [co])).id;
const prop2 = (await one(`insert into public.maintenance_properties (company_id, name, address) values ($1,'Focus','2 Main') returning id`, [co])).id;
const contract = (await one(`insert into public.maintenance_contracts (company_id, property_id, name) values ($1,$2,'2026') returning id`, [co, prop])).id;
const contract2 = (await one(`insert into public.maintenance_contracts (company_id, property_id, name) values ($1,$2,'2026') returning id`, [co, prop2])).id;
const mkRoute = async (date, withLead = true) => {
  const route = (await one(`insert into public.maintenance_routes (company_id, service_date, name) values ($1,$2,'R') returning id`, [co, date])).id;
  for (const p of [lead, a2, a3]) await db.query(`insert into public.maintenance_route_crew (company_id, route_id, person_id) values ($1,$2,$3)`, [co, route, p.pid]);
  if (withLead) await db.query(`update public.maintenance_routes set lead_person_id = $2 where id = $1`, [route, lead.pid]);
  const s1 = (await one(`insert into public.maintenance_stops (company_id, route_id, property_id, contract_id, sort_order) values ($1,$2,$3,$4,1) returning id`, [co, route, prop, contract])).id;
  const s2 = (await one(`insert into public.maintenance_stops (company_id, route_id, property_id, contract_id, sort_order) values ($1,$2,$3,$4,2) returning id`, [co, route, prop2, contract2])).id;
  return { route, s1, s2 };
};
const R = await mkRoute(today);
const clockIn = (u) => rpc(u, `select public.time_clock_in($1::date, null, gen_random_uuid()) as x`, [today]);
const arrive = (u, stop) => rpc(u, `select public.maintenance_leader_arrive($1::uuid) as x`, [stop]);
const finish = (u, stop, note = null) => rpc(u, `select public.maintenance_leader_complete($1::uuid, $2) as x`, [stop, note]);
const wd = async (pid) => all(`select * from public.time_workdays where person_id = $1 order by clock_in_at`, [pid]);

// ── clock-in and the route ──────────────────────────────────────────────────
let r = await clockIn(outsider.u);
check('1 a maintenance worker who is on no route today cannot start a shift', !r.ok && (await wd(outsider.pid)).length === 0, r.msg);
r = await arrive(lead.u, R.s1);
check('2 even the leader cannot check a crew in before clocking in their own workday', !r.ok && /Clock in for the day first/.test(r.msg) && (await one(`select count(*)::int c from public.time_visits`)).c === 0, r.msg);
r = await clockIn(lead.u);
const rr2 = await clockIn(a2.u); const rr3 = await clockIn(a3.u);
check('3 scheduled workers (leader included) clock in; each gets their OWN persisted workday row', r.ok && rr2.ok && rr3.ok && (await wd(lead.pid)).length === 1 && (await wd(a2.pid)).length === 1 && (await wd(a3.pid))[0].clock_out_at === null);
r = await clockIn(gone.u);
check('4 a deactivated worker cannot clock in', !r.ok && (await wd(gone.pid)).length === 0, r.msg);

// ── leader authority ───────────────────────────────────────────────────────
r = await arrive(a2.u, R.s1);
check('5 a crew member who is not the leader cannot check the crew in', !r.ok && /Only the crew leader/.test(r.msg) && (await one(`select count(*)::int c from public.time_visits`)).c === 0, r.msg);
r = await rpc(a2.u, `select public.maintenance_mark_arrived($1::uuid) as x`, [R.s1]);
const r5b = await rpc(a2.u, `select public.maintenance_finish_stop($1::uuid) as x`, [R.s1]);
check('5b the older direct functions are refused to non-leaders too (an old app or edited request cannot go around the rule)', !r.ok && !r5b.ok && (await one(`select status from public.maintenance_stops where id = $1`, [R.s1])).status === 'pending', r.msg + (r5b.msg ?? ''));
r = await arrive(outsider.u, R.s1);
const r5c = await arrive(ownerB.u, R.s1);
check('5c a worker not on the route, and another company\'s owner, cannot check anyone in', !r.ok && !r5c.ok);
r = await arrive(lead.u, R.s2);
check('6 the leader cannot skip ahead: the second stop stays locked while the first is not done', !r.ok && /Finish Chase Bank first/.test(r.msg), r.msg);
r = await arrive(lead.u, R.s1);
const stopRow = await one(`select status, arrived_at, arrived_by from public.maintenance_stops where id = $1`, [R.s1]);
const visit = await one(`select * from public.time_visits where maintenance_stop_id = $1`, [R.s1]);
check('7 the leader checks the crew in: stop is in progress, arrival saved once with the leader, one crew visit saved', r.ok && stopRow.status === 'arrived' && stopRow.arrived_by === lead.pid && visit.crew_level === true && visit.started_at !== null && visit.ended_at === null && visit.status === 'in_progress', r.msg);
r = await arrive(lead.u, R.s1);
check('8 a double tap or second phone returns the same visit, never a second', r.ok && r.v.already_arrived === true && (await one(`select count(*)::int c from public.time_visits where maintenance_stop_id = $1`, [R.s1])).c === 1);
r = await rpc(a2.u, `select public.time_start_visit('maintenance_stop', $1::uuid) as x`, [R.s1]);
check('9 other crew members cannot start a property timer of their own (the per-worker timer is gone for maintenance)', !r.ok && (await one(`select count(*)::int c from public.time_intervals`)).c === 0, r.msg);
check('10 the visit exists only because the server saved it: before check-in nothing existed (a phone timer cannot create one)', visit.started_at !== null && (await one(`select count(*)::int c from public.time_visits where maintenance_stop_id = $1`, [R.s2])).c === 0);

// ── completion ─────────────────────────────────────────────────────────────
r = await finish(a3.u, R.s1);
check('11 only the leader can finish the stop', !r.ok && /Only the crew leader/.test(r.msg) && (await one(`select status from public.maintenance_stops where id = $1`, [R.s1])).status === 'arrived', r.msg);
r = await finish(lead.u, R.s1, 'all done');
const doneVisit = await one(`select * from public.time_visits where maintenance_stop_id = $1`, [R.s1]);
check('12 the leader finishes: completion time and status are saved, visit is completed, elapsed time is the saved difference', r.ok && doneVisit.status === 'completed' && doneVisit.ended_at !== null && new Date(doneVisit.ended_at) >= new Date(doneVisit.started_at), r.msg);
r = await finish(lead.u, R.s1);
check('13 finishing twice changes nothing', r.ok && r.v.already_completed === true && (await one(`select count(*)::int c from public.time_visits where maintenance_stop_id = $1`, [R.s1])).c === 1);
r = await arrive(lead.u, R.s2);
check('14 completing one property makes the next stop available', r.ok, r.msg);
r = await rpc(a2.u, `select public.time_clock_out() as x`);
check('15 a worker clocks out on their own: their workday stops, the crew visit and the other workers are not touched', r.ok && (await wd(a2.pid))[0].clock_out_at !== null && (await wd(lead.pid))[0].clock_out_at === null && (await one(`select status from public.time_visits where maintenance_stop_id = $1`, [R.s2])).status === 'in_progress', r.msg);
r = await rpc(lead.u, `select public.maintenance_leader_arrive($1::uuid) as x`, [R.s1]);
check('15b a completed stop cannot be checked in again', !r.ok, r.msg);

// ── estimated labor-hours: elapsed time is not labor-hours ────────────────────
// A fresh route a week ago: visit 10:00 to 10:40 (40 minutes). Leader and CrewTwo clocked in all day; CrewThree clocked out at 10:20;
// the outsider was clocked in all day but is not on the route.
await asDb();
const past = (await one(`select (current_date - 7)::text as d`)).d;
const P = await mkRoute(past);
const at = async (hhmm) => (await one(`select (($1::date + $2::time) at time zone current_setting('TimeZone'))::timestamptz as t`, [past, hhmm])).t;
const w = async (pid, inn, out) => (await one(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, clock_out_at, status) values ($1,$2,$3,$4,$5,'closed') returning id`, [co, pid, past, await at(inn), await at(out)])).id;
await w(lead.pid, '07:00', '16:00'); await w(a2.pid, '07:00', '16:00'); await w(a3.pid, '07:00', '10:20'); await w(outsider.pid, '07:00', '16:00');
await db.query(`insert into public.time_visits (company_id, source, crew_level, maintenance_stop_id, maintenance_property_id, route_id, visit_date, label, started_at, ended_at, status)
  values ($1,'maintenance_stop',true,$2,$3,$4,$5,'Chase Bank',$6,$7,'completed')`, [co, P.s1, prop, P.route, past, await at('10:00'), await at('10:40')]);
await db.query(`update public.maintenance_stops set status = 'completed', arrived_at = $2, completed_at = $3 where id = $1`, [P.s1, await at('10:00'), await at('10:40')]);
r = await rpc(owner.u, `select public.maintenance_property_visits($1::uuid) as x`, [prop]);
const hist = r.ok ? r.v : [];
const pv = hist.find((h) => h.stop_id === P.s1);
check('16 the owner can read the property history', r.ok && Array.isArray(hist) && !!pv, r.msg);
check('17 elapsed visit duration is 40 minutes (arrival to completion)', pv && Number(pv.elapsed_minutes) === 40, JSON.stringify(pv));
check('18 estimated labor is 100 minutes: leader 40 + CrewTwo 40 + CrewThree 20 (clocked out half way). Not 40 x 3 = 120, and the outsider does not count',
  pv && Number(pv.est_labor_minutes) === 100 && pv.crew.length === 3 && Number(pv.crew.find((c) => c.name.startsWith('CrewThree')).minutes) === 20 && !pv.crew.some((c) => c.name.startsWith('NotOnRoute')), JSON.stringify(pv?.crew));
check('19 elapsed duration and labor-hours are separate numbers', pv && Number(pv.elapsed_minutes) !== Number(pv.est_labor_minutes));
check('19b the leader, the checklist and photo counts are part of the record', pv && pv.leader_name?.startsWith('Leader') && 'tasks_total' in pv && 'photos' in pv);
// payroll is untouched by the estimate
check('20 payroll stays each person\'s own workday: the estimate stored nothing and changed no workday (CrewThree still has 3h20m)', (await one(`select count(*)::int c from public.time_workdays where person_id = $1 and clock_in_at = $2 and clock_out_at = $3`, [a3.pid, await at('07:00'), await at('10:20')])).c === 1);
// repeated visits stay separate
check('21 the same property serviced again is a separate historical record (today\'s visit and last week\'s are two rows)', hist.filter((h) => h.stop_id === R.s1 || h.stop_id === P.s1).length === 2 && new Set(hist.map((h) => h.visit_id)).size >= 2, JSON.stringify(hist.map((h) => h.service_date)));
const todays = hist.find((h) => h.stop_id === R.s1);
check('22 today\'s visit is listed with its own saved arrival, completion and estimate (using the workdays recorded so far)', todays && todays.arrived_at && todays.completed_at && todays.est_labor_minutes !== null, JSON.stringify(todays));
// visits recorded before time tracking use the stop's own times
await asDb();
const L = await mkRoute((await one(`select (current_date - 20)::text as d`)).d);
const old = (await one(`select (current_date - 20)::text as d`)).d;
await db.query(`update public.maintenance_stops set status = 'completed', arrived_at = ($2::date + time '09:00') at time zone current_setting('TimeZone'), completed_at = ($2::date + time '09:30') at time zone current_setting('TimeZone') where id = $1`, [L.s1, old]);
await db.query(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, clock_out_at, status) values ($1,$2,$3,($3::date + time '06:00') at time zone current_setting('TimeZone'),($3::date + time '12:00') at time zone current_setting('TimeZone'),'closed')`, [co, lead.pid, old]);
r = await rpc(owner.u, `select public.maintenance_property_visits($1::uuid) as x`, [prop]);
const oldRec = r.v.find((h) => h.stop_id === L.s1);
check('23 an older visit with no saved crew visit still gets elapsed time and an estimate from the stop\'s own arrival/completion times', oldRec && Number(oldRec.elapsed_minutes) === 30 && Number(oldRec.est_labor_minutes) === 30 && oldRec.saved_visit === false, JSON.stringify(oldRec));

// ── who may read / change ──────────────────────────────────────────────────
r = await rpc(a2.u, `select public.maintenance_property_visits($1::uuid) as x`, [prop]);
const r24 = await rpc(ownerB.u, `select public.maintenance_property_visits($1::uuid) as x`, [prop]);
check('24 workers and another company\'s owner cannot read a property\'s visit history or labor estimates', !r.ok && !r24.ok, r.msg + (r24.msg ?? ''));
const vId = (await one(`select id from public.time_visits where maintenance_stop_id = $1`, [P.s1])).id;
r = await rpc(a2.u, `select public.maintenance_staff_edit_visit($1::uuid, null, now(), 'trying') as x`, [vId]);
check('25 a worker cannot edit a visit\'s times', !r.ok, r.msg);
r = await rpc(owner.u, `select public.maintenance_staff_edit_visit($1::uuid, $2::timestamptz, null, 'Arrival was entered late') as x`, [vId, await at('09:50')]);
const aud = await all(`select old_value, new_value, reason from public.time_audit where visit_id = $1 and action = 'corrected'`, [vId]);
check('26 the owner can correct a visit time; the old value, new value and reason are kept', r.ok && aud.length === 1 && aud[0].reason === 'Arrival was entered late', r.msg);
r = await rpc(owner.u, `select public.maintenance_property_visits($1::uuid) as x`, [prop]);
check('27 after the correction the visit and its labor estimate follow the new arrival time (50 minutes elapsed)', r.ok && Number(r.v.find((h) => h.stop_id === P.s1).elapsed_minutes) === 50);
check('28 a crew visit never gets per-person intervals (not even from the owner)', !(await rpc(owner.u, `select public.time_staff_add_interval($1::uuid, $2::uuid, $3::timestamptz, $4::timestamptz, 'by hand') as x`, [vId, a2.pid, await at('10:00'), await at('10:10')])).ok);

// ── every route needs ONE explicitly named leader; nobody becomes leader implicitly ──
await asDb();
const f1 = await mk('f1@x.test', 'Fresh One');
const f2 = await mk('f2@x.test', 'Fresh Two');
const f3 = await mk('f3@x.test', 'LeaderOnly');
const f4 = await mk('f4@x.test', 'NotMaintenance');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'worker','active','maintenance'),($1,$3,'worker','active','maintenance'),($1,$4,'worker','active','maintenance'),($1,$5,'worker','active','landscaping')`, [co, f1.pid, f2.pid, f3.pid, f4.pid]);
// a route today with NO leader (like the routes that existed before this rule): crew f1 and f2
const N = (await one(`insert into public.maintenance_routes (company_id, service_date, name) values ($1,$2,'NoLead') returning id`, [co, today])).id;
for (const p of [f1, f2]) await db.query(`insert into public.maintenance_route_crew (company_id, route_id, person_id) values ($1,$2,$3)`, [co, N, p.pid]);
const ns = (await one(`insert into public.maintenance_stops (company_id, route_id, property_id, contract_id, sort_order) values ($1,$2,$3,$4,1) returning id`, [co, N, prop, contract])).id;
await clockIn(f1.u); await clockIn(f2.u);
r = await arrive(f1.u, ns);
check('29 a route with NO leader: a clocked-in crew member cannot check in, with a plain explanation (no one is promoted by default)', !r.ok && /no crew leader yet/.test(r.msg) && (await one(`select status from public.maintenance_stops where id = $1`, [ns])).status === 'pending', r.msg);
r = await arrive(f2.u, ns);
check('29b nor can the other crew member; a lone crew member does not become leader either', !r.ok && /no crew leader yet/.test(r.msg));
r = await rpc(f1.u, `select public.maintenance_mark_arrived($1::uuid) as x`, [ns]);
const r29c = await rpc(f1.u, `select public.maintenance_finish_stop($1::uuid) as x`, [ns]);
check('29c the older direct functions refuse as well (backend, not just screens)', !r.ok && !r29c.ok && /no crew leader yet/.test(r.msg + r29c.msg), r.msg);
await asUser(owner.u);
let direct = 'no error';
try { await db.query(`update public.maintenance_routes set lead_person_id = $2 where id = $1`, [N, f3.pid]); } catch (e) { direct = String(e.message); }
await asDb();
check('29d choosing a leader by editing the route row is checked too: the leader must be on the crew', /on the route.s crew|Add them to the crew/.test(direct), direct);
r = await rpc(f1.u, `select public.maintenance_set_route_leader($1::uuid, $2::uuid) as x`, [N, f1.pid]);
check('30 a worker cannot name themselves (or anyone) leader', !r.ok && /not found/i.test(r.msg), r.msg);
r = await rpc(owner.u, `select public.maintenance_routes_without_leader() as x`);
check('31 the owner can list the routes that still need a leader (including routes that existed before)', r.ok && r.v.some((x) => x.route_id === N && x.crew === 2), JSON.stringify(r.v));
r = await rpc(a2.u, `select public.maintenance_routes_without_leader() as x`);
check('31b workers cannot list them', !r.ok, r.msg);
r = await rpc(owner.u, `select public.maintenance_set_route_leader($1::uuid, $2::uuid) as x`, [N, f3.pid]);
check('32 the leader must already be on the route crew (nobody is added by choosing them)', !r.ok && /on the route.s crew/.test(r.msg), r.msg);
r = await rpc(owner.u, `select public.maintenance_set_route_leader($1::uuid, null) as x`, [N]);
check('32b a route can never be left without a leader through the function', !r.ok && /Choose a crew leader/.test(r.msg), r.msg);
r = await rpc(owner.u, `select public.maintenance_set_route_leader($1::uuid, $2::uuid) as x`, [N, f1.pid]);
check('33 the owner designates f1 as leader (audited)', r.ok && (await one(`select lead_person_id from public.maintenance_routes where id = $1`, [N])).lead_person_id === f1.pid
  && (await one(`select count(*)::int c from public.membership_audit_log where event_type = 'route_leader_set' and target_id = $1`, [f1.pid])).c === 1, r.msg);
r = await arrive(f2.u, ns);
const r33b = await arrive(f1.u, ns);
check('34 now only the designated leader can check the crew in; the other crew member is refused with the only-the-leader message', !r.ok && /Only the crew leader/.test(r.msg) && r33b.ok, (r.msg ?? '') + (r33b.msg ?? ''));
r = await rpc(f2.u, `select public.maintenance_leader_complete($1::uuid) as x`, [ns]);
const r34b = await finish(f1.u, ns);
check('35 only the leader completes it', !r.ok && /Only the crew leader/.test(r.msg) && r34b.ok, (r.msg ?? '') + (r34b.msg ?? ''));
await asUser(owner.u);
let cleared = 'no error';
try { await db.query(`update public.maintenance_routes set lead_person_id = null where id = $1`, [N]); } catch (e) { cleared = String(e.message); }
await asDb();
check('36 a leader cannot be removed with a direct edit (the route would be left without one)', /always needs a crew leader/.test(cleared), cleared);
// owner keeps authority on a route with no leader
const N2 = (await one(`insert into public.maintenance_routes (company_id, service_date, name) values ($1,$2,'NoLead2') returning id`, [co, today])).id;
await db.query(`insert into public.maintenance_route_crew (company_id, route_id, person_id) values ($1,$2,$3)`, [co, N2, f2.pid]);
const ns2 = (await one(`insert into public.maintenance_stops (company_id, route_id, property_id, contract_id, sort_order) values ($1,$2,$3,$4,1) returning id`, [co, N2, prop2, contract2])).id;
r = await rpc(owner.u, `select public.maintenance_leader_arrive($1::uuid) as x`, [ns2]);
check('37 the owner (authorized by the existing rules) can still check in on a route with no leader', r.ok, r.msg);
r = await rpc(owner.u, `select public.maintenance_leader_complete($1::uuid) as x`, [ns2]);
check('37b and complete it', r.ok, r.msg);
r = await rpc(owner.u, `select public.maintenance_set_route_leader($1::uuid, $2::uuid) as x`, [N2, f4.pid]);
check('38 a landscaping worker who is not on the crew cannot be made a route leader', !r.ok, r.msg);
// a named leader who is not in the crew list (legacy shape) is still the leader
const M = (await one(`insert into public.maintenance_routes (company_id, service_date, name, lead_person_id) values ($1,$2,'LeadOnly',$3) returning id`, [co, today, f3.pid])).id;
await db.query(`insert into public.maintenance_route_crew (company_id, route_id, person_id) values ($1,$2,$3)`, [co, M, f2.pid]);
const ms = (await one(`insert into public.maintenance_stops (company_id, route_id, property_id, contract_id, sort_order) values ($1,$2,$3,$4,1) returning id`, [co, M, prop2, contract2])).id;
r = await clockIn(f3.u);
check('39 a named route leader who is not in the crew list can clock in (they are on the route)', r.ok, r.msg);
r = await arrive(f3.u, ms);
check('39b and check the crew in', r.ok, r.msg);
await db.query(`update public.company_members set status = 'inactive' where person_id = $1`, [f3.pid]);
r = await finish(f3.u, ms);
check('40 a deactivated leader cannot finish the stop', !r.ok, r.msg);
// workers cannot change stops directly either
await asUser(f2.u);
let directStop = 'no error';
try { await db.query(`update public.maintenance_stops set status = 'completed' where id = $1`, [ns2]); } catch (e) { directStop = String(e.message); }
await asDb();
check('41 a worker cannot write a stop or a visit directly (no rows change)', (await one(`select count(*)::int c from public.maintenance_stops where id = $1 and status = 'completed' and completed_by is null`, [ns2])).c === 0
  && !(await rpc(f2.u, `insert into public.time_visits (company_id, source, crew_level, maintenance_stop_id) values ('${co}', 'maintenance_stop', true, '${ns2}') returning 1 as x`)).ok);

// ── permanent company deletion lists the stored files (so they are not left behind) ──
await asDb();
await db.exec(`set session_replication_role = replica`);
const cd = (await one(`insert into public.companies (name) values ('Closing Co') returning id`)).id;
await db.exec(`set session_replication_role = origin`);
const ownerD = await mk('ownerd@x.test', 'OwnerD');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active')`, [cd, ownerD.pid]);
const wOnly = await mk('wonly@x.test', 'OnlyHere');
const wBoth = await mk('wboth@x.test', 'InTwoCompanies');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'worker','active','maintenance'),($1,$3,'worker','active','maintenance'),($4,$3,'worker','active','maintenance')`, [cd, wOnly.pid, wBoth.pid, co]);
const projD = (await one(`insert into public.projects (company_id, name, status) values ($1,'P','active') returning id`, [cd])).id;
await db.query(`insert into public.project_photos (company_id, project_id, uploaded_by, file_url, file_key) values ($1,$2,$3,'https://x/a.jpg','cd/projects/a.jpg'),($1,$2,$3,'https://x/b.jpg','cd/projects/b.jpg')`, [cd, projD, ownerD.pid]);
await db.query(`insert into public.project_photos (company_id, project_id, uploaded_by, file_url, file_key) values ($1,$2,$3,'https://x/c.jpg','keep/other.jpg')`, [co, (await one(`insert into public.projects (company_id, name, status) values ($1,'Keep','active') returning id`, [co])).id, owner.pid]);
r = await rpc(ownerD.u, `select public.delete_my_company('closing co') as x`);
const q = await all(`select file_key, source_table, processed_at from public.storage_cleanup_queue where company_id = $1 and kind = 'file' order by file_key`, [cd]);
check('32 permanent company deletion lists every stored file of that company for removal, in the same all-or-nothing step', r.ok && q.length === 2 && q[0].file_key === 'cd/projects/a.jpg' && q.every((x) => x.source_table === 'project_photos' && x.processed_at === null), (r.msg ?? '') + JSON.stringify(q));
check('33 only the deleted company: the other company files are not listed, its rows are untouched', (await one(`select count(*)::int c from public.storage_cleanup_queue where file_key = 'keep/other.jpg'`)).c === 0 && (await one(`select count(*)::int c from public.project_photos where file_key = 'keep/other.jpg'`)).c === 1);
check('34 nobody can read or change the cleanup list through the app', !(await rpc(owner.u, `select count(*) as x from public.storage_cleanup_queue`)).ok);
check('35 the company itself is gone with no leftover rows', (await one(`select count(*)::int c from public.companies where id = $1`, [cd])).c === 0 && (await one(`select count(*)::int c from public.projects where id = $1`, [projD])).c === 0);

// ── the cleanup job: claim, retry with delay, give up after 8, done only when storage confirmed ──
await asDb();
await db.query(`delete from public.storage_cleanup_queue where kind = 'prefix'`);   // folders are covered by the 74 test
check('36 the app cannot claim, finish or read the job status', !(await rpc(owner.u, `select count(*) as x from public.storage_cleanup_claim(5)`)).ok
  && !(await rpc(owner.u, `select public.storage_cleanup_finish('${q[0] ? (await one(`select id from public.storage_cleanup_queue limit 1`)).id : ''}'::uuid, true) as x`)).ok
  && !(await rpc(owner.u, `select public.storage_cleanup_status() as x`)).ok);
const c1 = await all(`select * from public.storage_cleanup_claim(10)`);
check('37 a run claims the due files and locks them (attempt 1)', c1.length === 2 && c1.every((x) => x.attempts === 1));
check('37b a second run at the same time claims nothing (locked, no double deletion)', (await all(`select * from public.storage_cleanup_claim(10)`)).length === 0);
await db.query(`select public.storage_cleanup_finish($1::uuid, false, 'storage down')`, [c1[0].id]);
let row = await one(`select status, attempts, last_error, locked_until, processed_at, next_attempt_at > now() as later from public.storage_cleanup_queue where id = $1`, [c1[0].id]);
check('38 a failed delete is kept for retry with a delay, the error is recorded, and it is NOT marked processed', row.status === 'pending' && row.later && row.last_error === 'storage down' && row.processed_at === null && row.locked_until === null, JSON.stringify(row));
await db.query(`select public.storage_cleanup_finish($1::uuid, true)`, [c1[1].id]);
row = await one(`select status, processed_at from public.storage_cleanup_queue where id = $1`, [c1[1].id]);
check('39 a confirmed delete is marked done and processed', row.status === 'done' && row.processed_at !== null);
check('39b the retry is not claimed before its delay is over', (await all(`select * from public.storage_cleanup_claim(10)`)).length === 0);
await db.query(`update public.storage_cleanup_queue set next_attempt_at = now() - interval '1 minute', attempts = 7, locked_until = null where id = $1`, [c1[0].id]);
const c2 = await all(`select * from public.storage_cleanup_claim(10)`);
check('40 once the delay is over it is claimed again (attempt 8)', c2.length === 1 && c2[0].id === c1[0].id && c2[0].attempts === 8);
await db.query(`select public.storage_cleanup_finish($1::uuid, false, 'still down')`, [c1[0].id]);
row = await one(`select status, processed_at from public.storage_cleanup_queue where id = $1`, [c1[0].id]);
const st = await one(`select public.storage_cleanup_status() as x`);
check('41 after 8 failed attempts it is marked failed (not processed), and the status counts it so nobody is told the files are gone', row.status === 'failed' && row.processed_at === null && st.x.failed === 1 && st.x.done === 1 && st.x.pending === 0, JSON.stringify(st.x));
await db.query(`update public.storage_cleanup_queue set next_attempt_at = now() - interval '1 minute', locked_until = now() - interval '1 minute' where status = 'pending'`);
check('42 a crashed run (lock expired) is picked up again', true);

// ── deleting a company deletes the accounts that belonged only to it ──
const acct = async (x) => ({ p: (await one(`select count(*)::int c from public.people where id = $1`, [x.pid])).c, u: (await one(`select count(*)::int c from auth.users where id = $1`, [x.u])).c });
const aO = await acct(ownerD), aW = await acct(wOnly), aB = await acct(wBoth);
check('43 the owner and the worker who belonged only to the deleted company lose their person record AND their login (no stuck "Finish setting up" account)', aO.p === 0 && aO.u === 0 && aW.p === 0 && aW.u === 0, JSON.stringify([aO, aW]));
check('44 a worker who also belongs to another company keeps their account and the other membership', aB.p === 1 && aB.u === 1 && (await one(`select count(*)::int c from public.company_members where person_id = $1 and company_id = $2`, [wBoth.pid, co])).c === 1, JSON.stringify(aB));
check('45 the other company people and logins are untouched', (await acct(owner)).p === 1 && (await acct(owner)).u === 1);
check('46 the closure record keeps how many accounts were deleted', (await one(`select (counts->>'accounts_deleted')::int n from public.company_closure_log where company_id = $1`, [cd])).n === 2);

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
