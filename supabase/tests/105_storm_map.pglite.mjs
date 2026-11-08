// Update 105: a storm map on each update. Real full schema on PGlite (not real Supabase).
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';
const repo = process.argv[2];
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
const { db, failures } = await buildFullSchema(repo);
check('0 the full schema including 104 and 105 loads', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/105_storm_map.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('1 update 105 can be run a second time', again);
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asRole = async (role, u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u ?? ''}', false); set role ${role};`); };
const call = async (role, u, sql, p) => { await asRole(role, u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: e.message }; } };
const co = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
const u = (await one(`insert into auth.users (email) values ('o@x.test') returning id`)).id;
const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1,'o@x.test','O','T') returning id`, [u])).id;
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'owner','active','landscaping')`, [co, pid]);
const pub = (id, map) => call('authenticated', u,
  `select public.publish_storm_outlook($1,'S','Head','Msg',null,3,6,null,null,'Dis',null,null,false${map === undefined ? '' : ',$2'}) as x`, map === undefined ? [id] : [id, map]);
let r = await pub(null, 'https://cdn.example.com/a/map.png');
const oid = r.v?.outlook_id;
check('2 the owner publishes with an https map', r.ok && !!oid, r.msg);
r = await call('authenticated', u, `select public.owner_storm_current() as x`);
check('3 the map comes back with the latest update', r.ok && r.v?.latest?.map_url === 'https://cdn.example.com/a/map.png', JSON.stringify(r.v));
r = await pub(oid);
check('4 an update without a map still works (map is optional)', r.ok && r.v?.version_no === 2, r.msg);
r = await call('authenticated', u, `select public.owner_storm_current() as x`);
check('5 that update has no map', r.v?.latest?.map_url === null || r.v?.latest?.map_url === undefined, JSON.stringify(r.v?.latest));
r = await pub(oid, 'http://insecure.example.com/m.png');
check('6 a non-https map link is refused', !r.ok && /map link/.test(r.msg ?? ''), r.msg);
r = await pub(oid, 'https://' + 'x'.repeat(700));
check('7 a very long map link is refused', !r.ok, r.msg);
await db.exec('reset role');
let locked = false;
try { await db.query(`update public.storm_outlook_versions set map_url = 'https://evil.example.com/x.png'`); } catch { locked = true; }
check('8 a published map cannot be changed afterward', locked);
const fnCount = (await one(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='publish_storm_outlook'`)).n;
check('9 only one publish function exists (no clash)', fnCount === 1, fnCount);
console.log(results.every(Boolean) ? 'all passed' : 'FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
