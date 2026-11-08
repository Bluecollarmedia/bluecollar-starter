// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && copy this file there && node <file> <path to the repo>
// Proves the Snow Settings "Require I'm Here first" switch is REAL: it drives the database's own
// visit status guard (update 020b). Uses the REAL snow_settings, snow_storms and snow_routes tables and the
// REAL guard function; the visits table, completion media and skip requests are small stand-ins.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const repo = process.argv[2];
const f020b = fs.readFileSync(`${repo}/supabase/updates/020b_snow_foundation.sql`, 'utf8');
const grabTable = (t, m) => { const a = t.indexOf(m); const b = t.indexOf('\n);', a); return t.slice(a, b + 3); };
const grabFn = (t, m) => { const a = t.indexOf(m); const b = t.indexOf('\n$$;', a); return t.slice(a, b + 4); };

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + String(detail).slice(0, 200)}`); };
const fails = async (db, sql, p, inc) => { try { await db.query(sql, p); return { raised: false, msg: '' }; } catch (e) { const msg = String(e.message); return { raised: true, msg, match: inc ? msg.includes(inc) : true }; } };

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated;
create table public.companies (id uuid primary key default gen_random_uuid());
create table public.people (id uuid primary key default gen_random_uuid());
create function public.my_person_id() returns uuid language sql stable as $$ select null::uuid $$;
`);
await db.exec(grabTable(f020b, 'create table if not exists public.snow_settings'));
await db.exec(grabTable(f020b, 'create table if not exists public.snow_storms'));
await db.exec(grabTable(f020b, 'create table if not exists public.snow_routes'));
await db.exec(`
create table public.snow_visits (
  id uuid primary key default gen_random_uuid(), company_id uuid, storm_id uuid not null, route_id uuid not null,
  status text not null default 'pending', arrived_at timestamptz, arrived_by uuid, completed_at timestamptz, completed_by uuid,
  skipped_at timestamptz, skipped_by uuid, completion_note text);
create table public.snow_completion_media (visit_id uuid);
create table public.snow_skip_requests (visit_id uuid, status text);
`);
await db.exec(grabFn(f020b, 'create or replace function public.snow_visit_status_guard'));
await db.exec(`create trigger snow_visits_status_guard before update on public.snow_visits for each row execute function public.snow_visit_status_guard();`);

const co = (await db.query(`insert into public.companies default values returning id`)).rows[0].id;
await db.query(`insert into public.snow_settings (company_id) values ($1)`, [co]);
const storm = (await db.query(`insert into public.snow_storms (company_id, name, service, status) values ($1, 'S', 'plowing', 'dispatched') returning id`, [co])).rows[0].id;
const route = (await db.query(`insert into public.snow_routes (company_id, storm_id, service, name, media_required) values ($1, $2, 'plowing', 'R', false) returning id`, [co, storm])).rows[0].id;
const visit = async () => (await db.query(`insert into public.snow_visits (company_id, storm_id, route_id) values ($1, $2, $3) returning id`, [co, storm, route])).rows[0].id;
const setRule = (on) => db.query(`update public.snow_settings set require_arrival_before_completion = $2 where company_id = $1`, [co, on]);
const complete = (id) => db.query(`update public.snow_visits set status = 'completed' where id = $1`, [id]);

check('1 the setting starts ON for a company (the safe default)', (await db.query(`select require_arrival_before_completion r from public.snow_settings where company_id = $1`, [co])).rows[0].r === true);
let v = await visit();
let f = await fails(db, `update public.snow_visits set status = 'completed' where id = $1`, [v], "Tap I'm Here");
check('2 ON: finishing a stop that was never arrived at is refused ("Tap I\'m Here at this property first")', f.raised && f.match, f.msg);

await setRule(false);
v = await visit();
f = await fails(db, `update public.snow_visits set status = 'completed' where id = $1`, [v]);
check('3 OFF (what the Settings switch does): the same stop can now be finished without I\'m Here', !f.raised, f.msg);
check('4 ...and it is recorded as completed', (await db.query(`select status from public.snow_visits where id = $1`, [v])).rows[0].status === 'completed');

await setRule(true);
v = await visit();
f = await fails(db, `update public.snow_visits set status = 'completed' where id = $1`, [v], "Tap I'm Here");
check('5 turning it back ON enforces it again immediately', f.raised && f.match, f.msg);

v = await visit();
await db.query(`update public.snow_visits set status = 'arrived' where id = $1`, [v]);
f = await fails(db, `update public.snow_visits set status = 'completed' where id = $1`, [v]);
check('6 with I\'m Here tapped first, finishing works with the rule ON', !f.raised, f.msg);

await db.query(`delete from public.snow_settings where company_id = $1`, [co]);
v = await visit();
f = await fails(db, `update public.snow_visits set status = 'completed' where id = $1`, [v], "Tap I'm Here");
check('7 a company with no settings row behaves as ON (matches the app\'s default)', f.raised && f.match, f.msg);

await db.query(`insert into public.snow_settings (company_id, require_arrival_before_completion) values ($1, false)`, [co]);
await db.query(`update public.snow_routes set media_required = true, min_media = 2 where id = $1`, [route]);
v = await visit();
f = await fails(db, `update public.snow_visits set status = 'completed' where id = $1`, [v], 'photo');
check('8 turning the arrival rule off does NOT turn off the photo rule', f.raised && f.match, f.msg);

const bad = results.filter((x) => !x).length;
console.log(`\n${results.length - bad} passed, ${bad} failed (${results.length} checks)`);
process.exit(bad ? 1 : 0);
