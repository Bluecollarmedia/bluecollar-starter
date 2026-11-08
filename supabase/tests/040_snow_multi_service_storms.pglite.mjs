// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && copy this file there && node <file> <path to the repo>
// Logic tests for update 40 (one storm, several services) on an in-process Postgres (PGlite).
// REAL SQL from the repo: the storm and route tables (020b), the old route-fill trigger (020b),
// the whole storm lifecycle update (024), the route-template apply function (025) and update 40.
// Small stand-ins: people/companies/members, snow properties and property services, route
// visits (with the same composite link to the route as production), skip requests, and the
// helper functions my_person_id / is_staff / snow_person_has_service. NOT the full production
// schema: row-level security and the activity log are not exercised here.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const repo = process.argv[2];
const read = (p) => fs.readFileSync(`${repo}/${p}`, 'utf8');
const grabTable = (text, marker) => { const a = text.indexOf(marker); const b = text.indexOf('\n);', a); return text.slice(a, b + 3); };
const grabFn = (text, marker) => { const a = text.indexOf(marker); const b = text.indexOf('\n$$;', a); return text.slice(a, b + 4); };

const f020b = read('supabase/updates/020b_snow_foundation.sql');
const f024 = read('supabase/updates/024_snow_storm_lifecycle.sql');
const f025 = read('supabase/updates/025_snow_routes_templates.sql');
const f040 = read('supabase/updates/040_snow_multi_service_storms.sql');

const stormsTable = grabTable(f020b, 'create table if not exists public.snow_storms');
const routesTable = grabTable(f020b, 'create table if not exists public.snow_routes');
const oldRouteFill = grabFn(f020b, 'create or replace function public.snow_route_fill') +
  "\ncreate trigger snow_routes_fill before insert or update on public.snow_routes for each row execute function public.snow_route_fill();";
const templateTables = grabTable(f025, 'create table if not exists public.snow_route_templates') + '\n' +
  grabTable(f025, 'create table if not exists public.snow_route_template_stops');
const applyFn = grabFn(f025, 'create or replace function public.snow_apply_route_template');

const standIn = `
create role anon; create role authenticated;
create table public.companies (id uuid primary key default gen_random_uuid());
create table public.people (id uuid primary key default gen_random_uuid(), name text);
create table public.company_members (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), person_id uuid not null references public.people(id), role text not null, status text not null default 'active', created_at timestamptz default now());
create function public.my_person_id() returns uuid language sql stable as $$ select nullif(current_setting('test.pid', true), '')::uuid $$;
create function public.is_staff(cid uuid) returns boolean language sql stable as $$
  select exists (select 1 from public.company_members m where m.company_id = cid and m.person_id = public.my_person_id() and m.role in ('owner','admin') and m.status = 'active') $$;
create table public.snow_staff_services (company_id uuid, person_id uuid, service text);
create function public.snow_person_has_service(cid uuid, pid uuid, svc text) returns boolean language sql stable as $$
  select exists (select 1 from public.snow_staff_services s where s.company_id = cid and s.person_id = pid and s.service = svc) $$;
create table public.snow_properties (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), name text not null,
  address text default '', city text, state text, zip text, latitude numeric, longitude numeric, map_destination text, status text not null default 'active');
create table public.snow_property_services (property_id uuid not null references public.snow_properties(id), service text not null, is_active boolean not null default true);
create table public.snow_skip_requests (storm_id uuid, status text);
`;

const visitsAndRouteFill = `
create table public.snow_visits (
  id uuid primary key default gen_random_uuid(), company_id uuid, storm_id uuid not null references public.snow_storms(id) on delete cascade,
  route_id uuid not null references public.snow_routes(id) on delete cascade, property_id uuid, service text not null,
  position int not null default 0, status text not null default 'pending', created_by uuid,
  foreign key (route_id, storm_id, service) references public.snow_routes (id, storm_id, service) on delete cascade);
create function public.snow_visit_fill() returns trigger language plpgsql as $$
declare r record; begin
  select company_id, storm_id, service into r from public.snow_routes where id = new.route_id;
  new.company_id := r.company_id; new.storm_id := r.storm_id; new.service := r.service; return new; end $$;
create trigger snow_visits_fill before insert on public.snow_visits for each row execute function public.snow_visit_fill();
`;

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };
const q = async (db, sql, params) => (await db.query(sql, params)).rows;
const fails = async (db, sql, params, includes) => {
  try { await db.query(sql, params); return { raised: false, msg: '' }; }
  catch (e) { const msg = String(e.message); return { raised: true, msg, match: includes ? msg.includes(includes) : true }; }
};

const db = new PGlite();
await db.exec(standIn);
await db.exec(stormsTable);
await db.exec(routesTable);
await db.exec(oldRouteFill);
await db.exec(visitsAndRouteFill);
await db.exec(f024); // the real storm lifecycle (guard, create, dispatch, end, reopen, helpers, old eligible fn)
// The REAL activity log pieces as they are BEFORE update 40: the events table (foreign keys left out),
// the helper that writes an entry (020b) and the row logger that watches storms (029).
await db.exec(grabTable(f020b, 'create table if not exists public.snow_activity_events').replace(/references public\.[a-z_]+\([a-z_]+\)( on delete [a-z ]+)?/g, ''));
await db.exec(grabFn(f020b, 'create or replace function public.snow_log_event'));
await db.exec(grabFn(read('supabase/updates/029_snow_activity_log.sql'), 'create or replace function public.snow_audit_row'));
await db.exec("create trigger snow_audit after insert or update or delete on public.snow_storms for each row execute function public.snow_audit_row('storm')");
await db.exec(templateTables);
await db.exec(applyFn);

const co = (await q(db, `insert into public.companies default values returning id`))[0].id;
const person = async (name, role, services = []) => {
  const id = (await q(db, `insert into public.people (name) values ($1) returning id`, [name]))[0].id;
  if (role) await db.query(`insert into public.company_members (company_id, person_id, role) values ($1, $2, $3)`, [co, id, role]);
  for (const s of services) await db.query(`insert into public.snow_staff_services (company_id, person_id, service) values ($1, $2, $3)`, [co, id, s]);
  return id;
};
const owner = await person('Olive', 'owner');
const plowGuy = await person('Pete', null, ['plowing']);
const shovelGal = await person('Sue', null, ['shoveling']);
const stranger = await person('Sam', null);
const as = (pid) => db.query(`select set_config('test.pid', $1, false)`, [pid ?? '']);
const prop = async (name, services, status = 'active') => {
  const id = (await q(db, `insert into public.snow_properties (company_id, name, status) values ($1, $2, $3) returning id`, [co, name, status]))[0].id;
  for (const s of services) await db.query(`insert into public.snow_property_services (property_id, service) values ($1, $2)`, [id, s]);
  return id;
};
const pPlow = await prop('Plow Lot', ['plowing']);
const pShovel = await prop('Shovel Walk', ['shoveling']);
const pBoth = await prop('Both Place', ['plowing', 'shoveling']);
const pOff = await prop('Closed Place', ['plowing'], 'inactive');

// ── History from BEFORE update 40 ───────────────────────────────────────────
await as(owner);
const legacy = (await q(db, `select (public.snow_create_storm('Old Plow Storm', 'plowing')->'storm'->>'id') as id`))[0].id;
await db.query(`insert into public.snow_routes (storm_id, name, lead_person_id) values ($1, 'Old Route', $2)`, [legacy, plowGuy]);
const legacyRoute = (await q(db, `select id from public.snow_routes where storm_id = $1`, [legacy]))[0].id;
await db.query(`insert into public.snow_visits (route_id, property_id) values ($1, $2)`, [legacyRoute, pPlow]);
await db.query(`select public.snow_dispatch_storm($1)`, [legacy]);
await db.query(`update public.snow_visits set status = 'completed' where route_id = $1`, [legacyRoute]);
await db.query(`select public.snow_end_storm($1)`, [legacy]);

// ── Apply update 40 (twice: it must be safe to run again) ───────────────────
await db.exec(f040);
await db.exec(f040);
check('1 update 40 runs twice without error', true);

const old = (await q(db, `select service, services, status from public.snow_storms where id = $1`, [legacy]))[0];
check('2 an old single-service storm gets a one-item list and keeps its status', old.services.join() === 'plowing' && old.service === 'plowing' && old.status === 'ended', JSON.stringify(old));
const oldRoute = (await q(db, `select service, name from public.snow_routes where id = $1`, [legacyRoute]))[0];
const oldVisit = (await q(db, `select service, status from public.snow_visits where route_id = $1`, [legacyRoute]))[0];
check('3 old routes and completed visits are untouched', oldRoute.service === 'plowing' && oldRoute.name === 'Old Route' && oldVisit.status === 'completed' && oldVisit.service === 'plowing');

// ── Creating storms ─────────────────────────────────────────────────────────
const multi = (await q(db, `select public.snow_create_storm('Big Storm', array['plowing','shoveling']) as r`))[0].r.storm;
check('4 a storm can include several services; the old single column is the first', multi.services.join() === 'plowing,shoveling' && multi.service === 'plowing' && multi.status === 'draft', JSON.stringify(multi));
const dedupe = (await q(db, `select public.snow_create_storm('Tidy', array['shoveling','plowing','shoveling']) as r`))[0].r.storm;
check('5 repeats are dropped and the first choice stays first', dedupe.services.join() === 'shoveling,plowing' && dedupe.service === 'shoveling');
const oneCall = (await q(db, `select public.snow_create_storm('Legacy call', 'salting') as r`))[0].r.storm;
check('6 the old one-service call still works', oneCall.services.join() === 'salting' && oneCall.service === 'salting');
let f = await fails(db, `select public.snow_create_storm('Bad', array['plowing','ice'])`, [], 'Choose plowing');
check('7 an unknown service is refused', f.raised && f.match, f.msg);
f = await fails(db, `select public.snow_create_storm('Bad', array[]::text[])`, [], 'Choose plowing');
check('8 an empty list is refused', f.raised && f.match, f.msg);
const rid1 = '11111111-1111-1111-1111-111111111111';
const a1 = (await q(db, `select public.snow_create_storm('Twice', array['plowing'], null, $1) as r`, [rid1]))[0].r;
const a2 = (await q(db, `select public.snow_create_storm('Twice', array['plowing'], null, $1) as r`, [rid1]))[0].r;
check('9 a repeated tap with the same request id makes one storm', a1.changed === true && a2.changed === false && a1.storm.id === a2.storm.id);
await as(stranger);
f = await fails(db, `select public.snow_create_storm('Nope', array['plowing'])`, [], 'Only the owner');
check('10 only an owner or admin can create a storm', f.raised && f.match, f.msg);
await as(owner);

// ── Routes with different services ──────────────────────────────────────────
const storm = multi.id;
await db.query(`insert into public.snow_routes (storm_id, service, name, lead_person_id) values ($1, 'plowing', 'Plow A', $2)`, [storm, plowGuy]);
await db.query(`insert into public.snow_routes (storm_id, service, name, lead_person_id) values ($1, 'shoveling', 'Shovel A', $2)`, [storm, shovelGal]);
const routes = await q(db, `select name, service from public.snow_routes where storm_id = $1 order by name`, [storm]);
check('11 one storm can have routes for different services', routes.map((r) => `${r.name}:${r.service}`).join() === 'Plow A:plowing,Shovel A:shoveling', JSON.stringify(routes));
f = await fails(db, `insert into public.snow_routes (storm_id, service, name) values ($1, 'salting', 'Salt')`, [storm], "doesn't include salting");
check('12 a route for a service the storm does not include is refused', f.raised && f.match, f.msg);
f = await fails(db, `insert into public.snow_routes (storm_id, name) values ($1, 'No service')`, [storm], 'Pick the service');
check('13 on a multi-service storm a route must say which service', f.raised && f.match, f.msg);
await db.query(`insert into public.snow_routes (storm_id, name) values ($1, 'Auto')`, [legacy.replace(legacy, oneCall.id)]);
check('14 on a single-service storm the route takes that service by itself', (await q(db, `select service from public.snow_routes where storm_id = $1`, [oneCall.id]))[0].service === 'salting');
f = await fails(db, `update public.snow_routes set service = 'shoveling' where name = 'Plow A'`, [], "can't be changed");
check('15 a route\'s service cannot be changed afterwards', f.raised && f.match, f.msg);
f = await fails(db, `update public.snow_storms set service = 'salting' where id = $1`, [storm], "service can't be changed");
check('16 the old service column cannot be edited directly', f.raised && f.match, f.msg);

// visits carry their route's service
const plowRoute = (await q(db, `select id from public.snow_routes where name = 'Plow A'`))[0].id;
const shovelRoute = (await q(db, `select id from public.snow_routes where name = 'Shovel A'`))[0].id;
await db.query(`insert into public.snow_visits (route_id, property_id) values ($1, $2), ($1, $3)`, [plowRoute, pPlow, pBoth]);
await db.query(`insert into public.snow_visits (route_id, property_id) values ($1, $2), ($1, $3)`, [shovelRoute, pShovel, pBoth]);
const vs = await q(db, `select r.name rname, v.service vs, v.storm_id from public.snow_visits v join public.snow_routes r on r.id = v.route_id where v.storm_id = $1 order by r.name`, [storm]);
check('17 every visit keeps its own route\'s service and the right storm (the same property can be in both)', vs.length === 4 && vs.every((v) => (v.rname === 'Plow A' ? v.vs === 'plowing' : v.vs === 'shoveling') && v.storm_id === storm), JSON.stringify(vs));
f = await fails(db, `insert into public.snow_visits (route_id, property_id, service) values ($1, $2, 'shoveling')`, [plowRoute, pPlow]);
const sv = (await q(db, `select service from public.snow_visits where route_id = $1 order by position limit 1`, [plowRoute]))[0];
check('18 a visit can never carry a different service from its route', !f.raised && sv.service === 'plowing');

// ── Eligible properties ─────────────────────────────────────────────────────
let el = await q(db, `select name, services from public.snow_storm_eligible_properties($1)`, [storm]);
check('19 eligible = active properties with any of the storm\'s services, with which ones', el.map((r) => `${r.name}:${r.services.join('+')}`).join() === 'Both Place:plowing+shoveling,Plow Lot:plowing,Shovel Walk:shoveling', JSON.stringify(el));
el = await q(db, `select name from public.snow_storm_eligible_properties($1, 'shoveling')`, [storm]);
check('20 asking for one service shows only properties that offer it', el.map((r) => r.name).join() === 'Both Place,Shovel Walk', JSON.stringify(el));
f = await fails(db, `select * from public.snow_storm_eligible_properties($1, 'salting')`, [storm], "doesn't include salting");
check('21 asking for a service the storm lacks is refused', f.raised && f.match, f.msg);
check('22 inactive properties are never offered', !(await q(db, `select name from public.snow_storm_eligible_properties($1)`, [storm])).some((r) => r.name === 'Closed Place'));
el = await q(db, `select name from public.snow_storm_eligible_properties($1)`, [legacy]);
check('23 an old single-service storm offers the same properties as before', el.map((r) => r.name).join() === 'Both Place,Plow Lot', JSON.stringify(el));

// ── Editing the services ────────────────────────────────────────────────────
f = await fails(db, `select public.snow_set_storm_services($1, array['plowing'])`, [storm], "Can't remove shoveling");
check('24 a service that has a route cannot be removed, and the message explains that cancelled routes count too', f.raised && f.match && f.msg.includes('cancelled routes stay on the storm as history'), f.msg);
let r = (await q(db, `select public.snow_set_storm_services($1, array['plowing','shoveling','salting']) as r`, [storm]))[0].r;
check('25 a service can be added to a storm', r.changed === true && r.storm.services.join() === 'plowing,shoveling,salting');
r = (await q(db, `select public.snow_set_storm_services($1, array['plowing','shoveling','salting']) as r`, [storm]))[0].r;
check('26 saving the same list again changes nothing', r.changed === false);
r = (await q(db, `select public.snow_set_storm_services($1, array['plowing','shoveling']) as r`, [storm]))[0].r;
check('27 an unused service can be removed again', r.storm.services.join() === 'plowing,shoveling');
f = await fails(db, `select public.snow_set_storm_services($1, array[]::text[])`, [storm], 'at least one');
check('28 the list can never be empty', f.raised && f.match, f.msg);
f = await fails(db, `select public.snow_set_storm_services($1, array['plowing'])`, [legacy], 'ended');
check('29 an ended storm\'s services cannot be edited', f.raised && f.match, f.msg);
await as(stranger);
f = await fails(db, `select public.snow_set_storm_services($1, array['plowing'])`, [storm], 'Storm not found');
check('30 only an owner or admin can edit services', f.raised && f.match, f.msg);
await as(owner);

// ── Dispatch ────────────────────────────────────────────────────────────────
await db.query(`insert into public.snow_routes (storm_id, service, name, lead_person_id) values ($1, 'plowing', 'Empty Route', $2)`, [storm, plowGuy]);
f = await fails(db, `select public.snow_dispatch_storm($1)`, [storm], 'Empty Route');
check('31 a route with no stops stops the dispatch (and names it)', f.raised && f.match && f.msg.includes('no stops'), f.msg);
await db.query(`update public.snow_routes set cancelled_at = now() where name = 'Empty Route'`);
await db.query(`update public.snow_routes set lead_person_id = $1 where name = 'Shovel A'`, [plowGuy]);
f = await fails(db, `select public.snow_dispatch_storm($1)`, [storm], 'Shovel A (shoveling)');
check('32 a lead is checked against THEIR route\'s service (plowing-only lead on a shoveling route is refused)', f.raised && f.match, f.msg);
await db.query(`update public.snow_routes set lead_person_id = $1 where name = 'Shovel A'`, [shovelGal]);
r = (await q(db, `select public.snow_dispatch_storm($1) as r`, [storm]))[0].r;
check('33 with every route led by someone who can work its service, dispatch works', r.changed === true && r.storm.status === 'dispatched' && r.summary.routes === 2, JSON.stringify(r));
r = (await q(db, `select public.snow_dispatch_storm($1) as r`, [storm]))[0].r;
check('34 dispatching twice changes nothing', r.changed === false);
f = await fails(db, `select public.snow_dispatch_storm($1)`, [oneCall.id], 'at least one route with stops');
check('35 a storm with no stops at all still cannot be dispatched', f.raised && f.match, f.msg);

// ── Route cancel, end, reopen ───────────────────────────────────────────────
await db.query(`update public.snow_routes set cancelled_at = now() where name = 'Shovel A'`);
r = (await q(db, `select public._snow_storm_summary($1) as s`, [storm]))[0].s;
check('36 a cancelled route stops counting as remaining work, the other service\'s route still counts', r.routes === 1 && r.visits === 3 && r.pending === 3, JSON.stringify(r));
f = await fails(db, `select public.snow_set_storm_services($1, array['plowing'])`, [storm], "Can't remove shoveling");
check('36b a CANCELLED route still blocks removing its service (Shovel A was cancelled above)', f.raised && f.match && f.msg.includes('cancelled'), f.msg);
r = (await q(db, `select public.snow_end_storm($1) as r`, [storm]))[0].r;
check('37 a multi-service storm ends like any other', r.storm.status === 'ended');
f = await fails(db, `insert into public.snow_routes (storm_id, service, name) values ($1, 'plowing', 'Late')`, [storm], 'has ended');
check('38 no route can be added to an ended storm', f.raised && f.match, f.msg);
r = (await q(db, `select public.snow_reopen_storm($1) as r`, [storm]))[0].r;
check('39 reopening works and keeps its services', r.storm.status === 'dispatched' && r.storm.services.join() === 'plowing,shoveling' && r.storm.reopened_count === 1);
const keep = await q(db, `select count(*)::int n from public.snow_visits where storm_id = $1`, [storm]);
check('40 ending and reopening deleted nothing (all 5 visits are still there)', keep[0].n === 5, JSON.stringify(keep));

// ── Templates ───────────────────────────────────────────────────────────────
const tpl = async (name, service, props) => {
  const id = (await q(db, `insert into public.snow_route_templates (company_id, name, service, lead_person_id) values ($1, $2, $3, $4) returning id`, [co, name, service, service === 'shoveling' ? shovelGal : plowGuy]))[0].id;
  let i = 1;
  for (const p of props) await db.query(`insert into public.snow_route_template_stops (template_id, company_id, property_id, position) values ($1, $2, $3, $4)`, [id, co, p, i++]);
  return id;
};
const tShovel = await tpl('Shovel Template', 'shoveling', [pShovel, pBoth, pPlow]);
const tSalt = await tpl('Salt Template', 'salting', [pBoth]);
const newStorm = (await q(db, `select public.snow_create_storm('Template Storm', array['plowing','shoveling']) as r`))[0].r.storm.id;
const newRoute = (await q(db, `select public.snow_apply_route_template($1, $2, 'From template') as id`, [newStorm, tShovel]))[0].id;
const made = (await q(db, `select service, lead_person_id from public.snow_routes where id = $1`, [newRoute]))[0];
const madeStops = await q(db, `select p.name, v.service from public.snow_visits v join public.snow_properties p on p.id = v.property_id where v.route_id = $1 order by v.position`, [newRoute]);
check('41 a shoveling template makes a shoveling route on a plowing+shoveling storm', made.service === 'shoveling' && made.lead_person_id === shovelGal);
check('42 template stops only include properties that offer that service', madeStops.map((s) => s.name).join() === 'Shovel Walk,Both Place' && madeStops.every((s) => s.service === 'shoveling'), JSON.stringify(madeStops));
f = await fails(db, `select public.snow_apply_route_template($1, $2)`, [newStorm, tSalt], "which this storm doesn't include");
check('43 a template for a service the storm lacks is refused', f.raised && f.match, f.msg);

// ── Old behaviour preserved ─────────────────────────────────────────────────
const still = (await q(db, `select status, services from public.snow_storms where id = $1`, [legacy]))[0];
check('44 the old ended storm is still intact after everything above', still.status === 'ended' && still.services.join() === 'plowing');
await db.query(`insert into public.snow_routes (storm_id, name, lead_person_id) values ($1, 'Reopened Old Route', $2)`, [oneCall.id, plowGuy]).catch(() => {});
check('45 a plain two-column route insert (how older app builds add routes) still works on a single-service storm', (await q(db, `select count(*)::int n from public.snow_routes where storm_id = $1`, [oneCall.id]))[0].n >= 1);

// ── Activity entries (update 40, section 8) ─────────────────────────────────
const events = (stormId, extra = '') => q(db, `select action, entity_type, service, note, before, after from public.snow_activity_events where storm_id = $1 ${extra} order by occurred_at, id`, [stormId]);
const stormEv = async (stormId) => (await events(stormId, "and entity_type = 'storm'"));

const legacyEv = await stormEv(legacy);
check('46 entries written BEFORE update 40 are not rewritten (the old storm still says plowing)',
  legacyEv.length >= 3 && legacyEv.every((e) => e.service === 'plowing' && e.note === null), JSON.stringify(legacyEv.map((e) => [e.action, e.service, e.note])));

const bigEv = await stormEv(storm);
check('47 a multi-service storm\'s "created" entry has no service and lists them all',
  bigEv[0].action === 'storm.created' && bigEv[0].service === null && bigEv[0].note === 'Services: plowing, shoveling', JSON.stringify(bigEv[0]));
const lifecycle = bigEv.filter((e) => ['storm.dispatched', 'storm.ended', 'storm.reopened'].includes(e.action));
check('48 its dispatched, ended and reopened entries are labelled the same way (none says one service)',
  lifecycle.map((e) => e.action).join() === 'storm.dispatched,storm.ended,storm.reopened' && lifecycle.every((e) => e.service === null && /^Services: /.test(e.note)), JSON.stringify(lifecycle.map((e) => [e.action, e.service, e.note])));

const edits = bigEv.filter((e) => e.action === 'storm.updated' && e.after && e.after.services);
const addSalting = edits.find((e) => (e.after.services || []).includes('salting'));
check('49 editing the services records the before and after lists and the note shows the current list',
  !!addSalting && addSalting.before.services.join() === 'plowing,shoveling' && addSalting.after.services.join() === 'plowing,shoveling,salting' && addSalting.service === null && addSalting.note === 'Services: plowing, shoveling, salting',
  JSON.stringify(addSalting));
const removeSalting = edits.find((e) => !(e.after.services || []).includes('salting'));
check('50 removing a service is recorded the same way, with the shorter current list', !!removeSalting && removeSalting.note === 'Services: plowing, shoveling', JSON.stringify(removeSalting));

const singleEv = await stormEv(oneCall.id);
check('51 a single-service storm is logged exactly as before (service kept, no note)', singleEv.length >= 1 && singleEv.every((e) => e.service === 'salting' && e.note === null), JSON.stringify(singleEv.map((e) => [e.action, e.service, e.note])));

const direct = async (type, svc, note, id) => (await q(db, `select public.snow_log_event($1, 'x.tested', $2, $3, $4, null, null, null, null, $5, null, null, $6) as id`, [co, type, id, id, svc, note]));
const idOf = (await direct('route', 'shoveling', 'A route note', storm))[0].id;
const route = (await q(db, `select service, note from public.snow_activity_events where id = $1`, [idOf]))[0];
check('52 entries about routes (or anything that is not a storm) are unchanged, even in a multi-service storm', route.service === 'shoveling' && route.note === 'A route note', JSON.stringify(route));
const idVisit = (await direct('visit', 'plowing', null, storm))[0].id;
check('53 visit entries keep their own service and get no note', (await q(db, `select service, note from public.snow_activity_events where id = $1`, [idVisit]))[0].service === 'plowing');
const idCustom = (await direct('storm', 'plowing', 'Custom note', storm))[0].id;
const custom = (await q(db, `select service, note from public.snow_activity_events where id = $1`, [idCustom]))[0];
check('54 a note someone wrote is kept (the services note only fills an empty one)', custom.service === null && custom.note === 'Custom note', JSON.stringify(custom));

const draftMulti = (await q(db, `select public.snow_create_storm('Draft to delete', array['shoveling','salting']) as r`))[0].r.storm.id;
await db.query(`delete from public.snow_storms where id = $1`, [draftMulti]);
const deleted = (await stormEv(draftMulti)).find((e) => e.action === 'storm.deleted');
check('55 deleting a multi-service draft is logged with all its services too (read from the deleted row)', !!deleted && deleted.service === null && deleted.note === 'Services: shoveling, salting', JSON.stringify(deleted));

const bad = results.filter((x) => !x).length;
console.log(`\n${results.length - bad} passed, ${bad} failed (${results.length} checks)`);
process.exit(bad ? 1 : 0);
