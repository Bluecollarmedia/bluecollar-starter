// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && copy this file (and ./helpers/fullSchema.mjs) beside it, then:
//   node <file> <path to the repo>
// Proves update 57 on the REAL full schema + every update (PGlite, not real Supabase): the company OWNER can keep private notes,
// pictures and materials lists for a project (a prospect included, and they stay when it becomes a real project); an admin, a
// worker, a customer and a stranger can neither see nor change them.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 240)}`); };
check('0 the full schema and all updates (including 057) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/057_owner_project_notes.sql`, 'utf8')); } catch (e) { again = false; }
check('0b update 57 can be run a second time', again);
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
const customer = await mk('cust@x.test', 'Cust');
const stranger = await mk('stranger@x.test', 'Stranger');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active'),($1,$3,'admin','active'),($1,$4,'worker','active'),($1,$5,'customer','active')`, [co, owner.pid, admin.pid, worker.pid, customer.pid]);
const proj = (await one(`insert into public.projects (company_id, name, customer_id, status) values ($1, 'Wyndham 2', $2, 'prospect') returning id`, [co, customer.pid])).id;

const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const counts = async () => one(`select (select count(*)::int from public.owner_project_notes) n, (select count(*)::int from public.owner_project_photos) p, (select count(*)::int from public.owner_material_lists) l`);

await asUser(owner.u);
let f = await fails(`insert into public.owner_project_notes (company_id, project_id, body) values ($1, $2, 'Order 12 yards of mulch; 40 ft of edging')`, [co, proj]);
check('1 the owner can write a note while the project is only a quote (prospect)', !f.raised, f.msg);
f = await fails(`insert into public.owner_project_photos (company_id, project_id, file_url, caption) values ($1, $2, 'https://r2.test/site.jpg', 'Back yard before')`, [co, proj]);
check('2 the owner can add a private picture with a caption', !f.raised, f.msg);
f = await fails(`insert into public.owner_material_lists (company_id, project_id, title, items, source_text) values ($1, $2, 'Materials list', '[{"category":"Mulch","item":"Brown mulch","quantity":12,"unit":"yards"}]'::jsonb, 'Order 12 yards of mulch')`, [co, proj]);
check('3 the owner can keep a sorted materials list', !f.raised, f.msg);
const own = await counts();
check('4 the owner sees all three', own.n === 1 && own.p === 1 && own.l === 1, JSON.stringify(own));
await db.exec('reset role');
await db.query(`update public.projects set status = 'active' where id = $1`, [proj]);
await asUser(owner.u);
check('5 after the quote is approved and the project is active, the notes written while quoting are still there', (await counts()).n === 1);
f = await fails(`update public.owner_project_notes set body = 'Order 14 yards of mulch' where project_id = $1`, [proj]);
check('6 the owner can edit a note', !f.raised && (await one(`select body from public.owner_project_notes`)).body === 'Order 14 yards of mulch', f.msg);
f = await fails(`insert into public.owner_project_notes (company_id, project_id, body) values ($1, $2, '   ')`, [co, proj]);
check('7 an empty note is refused', f.raised, f.msg);

for (const [who, label] of [[admin, 'an admin'], [worker, 'a worker'], [customer, 'the customer'], [stranger, 'a stranger']]) {
  await asUser(who.u);
  const seen = await counts();
  check(`8 ${label} sees none of the notes, pictures or lists`, seen.n === 0 && seen.p === 0 && seen.l === 0, JSON.stringify(seen));
  const a = await fails(`insert into public.owner_project_notes (company_id, project_id, body) values ($1, $2, 'sneaky')`, [co, proj]);
  const b = await fails(`insert into public.owner_project_photos (company_id, project_id, file_url) values ($1, $2, 'https://r2.test/z.jpg')`, [co, proj]);
  const c = await fails(`insert into public.owner_material_lists (company_id, project_id, items) values ($1, $2, '[]'::jsonb)`, [co, proj]);
  check(`9 ${label} cannot add any of them`, a.raised && b.raised && c.raised, a.msg + b.msg + c.msg);
}
await db.exec('reset role');
const before = await counts();
for (const who of [admin, worker, customer]) {
  await asUser(who.u);
  await db.query(`delete from public.owner_project_notes`);
  await db.query(`delete from public.owner_project_photos`);
  await db.query(`delete from public.owner_material_lists`);
  await db.query(`update public.owner_project_notes set body = 'changed'`);
}
await db.exec('reset role');
const after = await one(`select (select count(*)::int from public.owner_project_notes) n, (select count(*)::int from public.owner_project_photos) p, (select count(*)::int from public.owner_material_lists) l, (select body from public.owner_project_notes limit 1) b`);
check('10 others cannot delete or change them either (nothing was touched)', after.n === before.n && after.p === before.p && after.l === before.l && after.b === 'Order 14 yards of mulch', JSON.stringify({ before, after }));

await db.exec(`set session_replication_role = replica`);
const co2 = (await one(`insert into public.companies (name) values ('Other Co') returning id`)).id;
await db.exec(`set session_replication_role = origin`);
const otherProj = (await one(`insert into public.projects (company_id, name) values ($1, 'Theirs') returning id`, [co2])).id;
await asUser(owner.u);
f = await fails(`insert into public.owner_project_notes (company_id, project_id, body) values ($1, $2, 'attach to someone else')`, [co, otherProj]);
check('11 a note cannot be attached to another company\'s project', f.raised, f.msg);
f = await fails(`delete from public.owner_project_notes where project_id = $1`, [proj]);
check('12 the owner can delete a note', !f.raised && (await one(`select count(*)::int n from public.owner_project_notes`)).n === 0, f.msg);
await db.exec('reset role');
console.log(results.every(Boolean) ? '\nall passed' : `\n${results.filter((x) => !x).length} failed`);
process.exit(results.every(Boolean) ? 0 : 1);
