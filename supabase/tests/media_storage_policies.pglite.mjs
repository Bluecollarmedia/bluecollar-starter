// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && copy this file there && node <file> <path to the repo>
// Proves WHO the database lets upload photos, using the REAL storage rules from the repo:
//   public "media" bucket (schema.sql): any signed-in person may upload; only the uploader may delete; nobody signed out.
//   private "snow-media" completion photos (026 + 032): the stop's crew lead may upload while the stop is pending/arrived;
//   owner/admin may upload once it is completed; a crew member or a stranger may never.
// Stand-ins: storage.objects, role helpers, the visits table. NOT real Supabase Storage (no bucket creation, size or type limits).
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const repo = process.argv[2];
const read = (p) => fs.readFileSync(`${repo}/${p}`, 'utf8');
const schema = read('supabase/schema.sql');
const f026 = read('supabase/updates/026_snow_lead_execution.sql');
const f032 = read('supabase/updates/032_snow_owner_media.sql');
const grab = (t, m) => { const a = t.indexOf(m); const b = t.indexOf(');', a); return t.slice(a, b + 2); };

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + String(detail).slice(0, 200)}`); };

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid default auth.uid());
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select coalesce((string_to_array(name, '/'))[1:greatest(coalesce(array_length(string_to_array(name, '/'), 1), 1) - 1, 0)], '{}') $$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, anon; grant usage on schema auth to authenticated, anon;
grant select, insert, delete on storage.objects to authenticated; grant select on storage.objects to anon;
create function public._try_uuid(t text) returns uuid language plpgsql immutable as $$ begin return t::uuid; exception when others then return null; end $$;
create function public.is_staff(cid uuid) returns boolean language sql stable as $$ select current_setting('test.role', true) = 'staff' $$;
create function public.snow_leads_dispatched_route(rid uuid) returns boolean language sql stable as $$ select current_setting('test.role', true) = 'lead' $$;
create table public.snow_visits (id uuid primary key, company_id uuid, route_id uuid, status text);
grant select on public.snow_visits to authenticated;
`);
await db.exec(`insert into storage.buckets (id, name, public) values ('media', 'media', true) on conflict (id) do nothing;`);
for (const m of ['create policy media_public_read on storage.objects', 'create policy media_authenticated_upload on storage.objects', 'create policy media_owner_delete on storage.objects']) {
  await db.exec(grab(schema, m));
}
await db.exec(grab(f026, 'create policy snow_media_completion_upload on storage.objects'));
await db.exec(grab(f032, 'create policy snow_media_completion_staff_upload on storage.objects'));

const U1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', U2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const co = '11111111-1111-1111-1111-111111111111', v1 = '22222222-2222-2222-2222-222222222222', rt = '33333333-3333-3333-3333-333333333333';
await db.query(`insert into public.snow_visits values ($1,$2,$3,'arrived')`, [v1, co, rt]);

const asRole = async (role, uid, role2) => { await db.exec(`reset role; select set_config('test.uid','${uid ?? ''}',false); select set_config('test.role','${role2 ?? ''}',false); set role ${role};`); };
const tryInsert = async (bucket, name) => { try { await db.query(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [bucket, name]); return true; } catch { return false; } };
const exists = async (name) => { await db.exec('reset role'); return (await db.query(`select count(*)::int c from storage.objects where name = $1`, [name])).rows[0].c === 1; };

// public media bucket
await asRole('authenticated', U1);
check('1 media: a signed-in person can upload a profile / project / maintenance / issue photo', await tryInsert('media', `avatars/${U1}/a.jpg`) && await tryInsert('media', `${co}/projects/p/b.jpg`));
await asRole('anon', '');
check('2 media: a signed-OUT request is refused (this is the "new row violates row-level security" error)', !(await tryInsert('media', 'avatars/x/a.jpg')));
check('3 media: anyone can read (public bucket links open in the app)', (await db.query(`select count(*)::int c from storage.objects where bucket_id = 'media'`)).rows[0].c === 2);
await asRole('authenticated', U2);
await db.query(`delete from storage.objects where name = $1`, [`avatars/${U1}/a.jpg`]);
check('4 media: someone else cannot delete my photo', await exists(`avatars/${U1}/a.jpg`));
await asRole('authenticated', U1);
await db.query(`delete from storage.objects where name = $1`, [`avatars/${U1}/a.jpg`]);
check('5 media: the uploader can delete their own photo', !(await exists(`avatars/${U1}/a.jpg`)));
await asRole('authenticated', U1);
check('6 media: an upload to a bucket that does not exist in the rules is refused', !(await tryInsert('no-such-bucket', 'x.jpg')));

// snow completion photos
const key = (n) => `${co}/completion/${v1}/${n}.jpg`;
await asRole('authenticated', U1, 'lead');
check('7 snow: the stop\'s crew lead can upload while the stop is "arrived"', await tryInsert('snow-media', key('a')));
await asRole('authenticated', U1, 'crew');
check('8 snow: a crew member (not the lead) is refused', !(await tryInsert('snow-media', key('b'))));
await asRole('authenticated', U1, 'stranger');
check('9 snow: a stranger is refused', !(await tryInsert('snow-media', key('c'))));
await db.exec(`reset role; update public.snow_visits set status = 'completed' where id = '${v1}'`);
await asRole('authenticated', U1, 'lead');
check('10 snow: after the stop is finished the lead can no longer add photos (add them BEFORE tapping Finish)', !(await tryInsert('snow-media', key('d'))));
await asRole('authenticated', U1, 'staff');
check('11 snow: owner/admin can add photos to a finished stop', await tryInsert('snow-media', key('e')));
await db.exec(`reset role; update public.snow_visits set status = 'pending' where id = '${v1}'`);
await asRole('authenticated', U1, 'staff');
check('12 snow: owner/admin cannot add to an unfinished stop (only the lead can)', !(await tryInsert('snow-media', key('f'))));

const bad = results.filter((r) => !r).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
