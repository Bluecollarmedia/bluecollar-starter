// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && copy this file (and ./helpers/fullSchema.mjs) beside it, then:
//   node <file> <path to the repo>
// Proves update 56 on the REAL full schema + every update (PGlite, not real Supabase): the company OWNER can keep documents and
// private notes for a truck; an admin, a worker, a customer and a stranger can neither see nor change them.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 240)}`); };
check('0 the full schema and all updates (including 056) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/056_truck_documents_notes.sql`, 'utf8')); } catch (e) { again = false; }
check('0b update 56 can be run a second time', again);
const fails = async (sql, p) => { try { await db.query(sql, p); return { raised: false, msg: '' }; } catch (e) { return { raised: true, msg: String(e.message) }; } };
const one = async (sql, p) => (await db.query(sql, p)).rows[0];

const co = (await one(`insert into public.companies (name) values ('Test Co') returning id`)).id;
const co2 = (await one(`select 1`)) && null;
const mk = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const owner = await mk('owner@x.test', 'Owner');
const admin = await mk('admin@x.test', 'Admin');
const worker = await mk('worker@x.test', 'Worker');
const customer = await mk('cust@x.test', 'Cust');
const stranger = await mk('stranger@x.test', 'Stranger');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active'),($1,$3,'admin','active'),($1,$4,'worker','active'),($1,$5,'customer','active')`, [co, owner.pid, admin.pid, worker.pid, customer.pid]);
const truck = (await one(`insert into public.trucks (company_id, name) values ($1, 'Truck 5') returning id`, [co])).id;

const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
await asUser(owner.u);
let f = await fails(`insert into public.truck_documents (company_id, truck_id, kind, title, file_url, content_type, expires_on) values ($1, $2, 'insurance', 'Insurance 2026', 'https://r2.test/x.pdf', 'application/pdf', '2027-01-31')`, [co, truck]);
check('1 the owner can add an insurance PDF with an expiry date', !f.raised, f.msg);
f = await fails(`insert into public.truck_notes (company_id, truck_id, body) values ($1, $2, 'Needs new tires in March')`, [co, truck]);
check('2 the owner can add a private note', !f.raised, f.msg);
const own = await one(`select (select count(*)::int from public.truck_documents) d, (select count(*)::int from public.truck_notes) n`);
check('3 the owner sees them', own.d === 1 && own.n === 1, JSON.stringify(own));
f = await fails(`update public.truck_notes set body = 'Needs new tires in April' where truck_id = $1`, [truck]);
check('4 the owner can edit a note', !f.raised && (await one(`select body from public.truck_notes`)).body === 'Needs new tires in April', f.msg);
f = await fails(`insert into public.truck_documents (company_id, truck_id, kind, title, file_url) values ($1, $2, 'bogus', 'x', 'https://r2.test/y')`, [co, truck]);
check('5 only the known document kinds are accepted', f.raised, f.msg);

for (const [who, label] of [[admin, 'an admin'], [worker, 'a worker'], [customer, 'a customer'], [stranger, 'a stranger']]) {
  await asUser(who.u);
  const seen = await one(`select (select count(*)::int from public.truck_documents) d, (select count(*)::int from public.truck_notes) n`);
  check(`6 ${label} sees none of the documents or notes`, seen.d === 0 && seen.n === 0, JSON.stringify(seen));
  const a = await fails(`insert into public.truck_notes (company_id, truck_id, body) values ($1, $2, 'sneaky')`, [co, truck]);
  const b = await fails(`insert into public.truck_documents (company_id, truck_id, kind, title, file_url) values ($1, $2, 'other', 'sneaky', 'https://r2.test/z')`, [co, truck]);
  check(`7 ${label} cannot add a note or a document`, a.raised && b.raised, a.msg + b.msg);
}
await db.exec('reset role');
const before = await one(`select (select count(*)::int from public.truck_documents) d, (select count(*)::int from public.truck_notes) n`);
for (const who of [admin, worker]) {
  await asUser(who.u);
  await db.query(`delete from public.truck_notes`);
  await db.query(`delete from public.truck_documents`);
  await db.query(`update public.truck_notes set body = 'changed'`);
}
await db.exec('reset role');
const after = await one(`select (select count(*)::int from public.truck_documents) d, (select count(*)::int from public.truck_notes) n, (select body from public.truck_notes limit 1) b`);
check('8 an admin or worker cannot delete or change them either (nothing was touched)', after.d === before.d && after.n === before.n && after.b === 'Needs new tires in April', JSON.stringify({ before, after }));

// The truck must belong to the owner's own company.
await db.exec('reset role');
await db.exec(`set session_replication_role = replica`);
const co2id = (await one(`insert into public.companies (name) values ('Other Co') returning id`)).id;
await db.exec(`set session_replication_role = origin`);
const otherTruck = (await one(`insert into public.trucks (company_id, name) values ($1, 'Theirs') returning id`, [co2id])).id;
await asUser(owner.u);
f = await fails(`insert into public.truck_notes (company_id, truck_id, body) values ($1, $2, 'attach to someone else')`, [co, otherTruck]);
check('9 a note cannot be attached to another company\'s truck', f.raised, f.msg);
f = await fails(`delete from public.truck_notes where truck_id = $1`, [truck]);
check('10 the owner can delete a note', !f.raised && (await one(`select count(*)::int n from public.truck_notes`)).n === 0, f.msg);
await db.exec('reset role');
console.log(results.every(Boolean) ? '\nall passed' : `\n${results.filter((x) => !x).length} failed`);
process.exit(results.every(Boolean) ? 0 : 1);
