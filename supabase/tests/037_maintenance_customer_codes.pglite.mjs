// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && node <this file> <path to the repo>
// Logic tests for update 37 (maintenance customer codes) on an in-process Postgres (PGlite).
// Uses the REAL SQL for _random_code (schema.sql), the original lookup_project_code
// (schema.sql) and update 37. Tables, is_staff and my_person_id are small stand-ins,
// so this is NOT the full production schema (no row-level security is exercised).
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const repo = process.argv[2];
const read = (p) => fs.readFileSync(`${repo}/${p}`, 'utf8');
const schema = read('supabase/schema.sql');
const grab = (text, startMarker) => {
  const a = text.indexOf(startMarker);
  const b = text.indexOf('\n$$;', a);
  return text.slice(a, b + 4);
};
const randomCode = grab(schema, 'create or replace function public._random_code');
const oldLookup = grab(schema, 'create or replace function public.lookup_project_code');
const upd37 = read('supabase/updates/037_maintenance_customer_codes.sql');

const standIn = `
create role anon; create role authenticated;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table public.companies (id uuid primary key default gen_random_uuid(), name text not null);
create table public.people (id uuid primary key default gen_random_uuid(), user_id uuid unique references auth.users(id) on delete set null, email text default '');
create table public.company_members (id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  role text not null, status text not null default 'active', join_method text, deactivated_by uuid,
  unique (company_id, person_id));
create table public.projects (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  name text not null, customer_project_code text unique, customer_claimed_by uuid, customer_claimed_at timestamptz, customer_id uuid);
create table public.project_settings (project_id uuid primary key references public.projects(id) on delete cascade, customer_interaction_enabled boolean default true);
create table public.maintenance_properties (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  name text not null, address text default '', city text, customer_id uuid references public.people(id) on delete set null);
create function public.my_person_id() returns uuid language sql stable as $$ select id from public.people where user_id = auth.uid() limit 1 $$;
create function public.is_staff(cid uuid) returns boolean language sql stable as $$
  select exists (select 1 from public.company_members m where m.company_id = cid and m.person_id = public.my_person_id() and m.role in ('owner','admin') and m.status = 'active') $$;
`;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const fails = async (db, sql, params, includes) => {
  try { await db.query(sql, params); return { raised: false }; }
  catch (e) { return { raised: true, msg: String(e.message), match: includes ? String(e.message).includes(includes) : true }; }
};

const db = new PGlite();
await db.exec(standIn);
await db.exec(randomCode);
await db.exec(oldLookup);

const cid = (await db.query(`insert into public.companies (name) values ('Brighton') returning id`)).rows[0].id;
const mkUser = async (email, role) => {
  const u = (await db.query(`insert into auth.users default values returning id`)).rows[0].id;
  const p = (await db.query(`insert into public.people (user_id, email) values ($1, $2) returning id`, [u, email])).rows[0].id;
  if (role) await db.query(`insert into public.company_members (company_id, person_id, role) values ($1, $2, $3)`, [cid, p, role]);
  return { uid: u, pid: p };
};
const asUser = (uid) => db.query(`select set_config('test.uid', $1, false)`, [uid ?? '']);
const owner = await mkUser('owner@x.test', 'owner');
const worker = await mkUser('worker@x.test', 'worker');
const cust1 = await mkUser('c1@x.test', null);
const cust2 = await mkUser('c2@x.test', null);

// A property created BEFORE the update (to test the backfill).
const oldProp = (await db.query(`insert into public.maintenance_properties (company_id, name) values ($1, 'Old Residence') returning id`, [cid])).rows[0].id;
// A project with a code (regression for project codes).
const proj = (await db.query(`insert into public.projects (company_id, name, customer_project_code) values ($1, 'Beach House', 'BEACH142') returning id`, [cid])).rows[0].id;

await db.exec(`create schema if not exists test_only;`);
// Update 37 needs the maintenance codes table's FK targets to exist (they do) and is_staff().
await db.exec(upd37);

const codeOf = async (prop) => (await db.query(`select code from public.maintenance_customer_codes where property_id = $1`, [prop])).rows[0]?.code;

check('1 existing property is given a code by the update', !!(await codeOf(oldProp)) && (await codeOf(oldProp)).length === 8);
const newProp = (await db.query(`insert into public.maintenance_properties (company_id, name) values ($1, 'New Residence') returning id`, [cid])).rows[0].id;
const newCode = await codeOf(newProp);
check('2 a new property gets a code automatically', !!newCode && newCode.length === 8, newCode);
check('3 codes are unique and not the project code', newCode !== (await codeOf(oldProp)) && newCode !== 'BEACH142');

const lk = async (c) => (await db.query(`select public.lookup_project_code($1) as r`, [c])).rows[0].r;
let r = await lk(newCode);
check('4 lookup recognises a maintenance code (valid, property name, kind)', r.valid === true && r.project_name === 'New Residence' && r.kind === 'maintenance' && r.claimed === false, JSON.stringify(r));
r = await lk(newCode.toLowerCase() + '  ');
check('5 lookup is case and space tolerant', r.valid === true);
r = await lk('NOPE1234');
check('6 lookup: an unknown code is invalid', r.valid === false);
r = await lk('BEACH142');
check('7 regression: a project code still looks up as a project', r.valid === true && r.project_name === 'Beach House' && r.kind === undefined, JSON.stringify(r));

const claim = async (pid, c) => (await db.query(`select public._claim_project($1, $2) as r`, [pid, c])).rows[0].r;
r = await claim(cust1.pid, newCode);
check('8 a customer claims a maintenance code (success)', r.success === true && r.kind === 'maintenance', JSON.stringify(r));
const linked = (await db.query(`select customer_id from public.maintenance_properties where id = $1`, [newProp])).rows[0].customer_id;
check('9 the property is now linked to that customer', linked === cust1.pid);
const mem = (await db.query(`select role, status from public.company_members where company_id = $1 and person_id = $2`, [cid, cust1.pid])).rows[0];
check('10 the customer becomes an active customer member of the company', mem && mem.role === 'customer' && mem.status === 'active');
check('11 the same customer can claim again (no error)', (await claim(cust1.pid, newCode)).success === true);
r = await claim(cust2.pid, newCode);
check('12 a different person cannot claim an already claimed code', r.success === false && r.error === 'already_claimed', JSON.stringify(r));
r = await claim(cust2.pid, 'NOPE1234');
check('13 an invalid code is refused', r.success === false && r.error === 'invalid_code');
r = await claim(cust2.pid, 'BEACH142');
check('14 regression: a project code still claims a project', r.success === true && (await db.query(`select customer_id from public.projects where id = $1`, [proj])).rows[0].customer_id === cust2.pid);

// A customer record the owner linked by hand does not block the real customer's code (project parity).
await db.query(`update public.maintenance_properties set customer_id = $1 where id = $2`, [cust1.pid, oldProp]);
r = await claim(cust2.pid, await codeOf(oldProp));
check('15 a hand-linked customer record does not block the code: the real customer can claim', r.success === true && (await db.query(`select customer_id from public.maintenance_properties where id = $1`, [oldProp])).rows[0].customer_id === cust2.pid, JSON.stringify(r));

const mine = async (uid) => { await asUser(uid); return (await db.query(`select * from public.maintenance_my_properties()`)).rows; };
const m1 = await mine(cust1.uid);
check('16 a customer sees only their own maintenance properties', m1.length === 1 && m1[0].name === 'New Residence', JSON.stringify(m1.map((x) => x.name)));
const m2 = await mine(cust2.uid);
check('17 another customer sees only theirs', m2.length === 1 && m2[0].name === 'Old Residence', JSON.stringify(m2.map((x) => x.name)));

// Owner tools
await asUser(owner.uid);
const before = await codeOf(newProp);
const regen = (await db.query(`select public.regenerate_maintenance_code($1, false) as c`, [newProp])).rows[0].c;
const claimedBy = (await db.query(`select claimed_by from public.maintenance_customer_codes where property_id = $1`, [newProp])).rows[0].claimed_by;
check('18 owner regenerates: new code, old code stops working, the claim on the code is cleared',
  regen !== before && (await lk(before)).valid === false && (await lk(regen)).valid === true && claimedBy === null);
check('19 regenerate alone keeps the customer linked', (await db.query(`select customer_id from public.maintenance_properties where id = $1`, [newProp])).rows[0].customer_id === cust1.pid);

// claim again then revoke
await claim(cust1.pid, regen);
const regen2 = (await db.query(`select public.regenerate_maintenance_code($1, true) as c`, [newProp])).rows[0].c;
check('20 revoke: customer is unlinked and the code is new', (await db.query(`select customer_id from public.maintenance_properties where id = $1`, [newProp])).rows[0].customer_id === null && regen2 !== regen);
check('21 after revoke the former customer no longer sees the property', (await mine(cust1.uid)).every((x) => x.name !== 'New Residence'));

await asUser(worker.uid);
let f = await fails(db, `select public.regenerate_maintenance_code($1, false)`, [newProp], 'not allowed');
check('22 a worker cannot regenerate or revoke a code', f.raised && f.match, f.msg);
await asUser(cust2.uid);
f = await fails(db, `select public.regenerate_maintenance_code($1, true)`, [newProp], 'not allowed');
check('23 a customer cannot regenerate or revoke a code', f.raised && f.match, f.msg);

// Running update 37 twice is harmless
await db.exec(upd37);
check('24 running the update again keeps the existing codes', (await codeOf(oldProp)).length === 8 && (await db.query(`select count(*)::int as n from public.maintenance_customer_codes`)).rows[0].n === 2);

const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad} passed, ${bad} failed (${results.length} checks)`);
process.exit(bad ? 1 : 0);
