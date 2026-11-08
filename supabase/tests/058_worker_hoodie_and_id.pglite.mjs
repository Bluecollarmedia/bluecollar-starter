// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && copy this file (and ./helpers/fullSchema.mjs) beside it, then:
//   node <file> <path to the repo>
// Proves update 58 on the REAL full schema + every update (PGlite, not real Supabase): a worker's hoodie size is a valid size only,
// and the worker's ID photo record can be read only by that worker and the company OWNER (a pending join request included);
// an admin, another worker, the customer and a stranger get nothing; only the worker can add, replace or remove it, and only
// under their own private folder.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 240)}`); };
check('0 the full schema and all updates (including 058) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/058_worker_hoodie_and_id.sql`, 'utf8')); } catch (e) { again = false; }
check('0b update 58 can be run a second time', again);
const fails = async (sql, p) => { try { await db.query(sql, p); return { raised: false, msg: '' }; } catch (e) { return { raised: true, msg: String(e.message) }; } };
const one = async (sql, p) => (await db.query(sql, p)).rows[0];

const co = (await one(`insert into public.companies (name) values ('Test Co') returning id`)).id;
const mk = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const owner = await mk('owner@x.test', 'Owner');
const admin = await mk('admin@x.test', 'Admin');
const worker = await mk('worker@x.test', 'Worker');
const other = await mk('other@x.test', 'Other');
const applicant = await mk('applicant@x.test', 'Applicant');
const customer = await mk('cust@x.test', 'Cust');
const stranger = await mk('stranger@x.test', 'Stranger');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active'),($1,$3,'admin','active'),($1,$4,'worker','active'),($1,$5,'worker','active'),($1,$6,'customer','active')`, [co, owner.pid, admin.pid, worker.pid, other.pid, customer.pid]);
await db.query(`insert into public.join_requests (company_id, person_id, join_method, requested_role) values ($1, $2, 'team_code', 'worker')`, [co, applicant.pid]);
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const key = (p) => `ids/${p}/abc.jpg`;

await asUser(worker.u);
let f = await fails(`update public.people set hoodie_size = 'L' where id = $1`, [worker.pid]);
check('1 a worker can set their own hoodie size', !f.raised && (await one(`select hoodie_size from public.people where id = $1`, [worker.pid])).hoodie_size === 'L', f.msg);
f = await fails(`update public.people set hoodie_size = 'GIANT' where id = $1`, [worker.pid]);
check('2 a made-up size is refused', f.raised, f.msg);
f = await fails(`update public.people set hoodie_size = 'M' where id = $1`, [other.pid]);
await db.exec('reset role');
check('3 a worker cannot change someone elses size (nothing changes)', (await one(`select hoodie_size from public.people where id = $1`, [other.pid])).hoodie_size == null, f.msg);
await asUser(worker.u);
f = await fails(`insert into public.person_ids (person_id, id_key) values ($1, $2)`, [worker.pid, key(worker.pid)]);
check('4 a worker can add their own ID photo', !f.raised, f.msg);
f = await fails(`insert into public.person_ids (person_id, id_key) values ($1, $2)`, [other.pid, key(other.pid)]);
check('5 a worker cannot add an ID for someone else', f.raised, f.msg);
f = await fails(`update public.person_ids set id_key = $2 where person_id = $1`, [worker.pid, `ids/${other.pid}/steal.jpg`]);
check('6 the ID cannot be pointed at someone else\'s folder', f.raised, f.msg);
f = await fails(`update public.person_ids set id_key = $2 where person_id = $1`, [worker.pid, key(worker.pid).replace('abc', 'new')]);
check('7 the worker can replace their ID', !f.raised && (await one(`select id_key from public.person_ids`)).id_key.endsWith('new.jpg'), f.msg);
check('8 the worker can read their own ID record', (await one(`select count(*)::int c from public.person_ids`)).c === 1);

await db.exec('reset role');
await db.query(`insert into public.person_ids (person_id, id_key) values ($1, $2)`, [applicant.pid, key(applicant.pid)]);

await asUser(owner.u);
check('9 the owner sees the ID of a worker on the team and of someone who only asked to join', (await one(`select count(*)::int c from public.person_ids`)).c === 2);
f = await fails(`insert into public.person_ids (person_id, id_key) values ($1, $2)`, [owner.pid, key(owner.pid)]);
check('10 the owner is not blocked from having their own', !f.raised, f.msg);
await db.exec('reset role');
await db.query(`delete from public.person_ids where person_id = $1`, [owner.pid]);

await asUser(owner.u);
await db.query(`update public.person_ids set id_key = 'ids/x/y.jpg'`);
await db.query(`delete from public.person_ids`);
await db.exec('reset role');
check('11 the owner cannot change or delete a worker\'s ID', (await one(`select count(*)::int c from public.person_ids`)).c === 2 && (await one(`select id_key from public.person_ids where person_id = $1`, [applicant.pid])).id_key === key(applicant.pid));

for (const [who, label] of [[admin, 'an admin'], [other, 'another worker'], [customer, 'the customer'], [stranger, 'a stranger']]) {
  await asUser(who.u);
  const seen = (await one(`select count(*)::int c from public.person_ids`)).c;
  check(`12 ${label} sees no IDs`, seen === 0, String(seen));
  await db.query(`delete from public.person_ids`);
  await db.query(`update public.person_ids set id_key = 'ids/x/y.jpg'`);
}
await db.exec('reset role');
check('13 nobody else could delete or change them', (await one(`select count(*)::int c from public.person_ids`)).c === 2);

const sql = fs.readFileSync(`${repo}/supabase/updates/058_worker_hoodie_and_id.sql`, 'utf8');
const media = fs.readFileSync(`${repo}/supabase/functions/media/index.ts`, 'utf8');
check('14 the media function only signs an ID for that person or the owner of their company, and only uploads into the person\'s own ids folder',
  /action === 'id-sign'/.test(media) && /me\.roles\[r\.company_id\] === 'owner'/.test(media) && /first === 'avatars' \|\| first === 'ids' \? second === me\.personId/.test(media) && /presignGet\(key, 300\)/.test(media) && /owner_of_person/.test(sql));

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
