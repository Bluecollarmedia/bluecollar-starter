// Update 92: delete a worker or customer who has no login and no history; never one who does.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`);
check('0 the full schema and all updates (including 92) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/092_delete_unused_members.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 92 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
const del = (u, pid) => rpc(u, `select public.delete_unused_member($1::uuid) as x`, [pid]);

const co = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
const mkUser = async (email, name) => {
  await asDb();
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1,$2,$3,'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const placeholder = async (email, name) => (await one(`insert into public.people (email, first_name, last_name) values ($1,$2,'P') returning id`, [email, name])).id;
const owner = await mkUser('owner@x.test', 'Owner');
const plain = await mkUser('plain@x.test', 'Plain');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'owner','active','landscaping'),($1,$3,'worker','active','landscaping')`, [co, owner.pid, plain.pid]);

const w1 = await placeholder('w1@x.test', 'Never');        // worker, nobody linked, no history
const w2 = await placeholder('w2@x.test', 'Worked');       // worker with an assignment
const w3 = await mkUser('w3@x.test', 'Login');             // has a login
const c1 = await placeholder('c1@x.test', 'Newcust');      // customer, nothing yet
const c2 = await placeholder('c2@x.test', 'Hasjob');       // customer with a project
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'worker','active','landscaping'),($1,$3,'worker','active','landscaping'),($1,$4,'worker','active','landscaping'),($1,$5,'customer','active','landscaping'),($1,$6,'customer','active','landscaping')`, [co, w1, w2, w3.pid, c1, c2]);
const crew = (await one(`insert into public.crews (company_id, name) values ($1,'Crew A') returning id`, [co])).id;
await db.query(`insert into public.crew_members (company_id, crew_id, person_id) values ($1,$2,$3)`, [co, crew, w1]);
const proj = (await one(`insert into public.projects (company_id, name, status, customer_id) values ($1,'Job','active',$2) returning id`, [co, c2])).id;
await db.query(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, status) values ($1,$2,$3,current_date,'scheduled')`, [co, proj, w2]);
const exists = async (pid) => !!(await one(`select 1 as x from public.people where id = $1`, [pid]));
const member = async (pid, cid = co) => !!(await one(`select 1 as x from public.company_members where person_id = $1 and company_id = $2`, [pid, cid]));

let r = await del(plain.u, w1);
check('1 a worker (not the owner) cannot delete anyone', !r.ok && /not allowed/.test(r.msg), r.msg);
r = await del(owner.u, w1);
check('2 the owner deletes a worker nobody linked and who never worked', r.ok && r.v.deleted === true, r.msg);
check('3 the person and the membership are gone, and so is the crew placement', !(await exists(w1)) && !(await member(w1)) && +(await one(`select count(*) from public.crew_members where person_id = $1`, [w1])).count === 0);
r = await del(owner.u, w2);
check('4 a worker with a scheduled job is refused (deactivate instead)', !r.ok && /HAS_HISTORY/.test(r.msg) && /assignments/.test(r.msg), r.msg);
check('5 and nothing was removed', (await exists(w2)) && (await member(w2)));
r = await del(owner.u, w3.pid);
check('6 someone with a login is refused (deactivate instead)', !r.ok && /HAS_HISTORY/.test(r.msg) && /login/.test(r.msg), r.msg);
r = await del(owner.u, c1);
check('7 a customer with no records can be deleted', r.ok && !(await exists(c1)) && !(await member(c1)), r.msg);
r = await del(owner.u, c2);
check('8 a customer with a project is refused', !r.ok && /HAS_HISTORY/.test(r.msg) && /projects/.test(r.msg), r.msg);
check('9 every deletion is written to the history', +(await one(`select count(*) from public.membership_audit_log where event_type = 'member_deleted'`)).count === 2);
r = await del(owner.u, owner.pid);
check('10 the owner cannot delete themselves', !r.ok, r.msg);
