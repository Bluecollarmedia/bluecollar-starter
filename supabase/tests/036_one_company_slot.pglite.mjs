// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && node <this file> <path to the repo>
// Logic tests for the one-company rule on an in-process Postgres (PGlite).
// Uses the REAL SQL from the repo for: the delete guard (schema.sql), update 3
// (slot + creation trigger) and update 36. Everything else is a small stand-in
// (tables, auth.uid(), _create_company), so this is NOT the full production schema.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const repo = process.argv[2];
const read = (p) => fs.readFileSync(`${repo}/${p}`, 'utf8');
const schemaLines = read('supabase/schema.sql').split('\n');
const guardSql = schemaLines.slice(1263, 1284).join('\n'); // prevent_company_delete + its two triggers
const upd3 = read('supabase/updates/003_one_company.sql');
const upd36 = read('supabase/updates/036_one_company_slot.sql');

const standIn = `
create role anon; create role authenticated;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table public.companies (id uuid primary key default gen_random_uuid(), name text not null);
create table public.people (id uuid primary key default gen_random_uuid(), user_id uuid unique references auth.users(id) on delete set null,
  email text not null default '', phone text, avatar_url text);
create table public.company_members (id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  role text not null, status text not null default 'active', deactivated_at timestamptz, deactivated_by uuid,
  unique (company_id, person_id));
create table public.notification_preferences (person_id uuid);
create table public.app_notifications (recipient_id uuid);
-- Something that blocks a delete, to simulate a failed deletion.
create table public.keep_blocker (id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id) on delete restrict);
-- Like Snow's activity log: a table whose own delete trigger writes a log row
-- that points at the company. Deleting the company cascades into it.
create table public.activity_events (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, note text);
create table public.settings_like (company_id uuid primary key references public.companies(id) on delete cascade);
create function public.log_settings_delete() returns trigger language plpgsql as $$ begin
  insert into public.activity_events (company_id, note) values (old.company_id, 'settings.changed'); return old; end $$;
create trigger settings_like_audit after delete on public.settings_like for each row execute function public.log_settings_delete();
create function public.my_person_id() returns uuid language sql stable as $$ select id from public.people where user_id = auth.uid() limit 1 $$;
create function public._create_company(pid uuid, data jsonb) returns uuid language plpgsql as $$
declare cid uuid; begin
  insert into public.companies (name) values (coalesce(nullif(trim(data->>'company_name'), ''), 'My Company')) returning id into cid;
  insert into public.company_members (company_id, person_id, role) values (cid, pid, 'owner');
  return cid; end $$;
-- Old create_company (what production has today: only checks signed in).
create function public.create_company(data jsonb) returns uuid language plpgsql as $$
declare pid uuid := public.my_person_id(); begin
  if pid is null then raise exception 'not signed in'; end if; return public._create_company(pid, data); end $$;
`;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const fails = async (db, sql, params, includes) => {
  try { await db.query(sql, params); return { raised: false }; }
  catch (e) { return { raised: true, msg: String(e.message), match: includes ? String(e.message).includes(includes) : true }; }
};

async function fresh(withNew) {
  const db = new PGlite();
  await db.exec(standIn);
  await db.exec(guardSql);
  await db.exec(upd3);
  if (withNew) await db.exec(upd36);
  return db;
}
const asUser = (db, uid) => db.query(`select set_config('test.uid', $1, false)`, [uid ?? '']);
async function mkUser(db, email) {
  const u = (await db.query(`insert into auth.users default values returning id`)).rows[0].id;
  const p = (await db.query(`insert into public.people (user_id, email) values ($1, $2) returning id`, [u, email])).rows[0].id;
  return { uid: u, pid: p };
}
const slot = async (db) => (await db.query(`select public.company_slot_open() as o`)).rows[0].o;
const count = async (db, t) => Number((await db.query(`select count(*)::int as n from public.${t}`)).rows[0].n);

// ── Evidence for the old rule (update 3 only) ────────────────────────────────
{
  const db = await fresh(false);
  const a = await mkUser(db, 'owner@x.test');
  await asUser(db, a.uid);
  await db.query(`select public.create_company('{"company_name":"Brighton"}'::jsonb)`);
  check('OLD: slot closed while an owner with a login exists', (await slot(db)) === false);
  // The owner's login is deleted (what Delete Account does), company row stays.
  await db.query(`delete from auth.users where id = $1`, [a.uid]);
  check('OLD (bug): company still exists but slot reports OPEN', (await count(db, 'companies')) === 1 && (await slot(db)) === true);
}

// ── New rule (updates 3 + 36) ────────────────────────────────────────────────
const db = await fresh(true);
const owner = await mkUser(db, 'owner@x.test');
const worker = await mkUser(db, 'worker@x.test');
const stranger = await mkUser(db, 'stranger@x.test');

check('1 no company: slot is open', (await slot(db)) === true);

await asUser(db, null);
let r = await fails(db, `select public.create_company('{"company_name":"Brighton"}'::jsonb)`, [], 'not signed in');
check('2 unauthorized creation: not signed in is refused', r.raised && r.match, r.msg);

await asUser(db, owner.uid);
await db.query(`select public.create_company('{"company_name":"Brighton Lawn"}'::jsonb)`);
check('3 creation succeeds when no company exists', (await count(db, 'companies')) === 1 && (await slot(db)) === false);

await asUser(db, stranger.uid);
r = await fails(db, `select public.create_company('{"company_name":"Second"}'::jsonb)`, [], 'already exists');
check('4 existing company: a second create via the function is refused', r.raised && r.match && (await count(db, 'companies')) === 1, r.msg);

r = await fails(db, `insert into public.companies (name) values ('Sneaky')`, [], 'already exists');
check('5 existing company: direct insert is refused by the trigger', r.raised && r.match && (await count(db, 'companies')) === 1, r.msg);

r = await fails(db, `delete from public.companies`, [], 'cannot be deleted');
check('6 plain delete of the company is still blocked', r.raised && r.match && (await count(db, 'companies')) === 1, r.msg);

await db.query(`insert into public.settings_like (company_id) select id from public.companies`);

// The exact production failure: a plain delete (even with the lock bypass) trips the log trigger.
{
  let raised = '';
  try { await db.exec(`begin; set local app.allow_company_delete = 'on'; delete from public.companies; commit;`); }
  catch (e) { raised = String(e.message); }
  await db.exec('rollback').catch(() => {});
  check('6b production failure reproduced: raw delete fails because the log trigger writes a row for the vanishing company',
    raised.includes('violates foreign key') && (await count(db, 'companies')) === 1, raised.slice(0, 110));
}
const trigState = async () => (await db.query(`select tgenabled as s from pg_trigger where tgname = 'settings_like_audit'`)).rows[0].s;
check('6c the log trigger starts out enabled', (await trigState()) === 'O');

await db.query(`insert into public.company_members (company_id, person_id, role) select id, $1, 'worker' from public.companies`, [worker.pid]);
await asUser(db, worker.uid);
r = await fails(db, `select public.delete_my_company('Brighton Lawn')`, [], 'owner');
check('7 unauthorized deletion: a worker cannot delete the company', r.raised && r.match && (await count(db, 'companies')) === 1 && (await slot(db)) === false, r.msg);

await asUser(db, stranger.uid);
r = await fails(db, `select public.delete_my_company('Brighton Lawn')`, [], 'owner');
check('8 unauthorized deletion: an unrelated account cannot delete it', r.raised && (await count(db, 'companies')) === 1, r.msg);

await asUser(db, owner.uid);
r = await fails(db, `select public.delete_my_company('wrong name')`, [], 'exactly');
check('9 deletion needs the exact company name', r.raised && r.match && (await count(db, 'companies')) === 1, r.msg);

r = await fails(db, `delete from auth.users where false; select public.delete_my_account()`, [], 'own the company');
// run delete_my_account on its own (multi-statement text above is only to keep the helper simple)
r = await fails(db, `select public.delete_my_account()`, [], 'own the company');
check('10 the owner cannot erase their login while owning the company', r.raised && r.match && (await count(db, 'companies')) === 1, r.msg);

// failed deletion: something blocks it
const cid = (await db.query(`select id from public.companies`)).rows[0].id;
await db.query(`insert into public.keep_blocker (company_id) values ($1)`, [cid]);
r = await fails(db, `select public.delete_my_company('Brighton Lawn')`, [], null);
const flag = (await db.query(`select coalesce(current_setting('app.allow_company_delete', true), '') as f`)).rows[0].f;
check('11 deletion failure: company still exists, slot stays CLOSED, delete switch not left on',
  r.raised && (await count(db, 'companies')) === 1 && (await slot(db)) === false && flag !== 'on', r.msg);
check('11b deletion failure: nothing was partially removed (members intact)', (await count(db, 'company_members')) === 2);
check('11c deletion failure: the log trigger is still enabled (switch rolled back)', (await trigState()) === 'O');

// successful deletion
await db.query(`delete from public.keep_blocker`);
const peopleBefore = await count(db, 'people');
await db.query(`select public.delete_my_company('  brighton lawn ')`);
check('12 deletion success: company gone, slot OPEN again', (await count(db, 'companies')) === 0 && (await slot(db)) === true);
check('13 deletion success: accounts are kept, nobody is given ownership',
  (await count(db, 'people')) === peopleBefore && (await count(db, 'company_members')) === 0);
const flagAfter = (await db.query(`select coalesce(current_setting('app.allow_company_delete', true), '') as f`)).rows[0].f;
check('14 deletion switch is off after a successful delete', flagAfter !== 'on');
check('14b deletion with a log trigger present succeeds, and the trigger is enabled again afterwards',
  (await trigState()) === 'O' && (await count(db, 'settings_like')) === 0 && (await count(db, 'activity_events')) === 0);

r = await fails(db, `delete from public.companies`, [], null);
check('15 plain delete still blocked afterwards (nothing to delete, guard unchanged)', !r.raised || r.msg.includes('cannot be deleted'));

await asUser(db, stranger.uid);
await db.query(`select public.create_company('{"company_name":"New Co"}'::jsonb)`);
check('16 after deletion, a signed-in account can create a company again (slot reopens)', (await count(db, 'companies')) === 1 && (await slot(db)) === false);

// the former owner can now delete their account (company is gone / they own nothing)
await asUser(db, owner.uid);
await db.query(`select public.delete_my_account()`);
check('17 a person who owns no company can still delete their account',
  (await db.query(`select count(*)::int as n from auth.users where id = $1`, [owner.uid])).rows[0].n === 0);

const bad = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - bad} passed, ${bad} failed (${results.length} checks)`);
process.exit(bad ? 1 : 0);
