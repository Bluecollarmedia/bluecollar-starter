// Update 121: a customer sees only the completed tasks of their own project. Real full schema on PGlite (not real Supabase).
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`);
check('0 the full schema and all updates (including 121) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/121_customer_sees_completed_tasks.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 121 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); };
const co = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
const mk = async (email, name) => {
  await asDb();
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const owner = await mk('owner@x.test', 'Owner');
const cust = await mk('cust@x.test', 'Cat');
const other = await mk('other@x.test', 'Oz');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active'),($1,$3,'customer','active'),($1,$4,'customer','active')`, [co, owner.pid, cust.pid, other.pid]);
const proj = (await one(`insert into public.projects (company_id, name, status, customer_id) values ($1,'Patio','active',$2) returning id`, [co, cust.pid])).id;
await db.query(`insert into public.project_tasks (company_id, project_id, title, status, sort_order) values ($1,$2,'Dig','completed',1),($1,$2,'Pave','pending',2),($1,$2,'Seal','in_progress',3)`, [co, proj]);

await asUser(cust.u);
const mine = (await db.query(`select title, status from public.project_tasks where project_id = $1 order by sort_order`, [proj])).rows;
await asDb();
check('1 the customer sees the completed task', mine.some((r) => r.title === 'Dig'), JSON.stringify(mine));
check('2 the customer does NOT see pending or in-progress tasks', !mine.some((r) => r.status !== 'completed'), JSON.stringify(mine));

await asUser(other.u);
const theirs = (await db.query(`select title from public.project_tasks where project_id = $1`, [proj])).rows;
await asDb();
check('3 another customer sees none of this project\'s tasks', theirs.length === 0, JSON.stringify(theirs));

await asUser(cust.u);
let changed = true;
try { const r = await db.query(`update public.project_tasks set status = 'pending' where project_id = $1 returning id`, [proj]); changed = r.rows.length > 0; } catch { changed = false; }
await asDb();
check('4 a customer cannot change tasks', !changed);

// ── automatic progress ──
const prog = async (id) => (await one(`select progress from public.projects where id = $1`, [id])).progress;
const p2 = (await one(`insert into public.projects (company_id, name, status) values ($1,'Auto','active') returning id`, [co])).id;
const mkTask = async (st) => (await one(`insert into public.project_tasks (company_id, project_id, title, status, sort_order) values ($1,$2,'T','${st}',1) returning id`, [co, p2])).id;
const ta = await mkTask('pending'); const tb = await mkTask('pending'); const tc = await mkTask('pending'); const td = await mkTask('pending');
check('5 four pending tasks: 0%', (await prog(p2)) === 0, await prog(p2));
await db.query(`update public.project_tasks set status='completed' where id = $1`, [ta]);
check('6 one of four done: 25%', (await prog(p2)) === 25, await prog(p2));
await db.query(`update public.project_tasks set status='in_progress' where id = $1`, [tb]);
check('7 one done + one in progress (counts half): 38%', (await prog(p2)) === 38, await prog(p2));
await db.query(`update public.project_tasks set status='completed' where id in ($1,$2,$3)`, [tb, tc, td]);
check('8 all four done: capped at 99 until the project itself is completed', (await prog(p2)) === 99, await prog(p2));
await db.query(`insert into public.project_settings (company_id, project_id, auto_progress) values ($1,$2,false)`, [co, p2]);
await db.query(`update public.projects set progress = 40 where id = $1`, [p2]);
await db.query(`update public.project_tasks set status='pending' where id = $1`, [ta]);
check('9 with auto off, tasks leave a hand-set number alone', (await prog(p2)) === 40, await prog(p2));
await db.query(`update public.project_settings set auto_progress = true where project_id = $1`, [p2]);
await db.query(`update public.project_tasks set status='completed' where id = $1`, [ta]);
check('10 auto back on: the next task change re-estimates', (await prog(p2)) === 99, await prog(p2));
await db.query(`update public.projects set status='completed', progress=100 where id = $1`, [p2]);
await db.query(`update public.project_tasks set status='pending' where id = $1`, [ta]);
check('11 a completed project keeps 100', (await prog(p2)) === 100, await prog(p2));
