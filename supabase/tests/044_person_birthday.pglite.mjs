// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && copy this file there && node <file> <path to the repo>
// Proves update 044 (optional birthday): the column is added, bad dates are refused, running it twice is safe,
// and only the person themself can change their birthday (the REAL people_update policy is used).
// The people table definition and policy text are read from schema.sql; my_person_id() is a stand-in driven by a setting.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const repo = process.argv[2];
const schema = fs.readFileSync(`${repo}/supabase/schema.sql`, 'utf8');
const f044 = fs.readFileSync(`${repo}/supabase/updates/044_person_birthday.sql`, 'utf8');
const grabTable = (t, m) => { const a = t.indexOf(m); const b = t.indexOf('\n);', a); return t.slice(a, b + 3); };
const grabPolicy = (t, m) => { const a = t.indexOf(m); const b = t.indexOf(');', a); return t.slice(a, b + 2); };

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + String(detail).slice(0, 200)}`); };
const fails = async (db, sql, p) => { try { await db.query(sql, p); return { raised: false, msg: '' }; } catch (e) { return { raised: true, msg: String(e.message) }; } };

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated;
create schema auth; create table auth.users (id uuid primary key);
create function public.my_person_id() returns uuid language sql stable as $$ select nullif(current_setting('app.me', true), '')::uuid $$;
create function public.staff_of_person(p uuid) returns boolean language sql stable as $$ select false $$;
create function public.can_see_person(p uuid) returns boolean language sql stable as $$ select true $$;
`);
await db.exec(grabTable(schema, 'create table public.people ('));
await db.exec(`alter table public.people enable row level security;
${grabPolicy(schema, 'create policy people_select on public.people')}
${grabPolicy(schema, 'create policy people_update on public.people')}
grant select, update on public.people to authenticated;`);

const a = (await db.query(`insert into public.people (email, first_name) values ('a@x.test', 'Ann') returning id`)).rows[0].id;
const b = (await db.query(`insert into public.people (email, first_name) values ('b@x.test', 'Bob') returning id`)).rows[0].id;

check('1 before 044 there is no birthday column', (await db.query(`select count(*)::int n from information_schema.columns where table_name = 'people' and column_name = 'birthday'`)).rows[0].n === 0);
await db.exec(f044);
check('2 after 044 the column exists', (await db.query(`select count(*)::int n from information_schema.columns where table_name = 'people' and column_name = 'birthday'`)).rows[0].n === 1);
let f = { raised: false, msg: '' };
try { await db.exec(f044); } catch (e) { f = { raised: true, msg: String(e.message) }; }
check('3 running 044 a second time is safe', !f.raised, f.msg);
check('4 existing people keep an empty birthday', (await db.query(`select birthday from public.people where id = $1`, [a])).rows[0].birthday === null);

f = await fails(db, `update public.people set birthday = '1850-01-01' where id = $1`, [a]);
check('5 a year before 1900 is refused by the database', f.raised && /people_birthday_range/.test(f.msg), f.msg);
f = await fails(db, `update public.people set birthday = '1990-04-23' where id = $1`, [a]);
check('6 a normal date is accepted', !f.raised, f.msg);

await db.exec(`set role authenticated; select set_config('app.me', '${a}', false);`);
await db.query(`update public.people set birthday = '1991-05-06' where id = $1`, [a]);
check('7 I can change my own birthday', (await db.query(`select birthday::text d from public.people where id = $1`, [a])).rows[0].d === '1991-05-06');
await db.query(`update public.people set birthday = null where id = $1`, [a]);
check('8 I can clear it again', (await db.query(`select birthday from public.people where id = $1`, [a])).rows[0].birthday === null);
await db.query(`update public.people set birthday = '1980-01-01' where id = $1`, [b]);
await db.exec(`reset role;`);
check('9 I cannot change someone else\'s birthday (the update touches no row)', (await db.query(`select birthday from public.people where id = $1`, [b])).rows[0].birthday === null);

const bad = results.filter((r) => !r).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
