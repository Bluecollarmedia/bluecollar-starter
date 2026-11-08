// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && node <this file> <path to the repo>
// Logic tests for update 38 (property issues) on an in-process Postgres (PGlite).
// Tables, is_staff/is_crew/my_person_id are small stand-ins, so this is NOT the
// full production schema and row-level security is not exercised here.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const repo = process.argv[2];
const upd = fs.readFileSync(`${repo}/supabase/updates/038_property_issues.sql`, 'utf8')
  .replace(/do \$\$\nbegin\n  if not exists \([\s\S]*?end \$\$;/, ''); // realtime publication isn't in PGlite

const standIn = `
create role anon; create role authenticated;
create table public.companies (id uuid primary key default gen_random_uuid());
create table public.people (id uuid primary key default gen_random_uuid(), first_name text, last_name text);
create table public.company_members (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), person_id uuid not null references public.people(id), role text not null, status text not null default 'active');
create table public.projects (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), name text);
create table public.maintenance_properties (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), name text);
create table public.app_notifications (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), recipient_id uuid not null references public.people(id), event_type text not null, title text not null, body text not null default '', linked_entity_type text, linked_entity_id text);
create function public.my_person_id() returns uuid language sql stable as $$ select null::uuid $$;
create function public.is_staff(c uuid) returns boolean language sql stable as $$ select false $$;
create function public.is_crew(c uuid) returns boolean language sql stable as $$ select false $$;
`;

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const raises = async (db, sql, params) => { try { await db.query(sql, params); return false; } catch { return true; } };

const db = new PGlite();
await db.exec(standIn);
await db.exec(upd);
await db.exec(upd); // safe to run twice
check('1 update runs twice without error', true);

const co = (await db.query(`insert into public.companies default values returning id`)).rows[0].id;
const mk = async (f, role) => {
  const p = (await db.query(`insert into public.people (first_name, last_name) values ($1, 'T') returning id`, [f])).rows[0].id;
  if (role) await db.query(`insert into public.company_members (company_id, person_id, role) values ($1, $2, $3)`, [co, p, role]);
  return p;
};
const owner = await mk('Olive', 'owner'), admin = await mk('Adam', 'admin'), worker = await mk('Will', 'worker'), cust = await mk('Cy', 'customer');
const prop = (await db.query(`insert into public.maintenance_properties (company_id, name) values ($1, 'Beach House') returning id`, [co])).rows[0].id;
const proj = (await db.query(`insert into public.projects (company_id, name) values ($1, 'Patio') returning id`, [co])).rows[0].id;

const ins = (extra) => db.query(
  `insert into public.property_issues (company_id, reported_by, issue_type, place_name, maintenance_property_id, project_id, notes) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
  [co, worker, extra.type ?? 'tree_down', extra.place ?? 'Beach House', extra.prop ?? null, extra.proj ?? null, extra.notes ?? 'Big oak across the drive']);

const a = (await ins({ prop })).rows[0].id;
const notes = (await db.query(`select recipient_id, title, body, linked_entity_type, linked_entity_id, event_type from public.app_notifications order by recipient_id`)).rows;
check('2 a maintenance report notifies owner and admin only (not the worker, not the customer)', notes.length === 2 && notes.every((n) => n.recipient_id === owner || n.recipient_id === admin));
check('3 notification says what and where, links to the issue', notes[0].title === 'Tree down · Beach House' && notes[0].body.includes('By Will') && notes[0].linked_entity_type === 'issue' && notes[0].linked_entity_id === a && notes[0].event_type === 'issue_reported', JSON.stringify(notes[0]));
await ins({ proj, type: 'safety', place: 'Patio' });
check('4 a project report works too', (await db.query(`select count(*)::int n from public.property_issues`)).rows[0].n === 2);

check('5 a report with no place is refused', await raises(db, `insert into public.property_issues (company_id, reported_by, issue_type) values ($1, $2, 'damage')`, [co, worker]));
check('6 a report with both a property and a project is refused', await raises(db, `insert into public.property_issues (company_id, reported_by, issue_type, maintenance_property_id, project_id) values ($1, $2, 'damage', $3, $4)`, [co, worker, prop, proj]));
check('7 an unknown issue type is refused', await raises(db, `insert into public.property_issues (company_id, reported_by, issue_type, maintenance_property_id) values ($1, $2, 'ufo', $3)`, [co, worker, prop]));
check('8 an unknown status is refused', await raises(db, `update public.property_issues set status = 'nope' where id = $1`, [a]));

const before = (await db.query(`select updated_at from public.property_issues where id = $1`, [a])).rows[0].updated_at;
await new Promise((r) => setTimeout(r, 15));
await db.query(`update public.property_issues set status = 'resolved', resolved_by = $2, resolved_at = now(), resolution_note = 'Cleared' where id = $1`, [a, owner]);
const after = (await db.query(`select updated_at, status from public.property_issues where id = $1`, [a])).rows[0];
check('9 resolving works and refreshes updated_at', after.status === 'resolved' && after.updated_at > before);

const n0 = (await db.query(`select count(*)::int n from public.app_notifications`)).rows[0].n;
await db.query(`insert into public.property_issues (company_id, reported_by, issue_type, maintenance_property_id) values ($1, $2, 'other', $3)`, [co, owner, prop]);
const n1 = (await db.query(`select count(*)::int n from public.app_notifications`)).rows[0].n;
check('10 an owner reporting does not notify themselves (only the other admin)', n1 - n0 === 1);

await db.query(`delete from public.maintenance_properties where id = $1`, [prop]);
check('11 deleting a property removes its reports', (await db.query(`select count(*)::int n from public.property_issues where maintenance_property_id is not null`)).rows[0].n === 0);

const bad = results.filter((x) => !x).length;
console.log(`\n${results.length - bad} passed, ${bad} failed (${results.length} checks)`);
process.exit(bad ? 1 : 0);
