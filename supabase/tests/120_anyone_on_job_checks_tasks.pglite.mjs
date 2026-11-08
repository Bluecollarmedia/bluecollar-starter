// Update 120: anyone on a job can check off its tasks by default; the owner can switch back to Task-Lead-only. Real full schema on PGlite (not real Supabase).
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`);
check('0 the full schema and all updates (including 120) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/120_anyone_on_job_checks_tasks.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 120 can be run a second time', again);

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
const w3 = await mk('w3@x.test', 'Cy');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'owner','active','landscaping'),($1,$3,'worker','active','landscaping'),($1,$4,'worker','active','landscaping'),($1,$5,'worker','active','landscaping')`, [co, owner.pid, w1.pid, w2.pid, w3.pid]);
const proj = (await one(`insert into public.projects (company_id, name, status) values ($1,'Job','active') returning id`, [co])).id;
const assign = (who, status = 'scheduled') => db.query(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, status) values ($1,$2,$3,$4,$5)`, [co, proj, who.pid, today, status]);
await assign(w1); await assign(w2); // two workers: no automatic lead
const task = async (title) => (await one(`insert into public.project_tasks (company_id, project_id, title, status, sort_order) values ($1,$2,$3,'pending',1) returning id`, [co, proj, title])).id;
const tryComplete = async (who, id) => {
  await asUser(who.u);
  let ok = true, msg = '';
  try { await db.query(`update public.project_tasks set status = 'completed' where id = $1`, [id]); } catch (e) { ok = false; msg = String(e.message); }
  await asDb();
  return { ok, msg };
};

const t1 = await task('Trim');
const r1 = await tryComplete(w1, t1);
check('1 default: a worker on a job with NO Task Lead can check off a task', r1.ok, r1.msg);
const row = await one(`select completed_by from public.project_tasks where id = $1`, [t1]);
check('1b the database stamps who completed it', row.completed_by === w1.pid, JSON.stringify(row));

const t2 = await task('Edge');
const r2 = await tryComplete(w3, t2);
check('2 a worker who is NOT on the job still cannot', !r2.ok && /on this job/.test(r2.msg), r2.msg);

await db.query(`update public.projects set task_lead_id = $2 where id = $1`, [proj, w1.pid]);
const t3 = await task('Blow');
const r3 = await tryComplete(w2, t3);
check('3 with a Task Lead picked, another worker on the job can still check off (default)', r3.ok, r3.msg);

await db.query(`update public.companies set task_lead_only = true where id = $1`, [co]);
const t4 = await task('Mulch');
const r4 = await tryComplete(w2, t4);
check('4 with "Task Lead only" on, a non-lead worker cannot', !r4.ok && /Task Lead/.test(r4.msg), r4.msg);
const r5 = await tryComplete(w1, t4);
check('5 with "Task Lead only" on, the Task Lead can', r5.ok, r5.msg);

await db.query(`update public.projects set task_lead_id = null where id = $1`, [proj]);
const t6 = await task('Water');
const r6 = await tryComplete(w1, t6);
check('6 "Task Lead only" with no lead picked: nobody on the crew can (as before)', !r6.ok && /no Task Lead/.test(r6.msg), r6.msg);

await db.query(`update public.companies set task_lead_only = false where id = $1`, [co]);
await asUser(w1.u);
let edit = true;
try { await db.query(`update public.project_tasks set title = 'Hacked' where id = $1`, [t6]); } catch { edit = false; }
await asDb();
check('7 a worker still cannot edit a task title', !edit);

await asUser(w1.u);
let reopen = true, rmsg = '';
try { await db.query(`update public.project_tasks set status = 'pending' where id = $1`, [t1]); } catch (e) { reopen = false; rmsg = e.message; }
await asDb();
check('8 a worker on the job can reopen a task', reopen, rmsg);
