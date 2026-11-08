// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && copy this file there && node <file> <path to the repo>
// Proves update 46 (completion upload delete rule) and 47 (optional shared secret on the notification call).
// REAL SQL: both update files, and the 031 dispatch function it replaces. Stand-ins: storage.objects with the
// real delete policy applied, visits / completion media tables, role helpers, net.http_post (records the headers).
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const repo = process.argv[2];
const read = (p) => fs.readFileSync(`${repo}/${p}`, 'utf8');
const f046 = read('supabase/updates/046_snow_completion_upload_delete.sql');
const f047 = read('supabase/updates/047_snow_notify_shared_secret.sql');

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + String(detail).slice(0, 200)}`); };

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated;
create schema storage; create schema net;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select coalesce((string_to_array(name, '/'))[1:greatest(coalesce(array_length(string_to_array(name, '/'), 1), 1) - 1, 0)], '{}') $$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated; grant select, delete on storage.objects to authenticated;
create function public._try_uuid(t text) returns uuid language plpgsql immutable as $$ begin return t::uuid; exception when others then return null; end $$;
create function public.is_staff(cid uuid) returns boolean language sql stable as $$ select current_setting('test.role', true) = 'staff' $$;
create function public.snow_leads_dispatched_route(rid uuid) returns boolean language sql stable as $$ select current_setting('test.role', true) = 'lead' $$;
create table public.snow_visits (id uuid primary key, company_id uuid, route_id uuid, status text);
create table public.snow_completion_media (id uuid primary key default gen_random_uuid(), file_key text);
grant select on public.snow_visits, public.snow_completion_media to authenticated;
create policy tmp_read on storage.objects for select to authenticated using (true);
`);
await db.exec(f046);
let again = false; try { await db.exec(f046); again = true; } catch {}
check('1 046 can be run twice', again);

const co = '11111111-1111-1111-1111-111111111111', v1 = '22222222-2222-2222-2222-222222222222', rt = '33333333-3333-3333-3333-333333333333';
await db.query(`insert into public.snow_visits values ($1,$2,$3,'arrived')`, [v1, co, rt]);
const key = (n) => `${co}/completion/${v1}/${n}.jpg`;
const addObj = async (n) => { await db.query(`insert into storage.objects (bucket_id, name) values ('snow-media', $1)`, [key(n)]); };
const exists = async (n) => (await db.query(`select count(*)::int c from storage.objects where name = $1`, [key(n)])).rows[0].c === 1;
const delAs = async (role, n) => { await db.exec(`set role authenticated; select set_config('test.role','${role}',false);`); await db.query(`delete from storage.objects where name = $1`, [key(n)]); await db.exec(`reset role;`); };

await addObj('a'); await delAs('lead', 'a');
check('2 the crew lead can delete an upload that was never saved', !(await exists('a')));
await addObj('b'); await delAs('staff', 'b');
check('3 owner/admin can delete an unsaved upload', !(await exists('b')));
await addObj('c'); await delAs('crew', 'c');
check('4 anyone else (crew member, customer) cannot delete it', await exists('c'));
await db.query(`insert into public.snow_completion_media (file_key) values ($1)`, [key('c')]);
await delAs('lead', 'c'); await delAs('staff', 'c');
check('5 a SAVED completion photo can never be deleted this way, even by the owner', await exists('c'));
await addObj('d'); await db.query(`update public.snow_visits set status = 'completed' where id = $1`, [v1]); await delAs('lead', 'd');
check('6 once the stop is finished the lead can no longer delete files (owner still can)', await exists('d'));
await delAs('staff', 'd');
check('7 ...owner/admin can still clean it up', !(await exists('d')));
await db.query(`insert into storage.objects (bucket_id, name) values ('snow-media', $1)`, [`${co}/reference/x.jpg`]);
await db.exec(`set role authenticated; select set_config('test.role','lead',false);`);
await db.query(`delete from storage.objects where name = $1`, [`${co}/reference/x.jpg`]);
await db.exec(`reset role;`);
check('8 the rule does not touch other folders (reference files are not deleted by it)', (await db.query(`select count(*)::int c from storage.objects where name like '%/reference/x.jpg'`)).rows[0].c === 1);

// 047
await db.exec(`
create table public.app_settings (key text primary key, value text not null);
create table public.snow_notification_deliveries (notification_id uuid, status text, detail text, attempted_at timestamptz);
create table public.calls (url text, headers jsonb);
create function net.http_post(url text, body jsonb, headers jsonb) returns bigint language plpgsql as $$ begin insert into public.calls values (url, headers); return 1; end $$;
insert into public.app_settings values ('functions_url', 'https://x.test/functions/v1');
`);
await db.exec(f047);
let again2 = false; try { await db.exec(f047); again2 = true; } catch {}
check('9 047 can be run twice', again2);
const nid = '44444444-4444-4444-4444-444444444444';
const pend = () => db.query(`delete from public.snow_notification_deliveries; insert into public.snow_notification_deliveries (notification_id, status) values ($1, 'pending')`, [nid]).catch(async () => { await db.exec(`delete from public.snow_notification_deliveries`); await db.query(`insert into public.snow_notification_deliveries (notification_id, status) values ($1, 'pending')`, [nid]); });
await pend();
await db.query(`select public._snow_dispatch_notification($1)`, [nid]);
let h = (await db.query(`select headers from public.calls order by ctid desc limit 1`)).rows[0].headers;
check('10 with no secret set the call is exactly as before (no secret header)', h['x-snow-secret'] === undefined && h['Content-Type'] === 'application/json', JSON.stringify(h));
await db.query(`insert into public.app_settings values ('snow_notify_secret', 'abc123')`);
await db.query(`select public._snow_dispatch_notification($1)`, [nid]);
h = (await db.query(`select headers from public.calls order by ctid desc limit 1`)).rows[0].headers;
check('11 with a secret stored, the call carries it as x-snow-secret', h['x-snow-secret'] === 'abc123', JSON.stringify(h));
await db.query(`delete from public.app_settings where key = 'functions_url'`);
await db.query(`select public._snow_dispatch_notification($1)`, [nid]);
check('12 if the sender is not set up, the notice is marked unavailable (never blocks)', (await db.query(`select status from public.snow_notification_deliveries where notification_id = $1`, [nid])).rows[0].status === 'unavailable');

const bad = results.filter((r) => !r).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
