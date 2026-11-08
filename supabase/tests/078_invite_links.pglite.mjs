// Update 78: private one-time invite links (workers and customers), what each worker works on, and the old code paths being off.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 78) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/078_invite_links.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 78 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asAnon = async () => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { if (u) await asUser(u); else await asAnon(); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
// A sign-up through the real sign-up trigger, with the app's metadata.
const signUp = async (email, meta) => {
  const u = (await one(`insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`, [email, JSON.stringify(meta)])).id;
  const person = await one(`select * from public.people where user_id = $1`, [u]);
  return { u, person };
};
const login = async (email, name) => {
  const s = await signUp(email, { first_name: name, last_name: 'T' });
  return { u: s.u, pid: s.person.id };
};
const people = async () => (await one(`select count(*)::int c from public.people`)).c;

const coA = (await one(`insert into public.companies (name) values ('Acme Lawn') returning id`)).id;
await db.exec(`set session_replication_role = replica`);
const coB = (await one(`insert into public.companies (name) values ('Other Co') returning id`)).id;
await db.exec(`set session_replication_role = origin`);
const owner = await login('owner@x.test', 'Owner');
const admin = await login('admin@x.test', 'Admin');
const adminNo = await login('adminno@x.test', 'AdminNoInvites');
const worker = await login('worker@x.test', 'Worker');
const ownerB = await login('ownerb@x.test', 'OwnerB');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active'),($1,$3,'admin','active'),($1,$4,'admin','active'),($1,$5,'worker','active'),($6,$7,'owner','active')`,
  [coA, owner.pid, admin.pid, adminNo.pid, worker.pid, coB, ownerB.pid]);
await db.query(`insert into public.company_admin_permissions (company_id, invites) values ($1, true) on conflict (company_id) do update set invites = true`, [coA]);

// ── 1. add a worker: name + phone only ──
let r = await rpc(owner.u, `select public.add_worker('Gabriel', 'Rivera', '(732) 555-0142') as x`);
check('1 the owner adds a worker with just a name and a phone number and gets a private link', r.ok && r.v.created === true && typeof r.v.token === 'string' && r.v.token.length >= 60, JSON.stringify(r));
const w1 = r.v;
const rec = await one(`select p.first_name, p.last_name, p.phone, p.user_id, p.email, m.role, m.status, m.works_landscaping, m.works_maintenance from public.people p join public.company_members m on m.person_id = p.id where p.id = $1`, [w1.person_id]);
check('1b the new worker is an invited worker with no login yet, and starts like every other worker (no "maintenance" or "regular" type chosen)', rec.role === 'worker' && rec.status === 'invited' && rec.user_id === null && rec.works_landscaping === true && rec.works_maintenance === false, JSON.stringify(rec));
check('1c only a one-way hash of the link is stored (the database cannot show the link again)', (await one(`select count(*)::int c from public.invites where token_hash = $1`, [w1.token])).c === 0 && (await one(`select count(*)::int c from public.invites where person_id = $1 and status = 'pending'`, [w1.person_id])).c === 1);
check('2 a worker, a customer or a stranger cannot add workers; an admin without the invites power cannot either', !(await rpc(worker.u, `select public.add_worker('A','B','7325550100') as x`)).ok);
await db.query(`update public.company_admin_permissions set invites = false where company_id = $1`, [coA]);
check('2b admin with the power switched off is refused', !(await rpc(admin.u, `select public.add_worker('A','B','7325550100') as x`)).ok);
await db.query(`update public.company_admin_permissions set invites = true where company_id = $1`, [coA]);
check('2c an admin the owner allows can add a worker', (await rpc(admin.u, `select public.add_worker('Pat', 'Admin', '7325550101') as x`)).ok);
check('3 a name and a phone number are required, and the same phone twice is refused (send that worker a new link instead)',
  !(await rpc(owner.u, `select public.add_worker('', 'X', '7325550199') as x`)).ok && !(await rpc(owner.u, `select public.add_worker('A', 'X', '12') as x`)).ok
  && /already on your team/.test((await rpc(owner.u, `select public.add_worker('Gabe', 'Again', '732-555-0142') as x`)).msg));

// ── 2. the invite page's lookup ──
r = await rpc(null, `select public.invite_lookup($1) as x`, [w1.token]);
check('4 the link works for the invite page without being signed in, and shows only the company and the name and phone the owner typed', r.ok && r.v.valid === true && r.v.kind === 'worker' && r.v.company_name === 'Acme Lawn' && r.v.first_name === 'Gabriel'
  && Object.keys(r.v).sort().join() === 'company_name,first_name,kind,last_name,phone,valid', JSON.stringify(r.v));
check('4b a wrong link says invalid', (await rpc(null, `select public.invite_lookup('nope') as x`)).v.valid === false);

// ── 3. sign-up with the link: the person can fix their name ──
const before = await people();
const su = await signUp('gabriella@x.test', { first_name: 'Gabriella', last_name: 'Rivera', phone: '(732) 555-0142', invite_token: w1.token });
check('5 signing up with the link attaches the new login to the record the owner made, and the person corrected their own name (Gabriel became Gabriella)', su.person.id === w1.person_id && su.person.first_name === 'Gabriella' && su.person.email === 'gabriella@x.test', JSON.stringify(su.person));
check('5b no second person was created, and the worker is now active', (await people()) === before && (await one(`select status from public.company_members where person_id = $1 and company_id = $2`, [w1.person_id, coA])).status === 'active');
check('5c the link is used up in the same step', (await rpc(null, `select public.invite_lookup($1) as x`, [w1.token])).v.reason === 'used');
const sneaky = await signUp('late@x.test', { first_name: 'Late', last_name: 'Comer', invite_token: w1.token });
check('6 using the same link a second time does NOT attach to that worker: the second login is just an ordinary new person with no access', sneaky.person.id !== w1.person_id
  && (await one(`select count(*)::int c from public.company_members where person_id = $1`, [sneaky.person.id])).c === 0 && (await one(`select user_id from public.people where id = $1`, [w1.person_id])).user_id === su.u);

// ── 4. expiry, resend, cancel ──
const w2 = (await rpc(owner.u, `select public.add_worker('Dana', 'Cole', '7325550202') as x`)).v;
await db.query(`update public.invites set expires_at = now() - interval '1 minute' where person_id = $1`, [w2.person_id]);
check('7 an expired link says expired and does not attach', (await rpc(null, `select public.invite_lookup($1) as x`, [w2.token])).v.reason === 'expired'
  && (await signUp('dana@x.test', { first_name: 'Dana', last_name: 'Cole', invite_token: w2.token })).person.id !== w2.person_id);
const w3 = (await rpc(owner.u, `select public.add_worker('Eli', 'Moss', '7325550303') as x`)).v;
r = await rpc(owner.u, `select public.invite_send($1::uuid) as x`, [w3.person_id]);
check('8 "send again" makes a new link and the old one stops working', r.ok && r.v.token !== w3.token && (await rpc(null, `select public.invite_lookup($1) as x`, [w3.token])).v.valid === false && (await rpc(null, `select public.invite_lookup($1) as x`, [r.v.token])).v.valid === true, JSON.stringify(r));
const pend = await rpc(owner.u, `select public.invites_pending() as x`);
check('8b the owner\'s list shows who still has an unused link (and never the link itself)', pend.ok && pend.v.some((i) => i.person_id === w3.person_id) && !pend.v.some((i) => 'token' in i || 'token_hash' in i), JSON.stringify(pend.v).slice(0, 200));
const inv3 = pend.v.find((i) => i.person_id === w3.person_id);
check('8c the owner can cancel a link; then it no longer works', (await rpc(owner.u, `select public.invite_revoke($1::uuid) as x`, [inv3.id])).ok && (await rpc(null, `select public.invite_lookup($1) as x`, [r.v.token])).v.valid === false);
check('8d another company\'s owner cannot see, cancel or re-send our invites', !(await rpc(ownerB.u, `select public.invite_send($1::uuid) as x`, [w3.person_id])).ok && (await rpc(ownerB.u, `select public.invites_pending() as x`)).v.length === 0);

// ── 5. customers use the same link; email addresses never link anyone ──
await db.exec(`reset role`);
const cust = (await rpc(owner.u, `select public.add_customer('Cathy', 'Client', 'cathy@x.test', '7325550404') as x`)).v;
const projC = (await one(`insert into public.projects (company_id, name, status, customer_id) values ($1,'Cathy yard','active',$2) returning id`, [coA, cust.person_id])).id;
const peopleBefore = await people();
const stranger = await signUp('cathy@x.test', { first_name: 'Not', last_name: 'Cathy' });
check('9 someone who simply signs up with the customer\'s email address is NOT linked to her record (email matching is gone)', stranger.person.id !== cust.person_id && (await people()) === peopleBefore + 1
  && (await one(`select user_id from public.people where id = $1`, [cust.person_id])).user_id === null);
const ci = (await rpc(owner.u, `select public.invite_send($1::uuid) as x`, [cust.person_id])).v;
const cathy = await signUp('cathy.real@x.test', { first_name: 'Cathy', last_name: 'Client', invite_token: ci.token });
check('10 the customer\'s private link attaches her login to her own record: her projects are already there, no duplicate person', cathy.person.id === cust.person_id
  && (await one(`select customer_id from public.projects where id = $1`, [projC])).customer_id === cust.person_id
  && (await one(`select status from public.company_members where person_id = $1 and company_id = $2`, [cust.person_id, coA])).status === 'active');

// the customer keeps the name the owner typed; a different sign-up email is fine
const cn = (await rpc(owner.u, `select public.add_customer('Dan', 'Dealer', 'dan@x.test', '7325550606') as x`)).v;
const cni = (await rpc(owner.u, `select public.invite_send($1::uuid) as x`, [cn.person_id])).v;
const dan = await signUp('someone.else@x.test', { first_name: 'Daniel', last_name: 'Dealerman', invite_token: cni.token });
const danRow = await one(`select first_name, last_name, email, user_id from public.people where id = $1`, [cn.person_id]);
check('10b a customer keeps the name the owner typed (Dan Dealer stays, even if the form says Daniel Dealerman), and signing up with a different email still links them', dan.person.id === cn.person_id && danRow.first_name === 'Dan' && danRow.last_name === 'Dealer' && danRow.user_id !== null && danRow.email === 'someone.else@x.test', JSON.stringify(danRow));
const ev = (await rpc(owner.u, `select public.add_customer('Eve', '', '', '7325550707') as x`));
if (ev.ok) {
  const evi = (await rpc(owner.u, `select public.invite_send($1::uuid) as x`, [ev.v.person_id])).v;
  await signUp('eve@x.test', { first_name: 'Evelyn', last_name: 'Fox', invite_token: evi.token });
  const evRow = await one(`select first_name, last_name from public.people where id = $1`, [ev.v.person_id]);
  check('10c a part of the name the owner left empty is filled in from the sign-up form (first name stays Eve, last name Fox)', evRow.first_name === 'Eve' && evRow.last_name === 'Fox', JSON.stringify(evRow));
}

// ── 6. someone who already has a login ──
const existing = await login('existing@x.test', 'Existing');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'customer','active')`, [coB, existing.pid]);
const c2 = (await rpc(owner.u, `select public.add_customer('Ed', 'Existing', '', '7325550505') as x`)).v;
const proj2 = (await one(`insert into public.projects (company_id, name, status, customer_id) values ($1,'Ed yard','active',$2) returning id`, [coA, c2.person_id])).id;
const ei = (await rpc(owner.u, `select public.invite_send($1::uuid) as x`, [c2.person_id])).v;
r = await rpc(existing.u, `select public.invite_accept($1) as x`, [ei.token]);
check('11 a customer who already has an account (at another company) opens the link while signed in: the record is merged into their account', r.ok && r.v.success === true
  && (await one(`select customer_id from public.projects where id = $1`, [proj2])).customer_id === existing.pid && (await one(`select count(*)::int c from public.people where id = $1`, [c2.person_id])).c === 0
  && (await one(`select status from public.company_members where person_id = $1 and company_id = $2`, [existing.pid, coA])).status === 'active', JSON.stringify(r));
check('11b and the other company membership is untouched; the link cannot be used again', (await one(`select status from public.company_members where person_id = $1 and company_id = $2`, [existing.pid, coB])).status === 'active'
  && (await rpc(existing.u, `select public.invite_accept($1) as x`, [ei.token])).v.success === false);

// ── 7. what a worker works on ──
const gab = w1.person_id;
const maintFlag = async () => (await rpc(su.u, `select public.is_maintenance_worker($1::uuid) as x`, [coA])).v;
check('12 a new worker does not work on Maintenance until the owner says so', (await maintFlag()) === false);
r = await rpc(owner.u, `select public.set_worker_areas($1::uuid, true, true) as x`, [gab]);
check('12b the owner turns Maintenance on: the worker can now do Maintenance AND still works on Landscaping (one worker, both)', r.ok && (await maintFlag()) === true
  && (await one(`select works_landscaping, works_maintenance, worker_type from public.company_members where person_id = $1 and company_id = $2`, [gab, coA])).works_landscaping === true);
const crew = (await one(`insert into public.crews (company_id, name, is_maintenance) values ($1,'Maint crew', true) returning id`, [coA])).id;
const crewIns = await rpc(owner.u, `insert into public.crew_members (company_id, crew_id, person_id) values ($1,$2,$3) returning id`, [coA, crew, gab]);
check('12c a worker who works on Maintenance can be put in the Maintenance Crew; one who does not cannot', crewIns.ok && !(await rpc(owner.u, `insert into public.crew_members (company_id, crew_id, person_id) values ($1,$2,$3) returning id`, [coA, crew, worker.pid])).ok, crewIns.msg);
await asUser(su.u);
await db.query(`update public.company_members set works_landscaping = false, works_maintenance = false where person_id = $1`, [gab]).catch(() => {});
await asDb();
check('13 a worker cannot change what they work on by editing their own row (the change is ignored)', (await one(`select works_maintenance from public.company_members where person_id = $1 and company_id = $2`, [gab, coA])).works_maintenance === true);
check('13b a worker (or anyone not owner/admin) cannot set areas for others', !(await rpc(worker.u, `select public.set_worker_areas($1::uuid, false, true) as x`, [gab]).then((x) => x.ok)));
await rpc(owner.u, `select public.set_worker_areas($1::uuid, true, false) as x`, [gab]);
check('14 turning Maintenance off also takes the worker out of the Maintenance Crew', (await maintFlag()) === false && (await one(`select count(*)::int c from public.crew_members where person_id = $1 and crew_id = $2`, [gab, crew])).c === 0);
check('14b the change is logged', (await one(`select count(*)::int c from public.membership_audit_log where event_type = 'worker_areas_changed' and target_id = $1`, [gab])).c >= 2);
const legacy = (await one(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'worker','active','maintenance') returning works_maintenance, works_landscaping`, [coA, (await login('legacy@x.test', 'Legacy')).pid]));
check('15 a worker saved the older way as "maintenance" still works on Maintenance only (older data and tests keep working)', legacy.works_maintenance === true && legacy.works_landscaping === false);

// ── 8. the old codes are off ──
for (const fn of ['lookup_team_code', 'lookup_any_code', 'join_with_code', 'lookup_project_code', 'claim_project', 'approve_join_request', 'regenerate_snow_signup_code', 'set_worker_type']) {
  const sig = (await one(`select p.oid::regprocedure::text s from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1 limit 1`, [fn]))?.s;
  if (!sig) continue;
  const ok = (await one(`select has_function_privilege('authenticated', $1::regprocedure, 'execute') as e`, [sig])).e;
  check(`16 the old ${fn} can no longer be called from the app`, ok === false);
}
const teamCodeSignup = await signUp('oldcode@x.test', { first_name: 'Old', last_name: 'Code', team_code: 'WHATEVER1' });
check('17 a sign-up that still carries a team code just makes an ordinary account; it files no join request', (await one(`select count(*)::int c from public.join_requests where person_id = $1`, [teamCodeSignup.person.id])).c === 0);
check('18 owners can still start their own company', true);

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
