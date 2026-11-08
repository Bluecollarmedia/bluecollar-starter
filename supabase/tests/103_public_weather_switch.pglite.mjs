// Update 103: the public Weather master switch. Real full schema on PGlite (not real Supabase).
// Proves: default OFF; signed-out may ask; nobody can touch the table directly; only the exact owner can change it; the answer reveals only
// on/off; and applying the update changes nothing about any existing policy, table privilege or function.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };

// ── Before/after snapshot: the full schema through update 102, then apply 103 and compare everything that already existed ──
{
  const { db: base, failures } = await buildFullSchema(repo, { upTo: 102 });
  check('0 the schema through update 102 loads', failures.length === 0, JSON.stringify(failures));
  const snap = async () => ({
    policies: (await base.query(`select schemaname, tablename, policyname, cmd, roles::text as roles, qual, with_check from pg_policies where tablename not like 'public_weather%' order by 1,2,3`)).rows,
    tableGrants: (await base.query(`select table_schema, table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name not like 'public_weather%' order by 1,2,3,4`)).rows,
    functions: (await base.query(`select p.proname, p.proacl::text as acl, md5(pg_get_functiondef(p.oid)) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname not in ('public_weather_config','set_public_weather_enabled') order by 1, 2`)).rows,
    rls: (await base.query(`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname not like 'public_weather%' order by 1`)).rows,
  });
  const before = await snap();
  await base.exec(fs.readFileSync(`${repo}/supabase/updates/103_public_weather_switch.sql`, 'utf8'));
  const after = await snap();
  check('1 applying 103 changes no existing policy', JSON.stringify(before.policies) === JSON.stringify(after.policies));
  check('2 applying 103 changes no existing table privilege', JSON.stringify(before.tableGrants) === JSON.stringify(after.tableGrants));
  check('3 applying 103 changes no existing function (definition or privileges)', JSON.stringify(before.functions) === JSON.stringify(after.functions));
  check('4 applying 103 changes no existing table\'s row security', JSON.stringify(before.rls) === JSON.stringify(after.rls));
  const newObjects = (await base.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname like 'public_weather%' order by 1`)).rows.map((r) => r.relname);
  check('5 the only new table is public_weather_settings', JSON.stringify(newObjects.filter((n) => !n.endsWith('_pkey'))) === JSON.stringify(['public_weather_settings']), JSON.stringify(newObjects));
}

// ── Behavior, on the full schema (103 is applied by the loader) ──
const { db, failures } = await buildFullSchema(repo);
check('6 the full schema and all updates (including 103) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/103_public_weather_switch.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('7 update 103 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asRole = async (role, u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u ?? ''}', false); set role ${role};`); };
const asDb = async () => { await db.exec('reset role'); };
const call = async (role, u, sql, p) => { await asRole(role, u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };

const co = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
const mk = async (email, name) => {
  await asDb();
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const owner = await mk('owner@x.test', 'Owner');
const admin = await mk('admin@x.test', 'Admin');
const worker = await mk('worker@x.test', 'Worker');
const customer = await mk('customer@x.test', 'Customer');
const invitedOwner = await mk('invited@x.test', 'Invited');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'owner','active','landscaping'),($1,$3,'admin','active','landscaping'),($1,$4,'worker','active','landscaping'),($1,$5,'customer','active',null),($1,$6,'owner','invited','landscaping')`,
  [co, owner.pid, admin.pid, worker.pid, customer.pid, invitedOwner.pid]);

const CONFIG = `select public.public_weather_config() as x`;
let r = await call('anon', null, CONFIG);
check('8 signed out: the default answer is OFF, as exactly {"enabled": false}', r.ok && JSON.stringify(r.v) === '{"enabled":false}', JSON.stringify(r));
r = await call('authenticated', worker.u, CONFIG);
check('9 signed in: the same question works and says OFF', r.ok && r.v.enabled === false);

for (const [who, role, u] of [['signed out', 'anon', null], ['owner', 'authenticated', owner.u], ['admin', 'authenticated', admin.u], ['worker', 'authenticated', worker.u], ['customer', 'authenticated', customer.u]]) {
  const sel = await call(role, u, `select count(*) as x from public.public_weather_settings`);
  const ins = await call(role, u, `insert into public.public_weather_settings (company_id, enabled) values ($1, true) returning company_id as x`, [co]);
  const upd = await call(role, u, `update public.public_weather_settings set enabled = true returning company_id as x`);
  const del = await call(role, u, `delete from public.public_weather_settings returning company_id as x`);
  check(`10 ${who} cannot read, insert, update or delete the table directly`, !sel.ok && !ins.ok && !upd.ok && !del.ok && /permission denied/i.test(sel.msg + ins.msg + upd.msg + del.msg), JSON.stringify({ sel, ins, upd, del }));
}

const SET = (on) => `select public.set_public_weather_enabled(${on}) as x`;
for (const [who, role, u] of [['signed-out caller', 'anon', null], ['worker', 'authenticated', worker.u], ['customer', 'authenticated', customer.u], ['ADMIN', 'authenticated', admin.u], ['owner whose membership is only invited', 'authenticated', invitedOwner.u]]) {
  r = await call(role, u, SET(true));
  check(`11 ${who} cannot turn Weather on`, !r.ok, JSON.stringify(r));
  if (role === 'authenticated') check(`11b ${who} gets the plain refusal`, /Only the owner can do that/.test(r.msg ?? ''), r.msg);
}
r = await call('authenticated', owner.u, SET('null::boolean'.replace('null::boolean', 'null')));
check('12 a null choice is refused', !r.ok && /Choose on or off/.test(r.msg), r.msg);
check('13 after all those refusals the table still has no row and the answer is still OFF', +(await one(`select count(*) from public.public_weather_settings`)).count === 0 && (await call('anon', null, CONFIG)).v.enabled === false);

r = await call('authenticated', owner.u, SET(true));
check('14 the owner can turn Weather ON', r.ok && r.v.enabled === true, JSON.stringify(r));
const row = await one(`select * from public.public_weather_settings`);
check('15 the row records the owner and a time', row.company_id === co && row.enabled === true && row.updated_by === owner.pid && !!row.updated_at);
r = await call('anon', null, CONFIG);
check('16 signed-out visitors now see ON', r.ok && r.v.enabled === true);
check('17 the answer has exactly one key, "enabled", and nothing else (no company, id, name or time)', Object.keys(r.v).join() === 'enabled' && typeof r.v.enabled === 'boolean', JSON.stringify(r.v));
r = await call('authenticated', owner.u, SET(false));
check('18 the owner can turn it OFF again, and everyone sees OFF', r.ok && (await call('anon', null, CONFIG)).v.enabled === false && +(await one(`select count(*) from public.public_weather_settings`)).count === 1);
await call('authenticated', owner.u, SET(true)); await call('authenticated', owner.u, SET(true));
check('19 turning it on twice keeps ONE row for the company (no duplicates)', +(await one(`select count(*) from public.public_weather_settings`)).count === 1);

// A second company row can only exist by a deliberate admin step; if it did, ONE "off" must win.
await db.exec(`set app.allow_company_create = 'on'`);
const co2 = (await one(`insert into public.companies (name) values ('Other') returning id`)).id;
const owner2 = await mk('owner2@x.test', 'Owner2');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'owner','active','landscaping')`, [co2, owner2.pid]);
await db.query(`insert into public.public_weather_settings (company_id, enabled) values ($1, false)`, [co2]);
check('20 if a second company ever existed and said OFF, the answer is OFF (fails safe)', (await call('anon', null, CONFIG)).v.enabled === false);
await db.query(`update public.public_weather_settings set enabled = true where company_id = $1`, [co2]);
check('20b with both companies ON the answer is ON', (await call('anon', null, CONFIG)).v.enabled === true);
// An owner of one company can only ever change their own company's row.
await call('authenticated', owner2.u, SET(false));
const rows = (await db.query(`select company_id, enabled from public.public_weather_settings order by company_id`)).rows;
check('21 an owner changes only their own company\'s row', rows.find((x) => x.company_id === co).enabled === true && rows.find((x) => x.company_id === co2).enabled === false);

console.log(results.every(Boolean) ? '\nall passed' : '\nsome failed');
process.exit(results.every(Boolean) ? 0 : 1);
