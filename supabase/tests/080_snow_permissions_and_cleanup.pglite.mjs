// Update 80: admins without the "invites" power can run the Snow Team again, snow writes follow the "snow access" power,
// granting ignores dead requests, deleting a company takes Snow-only people with it, and the old sign-in call is closed.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 80) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/080_snow_permissions_and_cleanup.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 80 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
const login = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  let pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id;
  if (!pid) pid = (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  else await db.query(`update public.people set first_name = $2 where id = $1`, [pid, name]);
  return { u, pid };
};

const co = (await one(`insert into public.companies (name) values ('Acme Snow') returning id`)).id;
const owner = await login('o@x.test', 'Owner');
const admin = await login('a@x.test', 'Admin');
const worker = await login('w@x.test', 'Worker');
const snowOnly = await login('s@x.test', 'SnowOnly');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active'),($1,$3,'admin','active'),($1,$4,'worker','active')`,
  [co, owner.pid, admin.pid, worker.pid]);
// A Snow-only person: snow access, no company membership (the pre-78 shape).
await db.query(`insert into public.snow_staff (company_id, person_id, status, granted_at) values ($1,$2,'active',now())`, [co, snowOnly.pid]);
await db.query(`insert into public.snow_staff_services (company_id, person_id, service) values ($1,$2,'plowing')`, [co, snowOnly.pid]);

// ── 1. the Snow Team works for an admin even when the owner kept the invites power to themself ──
await db.query(`insert into public.company_admin_permissions (company_id, invites, snow_access, team) values ($1, false, true, true)
  on conflict (company_id) do update set invites = false, snow_access = true, team = true`, [co]);
let r = await rpc(admin.u, `select public.list_snow_members() as x`);
check('1 an admin WITHOUT the invites power can open the Snow Team list', r.ok && Array.isArray(r.v) && r.v.length === 1, r.msg);
r = await rpc(admin.u, `select public.team_access_overview() as x`);
check('1b and the Team Access screen', r.ok && Array.isArray(r.v) && r.v.length >= 4, r.msg);
r = await rpc(admin.u, `select public.snow_grant_access($1::uuid, array['plowing','salting']) as x`, [worker.pid]);
check('1c and can grant snow access (the snow-access power is on)', r.ok, r.msg);
r = await rpc(admin.u, `select public.set_snow_member_services($1::uuid, array['shoveling']) as x`, [worker.pid]);
check('1d and change services', r.ok, r.msg);

// ── 2. the snow-access power still protects writes ──
await db.query(`update public.company_admin_permissions set snow_access = false where company_id = $1`, [co]);
check('2 with the snow-access power off, an admin cannot grant, change or remove snow access (but still sees the list)',
  !(await rpc(admin.u, `select public.snow_grant_access($1::uuid, array['plowing']) as x`, [worker.pid])).ok
  && !(await rpc(admin.u, `select public.set_snow_member_services($1::uuid, array['plowing']) as x`, [worker.pid])).ok
  && !(await rpc(admin.u, `select public.revoke_snow_access($1::uuid) as x`, [worker.pid])).ok
  && (await rpc(admin.u, `select public.list_snow_members() as x`)).ok);
check('2b the owner is never blocked by the admin switches',
  (await rpc(owner.u, `select public.set_snow_member_services($1::uuid, array['plowing']) as x`, [worker.pid])).ok
  && (await rpc(owner.u, `select public.revoke_snow_access($1::uuid) as x`, [worker.pid])).ok);
check('2c a worker can do none of it', !(await rpc(worker.u, `select public.list_snow_members() as x`)).ok);

// ── 3. dead requests no longer open the door ──
const stranger = await login('x@x.test', 'Stranger');
await db.exec(`set session_replication_role = replica`);
await db.query(`insert into public.snow_access_requests (company_id, person_id, status) values ($1,$2,'pending')`, [co, stranger.pid]);
await db.exec(`set session_replication_role = origin`);
r = await rpc(owner.u, `select public.snow_grant_access($1::uuid, array['plowing']) as x`, [stranger.pid]);
check('3 a leftover pending request is no longer a reason to grant snow access', !r.ok && /isn't on your team/.test(r.msg), r.msg);

// ── 4. the old sign-in call is closed; the new one works ──
check('4 get_my_snow_status can no longer be called from the app',
  (await one(`select has_function_privilege('authenticated', 'public.get_my_snow_status()', 'execute') as e`)).e === false);
r = await rpc(snowOnly.u, `select public.get_my_snow_access() as x`);
check('4b a Snow-only worker still finds their company through get_my_snow_access', r.ok && r.v.length === 1 && r.v[0].company_id === co && r.v[0].services.includes('plowing'), r.msg);

// ── 5. anon and internal helpers ──
check('5 signed-out callers cannot run the snow team functions',
  (await one(`select has_function_privilege('anon', 'public.list_snow_members()', 'execute') as e`)).e === false
  && (await one(`select has_function_privilege('anon', 'public.snow_grant_access(uuid, text[])', 'execute') as e`)).e === false);
check('5b internal helpers are closed to the app',
  (await one(`select has_function_privilege('authenticated', 'public.snow_revoke_access(uuid)', 'execute') as e`)).e === false
  && (await one(`select has_function_privilege('authenticated', 'public._my_staff_company()', 'execute') as e`)).e === false);
const anonOpen = await one(`select count(*)::int c from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('snow_create_storm','snow_dispatch_storm','snow_end_storm','snow_arrive_visit','snow_complete_visit','snow_my_routes')
    and has_function_privilege('anon', p.oid, 'execute')`);
const authOpen = await one(`select count(*)::int c from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('snow_create_storm','snow_dispatch_storm','snow_end_storm','snow_arrive_visit','snow_complete_visit','snow_my_routes')
    and has_function_privilege('authenticated', p.oid, 'execute')`);
check('5c storm and visit functions are closed to anon but open to the app', anonOpen.c === 0 && authOpen.c >= 6, JSON.stringify({ anonOpen, authOpen }));

// ── 6. deleting the company takes the Snow-only person with it ──
await db.query(`update public.company_admin_permissions set snow_access = true where company_id = $1`, [co]);
r = await rpc(owner.u, `select public.delete_my_company('Acme Snow') as x`);
check('6 the owner deletes the company', r.ok, r.msg);
check('6b the Snow-only person\'s account went with it (no login left opening onto "Finish setting up")',
  (await one(`select count(*)::int c from public.people where id = $1`, [snowOnly.pid])).c === 0);
check('6c their files are on the cleanup list', (await one(`select count(*)::int c from public.storage_cleanup_queue where file_key like '%' || $1 || '%'`, [snowOnly.pid])).c >= 1);

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
