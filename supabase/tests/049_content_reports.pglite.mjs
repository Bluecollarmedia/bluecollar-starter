// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && copy this file there && node <file> <path to the repo>
// Proves update 49 (report content): who can report, who can see and handle reports, and that a report cannot be altered.
// REAL SQL: update 49 itself (table, policies, guard trigger). Stand-ins: companies/people/projects and the role helpers
// is_staff / is_project_customer / my_person_id (driven by test settings), set_company_from_project.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const repo = process.argv[2];
const f049 = fs.readFileSync(`${repo}/supabase/updates/049_content_reports.sql`, 'utf8');

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + String(detail).slice(0, 200)}`); };
const fails = async (db, sql, p) => { try { await db.query(sql, p); return { raised: false, msg: '' }; } catch (e) { return { raised: true, msg: String(e.message) }; } };

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated;
create table public.companies (id uuid primary key default gen_random_uuid());
create table public.people (id uuid primary key default gen_random_uuid());
create table public.projects (id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id));
create function public.my_person_id() returns uuid language sql stable as $$ select nullif(current_setting('test.me', true), '')::uuid $$;
create function public.is_staff(cid uuid) returns boolean language sql stable as $$ select current_setting('test.role', true) = 'staff' $$;
create function public.is_project_customer(pid uuid) returns boolean language sql stable as $$ select current_setting('test.role', true) = 'customer' $$;
create function public.set_company_from_project() returns trigger language plpgsql as $$
begin new.company_id := (select company_id from public.projects where id = new.project_id); return new; end $$;
grant usage on schema public to authenticated, anon;
grant select on public.projects to authenticated;
`);
await db.exec(f049);
let again = false; try { await db.exec(f049); again = true; } catch {}
check('1 049 can be run twice', again);

const co = (await db.query(`insert into public.companies default values returning id`)).rows[0].id;
const proj = (await db.query(`insert into public.projects (company_id) values ($1) returning id`, [co])).rows[0].id;
const owner = (await db.query(`insert into public.people default values returning id`)).rows[0].id;
const cust = (await db.query(`insert into public.people default values returning id`)).rows[0].id;
const stranger = (await db.query(`insert into public.people default values returning id`)).rows[0].id;
const msg = '55555555-5555-5555-5555-555555555555';

const as = async (role, me) => { await db.exec(`reset role; select set_config('test.role','${role}',false); select set_config('test.me','${me ?? ''}',false); set role authenticated;`); };
const report = (by, reason = 'inappropriate', type = 'message', id = msg) => fails(db, `insert into public.content_reports (project_id, reported_by, content_type, content_id, reason, details) values ($1,$2,$3,$4,$5,'x')`, [proj, by, type, id, reason]);

await as('customer', cust);
let r = await report(cust);
check('2 the project\'s customer can report a message as themself', !r.raised, r.msg);
check('3 the company is filled in from the project automatically', (await db.query(`select company_id from public.content_reports limit 1`)).rows[0].company_id === co);
r = await report(cust);
check('4 reporting the same item twice changes nothing (refused as a duplicate)', r.raised && /unique|duplicate/i.test(r.msg), r.msg);
r = await report(owner);
check('5 a customer cannot file a report in someone else\'s name', r.raised && /row-level security/.test(r.msg), r.msg);
r = await report(cust, 'rude');
check('6 an unknown reason is refused', r.raised && /check/i.test(r.msg), r.msg);
r = await report(cust, 'spam', 'message', '66666666-6666-6666-6666-666666666666');
check('7 a different message can be reported', !r.raised, r.msg);

await as('stranger', stranger);
r = await report(stranger, 'inappropriate', 'photo', '77777777-7777-7777-7777-777777777777');
check('8 a stranger (not staff, not this project\'s customer) cannot report', r.raised && /row-level security/.test(r.msg), r.msg);
check('9 a stranger sees no reports', (await db.query(`select count(*)::int n from public.content_reports`)).rows[0].n === 0);

await as('customer', cust);
check('10 the reporter sees their own reports', (await db.query(`select count(*)::int n from public.content_reports`)).rows[0].n === 2);
r = await fails(db, `update public.content_reports set status = 'handled'`);
const still = (await db.query(`select count(*)::int n from public.content_reports where status = 'handled'`)).rows[0].n;
check('11 the reporter cannot mark a report handled', still === 0, r.msg);

await as('staff', owner);
check('12 owner/admin see every report', (await db.query(`select count(*)::int n from public.content_reports`)).rows[0].n === 2);
r = await report(owner, 'harassment', 'photo', '88888888-8888-8888-8888-888888888888');
check('13 owner/admin can report too', !r.raised, r.msg);
await db.query(`update public.content_reports set status = 'handled', handled_note = 'removed it' where content_id = $1 and content_type = 'message'`, [msg]);
const h = (await db.query(`select status, handled_by, handled_at is not null as t from public.content_reports where content_id = $1`, [msg])).rows[0];
check('14 owner/admin can mark it handled; who and when are recorded', h.status === 'handled' && h.handled_by === owner && h.t, JSON.stringify(h));
r = await fails(db, `update public.content_reports set details = 'edited', reason = 'spam' where content_id = $1`, [msg]);
check('15 the contents of a report can never be edited', r.raised && /can't be changed/.test(r.msg), r.msg);
r = await fails(db, `delete from public.content_reports`);
check('16 reports cannot be deleted', (await db.query(`select count(*)::int n from public.content_reports`)).rows[0].n === 3, r.msg);

await db.exec(`reset role`);
await db.exec(`set role anon`);
r = await fails(db, `select * from public.content_reports`);
check('17 a signed-out request cannot read reports', r.raised, r.msg);

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
