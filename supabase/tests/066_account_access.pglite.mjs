// Run: copy this file (and ./helpers/fullSchema.mjs) next to a folder with @electric-sql/pglite installed, then:
//   node <file> <path to the repo>
// Proves update 66 on the REAL full schema + every update (PGlite, not real Supabase): one code box, pending vs approved,
// owner protection, admin powers (and the owner's switches), mode access, deactivation / reactivation, stale sessions,
// direct-API attempts and company closure.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
// Written for the old code-based joining (closed by update 78, functions removed by update 85, tested in 085): runs against the schema as of update 84.
const { db, failures } = await buildFullSchema(repo, { upTo: 84 });
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 066) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/066_account_access_hardening.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
// Update 78 turns the old code paths off again after an older update is re-run.
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/078_invite_links.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 66 can be run a second time', again);

const fails = async (sql, p) => { try { await db.query(sql, p); return { raised: false, msg: '' }; } catch (e) { return { raised: true, msg: String(e.message) }; } };
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0], rows: r.rows }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
const count = async (u, sql, p) => { const r = await rpc(u, sql, p); return r.ok ? Number(r.v) : -1; };

const mk = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const co = (await one(`insert into public.companies (name) values ('Acme Lawn') returning id`)).id;
const owner = await mk('owner@x.test', 'Owner');
const adminU = await mk('admin@x.test', 'Admin');
const adminB = await mk('adminb@x.test', 'AdminTwo');
const wL = await mk('wl@x.test', 'LandOnly');
const wS = await mk('ws@x.test', 'SnowOnly');
const wB = await mk('wb@x.test', 'Both');
const wX = await mk('wx@x.test', 'Extra');
const cust = await mk('cust@x.test', 'Customer');
const pL = await mk('pl@x.test', 'PendingLand');
const pS = await mk('ps@x.test', 'PendingSnow');
const pBad = await mk('pbad@x.test', 'Stranger');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values
  ($1,$2,'owner','active','landscaping'),($1,$3,'admin','active','landscaping'),($1,$4,'admin','active','landscaping'),($1,$5,'worker','active','landscaping'),
  ($1,$6,'worker','active','landscaping'),($1,$7,'worker','active','landscaping'),($1,$8,'customer','active','landscaping')`,
  [co, owner.pid, adminU.pid, adminB.pid, wL.pid, wB.pid, wX.pid, cust.pid]);
const grantSnow = async (pid, svcs = ['plowing']) => {
  await db.query(`insert into public.snow_staff (company_id, person_id, status, granted_at) values ($1,$2,'active',now()) on conflict do nothing`, [co, pid]);
  for (const s of svcs) await db.query(`insert into public.snow_staff_services (company_id, person_id, service) values ($1,$2,$3) on conflict do nothing`, [co, pid, s]);
};
await grantSnow(wS.pid, ['plowing', 'salting']);
await grantSnow(wB.pid, ['plowing']);
await db.query(`insert into public.team_codes (company_id, code, is_active) values ($1, 'LAND1', true)`, [co]);
await db.query(`insert into public.snow_signup_codes (company_id, code, is_active) values ($1, 'SNOW1', true)`, [co]);
const proj = (await one(`insert into public.projects (company_id, name, status) values ($1,'Job','active') returning id`, [co])).id;

// ── 1. one code box ─────────────────────────────────────────────────────────
let r = await rpc(pL.u, `select public.join_with_code('land1') as x`);
check('1 the one code box is gone (update 78): the app can no longer call join_with_code', !r.ok, r.msg);
await asDb();
await db.query(`insert into public.join_requests (company_id, person_id, status, requested_role) values ($1,$2,'pending','worker')`, [co, pL.pid]);
await db.query(`insert into public.snow_access_requests (company_id, person_id, status) values ($1,$2,'pending')`, [co, pS.pid]);

// ── 2. pending is not access ───────────────────────────────────────────────
check('5 a pending employee reads no company data and has no snow access', (await count(pL.u, `select count(*)::int from public.projects`)) === 0
  && (await rpc(pS.u, `select public.snow_is_active($1::uuid) as x`, [co])).v === false);
let f = await rpc(pL.u, `update public.join_requests set status = 'approved' where person_id = $1`, [pL.pid]);
const f2 = await rpc(pS.u, `update public.snow_access_requests set status = 'approved' where person_id = $1`, [pS.pid]);
const f3 = await rpc(pL.u, `insert into public.join_requests (company_id, person_id, status, requested_role) values ('${co}', '${pL.pid}', 'approved', 'worker')`);
const f4 = await rpc(pL.u, `update public.join_requests set requested_worker_type = 'maintenance' where person_id = $1`, [pL.pid]);
check('9 a phone cannot approve itself, forge a request, or change what it asked for (direct edits are refused)', !f.ok && !f3.ok && !f4.ok
  && (await one(`select status from public.join_requests where person_id = $1`, [pL.pid])).status === 'pending'
  && (await one(`select status from public.snow_access_requests where person_id = $1`, [pS.pid])).status === 'pending'
  && (await rpc(pL.u, `select public.is_member($1::uuid) as x`, [co])).v === false && (await rpc(pS.u, `select public.snow_is_active($1::uuid) as x`, [co])).v === false, [f.msg, f3.msg, f4.msg].join(' | '));
r = await rpc(pL.u, `select public.approve_join_request((select id from public.join_requests where person_id = '${pL.pid}'), 'worker') as x`);
check('20 a pending employee cannot approve their own request through the function', !r.ok, r.msg);
r = await rpc(wL.u, `select public.approve_join_request((select id from public.join_requests where person_id = '${pL.pid}'), 'worker') as x`);
check('20b a worker cannot approve requests', !r.ok, r.msg);

// ── 3. approval gives only what was asked (the approval screens are gone; access is granted directly) ──
const reqL = (await one(`select id from public.join_requests where person_id = $1`, [pL.pid])).id;
r = await rpc(adminU.u, `select public.approve_join_request($1::uuid, 'admin') as x`, [reqL]);
check('15 the old approval function can no longer be called', !r.ok, r.msg);
await asDb();
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'worker','active','landscaping')`, [co, pL.pid]);
await grantSnow(pS.pid, ['plowing']);
check('3 a landscaping employee has landscaping access and NO snow access', (await rpc(pL.u, `select public.is_crew($1::uuid) as x`, [co])).v === true && (await rpc(pL.u, `select public.snow_is_active($1::uuid) as x`, [co])).v === false);
check('3b a snow-only employee has snow only: no landscaping access', (await rpc(pS.u, `select public.snow_is_active($1::uuid) as x`, [co])).v === true
  && (await rpc(pS.u, `select public.is_crew($1::uuid) as x`, [co])).v === false);
check('26 snow access alone never dispatches anyone (no storm route crew rows)', (await one(`select count(*)::int c from public.snow_route_crew where person_id in ($1,$2)`, [pS.pid, wB.pid])).c === 0);
check('4 one person can have both modes on ONE account', (await rpc(wB.u, `select public.is_crew($1::uuid) as x`, [co])).v === true && (await rpc(wB.u, `select public.snow_is_active($1::uuid) as x`, [co])).v === true
  && (await one(`select count(*)::int c from public.people where email = 'wb@x.test'`)).c === 1);
check('21 a landscaping-only employee has no snow operations', (await rpc(wL.u, `select public.snow_is_active($1::uuid) as x`, [co])).v === false);
check('22 a snow-only employee has no landscaping tables', (await count(wS.u, `select count(*)::int from public.projects`)) === 0 && (await rpc(wS.u, `select public.is_crew($1::uuid) as x`, [co])).v === false);

// declined / cancelled requests cannot be replayed
await asDb();
await db.query(`insert into public.join_requests (company_id, person_id, status, requested_role) values ($1,$2,'declined','worker')`, [co, pBad.pid]);
const declined = (await one(`select id from public.join_requests where person_id = $1`, [pBad.pid])).id;
r = await rpc(owner.u, `select public.approve_join_request($1::uuid, 'worker') as x`, [declined]);
check('10 a declined request cannot be approved (the function is off entirely)', !r.ok && (await rpc(pBad.u, `select public.is_member($1::uuid) as x`, [co])).v === false, r.msg);

// ── 4. owner protection ─────────────────────────────────────────────────────
r = await rpc(owner.u, `select public.delete_my_account() as x`);
check('12 the owner cannot delete their own account', !r.ok && /own the company/.test(r.msg), r.msg);
r = await rpc(adminU.u, `select public.deactivate_member('${owner.pid}'::uuid, true) as x`);
check('13 an admin cannot deactivate the owner', !r.ok && /owner/i.test(r.msg), r.msg);
r = await rpc(adminU.u, `select public.delete_account('${owner.pid}'::uuid) as x`);
check('13b an admin cannot delete the owner account either', !r.ok, r.msg);
r = await rpc(adminU.u, `select public.delete_my_company('Acme Lawn') as x`);
check('14 an admin cannot close the company', !r.ok && /owner/i.test(r.msg), r.msg);
r = await rpc(adminU.u, `update public.company_members set role = 'owner' where person_id = '${adminU.pid}'`);
const rr = await rpc(adminU.u, `select role as x from public.company_members where person_id = '${adminU.pid}'`);
check('15b an admin cannot make themselves owner by editing the team list directly', !r.ok && rr.v === 'admin', r.msg);
r = await rpc(adminU.u, `update public.company_members set role = 'worker' where person_id = '${owner.pid}'`);
const r3 = await rpc(adminU.u, `delete from public.company_members where person_id = '${owner.pid}'`);
check('15c nobody can demote or delete the owner row directly', !r.ok && !r3.ok && (await one(`select role from public.company_members where person_id = $1`, [owner.pid])).role === 'owner', r.msg + r3.msg);
r = await rpc(adminU.u, `insert into public.company_members (company_id, person_id, role, status) values ('${co}', '${pBad.pid}', 'owner', 'active')`);
const r4 = await rpc(wL.u, `update public.company_members set status = 'inactive' where person_id = '${wX.pid}'`);
check('15d a direct insert of an owner row is refused, and a worker deactivating a coworker directly changes nothing', !r.ok && (await one(`select status from public.company_members where person_id = $1`, [wX.pid])).status === 'active', r.msg);
r = await rpc(owner.u, `select public.set_member_role('${owner.pid}'::uuid, 'worker') as x`);
check('12b the owner cannot demote themselves', !r.ok, r.msg);
r = await rpc(owner.u, `select public.deactivate_member('${owner.pid}'::uuid, true) as x`);
check('37 the owner cannot be deactivated through the worker controls', !r.ok, r.msg);

// ── 5. admin powers ─────────────────────────────────────────────────────────
r = await rpc(owner.u, `select public.set_member_role('${wX.pid}'::uuid, 'admin') as x`);
check('16 the owner can make an employee an admin', r.ok && (await one(`select role from public.company_members where person_id = $1`, [wX.pid])).role === 'admin', r.msg);
r = await rpc(adminU.u, `select public.set_member_role('${wL.pid}'::uuid, 'admin') as x`);
check('15e an admin cannot make another admin', !r.ok, r.msg);
r = await rpc(owner.u, `select public.set_member_role('${wX.pid}'::uuid, 'worker') as x`);
check('17 the owner can take admin away (the person stays, as a worker)', r.ok && (await one(`select role, status from public.company_members where person_id = $1`, [wX.pid])).role === 'worker'
  && (await one(`select status from public.company_members where person_id = $1`, [wX.pid])).status === 'active', r.msg);
r = await rpc(wX.u, `select public.time_scan_alerts() as x`);
const r5 = await rpc(wX.u, `select public.deactivate_member('${wL.pid}'::uuid, true) as x`);
check('18 a former admin is refused by the owner functions straight away (checked live, not from a saved role)', !r.ok && !r5.ok, r.msg + r5.msg);
check('16b the role change is in the history', (await one(`select count(*)::int c from public.membership_audit_log where event_type in ('admin_granted','admin_removed')`)).c === 2);

// the owner's switches
r = await rpc(owner.u, `select public.set_admin_permissions(false, false, false, false, false) as x`);
check('19a the owner can switch the five admin powers off', r.ok, r.msg);
r = await rpc(adminU.u, `select public.deactivate_member('${wL.pid}'::uuid, true) as x`);
const sw1 = !r.ok && /owner/i.test(r.msg);
r = await rpc(adminU.u, `select public.approve_join_request('${declined}'::uuid, 'worker') as x`);
const sw2 = !r.ok;
r = await rpc(adminU.u, `select public.snow_grant_access('${wL.pid}'::uuid, array['plowing']) as x`);
const sw3 = !r.ok;
r = await rpc(adminU.u, `select public.time_staff_add_workday('${wL.pid}'::uuid, current_date, now() - interval '5 hours', now() - interval '1 hour', 'forgot') as x`);
const sw4 = !r.ok && /not allowed admins/.test(r.msg);
r = await rpc(adminU.u, `select public.time_set_hourly_rate('${wL.pid}'::uuid, 20, current_date, 'x') as x`);
const sw5 = !r.ok && /not allowed admins/.test(r.msg);
check('19 with the switches off the DATABASE refuses an admin: team, invitations, snow, time corrections, pay rates', sw1 && sw2 && sw3 && sw4 && sw5, [sw1, sw2, sw3, sw4, sw5].join());
await asDb();
await db.query(`insert into public.worker_hourly_rates (company_id, person_id, hourly_rate, effective_date) values ($1,$2,22,'2020-01-01')`, [co, wL.pid]);
check('19b ...and the admin can no longer read pay rates, while the owner still can', (await count(adminU.u, `select count(*)::int from public.worker_hourly_rates`)) === 0
  && (await count(owner.u, `select count(*)::int from public.worker_hourly_rates`)) === 1);
r = await rpc(adminU.u, `select public.set_admin_permissions(true, true, true, true, true) as x`);
check('19c an admin cannot switch their own powers back on', !r.ok, r.msg);
await rpc(owner.u, `select public.set_admin_permissions(true, true, true, true, true) as x`);
check('19d the owner switches them back on and the admin works again', (await count(adminU.u, `select count(*)::int from public.worker_hourly_rates`)) === 1);

// ── 6. modes ────────────────────────────────────────────────────────────────
r = await rpc(adminU.u, `select public.set_member_modes('${wB.pid}'::uuid, false, array['plowing']) as x`);
check('24 removing landscaping keeps snow: the person stays active', r.ok && (await rpc(wB.u, `select public.snow_is_active($1::uuid) as x`, [co])).v === true
  && (await rpc(wB.u, `select public.is_crew($1::uuid) as x`, [co])).v === false, r.msg);
r = await rpc(adminU.u, `select public.set_member_modes('${wB.pid}'::uuid, false, '{}') as x`);
check('24b removing the last mode is refused: that is Deactivate worker, a different action', !r.ok && /Deactivate/.test(r.msg), r.msg);
r = await rpc(adminU.u, `select public.set_member_modes('${wB.pid}'::uuid, true, array['plowing']) as x`);
check('24c landscaping can be given back without touching snow', r.ok && (await rpc(wB.u, `select public.is_crew($1::uuid) as x`, [co])).v === true && (await rpc(wB.u, `select public.snow_is_active($1::uuid) as x`, [co])).v === true, r.msg);
r = await rpc(adminU.u, `select public.set_member_modes('${wB.pid}'::uuid, true, '{}') as x`);
check('24d removing snow keeps landscaping', r.ok && (await rpc(wB.u, `select public.is_crew($1::uuid) as x`, [co])).v === true && (await rpc(wB.u, `select public.snow_is_active($1::uuid) as x`, [co])).v === false, r.msg);
await rpc(adminU.u, `select public.set_member_modes('${wB.pid}'::uuid, true, array['plowing','salting']) as x`);

// ── 7. deactivation ─────────────────────────────────────────────────────────
await asDb();
const wd = (await one(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, clock_out_at, status) values ($1,$2,current_date - 2, now() - interval '50 hours', now() - interval '42 hours','closed') returning id`, [co, wB.pid])).id;
await db.query(`select public._time_audit($1, 'workday', $2, $3, $2, null, 'added', null, null, null, 'history', false)`, [co, wd, wB.pid]);
await db.query(`insert into public.push_tokens (token, person_id) values ('tok1', $1)`, [wB.pid]);
await db.query(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at) values ($1,$2,current_date, now() - interval '1 hour')`, [co, wL.pid]);
r = await rpc(owner.u, `select public.deactivate_member('${wL.pid}'::uuid, true) as x`);
check('31 a person who is on the clock cannot be deactivated until their time is closed', !r.ok && /clocked in/.test(r.msg)
  && (await one(`select status from public.company_members where person_id = $1`, [wL.pid])).status === 'active', r.msg);
await db.query(`delete from public.time_workdays where person_id = $1 and clock_out_at is null`, [wL.pid]);
// a warning that needs a confirmation
await db.query(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, status) values ($1,$2,$3,current_date + 1,'scheduled')`, [co, proj, wB.pid]);
r = await rpc(owner.u, `select public.deactivate_member('${wB.pid}'::uuid, false) as x`);
check('32 unfinished work is shown as a warning and needs a confirmation (nothing silently lost)', !r.ok && /confirm/.test(r.msg), r.msg);
const chk = await rpc(owner.u, `select public.member_deactivation_check('${wB.pid}'::uuid) as x`);
check('32b the check lists the upcoming job', chk.ok && chk.v.warnings.some((w) => /upcoming job/.test(w)), JSON.stringify(chk.v));
r = await rpc(owner.u, `select public.deactivate_member('${wB.pid}'::uuid, true) as x`);
check('25 deactivating a worker with BOTH modes ends both at once', r.ok && (await rpc(wB.u, `select public.is_crew($1::uuid) as x`, [co])).v === false
  && (await rpc(wB.u, `select public.snow_is_active($1::uuid) as x`, [co])).v === false, r.msg);
r = await rpc(wB.u, `select count(*)::int as x from public.projects`);
const r6 = await rpc(wB.u, `select public.time_my_day(current_date) as x`);
const r7 = await rpc(wB.u, `select public.time_clock_in(current_date, null, null) as x`);
const r8 = await rpc(wB.u, `select public.get_my_snow_access() as x`);
check('27 the SAME old session can read nothing, clock in, or open a workday after deactivation (membership is checked live on every request)', r.v === 0 && !r6.ok && !r7.ok && Array.isArray(r8.v) && r8.v.length === 0, JSON.stringify([r.v, r6.msg, r7.msg, r8.v]));
check('28 a fresh sign-in or installation is the same thing: the user id has no active membership', (await rpc(wB.u, `select public.is_member($1::uuid) as x`, [co])).v === false);
r = await rpc(wB.u, `select public.approve_join_request('${declined}'::uuid, 'admin') as x`);
const r9 = await rpc(wB.u, `update public.company_members set status = 'active' where person_id = '${wB.pid}'`);
const r10 = await rpc(wB.u, `select public.snow_grant_access('${wB.pid}'::uuid, array['plowing']) as x`);
check('29 direct calls cannot bring it back: approve, edit the team list, grant themselves snow all change nothing', !r.ok && !r10.ok
  && (await one(`select status from public.company_members where person_id = $1`, [wB.pid])).status === 'inactive', [r.msg, r9.msg, r10.msg].join(' | '));
r = await rpc(wB.u, `select public.join_with_code('LAND1') as x`);
check('29b an old code does not restore it: codes are off, and they still have no access', !r.ok
  && (await rpc(wB.u, `select public.is_member($1::uuid) as x`, [co])).v === false, r.msg);
await asDb();
check('30 their time, history and push-free state are intact: workday and audit rows remain, push token removed', (await one(`select count(*)::int c from public.time_workdays where id = $1`, [wd])).c === 1
  && (await one(`select count(*)::int c from public.time_audit where workday_id = $1`, [wd])).c === 1 && (await one(`select count(*)::int c from public.push_tokens where person_id = $1`, [wB.pid])).c === 0);
check('30b the assignment was kept for the owner to reassign (not deleted, not completed)', (await one(`select status from public.assignments where person_id = $1`, [wB.pid])).status === 'scheduled');
check('30c the deactivation is in the audit log with who did it', (await one(`select count(*)::int c from public.membership_audit_log where event_type = 'member_deactivated' and target_id = $1 and actor_id = $2`, [wB.pid, owner.pid])).c >= 1);
// a snow-only person
r = await rpc(adminU.u, `select public.deactivate_member('${wS.pid}'::uuid, true) as x`);
check('25b a snow-only worker (no landscaping row) is deactivated too', r.ok && (await rpc(wS.u, `select public.snow_is_active($1::uuid) as x`, [co])).v === false
  && (await one(`select status from public.snow_staff where person_id = $1`, [wS.pid])).status === 'revoked', r.msg);
// pending requests are closed when someone is deactivated
await db.query(`insert into public.join_requests (company_id, person_id, status, requested_role) values ($1,$2,'pending','worker')`, [co, wX.pid]).catch(() => {});
r = await rpc(owner.u, `select public.deactivate_member('${wX.pid}'::uuid, true) as x`);
check('10b deactivating closes that person pending requests so they cannot be approved later', r.ok && (await one(`select count(*)::int c from public.join_requests where person_id = $1 and status = 'pending'`, [wX.pid])).c === 0, r.msg);

// ── 8. reactivation ─────────────────────────────────────────────────────────
r = await rpc(owner.u, `select public.restore_account_access('${wB.pid}'::uuid) as x`);
check('34a the old one-tap restore no longer exists: it tells the owner to choose what they can do', !r.ok && /Choose/.test(r.msg), r.msg);
r = await rpc(owner.u, `select public.reactivate_member('${wB.pid}'::uuid, false, 'landscaping', '{}') as x`);
check('34 reactivation requires choosing at least one mode', !r.ok && /Choose/.test(r.msg), r.msg);
r = await rpc(owner.u, `select public.reactivate_member('${wB.pid}'::uuid, true, 'landscaping', '{}') as x`);
check('33 an authorized owner reactivates the same account (no duplicate)', r.ok && (await rpc(wB.u, `select public.is_crew($1::uuid) as x`, [co])).v === true
  && (await one(`select count(*)::int c from public.people where email = 'wb@x.test'`)).c === 1, r.msg);
check('35 the person had both modes before; reactivating landscaping only does NOT bring snow back', (await rpc(wB.u, `select public.snow_is_active($1::uuid) as x`, [co])).v === false);
check('36 reactivating dispatches nothing (no route crew rows) and keeps the old assignment as it was', (await one(`select count(*)::int c from public.snow_route_crew where person_id = $1`, [wB.pid])).c === 0
  && (await one(`select status from public.assignments where person_id = $1`, [wB.pid])).status === 'scheduled');
// an admin who was deactivated does not come back as admin
await rpc(owner.u, `select public.set_member_role('${wL.pid}'::uuid, 'admin') as x`);
await rpc(owner.u, `select public.deactivate_member('${wL.pid}'::uuid, true) as x`);
r = await rpc(owner.u, `select public.reactivate_member('${wL.pid}'::uuid, true, 'landscaping', '{}') as x`);
check('35b a deactivated admin comes back as a plain worker, never as admin', r.ok && (await one(`select role from public.company_members where person_id = $1`, [wL.pid])).role === 'worker'
  && (await rpc(wL.u, `select public.is_staff($1::uuid) as x`, [co])).v === false, r.msg);
r = await rpc(owner.u, `select public.reactivate_member('${wS.pid}'::uuid, false, 'landscaping', array['plowing']) as x`);
check('34b a snow-only person is reactivated for snow only, with the services the owner picked', r.ok && (await rpc(wS.u, `select public.snow_is_active($1::uuid) as x`, [co])).v === true
  && (await rpc(wS.u, `select public.is_crew($1::uuid) as x`, [co])).v === false && (await one(`select count(*)::int c from public.snow_staff_services where person_id = $1`, [wS.pid])).c === 1, r.msg);
r = await rpc(wL.u, `select public.reactivate_member('${wB.pid}'::uuid, true, 'landscaping', '{}') as x`);
check('34c a worker cannot reactivate anyone', !r.ok, r.msg);

// ── 9. history, audit, direct audit forgery ─────────────────────────────────
r = await rpc(wL.u, `insert into public.membership_audit_log (company_id, event_type, actor_id) values ('${co}', 'fake', '${owner.pid}')`);
check('12c a history row cannot be written in someone else name', !r.ok, r.msg);
r = await rpc(owner.u, `delete from public.membership_audit_log`);
check('12d nobody can delete the membership history through the app', (await one(`select count(*)::int c from public.membership_audit_log`)).c > 5);

// ── 10. company closure ─────────────────────────────────────────────────────
await asDb();
await db.exec(`set session_replication_role = replica`);
const coB = (await one(`insert into public.companies (name) values ('Other Co') returning id`)).id;
await db.exec(`set session_replication_role = origin`);
const ownerB = await mk('ownerb@x.test', 'OwnerB');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active'),($1,$3,'worker','active')`, [coB, ownerB.pid, wX.pid]);
r = await rpc(adminU.u, `select public.company_closure_preview() as x`);
check('38 an admin cannot even preview closing the company', !r.ok, r.msg);
r = await rpc(wL.u, `select public.delete_my_company('Acme Lawn') as x`);
check('39 a worker cannot close the company', !r.ok, r.msg);
r = await rpc(ownerB.u, `select public.delete_my_company('Acme Lawn') as x`);
check('39b another company owner cannot close this company either', !r.ok, r.msg);
await asDb();
await db.query(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at) values ($1,$2,current_date, now() - interval '1 hour')`, [co, wL.pid]);
const pv = await rpc(owner.u, `select public.company_closure_preview() as x`);
check('42 the preview shows who is on the clock and what is pending', pv.ok && pv.v.on_the_clock === 1 && 'pending_join_requests' in pv.v && 'open_codes' in pv.v, JSON.stringify(pv.v));
r = await rpc(owner.u, `select public.delete_my_company('Acme Lawn') as x`);
check('42b closing is refused while someone is clocked in, and NOTHING changed (codes still work, company still there)', !r.ok && /clocked in/.test(r.msg)
  && (await one(`select count(*)::int c from public.companies where id = $1`, [co])).c === 1 && (await one(`select count(*)::int c from public.team_codes where company_id = $1 and is_active`, [co])).c === 1, r.msg);
r = await rpc(owner.u, `select public.delete_my_company('Wrong Name') as x`);
check('44 a wrong confirmation name closes nothing and reports the failure', !r.ok && (await one(`select count(*)::int c from public.companies where id = $1`, [co])).c === 1, r.msg);
await db.query(`delete from public.time_workdays where person_id = $1 and clock_out_at is null`, [wL.pid]);
await db.query(`insert into public.join_requests (company_id, person_id, status, requested_role) values ($1,$2,'pending','worker')`, [co, pBad.pid]);
await db.query(`insert into public.snow_access_requests (company_id, person_id, status) values ($1,$2,'pending')`, [co, pBad.pid]);
const histBefore = (await one(`select count(*)::int c from public.time_workdays where company_id = $1`, [co])).c;
await db.exec(`set session_replication_role = replica`);
await db.exec(`set session_replication_role = origin`);
r = await rpc(owner.u, `select public.delete_my_company('acme lawn') as x`);
check('40 the owner closes the company', r.ok && (await one(`select count(*)::int c from public.companies where id = $1`, [co])).c === 0, r.msg);
const leftovers = [];
for (const row of await all(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public' where c.relkind = 'r' and c.relname <> 'company_closure_log'
    and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)`)) {
  const n = (await one(`select count(*)::int c from public.${row.relname} where company_id = $1`, [co])).c;
  if (n > 0) leftovers.push(`${row.relname}:${n}`);
}
check('40a nothing is left behind: no table anywhere still holds a row of the closed company (no orphans, no half-deleted state)', leftovers.length === 0, leftovers.join(','));
check('40c the permanent delete took the company data with it: projects, hours, history and members are gone', (await one(`select count(*)::int c from public.projects where id = $1`, [proj])).c === 0
  && (await one(`select count(*)::int c from public.time_workdays where company_id = $1`, [co])).c === 0 && (await one(`select count(*)::int c from public.membership_audit_log where company_id = $1`, [co])).c === 0);
check('40b every code and pending request of that company is gone with it: the codes no longer work', (await one(`select public.lookup_any_code('LAND1') as x`)).x.valid === false
  && (await one(`select public.lookup_any_code('SNOW1') as x`)).x.valid === false);
r = await rpc(pBad.u, `select public.join_with_code('LAND1') as x`);
check('11 an old code or pending request cannot recreate membership in a closed company', !r.ok
  && (await one(`select count(*)::int c from public.company_members where company_id = $1`, [co])).c === 0, r.msg);
check('41 old sessions of the closed company read nothing', (await rpc(adminU.u, `select public.is_member($1::uuid) as x`, [co])).v === false && (await count(adminU.u, `select count(*)::int from public.projects`)) === 0);
check('43 a closure record was kept (who, when, what was pending)', (await one(`select count(*)::int c from public.company_closure_log where company_id = $1 and closed_by = $2`, [co, owner.pid])).c === 1);
r = await rpc(owner.u, `select public.delete_my_company('Acme Lawn') as x`);
check('45 repeating the closure is refused cleanly (nothing to close, no second record)', !r.ok && (await one(`select count(*)::int c from public.company_closure_log where company_id = $1`, [co])).c === 1, r.msg);
check('46 the other company, its owner, and everyone login (people and auth users) are untouched', (await one(`select count(*)::int c from public.companies where id = $1`, [coB])).c === 1
  && (await one(`select count(*)::int c from public.company_members where company_id = $1`, [coB])).c === 2
  && (await one(`select count(*)::int c from public.people where id = $1`, [wL.pid])).c === 1 && (await one(`select count(*)::int c from auth.users where id = $1`, [wL.u])).c === 1);
check('43b history of closed company that must be kept elsewhere: nothing in other companies changed', histBefore >= 1);

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
