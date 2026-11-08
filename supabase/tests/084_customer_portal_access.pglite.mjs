// Update 84: the owner turns a customer's portal access off and on. Off ends access and cancels an unused link; their records stay;
// on restores it (active if they have a login, invited if they never signed up); only the owner, only customers; Message customers skips
// customers who are off.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 84) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/084_customer_portal_access.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 84 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
const login = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  let pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id;
  if (!pid) pid = (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1,$2,$3,'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const status = async (pid, co) => (await one(`select status from public.company_members where company_id = $1 and person_id = $2`, [co, pid])).status;

const co = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
const owner = await login('o@x.test', 'Owner');
const worker = await login('w@x.test', 'Worker');
const withLogin = await login('c1@x.test', 'HasLogin');
const noLogin = (await one(`insert into public.people (email, first_name, last_name) values ('c2@x.test','NoLogin','T') returning id`)).id;
const other = await login('o2@x.test', 'OtherCo');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active'),($1,$3,'worker','active'),($1,$4,'customer','active'),($1,$5,'customer','invited')`, [co, owner.pid, worker.pid, withLogin.pid, noLogin]);

// a pending link for the customer who never signed up
await db.query(`insert into public.invites (company_id, person_id, kind, token_hash, status, expires_at) values ($1,$2,'customer','h1','pending', now() + interval '7 days')`, [co, noLogin]);
// something that belongs to the customer: it must survive
await db.query(`insert into public.projects (company_id, name, customer_id, status) values ($1,'Backyard',$2,'active')`, [co, withLogin.pid]);

let r = await rpc(worker.u, `select public.set_customer_portal_access($1::uuid, false) as x`, [withLogin.pid]);
check('1 a worker cannot change customer access', !r.ok && /Only the owner/.test(r.msg ?? ''), JSON.stringify(r));
r = await rpc(owner.u, `select public.set_customer_portal_access($1::uuid, false) as x`, [worker.pid]);
check('2 only customers can be changed here (not a worker)', !r.ok && /not one of your customers/.test(r.msg ?? ''), JSON.stringify(r));
r = await rpc(owner.u, `select public.set_customer_portal_access($1::uuid, false) as x`, [other.pid]);
check('3 a person who is not your customer (for example from another company) cannot be touched', !r.ok && /not one of your customers/.test(r.msg ?? ''), JSON.stringify(r));
r = await rpc(owner.u, `select public.set_customer_portal_access($1::uuid, false) as x`, [owner.pid]);
check('4 you cannot change your own access', !r.ok, JSON.stringify(r));

const before = (await one(`select public._customer_audience($1::uuid, 'customers_all') as a`, [co])).a;
r = await rpc(owner.u, `select public.set_customer_portal_access($1::uuid, false) as x`, [withLogin.pid]);
check('5 turning access off makes the customer inactive', r.ok && r.v === 'inactive' && (await status(withLogin.pid, co)) === 'inactive', JSON.stringify(r));
check('6 their project and records are kept', (await one(`select count(*)::int c from public.projects where customer_id = $1`, [withLogin.pid])).c === 1);
const after = (await one(`select public._customer_audience($1::uuid, 'customers_all') as a`, [co])).a;
check('7 Message customers skips a customer whose access is off', before.includes(withLogin.pid) && !after.includes(withLogin.pid), JSON.stringify({ before, after }));
r = await rpc(owner.u, `select public.set_customer_portal_access($1::uuid, false) as x`, [withLogin.pid]);
check('8 turning it off twice is harmless', r.ok && r.v === 'inactive');
r = await rpc(owner.u, `select public.set_customer_portal_access($1::uuid, true) as x`, [withLogin.pid]);
check('9 turning it back on restores a customer who has a login to active', r.ok && r.v === 'active' && (await status(withLogin.pid, co)) === 'active' && !!(await one(`select 1 x from public.company_members where person_id = $1 and deactivated_at is null`, [withLogin.pid])), JSON.stringify(r));

r = await rpc(owner.u, `select public.set_customer_portal_access($1::uuid, false) as x`, [noLogin]);
const link = await one(`select status from public.invites where person_id = $1`, [noLogin]);
check('10 turning off a customer who never signed up cancels their unused link', r.ok && r.v === 'inactive' && link.status === 'revoked', JSON.stringify({ r, link }));
r = await rpc(owner.u, `select public.invite_send($1::uuid) as x`, [noLogin]);
check('11 while access is off no new link can be made', !r.ok && /access was removed/.test(r.msg ?? ''), JSON.stringify(r));
r = await rpc(owner.u, `select public.set_customer_portal_access($1::uuid, true) as x`, [noLogin]);
check('12 turning it on for someone who never signed up puts them back to invite pending', r.ok && r.v === 'invited' && (await status(noLogin, co)) === 'invited', JSON.stringify(r));
r = await rpc(owner.u, `select public.invite_send($1::uuid) as x`, [noLogin]);
check('13 and a new link can be made again', r.ok, JSON.stringify(r));
const log = (await one(`select count(*)::int c from public.membership_audit_log where company_id = $1 and event_type in ('customer_access_off','customer_access_on')`, [co])).c;
check('14 every change is in the audit log', log >= 4, String(log));
console.log(results.every(Boolean) ? '\nall passed' : '\nsome failed');
process.exit(results.every(Boolean) ? 0 : 1);
