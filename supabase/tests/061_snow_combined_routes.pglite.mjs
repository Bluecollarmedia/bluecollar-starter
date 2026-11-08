// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && copy this file (and ./helpers/fullSchema.mjs) beside it, then:
//   node <file> <path to the repo>
// Proves update 61 on the REAL full schema + every update (PGlite, not real Supabase): ONE snow route can do several services together
// (plowing + salting). A property gets one visit per service in that route; a lead starts both visits at a property without finishing
// the first; moving to a different property still needs the current stop finished; dispatch needs a lead who can work every service;
// and everything that already worked (single-service routes) still works.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 260)}`); };
check('0 the full schema and all updates (including 061) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/061_snow_combined_routes.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 61 can be run a second time', again);
const fails = async (sql, p) => { try { await db.query(sql, p); return { raised: false, msg: '' }; } catch (e) { return { raised: true, msg: String(e.message) }; } };
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;

const co = (await one(`insert into public.companies (name) values ('Test Co') returning id`)).id;
const mk = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const owner = await mk('owner@x.test', 'Owner');
const lead = await mk('lead@x.test', 'Lead');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1, $2, 'owner', 'active'), ($1, $3, 'worker', 'active')`, [co, owner.pid, lead.pid]);
await db.query(`insert into public.snow_staff (company_id, person_id, status) values ($1, $2, 'active')`, [co, lead.pid]);
await db.query(`insert into public.snow_staff_services (company_id, person_id, service) values ($1, $2, 'plowing')`, [co, lead.pid]);

const mkProp = async (name, services) => {
  const id = (await one(`insert into public.snow_properties (company_id, name, address) values ($1, $2, '1 St') returning id`, [co, name])).id;
  for (const s of services) await db.query(`insert into public.snow_property_services (company_id, property_id, service, is_active) values ($1, $2, $3, true)`, [co, id, s]);
  return id;
};
const pBoth = await mkProp('Oak Plaza', ['plowing', 'salting']);
const pBoth2 = await mkProp('Elm Court', ['plowing', 'salting']);
const pPlowOnly = await mkProp('Pine Lot', ['plowing']);

const st = (await one(`insert into public.snow_storms (company_id, name, service, services, status) values ($1, 'Oct 19', 'plowing', array['plowing','salting'], 'draft') returning id`, [co])).id;

// ── a combined route
let f = await fails(`insert into public.snow_routes (company_id, storm_id, name, services) values ($1, $2, 'Truck 1', array['plowing','salting'])`, [co, st]);
check('1 one route can be created for plowing AND salting together', !f.raised, f.msg);
const route = await one(`select id, service, services from public.snow_routes where storm_id = $1`, [st]);
check('2 its own service is the first (plowing) and it keeps both services', route.service === 'plowing' && route.services.join() === 'plowing,salting', JSON.stringify(route));
f = await fails(`insert into public.snow_routes (company_id, storm_id, name, services) values ($1, $2, 'Bad', array['plowing','shoveling'])`, [co, st]);
check('3 a route cannot include a service the storm does not have', f.raised, f.msg);
f = await fails(`update public.snow_routes set services = array['plowing'] where id = $1`, [route.id]);
const still = await one(`select services from public.snow_routes where id = $1`, [route.id]);
check('4 a route\'s services are fixed once it is made', still.services.join() === 'plowing,salting', JSON.stringify(still));

// ── visits: one per service
const addVisit = (prop, svc, pos) => fails(`insert into public.snow_visits (route_id, property_id, service, position) values ($1, $2, $3, $4)`, [route.id, prop, svc, pos]);
f = await addVisit(pBoth, 'plowing', 1);
const f2 = await addVisit(pBoth, 'salting', 2);
check('5 a property gets a plowing visit and a salting visit in the same route', !f.raised && !f2.raised, f.msg + f2.msg);
f = await addVisit(pPlowOnly, 'salting', 3);
check('6 a visit for a service the property does not offer is still refused', f.raised && /isn't set up for/.test(f.msg), f.msg);
f = await fails(`insert into public.snow_visits (route_id, property_id, position) values ($1, $2, 3)`, [route.id, pPlowOnly]);
check('7 a visit with no service takes the route\'s own service (plowing)', !f.raised && (await one(`select service from public.snow_visits where property_id = $1`, [pPlowOnly])).service === 'plowing', f.msg);
await addVisit(pBoth2, 'plowing', 4); await addVisit(pBoth2, 'salting', 5);
const svs = await all(`select service from public.snow_visits where route_id = $1 order by position`, [route.id]);
check('8 the visits carry their own services', svs.map((x) => x.service).join() === 'plowing,salting,plowing,plowing,salting', svs.map((x) => x.service).join());

// a single-service route still refuses a service it does not do
const st2 = (await one(`insert into public.snow_storms (company_id, name, service, services, status) values ($1, 'Other', 'plowing', array['plowing','salting'], 'draft') returning id`, [co])).id;
const r2 = (await one(`insert into public.snow_routes (company_id, storm_id, name, service) values ($1, $2, 'Plow only', 'plowing') returning id`, [co, st2])).id;
f = await fails(`insert into public.snow_visits (route_id, property_id, service, position) values ($1, $2, 'salting', 1)`, [r2, pBoth]);
check('9 a plowing-only route refuses a salting visit', f.raised && /doesn't do/.test(f.msg), f.msg);
await db.query(`delete from public.snow_storms where id = $1`, [st2]);

// ── dispatch needs a lead who can work every service
await db.query(`update public.snow_routes set lead_person_id = $2 where id = $1`, [route.id, lead.pid]);
await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${owner.u}', false); set role authenticated;`);
f = await fails(`select public.snow_dispatch_storm($1)`, [st]);
check('10 dispatch is refused while the lead can only plow (and says which route)', f.raised && /Truck 1 \(plowing \+ salting\)/.test(f.msg), f.msg);
await db.exec('reset role');
await db.query(`insert into public.snow_staff_services (company_id, person_id, service) values ($1, $2, 'salting')`, [co, lead.pid]);
await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${owner.u}', false); set role authenticated;`);
f = await fails(`select public.snow_dispatch_storm($1)`, [st]);
check('11 once the lead can plow and salt, the storm dispatches', !f.raised, f.msg);

// ── the lead works the stops
const vis = await all(`select id, property_id, service, position from public.snow_visits where route_id = $1 order by position`, [route.id]);
await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${lead.u}', false); set role authenticated;`);
f = await fails(`select public.snow_arrive_visit($1)`, [vis[0].id]);
check('12 the lead arrives at the first property (plowing visit)', !f.raised, f.msg);
f = await fails(`select public.snow_arrive_visit($1)`, [vis[1].id]);
check('13 and can start the salting visit at the SAME property without finishing the plowing one', !f.raised, f.msg);
f = await fails(`select public.snow_arrive_visit($1)`, [vis[2].id]);
check('14 but cannot start a DIFFERENT property while this one is still open', f.raised && /Finish the stop/.test(f.msg), f.msg);
f = await fails(`select public.snow_complete_visit($1)`, [vis[0].id]);
const g = await fails(`select public.snow_complete_visit($1)`, [vis[1].id]);
check('15 both visits at the property can be finished', !f.raised && !g.raised, f.msg + g.msg);
f = await fails(`select public.snow_arrive_visit($1)`, [vis[2].id]);
check('16 then the next property can be started', !f.raised, f.msg);
await db.exec('reset role');

// ── nothing about plain routes changed
const st3 = (await one(`insert into public.snow_storms (company_id, name, service, services, status) values ($1, 'Plain', 'plowing', array['plowing'], 'draft') returning id`, [co])).id;
f = await fails(`insert into public.snow_routes (company_id, storm_id, name) values ($1, $2, 'Route 1')`, [co, st3]);
const plain = await one(`select service, services from public.snow_routes where storm_id = $1`, [st3]);
check('17 a normal one-service route still works and gets services = just its service', !f.raised && plain.service === 'plowing' && plain.services.join() === 'plowing', JSON.stringify(plain) + f.msg);
await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${owner.u}', false); set role authenticated;`);
f = await fails(`select public.snow_set_storm_services($1, array['plowing'])`, [st]);
await db.exec('reset role');
check('18 a storm cannot drop salting while a route does salting', f.raised && /salting/.test(f.msg), f.msg);

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
