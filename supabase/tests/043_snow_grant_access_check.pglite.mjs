// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && copy this file there && node <file> <path to the repo>
// Tests for update 43 (snow_grant_access only works for people on the company's team) on an in-process
// Postgres (PGlite). REAL SQL: the snow_staff / snow_staff_services / snow_access_log tables and the
// original snow_grant_access (update 20), the snow_access_requests table and the REAL approval,
// service-change functions (update 23, with its helper tables as stand-ins), and update 43.
// Small stand-ins: companies, people, company_members, membership_audit_log, my_person_id / is_staff.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const repo = process.argv[2];
const read = (p) => fs.readFileSync(`${repo}/${p}`, 'utf8');
const grabTable = (t, m) => { const a = t.indexOf(m); const b = t.indexOf('\n);', a); return t.slice(a, b + 3); };
const grabFn = (t, m) => { const a = t.indexOf(m); const b = t.indexOf('\n$$;', a); return t.slice(a, b + 4); };
const f020 = read('supabase/updates/020_snow_access.sql');
const f023 = read('supabase/updates/023_snow_onboarding.sql');
const f043 = read('supabase/updates/043_snow_grant_access_check.sql');

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + String(detail).slice(0, 200)}`); };
const fails = async (db, sql, p, inc) => { try { await db.query(sql, p); return { raised: false, msg: '' }; } catch (e) { const msg = String(e.message); return { raised: true, msg, match: inc ? msg.includes(inc) : true }; } };
const q = async (db, sql, p) => (await db.query(sql, p)).rows;

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated;
create table public.companies (id uuid primary key default gen_random_uuid());
create table public.people (id uuid primary key default gen_random_uuid(), name text);
create table public.company_members (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), person_id uuid not null references public.people(id), role text not null, status text not null default 'active', created_at timestamptz default now());
create function public.my_person_id() returns uuid language sql stable as $$ select nullif(current_setting('test.pid', true), '')::uuid $$;
create function public.is_staff(cid uuid) returns boolean language sql stable as $$
  select exists (select 1 from public.company_members m where m.company_id = cid and m.person_id = public.my_person_id() and m.role in ('owner','admin') and m.status = 'active') $$;
create table public.snow_signup_codes (id uuid primary key default gen_random_uuid());
create table public.membership_audit_log (id uuid primary key default gen_random_uuid(), company_id uuid, event_type text, actor_id uuid, target_id uuid, metadata jsonb);
create function public._snow_valid_services(s text[]) returns boolean language sql immutable as $$
  select s is not null and cardinality(s) > 0 and s <@ array['plowing','shoveling','salting']::text[] $$;
`);
await db.exec(grabTable(f020, 'create table if not exists public.snow_staff'));
await db.exec(grabTable(f020, 'create table if not exists public.snow_staff_services'));
await db.exec(grabTable(f020, 'create table if not exists public.snow_access_log'));
await db.exec(grabTable(f023, 'create table if not exists public.snow_access_requests'));
await db.exec(grabFn(f020, 'create or replace function public.snow_grant_access'));
await db.exec(grabFn(f020, 'create or replace function public.snow_revoke_access'));
await db.exec(grabFn(f023, 'create or replace function public._my_staff_company'));
await db.exec(grabFn(f023, 'create or replace function public._snow_services_of'));
await db.exec(grabFn(f023, 'create or replace function public.approve_snow_access_request'));
await db.exec(grabFn(f023, 'create or replace function public.set_snow_member_services'));

const co = (await q(db, `insert into public.companies default values returning id`))[0].id;
const co2 = (await q(db, `insert into public.companies default values returning id`))[0].id;
const mk = async (name, company, role, status = 'active') => {
  const id = (await q(db, `insert into public.people (name) values ($1) returning id`, [name]))[0].id;
  if (company) await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1, $2, $3, $4)`, [company, id, role, status]);
  return id;
};
const owner = await mk('Olive', co, 'owner');
const owner2 = await mk('Otto', co2, 'owner');
const worker = await mk('Wendy', co, 'worker');
const admin = await mk('Adam', co, 'admin');
const customer = await mk('Cy', co, 'customer');
const stranger = await mk('Sam', null);
const otherCo = await mk('Olga', co2, 'worker');
const inactive = await mk('Ina', co, 'worker', 'inactive');
const snowOnly = await mk('Sven', null);
const as = (pid) => db.query(`select set_config('test.pid', $1, false)`, [pid ?? '']);
const grant = (person, svcs = ['plowing']) => db.query(`select public.snow_grant_access($1, $2::text[])`, [person, svcs]);
const staffOf = async (p) => (await q(db, `select status from public.snow_staff where person_id = $1`, [p]))[0]?.status;

await as(owner);

// ── Before update 43: the old, loose function ───────────────────────────────
await grant(customer);
check('1 BEFORE 43 (the problem): a customer could be given snow access', (await staffOf(customer)) === 'active');
await db.query(`delete from public.snow_staff_services where person_id = $1`, [customer]);
await db.query(`delete from public.snow_staff where person_id = $1`, [customer]);
await grant(stranger);
check('2 BEFORE 43 (the problem): so could a total stranger', (await staffOf(stranger)) === 'active');
await db.query(`delete from public.snow_staff_services where person_id = $1`, [stranger]);
await db.query(`delete from public.snow_staff where person_id = $1`, [stranger]);

// ── Apply update 43 (twice) ─────────────────────────────────────────────────
await db.exec(f043);
await db.exec(f043);
check('3 update 43 runs twice without error', true);

// ── Who can be given access now ─────────────────────────────────────────────
await grant(worker, ['plowing', 'shoveling']);
check('4 an active worker of the company can be given snow access (the new Team screen path)', (await staffOf(worker)) === 'active');
const svc = (await q(db, `select service from public.snow_staff_services where person_id = $1 order by service`, [worker])).map((r) => r.service);
check('5 with exactly the services chosen', svc.join() === 'plowing,shoveling');
await grant(admin, ['salting']);
check('6 an admin can be given services too', (await staffOf(admin)) === 'active');
let f = await fails(db, `select public.snow_grant_access($1, array['plowing']::text[])`, [customer], "isn't on your team");
check('7 a CUSTOMER is refused', f.raised && f.match && (await staffOf(customer)) === undefined, f.msg);
f = await fails(db, `select public.snow_grant_access($1, array['plowing']::text[])`, [stranger], "isn't on your team");
check('8 a person with no link to the company is refused', f.raised && f.match && (await staffOf(stranger)) === undefined, f.msg);
f = await fails(db, `select public.snow_grant_access($1, array['plowing']::text[])`, [otherCo], "isn't on your team");
check('9 a worker of ANOTHER company is refused', f.raised && f.match && (await staffOf(otherCo)) === undefined, f.msg);
f = await fails(db, `select public.snow_grant_access($1, array['plowing']::text[])`, [inactive], "isn't on your team");
check('10 a deactivated worker is refused', f.raised && f.match, f.msg);
f = await fails(db, `select public.snow_grant_access($1, array['plowing']::text[])`, ['99999999-9999-9999-9999-999999999999'], 'Person not found');
check('11 an unknown person is still "Person not found"', f.raised && f.match, f.msg);

// ── Everything else unchanged ───────────────────────────────────────────────
await grant(worker, ['plowing', 'shoveling']);
const log = await q(db, `select action from public.snow_access_log where person_id = $1 order by created_at`, [worker]);
check('12 repeating the same grant changes nothing and logs nothing new (double tap safe)', log.length === 1 && log[0].action === 'granted', JSON.stringify(log));
await grant(worker, ['salting']);
check('13 changing services still works and is logged', (await q(db, `select action from public.snow_access_log where person_id = $1 order by created_at desc limit 1`, [worker]))[0].action === 'services_changed');
f = await fails(db, `select public.snow_grant_access($1, array[]::text[])`, [worker], 'at least one');
check('14 an empty service list is still refused', f.raised && f.match, f.msg);
f = await fails(db, `select public.snow_grant_access($1, array['ice']::text[])`, [worker], 'Unknown snow service');
check('15 an unknown service is still refused', f.raised && f.match, f.msg);
await as(worker);
f = await fails(db, `select public.snow_grant_access($1, array['plowing']::text[])`, [admin], 'Only the owner');
check('16 a worker still cannot grant access', f.raised && f.match, f.msg);
await as(owner2);
f = await fails(db, `select public.snow_grant_access($1, array['plowing']::text[])`, [worker], "isn't on your team");
check('17 another company\'s owner cannot grant YOUR worker snow access', f.raised && f.match, f.msg);
await as(owner);

// removed access can be restored
await db.query(`select public.snow_revoke_access($1)`, [worker]);
check('18 a worker whose snow access was removed is revoked', (await staffOf(worker)) === 'revoked');
await grant(worker, ['plowing']);
check('19 and can be restored (they are on the snow team list and on the company team)', (await staffOf(worker)) === 'active');
// even if their landscaping membership is gone, someone already on the snow team (e.g. snow-only) can be restored
await db.query(`delete from public.company_members where person_id = $1`, [worker]);
await db.query(`select public.snow_revoke_access($1)`, [worker]);
await grant(worker, ['plowing']);
check('20 a snow-team member with no landscaping membership can still be restored', (await staffOf(worker)) === 'active');

// ── The signup approval path must keep working ──────────────────────────────
await db.query(`insert into public.snow_access_requests (company_id, person_id) values ($1, $2)`, [co, snowOnly]);
const req = (await q(db, `select id from public.snow_access_requests where person_id = $1`, [snowOnly]))[0].id;
await db.query(`select public.approve_snow_access_request($1, array['plowing']::text[])`, [req]);
check('21 approving a snow SIGNUP request (a person who is not on the company team yet) still works', (await staffOf(snowOnly)) === 'active' && (await q(db, `select status from public.snow_access_requests where id = $1`, [req]))[0].status === 'approved');
const custReq = (await q(db, `insert into public.snow_access_requests (company_id, person_id) values ($1, $2) returning id`, [co, customer]))[0].id;
await db.query(`select public.approve_snow_access_request($1, array['salting']::text[])`, [custReq]);
check('22 and an owner can still approve a request that a customer account filed (their explicit decision)', (await staffOf(customer)) === 'active');
await db.query(`update public.snow_access_requests set status = 'declined' where person_id = $1`, [stranger]);
const strangerReq = (await q(db, `insert into public.snow_access_requests (company_id, person_id, status) values ($1, $2, 'declined') returning id`, [co, stranger]))[0].id;
f = await fails(db, `select public.snow_grant_access($1, array['plowing']::text[])`, [stranger], "isn't on your team");
check('23 a DECLINED request does not make someone eligible', f.raised && f.match, f.msg);
await db.query(`select public.set_snow_member_services($1, array['salting','plowing']::text[])`, [snowOnly]);
check('24 changing an existing snow member\'s services (update 23 path) still works', (await q(db, `select count(*)::int n from public.snow_staff_services where person_id = $1`, [snowOnly]))[0].n === 2);

const bad = results.filter((x) => !x).length;
console.log(`\n${results.length - bad} passed, ${bad} failed (${results.length} checks)`);
process.exit(bad ? 1 : 0);
