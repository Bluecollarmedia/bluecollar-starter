// Update 85: the old code / request functions are gone; everything that is live still works (invite links, adding people, customers,
// Snow access, company creation); the update can be run twice.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 85) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/085_drop_old_code_functions.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 85 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const exists = async (name) => !!(await one(`select 1 x from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public' where p.proname = $1`, [name]));
const gone = ['approve_join_request', 'decline_join_request', 'request_join', 'join_with_code', '_request_join', '_join_requests_guard', '_guard_requested_worker_type',
  'lookup_any_code', 'lookup_team_code', 'lookup_project_code', 'lookup_snow_code', 'claim_project', '_claim_project', '_claim_maintenance',
  'regenerate_project_code', 'regenerate_maintenance_code', '_new_customer_code', '_maintenance_property_code',
  'regenerate_snow_signup_code', 'disable_snow_signup_code', 'request_snow_access', '_request_snow_access', 'approve_snow_access_request',
  'decline_snow_access_request', 'remove_snow_access_request', 'list_snow_access_requests', 'withdraw_my_snow_request', 'handle_new_user_snow'];
const stillThere = [];
for (const n of gone) if (await exists(n)) stillThere.push(n);
check('1 all 28 old code / request functions are gone', stillThere.length === 0, stillThere.join(', '));

const live = ['invite_send', 'invite_lookup', 'invite_accept', 'invite_revoke', 'add_worker', 'add_customer', 'handle_new_user', '_create_company', 'snow_grant_access',
  'revoke_snow_access', 'set_snow_member_services', 'deactivate_member', 'reactivate_member', 'get_my_context', 'list_accounts', 'delete_account', 'delete_my_company',
  'company_closure_preview', 'set_customer_portal_access', 'send_customer_announcement', 'ensure_property', 'snow_enable_for_property', '_random_code'];
const missing = [];
for (const n of live) if (!(await exists(n))) missing.push(n);
check('2 every live function is still there (nothing needed was dropped)', missing.length === 0, missing.join(', '));

const trg = await one(`select count(*)::int c from pg_trigger t where not t.tgisinternal and t.tgname in ('maintenance_properties_code', 'join_requests_guard', 'join_requests_guard_worker_type')`);
check('3 the old triggers are gone', trg.c === 0, String(trg.c));
const dangling = await one(`select count(*)::int c from pg_trigger t left join pg_proc p on p.oid = t.tgfoid where not t.tgisinternal and p.oid is null`);
check('4 no trigger points at a missing function', dangling.c === 0, String(dangling.c));

// Live things still work after the drop
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
const login = async (email, name) => {
  const u = (await one(`insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`, [email, JSON.stringify({ first_name: name, last_name: 'T', company_name: name === 'Owner' ? 'Acme' : '' })])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u])).id;
  return { u, pid };
};
const owner = await login('o@x.test', 'Owner');
check('5 starting a company at sign-up still works (the owner becomes owner)', !!(await one(`select 1 x from public.company_members where person_id = $1 and role = 'owner' and status = 'active'`, [owner.pid])));
const w = await rpc(owner.u, `select public.add_worker('Gab', 'Riv', '(732) 555-0142') as x`);
check('6 adding a worker still makes a private link', w.ok && typeof w.v.token === 'string');
const c = await rpc(owner.u, `select public.add_customer('Cathy', 'Client', 'c@x.test', '7325550404') as x`);
check('7 adding a customer still works', c.ok && !!c.v.person_id);
const ctx = await rpc(owner.u, `select public.get_my_context() as x`);
check('8 the sign-in context still loads', ctx.ok && ctx.v != null);
const acc = await rpc(owner.u, `select jsonb_array_length(public.team_access_overview()) as x`);
check('9 the Team Access list still loads and shows the owner', acc.ok && acc.v >= 1, JSON.stringify(acc));
const mp = await db.query(`insert into public.maintenance_properties (company_id, name, is_active) select company_id, 'Elm', true from public.company_members where person_id = $1 and role = 'owner' returning id`, [owner.pid]).then((r) => r.rows[0]).catch((e) => ({ err: e.message }));
check('10 a maintenance property can be added without the old code trigger', !!mp?.id, JSON.stringify(mp));
console.log(results.every(Boolean) ? '\nall passed' : '\nsome failed');
process.exit(results.every(Boolean) ? 0 : 1);
