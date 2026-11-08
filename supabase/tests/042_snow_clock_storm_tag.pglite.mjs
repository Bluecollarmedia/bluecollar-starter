// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && copy this file there && node <file> <path to the repo>
// Logic tests for update 42 (clock-ins tagged with the storm) on an in-process Postgres (PGlite).
// REAL SQL from the repo: the shifts table and the clock in/out functions (028), snow_is_active /
// snow_has_service / snow_person_has_service (020), the storm and route tables (020b), the whole
// storm lifecycle (024), update 40 (multi-service storms), update 41 (crew) and update 42.
// Small stand-ins: people/companies/members, snow staff, route visits, my_person_id / is_staff.
// NOT the full production schema: row-level security on shifts and the owner's correction screen are
// not exercised here.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const repo = process.argv[2];
const read = (p) => fs.readFileSync(`${repo}/${p}`, 'utf8');
const grabTable = (text, marker) => { const a = text.indexOf(marker); const b = text.indexOf('\n);', a); return text.slice(a, b + 3); };
const grabFn = (text, marker) => { const a = text.indexOf(marker); const b = text.indexOf('\n$$;', a); return text.slice(a, b + 4); };
const stripFk = (t) => t.replace(/references public\.[a-z_]+\([a-z_]+\)( on delete [a-z ]+)?/g, '');

const f020 = read('supabase/updates/020_snow_access.sql');
const f020b = read('supabase/updates/020b_snow_foundation.sql');
const f024 = read('supabase/updates/024_snow_storm_lifecycle.sql');
const f028 = read('supabase/updates/028_snow_shifts.sql');
const f029 = read('supabase/updates/029_snow_activity_log.sql');
const f040 = read('supabase/updates/040_snow_multi_service_storms.sql');
const f041 = read('supabase/updates/041_snow_route_crew.sql');
const f042 = read('supabase/updates/042_snow_clock_storm_tag.sql');

const standIn = `
create role anon; create role authenticated;
create publication supabase_realtime;
create table public.companies (id uuid primary key default gen_random_uuid());
create table public.people (id uuid primary key default gen_random_uuid(), first_name text, last_name text);
create table public.company_members (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), person_id uuid not null references public.people(id), role text not null, status text not null default 'active', created_at timestamptz default now());
create function public.my_person_id() returns uuid language sql stable as $$ select nullif(current_setting('test.pid', true), '')::uuid $$;
create function public.is_staff(cid uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.company_members m where m.company_id = cid and m.person_id = public.my_person_id() and m.role in ('owner','admin') and m.status = 'active') $$;
create table public.snow_staff (company_id uuid, person_id uuid, status text not null default 'active', created_at timestamptz default now());
create table public.snow_staff_services (company_id uuid, person_id uuid, service text);
create table public.snow_skip_requests (storm_id uuid, status text);
create table public.snow_properties (id uuid primary key default gen_random_uuid(), company_id uuid, name text, address text default '', city text, state text, zip text, latitude numeric, longitude numeric, map_destination text, status text default 'active');
create table public.snow_property_services (id uuid primary key default gen_random_uuid(), company_id uuid, property_id uuid, service text, is_active boolean default true);
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
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + String(detail).slice(0, 240)}`); };
const q = async (db, sql, p) => (await db.query(sql, p)).rows;
const fails = async (db, sql, p, includes) => {
  try { await db.query(sql, p); return { raised: false, msg: '' }; }
  catch (e) { const msg = String(e.message); return { raised: true, msg, match: includes ? msg.includes(includes) : true }; }
};

const db = new PGlite();
await db.exec(standIn);
await db.exec(grabTable(f020b, 'create table if not exists public.snow_storms'));
await db.exec(grabTable(f020b, 'create table if not exists public.snow_routes'));
await db.exec(grabFn(f020b, 'create or replace function public.snow_route_fill') +
  "\ncreate trigger snow_routes_fill before insert or update on public.snow_routes for each row execute function public.snow_route_fill();");
await db.exec(visits);
await db.exec(f024);
await db.exec(grabFn(f020, 'create or replace function public.snow_is_active'));
await db.exec(grabFn(f020, 'create or replace function public.snow_has_service') + '\n' + grabFn(f020, 'create or replace function public.snow_person_has_service'));
// lead helper (the latest definition lives in 027) so the crew update's policies can be created
await db.exec(grabFn(read('supabase/updates/027_snow_skip_requests.sql'), 'create or replace function public.snow_is_route_lead'));
// The REAL shifts table and clock functions (update 28), and the Activity log pieces they use.
await db.exec(grabTable(f028, 'create table if not exists public.snow_shifts'));
await db.exec(grabFn(f028, 'create or replace function public._snow_my_company'));
await db.exec(grabFn(f028, 'create or replace function public.snow_clock_in'));
await db.exec(grabFn(f028, 'create or replace function public.snow_clock_out'));
await db.exec(stripFk(grabTable(f020b, 'create table if not exists public.snow_activity_events')));
await db.exec(grabFn(f020b, 'create or replace function public.snow_log_event'));
// For update 41's policies and crew table
await db.exec(`alter table public.snow_storms enable row level security; alter table public.snow_routes enable row level security; alter table public.snow_visits enable row level security;`);
await db.exec(grabFn(f029, 'create or replace function public.snow_audit_row'));
await db.exec(grabFn(f029, 'create or replace function public.snow_attach_audit'));
await db.exec(f040);
await db.exec(f041);

const co = (await q(db, `insert into public.companies default values returning id`))[0].id;
const person = async (name, role, services) => {
  const id = (await q(db, `insert into public.people (first_name, last_name) values ($1, 'T') returning id`, [name]))[0].id;
  if (role) await db.query(`insert into public.company_members (company_id, person_id, role) values ($1, $2, $3)`, [co, id, role]);
  else await db.query(`insert into public.snow_staff (company_id, person_id) values ($1, $2)`, [co, id]);
  for (const s of services ?? []) await db.query(`insert into public.snow_staff_services (company_id, person_id, service) values ($1, $2, $3)`, [co, id, s]);
  return id;
};
const owner = await person('Olive', 'owner');
const lead = await person('Lena', null, ['plowing']);
const crew = await person('Cora', null, ['plowing']);
const busy = await person('Bea', null, ['plowing', 'shoveling']);
const nobody = await person('Nic', null, ['plowing']);
const loses = await person('Lou', null, ['plowing']);
const as = (pid) => db.query(`select set_config('test.pid', $1, false)`, [pid ?? '']);
await as(owner);

const mkStorm = async (name, svcs) => (await q(db, `select (public.snow_create_storm($1, $2::text[])->'storm'->>'id') as id`, [name, svcs]))[0].id;
const mkRoute = async (storm, svc, name, leadId) => {
  await db.query(`insert into public.snow_routes (storm_id, service, name, lead_person_id) values ($1, $2, $3, $4)`, [storm, svc, name, leadId]);
  const id = (await q(db, `select id from public.snow_routes where name = $1`, [name]))[0].id;
  await db.query(`insert into public.snow_visits (route_id, property_id) values ($1, null)`, [id]);
  return id;
};
const clockIn = async (pid, rid) => { await as(pid); return (await q(db, `select * from public.snow_clock_in($1)`, [rid ?? null]))[0]; };
const clockOut = async (pid) => { await as(pid); return (await q(db, `select * from public.snow_clock_out()`))[0]; };

// ── Before update 42: how clocking works today ──────────────────────────────
const old1 = await clockIn(nobody);
check('1 before update 42 clocking in works (the existing function)', !!old1.id && old1.clock_out_at === null && !('storm_id' in old1));
await clockOut(nobody);

// ── Apply update 42 (twice) ─────────────────────────────────────────────────
await db.exec(f042);
await db.exec(f042);
check('2 update 42 runs twice without error', true);
const oldRow = (await q(db, `select storm_id from public.snow_shifts where id = $1`, [old1.id]))[0];
check('3 shifts that already existed stay untagged', oldRow.storm_id === null);

// ── Zero routes ─────────────────────────────────────────────────────────────
let s = await clockIn(nobody);
check('4 zero active routes: the clock-in works and is untagged', !!s.id && s.storm_id === null);
await clockOut(nobody);

// ── Exactly one route ───────────────────────────────────────────────────────
await as(owner);
const storm1 = await mkStorm('Storm One', ['plowing', 'shoveling']);
const R1 = await mkRoute(storm1, 'plowing', 'Plow One', lead);
await db.query(`select public.snow_set_route_crew($1, array[$2]::uuid[])`, [R1, crew]);
check('5 a route on a draft storm does not count (not dispatched yet)', (await clockIn(lead)).storm_id === null);
await clockOut(lead);
await as(owner);
await db.query(`select public.snow_dispatch_storm($1)`, [storm1]);
s = await clockIn(lead);
check('6 exactly one active route as LEAD: the shift is tagged with its storm', s.storm_id === storm1, JSON.stringify(s));
const out = await clockOut(lead);
check('7 clock-out is unchanged and keeps the tag', out.clock_out_at !== null && out.storm_id === storm1);
s = await clockIn(crew);
check('8 exactly one active route as CREW: tagged too', s.storm_id === storm1);
await clockOut(crew);

// ── Several routes ──────────────────────────────────────────────────────────
await as(owner);
const R2 = await mkRoute(storm1, 'shoveling', 'Shovel One', busy);
await db.query(`select public.snow_set_route_crew($1, array[$2]::uuid[])`, [R1, busy]);
s = await clockIn(busy);
check('9 two active routes (lead on one, crew on another, even in the same storm): untagged, and the clock-in is NOT blocked', !!s.id && s.storm_id === null, JSON.stringify(s));
await clockOut(busy);
await as(owner);
const storm2 = await mkStorm('Storm Two', ['plowing']);
const R3 = await mkRoute(storm2, 'plowing', 'Plow Two', lead);
await db.query(`select public.snow_dispatch_storm($1)`, [storm2]);
s = await clockIn(lead);
check('10 a worker leading routes on two storms: untagged, not blocked', !!s.id && s.storm_id === null);
await clockOut(lead);

// ── What does not count ─────────────────────────────────────────────────────
await as(owner);
await db.query(`update public.snow_routes set cancelled_at = now() where id = $1`, [R3]);
s = await clockIn(lead);
check('11 a cancelled route does not count: back to exactly one route, tagged', s.storm_id === storm1);
await clockOut(lead);
await as(owner);
await db.query(`select public.snow_end_storm($1)`, [storm2]);
await db.query(`select public.snow_end_storm($1)`, [storm1]);
s = await clockIn(lead);
check('12 an ENDED storm does not count', s.storm_id === null);
await clockOut(lead);
await as(owner);
await db.query(`select public.snow_reopen_storm($1)`, [storm1]);
await db.query(`insert into public.snow_staff_services (company_id, person_id, service) values ($1, $2, 'plowing')`, [co, loses]);
await db.query(`select public.snow_set_route_crew($1, array[$2]::uuid[])`, [R1, loses]);
check('13 a reopened storm counts again', (await clockIn(lead)).storm_id === storm1);
await clockOut(lead);
await db.query(`delete from public.snow_staff_services where person_id = $1`, [loses]);
s = await clockIn(loses);
check('14 a crew member who no longer holds the route\'s service gets no tag (and can still clock in if they have snow access)', !!s.id && s.storm_id === null);
await clockOut(loses);

// ── Safety ──────────────────────────────────────────────────────────────────
s = await clockIn(lead, '11111111-1111-1111-1111-111111111111');
const again = await clockIn(lead, '11111111-1111-1111-1111-111111111111');
check('15 a double tap (same request id) returns the same shift and the tag is not redone', again.id === s.id && again.storm_id === s.storm_id);
const third = await clockIn(lead);
check('16 clocking in while already clocked in returns the open shift unchanged (one open shift per person)', third.id === s.id && (await q(db, `select count(*)::int n from public.snow_shifts where person_id = $1 and clock_out_at is null`, [lead]))[0].n === 1);
await clockOut(lead);

await as(owner);
const storm3 = await mkStorm('Storm Three', ['plowing']);
const R4 = await mkRoute(storm3, 'plowing', 'Plow Three', nobody);
await db.query(`select public.snow_dispatch_storm($1)`, [storm3]);
check('17 before breaking anything: the tag works for this worker', (await clockIn(nobody)).storm_id === storm3);
await clockOut(nobody);
// Simulate a failure while working out the tag: the crew table is gone.
await db.exec(`alter table public.snow_route_crew rename to snow_route_crew_gone`);
s = await clockIn(nobody);
check('18 if working out the tag fails for any reason, clocking in STILL works (untagged)', !!s.id && s.storm_id === null, JSON.stringify(s));
await clockOut(nobody);
await db.exec(`alter table public.snow_route_crew_gone rename to snow_route_crew`);

// ── Rules untouched / log ───────────────────────────────────────────────────
await as(owner);
const ev = await q(db, `select action, storm_id, person_id, after from public.snow_activity_events where action = 'shift.clocked_in' order by occurred_at, id`);
check('19 the clock-in entries in the Activity log name the storm when tagged (and have none when not)', ev.some((e) => e.storm_id === storm1) && ev.some((e) => e.storm_id === null), JSON.stringify(ev.slice(0, 3)));
const outsider = await person('Zed', null, []);
await as(outsider);
await db.query(`delete from public.snow_staff where person_id = $1`, [outsider]);
const f = await fails(db, `select * from public.snow_clock_in()`, [], 'snow team access');
check('20 someone with no snow access still cannot clock in (the access rule is unchanged)', f.raised && f.match, f.msg);
await as(owner);
check('21 owners can clock in and are tagged by the same rule (one route they lead)', (await (async () => { const st = await mkStorm('Owner Storm', ['plowing']); await mkRoute(st, 'plowing', 'Owner Route', owner); await db.query(`select public.snow_dispatch_storm($1)`, [st]); const r = await clockIn(owner); await clockOut(owner); return r.storm_id === st; })()));

const bad = results.filter((x) => !x).length;
console.log(`\n${results.length - bad} passed, ${bad} failed (${results.length} checks)`);
process.exit(bad ? 1 : 0);
