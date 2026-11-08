// Update 70: a customer record the owner created connects to the customer's real login by claiming the property code, with no duplicates.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
// Written for the old code-based joining (closed by update 78, functions removed by update 85, tested in 085): runs against the schema as of update 84.
const { db, failures } = await buildFullSchema(repo, { upTo: 84 });
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 280)}`); };
check('0 the full schema and all updates (including 70) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/070_customer_link_no_duplicates.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 70 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
const login = async (email, name) => {   // a real sign-up: auth user + (trigger-made or inserted) person row
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  let pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id;
  if (!pid) pid = (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const placeholder = async (co, email, first) => {   // what the owner's "Add customer" creates: a person with no login + an invited membership
  const pid = (await one(`insert into public.people (email, first_name, last_name) values ($1, $2, 'Cust') returning id`, [email, first])).id;
  await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'customer','invited')`, [co, pid]);
  return pid;
};
const claim = async (pid, code) => (await one(`select public._claim_maintenance($1::uuid, $2) as x`, [pid, code])).x;
const codeOf = async (prop) => (await one(`select code from public.maintenance_customer_codes where property_id = $1`, [prop])).code;
const peopleCount = async () => (await one(`select count(*)::int c from public.people`)).c;

const coA = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
await db.exec(`set session_replication_role = replica`);
const coB = (await one(`insert into public.companies (name) values ('Other Co') returning id`)).id;
await db.exec(`set session_replication_role = origin`);
const ownerA = await login('ownera@x.test', 'OwnerA');
const ownerB = await login('ownerb@x.test', 'OwnerB');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active'),($3,$4,'owner','active')`, [coA, ownerA.pid, coB, ownerB.pid]);
const mkProp = async (co, name, customer) => (await one(`insert into public.maintenance_properties (company_id, name, address, customer_id) values ($1,$2,'1 Main',$3) returning id`, [co, name, customer ?? null])).id;

// 1. MISSING EMAIL: the owner added the customer with no email and linked the lawn; the customer signs up with their own email and claims the code
const phNoEmail = await placeholder(coA, '', 'NoEmail');
const p1 = await mkProp(coA, 'Lawn 1', phNoEmail);
await db.query(`insert into public.projects (company_id, name, status, customer_id) values ($1,'Patio','active',$2)`, [coA, phNoEmail]);
const before1 = await peopleCount();
const real1 = await login('real1@x.test', 'Real1');
const after1signup = await peopleCount();
let res = await claim(real1.pid, await codeOf(p1));
check('1 missing email: claiming the code links the lawn to the customer\'s own login', res.success === true && (await one(`select customer_id from public.maintenance_properties where id = $1`, [p1])).customer_id === real1.pid, JSON.stringify(res));
check('1b the owner-created record is merged away: its projects follow the real customer, no duplicate person remains', (await one(`select count(*)::int c from public.people where id = $1`, [phNoEmail])).c === 0
  && (await one(`select customer_id from public.projects where name = 'Patio'`)).customer_id === real1.pid && (await peopleCount()) === after1signup - 1, `${before1}/${after1signup}/${await peopleCount()}`);
check('1c the real customer is an active customer of the company (and only one membership row for them)', (await one(`select count(*)::int c from public.company_members where company_id = $1 and person_id = $2 and role = 'customer' and status = 'active'`, [coA, real1.pid])).c === 1);

// 2. EXISTING ACCOUNT: the person already has a login (and belongs to another company); the owner added a record for them with a typo email
const existing = await login('existing@x.test', 'Existing');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'customer','active')`, [coB, existing.pid]);
const ph2 = await placeholder(coA, 'exsting@x.test', 'Existing');   // typo: an email match could never have linked it
const p2 = await mkProp(coA, 'Lawn 2', ph2);
const c2before = await peopleCount();
res = await claim(existing.pid, await codeOf(p2));
check('2 existing account: claiming the code links their existing login (no new person is created for them)', res.success === true && (await one(`select customer_id from public.maintenance_properties where id = $1`, [p2])).customer_id === existing.pid && (await peopleCount()) === c2before - 1, JSON.stringify(res));
check('2b the other-company membership of that account is untouched', (await one(`select status from public.company_members where company_id = $1 and person_id = $2`, [coB, existing.pid])).status === 'active');

// 3. NO NAME GUESSING: same name and email as a placeholder, but never linked to this property by the owner -> not merged
const ph3 = await placeholder(coA, 'same@x.test', 'Samename');
const stranger = await login('same@x.test', 'Samename');   // signs up with the same email: no auto-merge by the claim path
const p3 = await mkProp(coA, 'Lawn 3', null);
res = await claim(stranger.pid, await codeOf(p3));
check('3 a claim never merges a record just because the name or email matches: the unrelated placeholder is untouched', res.success === true && (await one(`select count(*)::int c from public.people where id = $1`, [ph3])).c === 1);

// 4. INACTIVE MEMBERSHIP: removed by the owner -> refused; inactive on their own -> reactivated
const removed = await login('removed@x.test', 'Removed');
await db.query(`insert into public.company_members (company_id, person_id, role, status, deactivated_by) values ($1,$2,'customer','inactive',$3)`, [coA, removed.pid, ownerA.pid]);
const p4 = await mkProp(coA, 'Lawn 4', null);
res = await claim(removed.pid, await codeOf(p4));
check('4 inactive membership that the OWNER removed: the code is refused (access_removed) and nothing is linked', res.success === false && res.error === 'access_removed' && (await one(`select customer_id from public.maintenance_properties where id = $1`, [p4])).customer_id === null, JSON.stringify(res));
const selfOff = await login('selfoff@x.test', 'SelfOff');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'customer','inactive')`, [coA, selfOff.pid]);
const p4b = await mkProp(coA, 'Lawn 4b', null);
res = await claim(selfOff.pid, await codeOf(p4b));
check('4b inactive without an owner removal: claiming reactivates the same membership (still one row)', res.success === true
  && (await one(`select status from public.company_members where company_id = $1 and person_id = $2`, [coA, selfOff.pid])).status === 'active'
  && (await one(`select count(*)::int c from public.company_members where company_id = $1 and person_id = $2`, [coA, selfOff.pid])).c === 1, JSON.stringify(res));

// 5. ACCOUNT OUTSIDE THE COMPANY: a customer of company B claims company A's code; only A's property links, B is untouched; B's code does not open A
const outsider = await login('outsider@x.test', 'Outsider');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'customer','active')`, [coB, outsider.pid]);
const pB = await mkProp(coB, 'B lawn', outsider.pid);
const p5 = await mkProp(coA, 'Lawn 5', null);
res = await claim(outsider.pid, await codeOf(p5));
check('5 an account that belongs to another company links to A only by A\'s own code', res.success === true && (await one(`select customer_id from public.maintenance_properties where id = $1`, [p5])).customer_id === outsider.pid
  && (await one(`select customer_id from public.maintenance_properties where id = $1`, [pB])).customer_id === outsider.pid);
check('5b they see only their own properties through the customer function (A lawn and B lawn), never other customers\' lawns', (await rpc(outsider.u, `select count(*)::int as x from public.maintenance_my_properties()`)).v === 2);
const otherLawn = await mkProp(coA, 'Someone else', real1.pid);
check('5c another customer\'s lawn is not visible to them', (await rpc(outsider.u, `select count(*)::int as x from public.maintenance_my_properties() where name = 'Someone else'`)).v === 0);

// 6. A record that has a login is never merged away, and a placeholder that belongs to two companies is kept
const p6a = await login('hasLogin@x.test', 'HasLogin');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'customer','invited')`, [coA, p6a.pid]);
const p6 = await mkProp(coA, 'Lawn 6', p6a.pid);
const claimer6 = await login('claimer6@x.test', 'Claimer6');
await claim(claimer6.pid, await codeOf(p6));
check('6 a record that already has a login is not deleted by a claim', (await one(`select count(*)::int c from public.people where id = $1`, [p6a.pid])).c === 1);
const ph7 = await placeholder(coA, 'shared@x.test', 'Shared');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'customer','invited')`, [coB, ph7]);
const p7 = await mkProp(coA, 'Lawn 7', ph7);
const claimer7 = await login('claimer7@x.test', 'Claimer7');
await claim(claimer7.pid, await codeOf(p7));
check('7 a placeholder that also belongs to another company is not merged or deleted', (await one(`select count(*)::int c from public.people where id = $1`, [ph7])).c === 1);

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
