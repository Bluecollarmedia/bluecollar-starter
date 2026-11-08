// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && copy this file there && node <file> <path to the repo>
// Logic AND row-level-security tests for update 41 (crew members on a Snow route) on an in-process
// Postgres (PGlite). The tests really switch to the "authenticated" role so the row-level rules apply.
// REAL SQL from the repo: the storm/route tables (020b), the whole storm lifecycle (024), the lead
// helpers and lead read policies (026/027), the property-instructions rule (022), snow_has_service /
// snow_person_has_service (020), the Activity log helpers (020b/029), updates 40 and 41.
// Small stand-ins: people/companies/members, snow staff tables, property services, route visits (same
// composite link to the route as production), and my_person_id / is_staff. NOT the full production
// schema: storage (photo) rules, the lead's arrive/finish functions and customer rules are not run here.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const repo = process.argv[2];
const read = (p) => fs.readFileSync(`${repo}/${p}`, 'utf8');
const grabTable = (text, marker) => { const a = text.indexOf(marker); const b = text.indexOf('\n);', a); return text.slice(a, b + 3); };
const grabFn = (text, marker) => { const a = text.indexOf(marker); const b = text.indexOf('\n$$;', a); return text.slice(a, b + 4); };

const f020 = read('supabase/updates/020_snow_access.sql');
const f020b = read('supabase/updates/020b_snow_foundation.sql');
const f022 = read('supabase/updates/022_snow_property_details.sql');
const f024 = read('supabase/updates/024_snow_storm_lifecycle.sql');
const f026 = read('supabase/updates/026_snow_lead_execution.sql');
const f027 = read('supabase/updates/027_snow_skip_requests.sql');
const f029 = read('supabase/updates/029_snow_activity_log.sql');
const f040 = read('supabase/updates/040_snow_multi_service_storms.sql');
const f041 = read('supabase/updates/041_snow_route_crew.sql');

const stripFk = (t) => t.replace(/references public\.[a-z_]+\([a-z_]+\)( on delete [a-z ]+)?/g, '');
const stormsTable = grabTable(f020b, 'create table if not exists public.snow_storms');
const routesTable = grabTable(f020b, 'create table if not exists public.snow_routes');
const oldRouteFill = grabFn(f020b, 'create or replace function public.snow_route_fill') +
  "\ncreate trigger snow_routes_fill before insert or update on public.snow_routes for each row execute function public.snow_route_fill();";
const leadHelpers = ['snow_leads_in_storm', 'snow_leads_dispatched_route'].map((n) => grabFn(f026, `create or replace function public.${n}`)).join('\n');
const leadFn027 = grabFn(f027, 'create or replace function public.snow_is_route_lead'); // the latest definition
const leadPolicies = f026.slice(f026.indexOf('drop policy if exists snow_storms_lead_select'), f026.indexOf('drop policy if exists snow_completion_media_lead_select'));
const hasService = grabFn(f020, 'create or replace function public.snow_has_service') + '\n' + grabFn(f020, 'create or replace function public.snow_person_has_service');
const canSeeOld = grabFn(f022, 'create or replace function public.snow_can_see_property_service');
const visitForLead = grabFn(f026, 'create or replace function public._snow_visit_for_lead');

const standIn = `
create role anon; create role authenticated;
create publication supabase_realtime;
create table public.companies (id uuid primary key default gen_random_uuid());
create table public.people (id uuid primary key default gen_random_uuid(), first_name text, last_name text);
create table public.company_members (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), person_id uuid not null references public.people(id), role text not null, status text not null default 'active', created_at timestamptz default now());
create function public.my_person_id() returns uuid language sql stable as $$ select nullif(current_setting('test.pid', true), '')::uuid $$;
create function public.is_staff(cid uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.company_members m where m.company_id = cid and m.person_id = public.my_person_id() and m.role in ('owner','admin') and m.status = 'active') $$;
create table public.snow_staff (company_id uuid, person_id uuid, status text not null default 'active');
create table public.snow_staff_services (company_id uuid, person_id uuid, service text);
create table public.snow_properties (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), name text not null,
  address text default '', city text, state text, zip text, latitude numeric, longitude numeric, map_destination text, status text not null default 'active');
create table public.snow_property_services (id uuid primary key default gen_random_uuid(), company_id uuid, property_id uuid not null references public.snow_properties(id), service text not null, is_active boolean not null default true);
create table public.snow_skip_requests (storm_id uuid, status text);
`;

const visits = `
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
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + String(detail).slice(0, 220)}`); };
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
await db.exec(visits);
await db.exec(f024);
await db.exec(hasService);
await db.exec(leadFn027);
await db.exec(leadHelpers);
await db.exec(canSeeOld);
await db.exec(visitForLead);
// Activity log pieces (real, as before update 41)
await db.exec(stripFk(grabTable(f020b, 'create table if not exists public.snow_activity_events')));
await db.exec(grabFn(f020b, 'create or replace function public.snow_log_event'));
await db.exec(grabFn(f029, 'create or replace function public.snow_audit_row'));
await db.exec(grabFn(f029, 'create or replace function public.snow_attach_audit'));
await db.exec("select public.snow_attach_audit('public.snow_routes', 'route'); select public.snow_attach_audit('public.snow_storms', 'storm');");
await db.exec(f040);

// Row-level security on the three tables, with the REAL lead read rules plus an owner rule.
await db.exec(`
alter table public.snow_storms enable row level security;
alter table public.snow_routes enable row level security;
alter table public.snow_visits enable row level security;
create policy staff_all_storms on public.snow_storms for select using (public.is_staff(company_id));
create policy staff_all_routes on public.snow_routes for select using (public.is_staff(company_id));
create policy staff_all_visits on public.snow_visits for select using (public.is_staff(company_id));
${leadPolicies}
grant usage on schema public to authenticated;
grant select on public.snow_storms, public.snow_routes, public.snow_visits, public.snow_property_services, public.people to authenticated;
grant execute on all functions in schema public to authenticated;
`);

const co = (await q(db, `insert into public.companies default values returning id`))[0].id;
const person = async (name, role, services = []) => {
  const id = (await q(db, `insert into public.people (first_name, last_name) values ($1, 'T') returning id`, [name]))[0].id;
  if (role) await db.query(`insert into public.company_members (company_id, person_id, role) values ($1, $2, $3)`, [co, id, role]);
  if (!role) await db.query(`insert into public.snow_staff (company_id, person_id) values ($1, $2)`, [co, id]);
  for (const s of services) await db.query(`insert into public.snow_staff_services (company_id, person_id, service) values ($1, $2, $3)`, [co, id, s]);
  return id;
};
const owner = await person('Olive', 'owner');
const lead = await person('Lena', null, ['plowing']);
const crewA = await person('Amy', null, ['plowing']);
const crewB = await person('Bo', null, ['shoveling']);        // snow team, but NOT plowing
const stranger = await person('Sam', null, ['plowing']);      // plowing, not on the route
const outsider = await person('Otto', null, []);
const lead2 = await person('Lou', null, ['shoveling']);
const as = (pid) => db.query(`select set_config('test.pid', $1, false)`, [pid ?? '']);
const prop = async (name, svc) => {
  const id = (await q(db, `insert into public.snow_properties (company_id, name) values ($1, $2) returning id`, [co, name]))[0].id;
  await db.query(`insert into public.snow_property_services (company_id, property_id, service) values ($1, $2, $3)`, [co, id, svc]);
  return id;
};
const pA = await prop('Plow Lot A', 'plowing');
const pB = await prop('Plow Lot B', 'plowing');
const pS = await prop('Shovel Walk', 'shoveling');

await as(owner);
const stormId = (await q(db, `select (public.snow_create_storm('Big Storm', array['plowing','shoveling'])->'storm'->>'id') as id`))[0].id;
await db.query(`insert into public.snow_routes (storm_id, service, name, lead_person_id) values ($1, 'plowing', 'Plow 1', $2), ($1, 'shoveling', 'Shovel 1', $3)`, [stormId, lead, lead2]);
const R1 = (await q(db, `select id from public.snow_routes where name = 'Plow 1'`))[0].id;
const R2 = (await q(db, `select id from public.snow_routes where name = 'Shovel 1'`))[0].id;
await db.query(`insert into public.snow_visits (route_id, property_id) values ($1, $2), ($1, $3), ($4, $5)`, [R1, pA, pB, R2, pS]);
const psOf = async (pid) => (await q(db, `select id from public.snow_property_services where property_id = $1`, [pid]))[0].id;
const psA = await psOf(pA), psS = await psOf(pS);

// ── Before update 41 ────────────────────────────────────────────────────────
await db.query(`select public.snow_dispatch_storm($1)`, [stormId]); // lead rules before 41
const asRole = async (pid, fn) => { await as(pid); await db.exec('set role authenticated'); try { return await fn(); } finally { await db.exec('reset role'); } };
const see = (pid, table, col, val) => asRole(pid, async () => (await q(db, `select count(*)::int n from public.${table} where ${col} = $1`, [val]))[0].n);
check('1 before update 41: the lead sees their route and stops (the rule that exists today)', (await see(lead, 'snow_routes', 'id', R1)) === 1 && (await see(lead, 'snow_visits', 'route_id', R1)) === 2);
await as(owner);

// ── Apply update 41 (twice) ─────────────────────────────────────────────────
await db.exec(f041);
await db.exec(f041);
check('2 update 41 runs twice without error', true);
const setCrew = (pid, route, ids) => asRole(pid, async () => (await q(db, `select public.snow_set_route_crew($1, $2::uuid[]) as r`, [route, ids]))[0].r);
const crewOf = async (route) => (await q(db, `select person_id from public.snow_route_crew where route_id = $1 order by created_at, person_id`, [route])).map((r) => r.person_id);

check('3 nothing changes for existing routes: nobody is crew yet and the lead still sees the route', (await q(db, `select count(*)::int n from public.snow_route_crew`))[0].n === 0 && (await see(lead, 'snow_routes', 'id', R1)) === 1);
check('4 a crew member cannot see an already-dispatched route until the owner adds them (stranger sees nothing)', (await see(crewA, 'snow_routes', 'id', R1)) === 0 && (await see(stranger, 'snow_visits', 'route_id', R1)) === 0);

// ── Owner sets the crew ─────────────────────────────────────────────────────
let r = await setCrew(owner, R1, [crewA]);
check('5 the owner adds a crew member', r.changed === true && r.crew.length === 1 && r.crew[0] === crewA, JSON.stringify(r));
r = await setCrew(owner, R1, [crewA]);
check('6 saving the same crew again changes nothing (a double tap is safe)', r.changed === false && (await crewOf(R1)).length === 1);
let f = await fails(db, `select public.snow_set_route_crew($1, array[$2]::uuid[])`, [R1, crewB], "isn't on the snow team for plowing");
check('7 a person without the route\'s service cannot be crew (shoveling-only worker on a plowing route)', f.raised && f.match, f.msg);
f = await fails(db, `select public.snow_set_route_crew($1, array[$2]::uuid[])`, [R1, lead], 'already leads');
check('8 the lead cannot also be crew', f.raised && f.match, f.msg);
f = await fails(db, `select public.snow_set_route_crew($1, array[$2]::uuid[])`, [R1, '99999999-9999-9999-9999-999999999999'], 'Person not found');
check('9 an unknown person is refused', f.raised && f.match, f.msg);
await as(lead);
f = await fails(db, `select public.snow_set_route_crew($1, array[$2]::uuid[])`, [R1, stranger], 'Route not found');
check('10 the lead cannot change their own crew (owner/admin only)', f.raised && f.match, f.msg);
await as(crewA);
f = await fails(db, `select public.snow_set_route_crew($1, array[$2]::uuid[])`, [R1, stranger], 'Route not found');
check('11 a crew member cannot add anyone, including themselves', f.raised && f.match, f.msg);
await as(owner);
r = await setCrew(owner, R1, [crewA, stranger, crewA, stranger]);
check('12 repeats in the list collapse to one each', r.crew.length === 2 && (await crewOf(R1)).length === 2);
r = await setCrew(owner, R1, [stranger]);
check('13 the list is the new crew: Amy was removed', r.changed === true && (await crewOf(R1)).join() === stranger);
r = await setCrew(owner, R1, [crewA, stranger]);

// direct writes
await as(crewA);
f = await fails(db, `insert into public.snow_route_crew (route_id, person_id) values ($1, $2)`, [R1, crewA]);
await db.exec('reset role');
let direct = await asRole(crewA, async () => { try { await db.query(`insert into public.snow_route_crew (route_id, person_id) values ($1, $2)`, [R2, crewA]); return 'inserted'; } catch (e) { return String(e.message); } });
check('14 nobody can write the crew table directly (no self-adding)', /permission denied/i.test(direct), direct);
await as(owner);
f = await fails(db, `update public.snow_route_crew set person_id = $1 where route_id = $2`, [outsider, R1], "can't be edited");
check('15 a crew assignment cannot be edited, only removed and re-added', f.raised && f.match, f.msg);

// ── What crew can see (after dispatch) ──────────────────────────────────────
const storms = (pid) => asRole(pid, async () => (await q(db, `select count(*)::int n from public.snow_storms where id = $1`, [stormId]))[0].n);
check('16 crew see the storm, their route and its stops', (await storms(crewA)) === 1 && (await see(crewA, 'snow_routes', 'id', R1)) === 1 && (await see(crewA, 'snow_visits', 'route_id', R1)) === 2);
check('17 crew do NOT see other routes in the same storm, or their stops', (await see(crewA, 'snow_routes', 'id', R2)) === 0 && (await see(crewA, 'snow_visits', 'route_id', R2)) === 0);
check('18 a worker who is not on the crew sees nothing of the route (authorization)', (await see(outsider, 'snow_routes', 'id', R1)) === 0 && (await storms(outsider)) === 0);
check('19 the lead of another route still sees only their own (unchanged)', (await see(lead2, 'snow_routes', 'id', R2)) === 1 && (await see(lead2, 'snow_routes', 'id', R1)) === 0);
check('20 the lead still sees the route and stops exactly as before', (await see(lead, 'snow_routes', 'id', R1)) === 1 && (await see(lead, 'snow_visits', 'route_id', R1)) === 2);
check('21 the owner sees everything', (await see(owner, 'snow_routes', 'id', R1)) === 1 && (await see(owner, 'snow_routes', 'id', R2)) === 1);

// ── Crew can view only; the lead's actions stay lead-only ───────────────────
const fn1 = (pid, sql, params) => asRole(pid, async () => (await q(db, sql, params))[0].v);
check('22 the "is the lead" check is false for crew (every arrive/finish/photo/skip rule uses it)', (await fn1(crewA, `select public.snow_is_route_lead($1) as v`, [R1])) === false && (await fn1(crewA, `select public.snow_leads_dispatched_route($1) as v`, [R1])) === false);
check('23 ...and still true for the lead', (await fn1(lead, `select public.snow_is_route_lead($1) as v`, [R1])) === true && (await fn1(lead, `select public.snow_leads_dispatched_route($1) as v`, [R1])) === true);
check('24 the crew check is true for crew and false for the lead and outsiders', (await fn1(crewA, `select public.snow_is_route_crew($1) as v`, [R1])) === true && (await fn1(lead, `select public.snow_is_route_crew($1) as v`, [R1])) === false && (await fn1(outsider, `select public.snow_is_route_crew($1) as v`, [R1])) === false);
const visit1 = (await q(db, `select id from public.snow_visits where route_id = $1 order by position limit 1`, [R1]))[0].id;
await as(crewA); await db.exec('set role authenticated');
f = await fails(db, `select public._snow_visit_for_lead($1)`, [visit1]);
await db.exec('reset role');
check('25 the REAL lead-only gate for arrive/finish refuses a crew member', f.raised, f.msg);
await as(lead); await db.exec('set role authenticated');
f = await fails(db, `select public._snow_visit_for_lead($1)`, [visit1]);
await db.exec('reset role');
check('26 ...and still lets the lead through', !f.raised, f.msg);
const upd = await asRole(crewA, async () => { try { const x = await db.query(`update public.snow_visits set status = 'completed' where id = $1`, [visit1]); return x.affectedRows ?? 0; } catch (e) { return 'denied'; } });
check('27 a crew member cannot change a visit directly (no update access)', upd === 0 || upd === 'denied', String(upd));
await as(owner);
check('28 the visit is untouched after that attempt', (await q(db, `select status from public.snow_visits where id = $1`, [visit1]))[0].status === 'pending');

// ── Instructions ─────────────────────────────────────────────────────────────
const canSee = (pid, ps) => asRole(pid, async () => (await q(db, `select public.snow_can_see_property_service($1) as v`, [ps]))[0].v);
check('29 crew can see the instructions for a stop on their route', (await canSee(crewA, psA)) === true);
check('30 crew cannot see instructions for another route\'s property', (await canSee(crewA, psS)) === false);
check('31 the lead and the owner still can; an outsider still cannot', (await canSee(lead, psA)) === true && (await canSee(owner, psA)) === true && (await canSee(outsider, psA)) === false);
check('32 a worker with no snow access at all cannot see instructions for the route either', (await canSee(outsider, psS)) === false);

// ── My routes + role ─────────────────────────────────────────────────────────
const mine = (pid) => asRole(pid, async () => q(db, `select route_id, role from public.snow_my_routes() order by role`));
let m = await mine(crewA);
check('33 snow_my_routes tells a crew member they are crew', m.length === 1 && m[0].route_id === R1 && m[0].role === 'crew', JSON.stringify(m));
m = await mine(lead);
check('34 ...and the lead that they lead (a single-lead route works as before)', m.length === 1 && m[0].role === 'lead', JSON.stringify(m));
check('35 ...and an outsider gets nothing', (await mine(outsider)).length === 0);

// ── Losing access ────────────────────────────────────────────────────────────
await db.query(`delete from public.snow_staff_services where person_id = $1 and service = 'plowing'`, [stranger]);
check('36 a crew member who loses the route\'s snow service loses the route', (await see(stranger, 'snow_routes', 'id', R1)) === 0 && (await mine(stranger)).length === 0);
await db.query(`insert into public.snow_staff_services (company_id, person_id, service) values ($1, $2, 'plowing')`, [co, stranger]);
check('37 ...and gets it back when the service is restored', (await see(stranger, 'snow_routes', 'id', R1)) === 1);

// ── Lead changes ─────────────────────────────────────────────────────────────
await db.query(`update public.snow_routes set lead_person_id = $1 where id = $2`, [crewA, R1]);
check('38 making a crew member the lead removes them from the crew', !(await crewOf(R1)).includes(crewA) && (await crewOf(R1)).includes(stranger));
check('39 and they now see the route as its lead', (await mine(crewA))[0].role === 'lead');
await as(owner);
f = await fails(db, `select public.snow_set_route_crew($1, array[$2]::uuid[])`, [R1, crewA], 'already leads');
check('40 the new lead cannot be re-added as crew', f.raised && f.match, f.msg);
await db.query(`update public.snow_routes set lead_person_id = $1 where id = $2`, [lead, R1]);
await setCrew(owner, R1, [crewA, stranger]);

// ── Activity log ─────────────────────────────────────────────────────────────
const ev = await q(db, `select action, route_id, storm_id, person_id from public.snow_activity_events where entity_type = 'route_crew' order by occurred_at, id`);
check('41 adding and removing crew is in the Activity log with the route, storm and person', ev.some((e) => e.action === 'route_crew.created' && e.route_id === R1 && e.storm_id === stormId && e.person_id === crewA) && ev.some((e) => e.action === 'route_crew.deleted'), JSON.stringify(ev.slice(0, 3)));

// ── Cancel, end, delete ──────────────────────────────────────────────────────
await db.query(`update public.snow_routes set cancelled_at = now() where id = $1`, [R1]);
check('42 a cancelled route disappears from crew (and the lead)', (await see(crewA, 'snow_routes', 'id', R1)) === 0 && (await mine(crewA)).length === 0);
await as(owner);
f = await fails(db, `select public.snow_set_route_crew($1, array[$2]::uuid[])`, [R1, crewA], 'cancelled');
check('43 crew cannot be changed on a cancelled route', f.raised && f.match, f.msg);
check('44 the crew rows are kept as history', (await crewOf(R1)).length === 2);
await as(owner);
await db.query(`select public.snow_end_storm($1)`, [stormId]);
f = await fails(db, `select public.snow_set_route_crew($1, array[$2]::uuid[])`, [R2, crewB], 'ended');
check('45 crew cannot be changed once the storm has ended', f.raised && f.match, f.msg);

await as(owner);
const draftStorm = (await q(db, `select (public.snow_create_storm('Draft', array['plowing'])->'storm'->>'id') as id`))[0].id;
await db.query(`insert into public.snow_routes (storm_id, service, name, lead_person_id) values ($1, 'plowing', 'Draft route', $2)`, [draftStorm, lead]);
const dr = (await q(db, `select id from public.snow_routes where storm_id = $1`, [draftStorm]))[0].id;
await setCrew(owner, dr, [crewA]);
check('46 a draft storm\'s crew is invisible to the crew member (not dispatched yet)', (await see(crewA, 'snow_routes', 'id', dr)) === 0 && (await mine(crewA)).length === 0);
await db.query(`delete from public.snow_storms where id = $1`, [draftStorm]);
check('47 deleting a draft storm removes its crew rows without error', (await q(db, `select count(*)::int n from public.snow_route_crew where route_id = $1`, [dr]))[0].n === 0);

const bad = results.filter((x) => !x).length;
console.log(`\n${results.length - bad} passed, ${bad} failed (${results.length} checks)`);
process.exit(bad ? 1 : 0);
