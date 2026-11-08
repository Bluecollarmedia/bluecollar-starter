// Update 82: dispatching a storm tells every live route's lead and crew (once each); a new lead or a newly added crew member is told
// mid-storm; drafts, cancelled routes and other companies never get anything.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 82) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/082_snow_crew_push.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 82 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
const login = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  let pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id;
  if (!pid) pid = (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  else await db.query(`update public.people set first_name = $2 where id = $1`, [pid, name]);
  return { u, pid };
};

const co = (await one(`insert into public.companies (name) values ('Acme Snow') returning id`)).id;
const owner = await login('o@x.test', 'Owner');
const lead = await login('lead@x.test', 'Lead');
const lead2 = await login('lead2@x.test', 'Lead2');
const crew = await login('crew@x.test', 'Crew');
const late = await login('late@x.test', 'Late');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active'),($1,$3,'worker','active'),($1,$4,'worker','active'),($1,$5,'worker','active'),($1,$6,'worker','active')`,
  [co, owner.pid, lead.pid, lead2.pid, crew.pid, late.pid]);
for (const p of [lead, lead2, crew, late]) {
  await db.query(`insert into public.snow_staff (company_id, person_id, status, granted_at) values ($1,$2,'active',now())`, [co, p.pid]);
  await db.query(`insert into public.snow_staff_services (company_id, person_id, service) values ($1,$2,'plowing')`, [co, p.pid]);
}
const prop = (await one(`insert into public.snow_properties (company_id, name, address) values ($1,'Oak Plaza','1 Oak St') returning id`, [co])).id;
await db.query(`insert into public.snow_property_services (company_id, property_id, service, is_active) values ($1,$2,'plowing',true)`, [co, prop]);

const st = (await rpc(owner.u, `select public.snow_create_storm('Oct 21 Plowing', 'plowing') as x`)).v;
const stormId = st?.storm?.id ?? st?.id ?? (await one(`select id from public.snow_storms where company_id = $1`, [co])).id;
const route = (await one(`insert into public.snow_routes (company_id, storm_id, name, service, lead_person_id) values ($1,$2,'North route','plowing',$3) returning id`, [co, stormId, lead.pid])).id;
await db.query(`insert into public.snow_visits (company_id, storm_id, route_id, property_id, service, status, position) values ($1,$2,$3,$4,'plowing','pending',1),($1,$2,$3,$4,'plowing','pending',2)`, [co, stormId, route, prop]);
await db.query(`insert into public.snow_route_crew (route_id, person_id) values ($1,$2)`, [route, crew.pid]);
const cancelled = (await one(`insert into public.snow_routes (company_id, storm_id, name, service, lead_person_id, cancelled_at) values ($1,$2,'Old route','plowing',$3,now()) returning id`, [co, stormId, lead2.pid])).id;

const count = async (person, event) => (await one(`select count(*)::int c from public.snow_notifications where recipient_person_id = $1 and event = $2`, [person, event])).c;

check('1 nothing is sent while the storm is still a draft (building the crew tells nobody)', (await count(lead.pid, 'storm.dispatched')) === 0 && (await count(crew.pid, 'storm.dispatched')) === 0);

let r = await rpc(owner.u, `select public.snow_dispatch_storm($1::uuid) as x`, [stormId]);
check('2 dispatching works', r.ok, r.msg);
check('3 the lead is told, with their route name and stop count', (await count(lead.pid, 'storm.dispatched')) === 1
  && /North route/.test((await one(`select body from public.snow_notifications where recipient_person_id = $1 and event = 'storm.dispatched'`, [lead.pid])).body)
  && /2 stops/.test((await one(`select body from public.snow_notifications where recipient_person_id = $1 and event = 'storm.dispatched'`, [lead.pid])).body));
check('4 the crew member is told too, as crew', (await count(crew.pid, 'storm.dispatched')) === 1
  && /crew of North route/.test((await one(`select body from public.snow_notifications where recipient_person_id = $1`, [crew.pid])).body));
check('5 a cancelled route\'s lead is NOT told, and neither is anyone not on a route', (await count(lead2.pid, 'storm.dispatched')) === 0 && (await count(late.pid, 'storm.dispatched')) === 0);
const d = await all(`select channel, status from public.snow_notification_deliveries d join public.snow_notifications n on n.id = d.notification_id where n.recipient_person_id = $1`, [lead.pid]);
check('6 each notice has an in-app copy (stored) and a push row that goes to the sender (or is marked unavailable honestly)', d.some((x) => x.channel === 'in_app' && x.status === 'stored') && d.some((x) => x.channel === 'push'), JSON.stringify(d));
check('7 the lead sees it in their notification list, linked to the route',
  (await one(`select count(*)::int c from public.app_notifications where recipient_id = $1 and linked_entity_type = 'snow_route' and linked_entity_id = $2`, [lead.pid, route])).c === 1);

// dispatching again changes nothing
await rpc(owner.u, `select public.snow_dispatch_storm($1::uuid) as x`, [stormId]);
check('8 dispatching an already dispatched storm never sends a second notice', (await count(lead.pid, 'storm.dispatched')) === 1);

// mid-storm changes
await db.query(`update public.snow_routes set lead_person_id = $2 where id = $1`, [route, lead2.pid]);
check('9 a NEW lead is told mid-storm', (await count(lead2.pid, 'route.lead_assigned')) === 1);
await db.query(`insert into public.snow_route_crew (route_id, person_id) values ($1,$2)`, [route, late.pid]);
check('10 someone added to the crew mid-storm is told', (await count(late.pid, 'route.crew_added')) === 1);
check('11 a draft storm\'s changes tell nobody (the first lead change above was on a dispatched storm; a second storm in draft stays silent)', await (async () => {
  const s2 = (await one(`insert into public.snow_storms (company_id, name, service) values ($1,'Draft storm','plowing') returning id`, [co])).id;
  const r2 = (await one(`insert into public.snow_routes (company_id, storm_id, name, service, lead_person_id) values ($1,$2,'Draft route','plowing',$3) returning id`, [co, s2, lead.pid])).id;
  await db.query(`update public.snow_routes set lead_person_id = $2 where id = $1`, [r2, crew.pid]);
  return (await count(crew.pid, 'route.lead_assigned')) === 0;
})());

// reopen -> dispatched again tells them again
await rpc(owner.u, `select public.snow_end_storm($1::uuid) as x`, [stormId]);
await rpc(owner.u, `select public.snow_reopen_storm($1::uuid) as x`, [stormId]);
check('12 a storm that is ended, reopened and dispatched again tells the crew again (new dispatch, new notice)', (await count(crew.pid, 'storm.dispatched')) === 2 && (await count(lead2.pid, 'storm.dispatched')) === 1);

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
