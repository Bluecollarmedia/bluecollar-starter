// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && copy this file there && node <file> <path to the repo>
// Proves update 45: correcting an OPEN shift closes it at the corrected clock-out time (not "now").
// REAL SQL: the shifts and corrections tables (028), the old and new snow_correct_shift. Stand-ins: companies/people,
// is_staff / my_person_id, and a no-op snow_log_event.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const repo = process.argv[2];
const read = (p) => fs.readFileSync(`${repo}/${p}`, 'utf8');
const grabTable = (t, m) => { const a = t.indexOf(m); const b = t.indexOf('\n);', a); return t.slice(a, b + 3); };
const grabFn = (t, m) => { const a = t.indexOf(m); const b = t.indexOf('\n$$;', a); return t.slice(a, b + 4); };
const f028 = read('supabase/updates/028_snow_shifts.sql');
const f045 = read('supabase/updates/045_snow_correct_shift_close_time.sql');

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + String(detail).slice(0, 200)}`); };
const fails = async (db, sql, p) => { try { await db.query(sql, p); return { raised: false, msg: '' }; } catch (e) { return { raised: true, msg: String(e.message) }; } };

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated;
create table public.companies (id uuid primary key default gen_random_uuid());
create table public.people (id uuid primary key default gen_random_uuid());
create function public.my_person_id() returns uuid language sql stable as $$ select nullif(current_setting('test.pid', true), '')::uuid $$;
create function public.is_staff(cid uuid) returns boolean language sql stable as $$ select current_setting('test.staff', true) = 'yes' $$;
create function public.snow_log_event(cid uuid, ev text, ent text, eid uuid, p_person_id uuid default null, p_before jsonb default null, p_after jsonb default null, p_note text default null)
  returns void language sql as $$ select 1 $$;
`);
await db.exec(grabTable(f028, 'create table if not exists public.snow_shifts'));
await db.exec(grabTable(f028, 'create table if not exists public.snow_shift_corrections'));
await db.exec(grabFn(f028, 'create or replace function public.snow_correct_shift'));

const co = (await db.query(`insert into public.companies default values returning id`)).rows[0].id;
const pe = (await db.query(`insert into public.people default values returning id`)).rows[0].id;
await db.exec(`select set_config('test.staff', 'yes', false);`);
const open = async (hoursAgo) => (await db.query(`insert into public.snow_shifts (company_id, person_id, clock_in_at) values ($1, $2, now() - ($3 || ' hours')::interval) returning id`, [co, pe, String(hoursAgo)])).rows[0].id;
const closeAll = () => db.query(`update public.snow_shifts set clock_out_at = clock_in_at where clock_out_at is null`);
const out = async (id) => (await db.query(`select clock_out_at, (clock_out_at is null) as is_open, extract(epoch from (now() - clock_out_at))/3600 as h_ago from public.snow_shifts where id = $1`, [id])).rows[0];

// OLD behaviour, for contrast
let s = await open(10);
await db.query(`select public.snow_correct_shift($1, now() - interval '10 hours', now() - interval '6 hours', 'forgot to clock out')`, [s]);
let r = await out(s);
check('1 BEFORE 045: the open shift was closed at "now" (about 0 hours ago), not at the corrected time', Math.abs(r.h_ago) < 0.1, r.h_ago);

await closeAll();
await db.exec(f045);
let f = { raised: false };
try { await db.exec(f045); } catch (e) { f = { raised: true, msg: String(e.message) }; }
check('2 045 can be run twice', !f.raised, f.msg);

s = await open(10);
await db.query(`select public.snow_correct_shift($1, now() - interval '10 hours', now() - interval '6 hours', 'forgot to clock out')`, [s]);
r = await out(s);
check('3 AFTER 045: the open shift closes at the corrected time (about 6 hours ago)', !r.is_open && Math.abs(r.h_ago - 6) < 0.1, r.h_ago);

s = await open(5);
await db.query(`select public.snow_correct_shift($1, now() - interval '5 hours', now() + interval '3 hours', 'typo')`, [s]);
r = await out(s);
check('4 a clock-out in the future is capped at now', !r.is_open && Math.abs(r.h_ago) < 0.1, r.h_ago);
await closeAll();

s = await open(5);
await db.query(`select public.snow_correct_shift($1, now() - interval '9 hours', now() - interval '8 hours', 'moved earlier')`, [s]);
r = await out(s);
const orig = (await db.query(`select clock_in_at <= clock_out_at ok from public.snow_shifts where id = $1`, [s])).rows[0].ok;
check('5 a corrected clock-out earlier than the original clock-in never breaks the shift (stays valid)', !r.is_open && orig);
await closeAll();

s = await open(4);
await db.query(`select public.snow_correct_shift($1, now() - interval '4 hours', null, 'only fixing the start')`, [s]);
check('6 no clock-out given: the shift stays open', (await out(s)).is_open === true);
await closeAll();

// A shift that was already closed keeps its row (the correction row carries the new times)
s = await open(8);
await db.query(`update public.snow_shifts set clock_out_at = clock_in_at + interval '1 hour' where id = $1`, [s]);
const before = (await out(s)).clock_out_at.toISOString();
await db.query(`select public.snow_correct_shift($1, now() - interval '8 hours', now() - interval '2 hours', 'longer than it looked')`, [s]);
check('7 an already-closed shift row is not rewritten (the correction row holds the new times)', (await out(s)).clock_out_at.toISOString() === before);
check('8 every correction is kept as a row', (await db.query(`select count(*)::int n from public.snow_shift_corrections where shift_id = $1`, [s])).rows[0].n === 1);

f = await fails(db, `select public.snow_correct_shift($1, now(), now() - interval '1 hour', 'x')`, [s]);
check('9 clock out before clock in is refused', f.raised && /before clock in/.test(f.msg), f.msg);
f = await fails(db, `select public.snow_correct_shift($1, now() - interval '3 hours', now(), '   ')`, [s]);
check('10 a reason is required', f.raised && /why/.test(f.msg), f.msg);
await db.exec(`select set_config('test.staff', 'no', false);`);
f = await fails(db, `select public.snow_correct_shift($1, now() - interval '3 hours', now(), 'x')`, [s]);
check('11 only owner/admin can correct (others get "Shift not found")', f.raised && /Shift not found/.test(f.msg), f.msg);

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
