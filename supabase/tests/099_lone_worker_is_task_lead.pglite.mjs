// Update 99: a job with no Task Lead and exactly one worker makes that worker the Task Lead. Real full schema on PGlite (not real Supabase).
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 99) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/099_lone_worker_is_task_lead.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 99 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const today = (await db.query(`select current_date::text as d`)).rows[0].d;

const co = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
const mk = async (email, name) => {
  await asDb();
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const owner = await mk('owner@x.test', 'Owner');
const w1 = await mk('w1@x.test', 'Ann');
const w2 = await mk('w2@x.test', 'Bo');
const adm = await mk('adm@x.test', 'Adm');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'owner','active','landscaping'),($1,$3,'worker','active','landscaping'),($1,$4,'worker','active','landscaping'),($1,$5,'admin','active','landscaping')`, [co, owner.pid, w1.pid, w2.pid, adm.pid]);
const proj = async (n) => (await one(`insert into public.projects (company_id, name, status) values ($1,$2,'active') returning id`, [co, n])).id;
const lead = async (id) => (await one(`select task_lead_id from public.projects where id = $1`, [id])).task_lead_id;
const assign = (p, who, status = 'scheduled') => db.query(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, status) values ($1,$2,$3,$4,$5)`, [co, p, who.pid, today, status]);

const a = await proj('One worker');
await assign(a, w1);
check('1 one worker on a job with no lead becomes the Task Lead', (await lead(a)) === w1.pid, await lead(a));

const b = await proj('Two workers');
await assign(b, w1); await assign(b, w2);
check('2 a second worker added later does not take the lead (the first stays; the owner can change it)', (await lead(b)) === w1.pid);
await db.query(`update public.projects set task_lead_id = $2 where id = $1`, [b, w2.pid]);
check('2b the owner can still pick someone else', (await lead(b)) === w2.pid);

const c = await proj('Owner picked');
await db.query(`update public.projects set task_lead_id = $2 where id = $1`, [c, w2.pid]);
await assign(c, w1);
check('3 a lead the owner picked is never replaced', (await lead(c)) === w2.pid);

const d = await proj('Admin only');
await assign(d, adm);
check('4 an admin on a job is never made lead', (await lead(d)) === null);

const e = await proj('Cancelled');
await assign(e, w1, 'cancelled');
check('5 a cancelled assignment does not count', (await lead(e)) === null);

// The worker can now tick a task: the existing rule lets the Task Lead change a task's status.
const t = (await one(`insert into public.project_tasks (company_id, project_id, title, status, sort_order) values ($1,$2,'Trim','pending',1) returning id`, [co, a])).id;
await asUser(w1.u);
let ok = true, msg = '';
try { await db.query(`update public.project_tasks set status = 'completed' where id = $1`, [t]); } catch (err) { ok = false; msg = String(err.message); }
await asDb();
check('6 the lone worker can complete a task on his job', ok, msg);

// Backfill: a job that already has one worker and no lead is fixed by running the update again.
const f = await proj('Old job');
await db.query(`alter table public.assignments disable trigger trg_auto_task_lead`);
await assign(f, w2);
await db.query(`alter table public.assignments enable trigger trg_auto_task_lead`);
check('7 setup: an old job has one worker and no lead', (await lead(f)) === null);
await db.exec(fs.readFileSync(`${repo}/supabase/updates/099_lone_worker_is_task_lead.sql`, 'utf8'));
check('8 running the update fixes the old job', (await lead(f)) === w2.pid);

console.log(results.every(Boolean) ? '\nall passed' : '\nsome failed');
process.exit(results.every(Boolean) ? 0 : 1);
