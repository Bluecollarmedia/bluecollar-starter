// Update 72: "Add customer" never creates a duplicate person and never guesses by name.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 280)}`); };
check('0 the full schema and all updates (including 72) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/072_add_customer.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 72 can be run a second time', again);

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
const add = (u, first, last, email, phone) => rpc(u, `select public.add_customer($1, $2, $3, $4) as x`, [first, last, email, phone ?? null]);
const people = async () => (await one(`select count(*)::int c from public.people`)).c;

const coA = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
await db.exec(`set session_replication_role = replica`);
const coB = (await one(`insert into public.companies (name) values ('Other Co') returning id`)).id;
await db.exec(`set session_replication_role = origin`);
const ownerA = await login('ownera@x.test', 'OwnerA');
const ownerB = await login('ownerb@x.test', 'OwnerB');
const worker = await login('worker@x.test', 'Worker');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active'),($3,$4,'owner','active'),($1,$5,'worker','active')`, [coA, ownerA.pid, coB, ownerB.pid, worker.pid]);
const memberOf = async (co, pid) => (await one(`select role, status from public.company_members where company_id = $1 and person_id = $2`, [co, pid]));

// who may call it
let r = await add(worker.u, 'Pat', 'Smith', 'pat@x.test');
check('1 a worker cannot add customers', !r.ok && /Only the owner or an admin/.test(r.msg), r.msg);

// 2. missing email
let before = await people();
r = await add(ownerA.u, 'Pat', 'NoEmail', '');
check('2 missing email: one new customer record, invited, no login', r.ok && r.v.outcome === 'created' && (await people()) === before + 1 && (await memberOf(coA, r.v.person_id)).status === 'invited' && (await one(`select user_id from public.people where id = $1`, [r.v.person_id])).user_id === null, JSON.stringify(r));
before = await people();
r = await add(ownerA.u, 'Pat', 'NoEmail', '');
check('2b adding the same name with no email again is NOT guessed to be the same person (no name matching) - the owner decides', r.ok && (await people()) === before + 1);

// 3. same email twice, no account
r = await add(ownerA.u, 'Lee', 'Placeholder', 'Lee@X.test');
const leeId = r.v.person_id;
before = await people();
const r2 = await add(ownerA.u, 'Lee', 'Placeholder', 'lee@x.test');
check('3 same email again (any capitalisation) returns the same record: no duplicate', r.ok && r2.ok && r2.v.person_id === leeId && r2.v.outcome === 'already_customer' && (await people()) === before);

// 4. existing account at another company
const existing = await login('existing@x.test', 'Existing');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'customer','active')`, [coB, existing.pid]);
before = await people();
r = await add(ownerA.u, 'Typed', 'Differently', 'EXISTING@x.test');
check('4 an existing account (at another company): that SAME person is added to this company as an invited customer; no second person', r.ok && r.v.person_id === existing.pid && r.v.outcome === 'existing_account' && (await people()) === before && (await memberOf(coA, existing.pid)).status === 'invited', JSON.stringify(r));
check('4b their other company membership is untouched, and their name was not overwritten by what the owner typed', (await memberOf(coB, existing.pid)).status === 'active' && (await one(`select first_name from public.people where id = $1`, [existing.pid])).first_name === 'Existing');
r = await add(ownerA.u, 'Typed', 'Again', 'existing@x.test');
check('4c adding them again is a no-op (already a customer here)', r.ok && r.v.outcome === 'already_customer' && (await one(`select count(*)::int c from public.company_members where company_id = $1 and person_id = $2`, [coA, existing.pid])).c === 1);

// 5. a record from ANOTHER company is never reused or changed
const otherPh = (await one(`insert into public.people (email, first_name, last_name) values ('shared@x.test', 'Their', 'Record') returning id`)).id;
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'customer','invited')`, [coB, otherPh]);
r = await add(ownerA.u, 'Mine', 'Own', 'shared@x.test');
check('5 an owner-created record of another company with the same email is not reused or changed: this company gets its own', r.ok && r.v.person_id !== otherPh && r.v.outcome === 'created' && (await one(`select first_name from public.people where id = $1`, [otherPh])).first_name === 'Their' && !(await memberOf(coA, otherPh)));

// 6. inactive membership
const removed = await login('removed@x.test', 'Removed');
await db.query(`insert into public.company_members (company_id, person_id, role, status, deactivated_by) values ($1,$2,'customer','inactive',$3)`, [coA, removed.pid, ownerA.pid]);
r = await add(ownerA.u, 'Re', 'Moved', 'removed@x.test');
check('6 a customer whose access the owner REMOVED is not silently re-added', !r.ok && /access was removed/.test(r.msg) && (await memberOf(coA, removed.pid)).status === 'inactive', r.msg);
const selfOff = await login('selfoff@x.test', 'SelfOff');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'customer','inactive')`, [coA, selfOff.pid]);
r = await add(ownerA.u, 'Self', 'Off', 'selfoff@x.test');
check('6b an inactive customer (not removed by the owner) is returned as the same person, no duplicate', r.ok && r.v.person_id === selfOff.pid);

// 7. team member / account outside the company
r = await add(ownerA.u, 'Wor', 'Ker', 'worker@x.test');
check('7 an email that belongs to a team member is refused (they are not a customer)', !r.ok && /someone on your team/.test(r.msg), r.msg);
const outsider = await login('outsider@x.test', 'Outsider');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'worker','active')`, [coB, outsider.pid]);
before = await people();
r = await add(ownerA.u, 'Out', 'Sider', 'outsider@x.test');
check('7b an account that works for another company becomes a customer here with the same person; their other role is untouched; nothing is assigned to them', r.ok && r.v.person_id === outsider.pid && (await people()) === before && (await memberOf(coB, outsider.pid)).role === 'worker'
  && (await one(`select count(*)::int c from public.projects where customer_id = $1`, [outsider.pid])).c === 0);

// 8. bad input
r = await add(ownerA.u, '', 'X', 'a@x.test');
check('8 a first name is required', !r.ok && /first name/.test(r.msg), r.msg);
r = await add(ownerA.u, 'A', 'B', 'not-an-email');
check('8b a bad email is refused', !r.ok && /email/.test(r.msg), r.msg);

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
