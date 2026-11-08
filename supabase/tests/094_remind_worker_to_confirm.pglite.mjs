// Update 94: "Remind" sends the worker a push notification (an in-app notification the existing push trigger sends), at most once an hour.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 94) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/094_remind_worker_to_confirm.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 94 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await db.exec('reset role'); } };
const signUp = async (email, meta) => {
  await db.exec('reset role');
  const u = (await one(`insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`, [email, JSON.stringify(meta)])).id;
  return { u, pid: (await one(`select id from public.people where user_id = $1`, [u])).id };
};

const owner = await signUp('o@x.test', { first_name: 'Owner', last_name: 'O', company_name: 'Acme' });
const co = (await one(`select company_id from public.company_members where person_id = $1 and role = 'owner'`, [owner.pid])).company_id;
const w = await signUp('w@x.test', { first_name: 'Yosef', last_name: 'N' });
const other = await signUp('x@x.test', { first_name: 'Other', last_name: 'W' });
const ghost = (await one(`insert into public.people (email, first_name, last_name) values ('g@x.test','Ghost','G') returning id`)).id;
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'worker','active','landscaping'),($1,$3,'worker','active','landscaping'),($1,$4,'worker','active','landscaping')`, [co, w.pid, other.pid, ghost]);
const proj = (await one(`insert into public.projects (company_id, name, status) values ($1,'Vineyard project','active') returning id`, [co])).id;
let made = 0;
const mk = async (pid, state = 'awaiting', status = 'scheduled') => { const pj = made++ === 0 ? proj : (await one(`insert into public.projects (company_id, name, status) values ($1,$2,'active') returning id`, [co, `Job ${made}`])).id; return (await one(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, is_full_day, status, confirmation_state) values ($1,$2,$3,current_date,true,$4,$5) returning id`, [co, pj, pid, status, state])).id; };
const a1 = await mk(w.pid);
const remind = (u, id) => rpc(u, `select public.remind_worker_assignment($1::uuid) as x`, [id]);
const notes = async (pid) => (await db.query(`select * from public.app_notifications where recipient_id = $1 and event_type = 'schedule_reminder'`, [pid])).rows;

let r = await remind(other.u, a1);
check('1 a worker cannot remind anyone', !r.ok && /not allowed/.test(r.msg), r.msg);
r = await remind(owner.u, a1);
check('2 the owner\'s Remind sends the worker one notification', r.ok && r.v.sent === true && (await notes(w.pid)).length === 1, JSON.stringify(r));
const n = (await notes(w.pid))[0];
check('3 it says which job and when, and asks them to confirm', /Vineyard project/.test(n.body) && /today/.test(n.body) && /confirm/i.test(n.body) && /confirm/i.test(n.title), JSON.stringify(n));
check('4 it is addressed to the worker and linked to the job', n.recipient_id === w.pid && n.linked_entity_id === a1);
r = await remind(owner.u, a1);
check('5 a second tap within the hour sends nothing more and says why', r.ok && r.v.sent === false && r.v.reason === 'recent' && (await notes(w.pid)).length === 1, JSON.stringify(r));
await db.query(`update public.app_notifications set created_at = now() - interval '2 hours' where recipient_id = $1`, [w.pid]);
r = await remind(owner.u, a1);
check('6 after an hour it can be sent again', r.ok && r.v.sent === true && (await notes(w.pid)).length === 2, JSON.stringify(r));
const a2 = await mk(w.pid, 'confirmed');
r = await remind(owner.u, a2);
check('7 a job the worker already confirmed is not reminded', r.ok && r.v.sent === false && r.v.reason === 'confirmed', JSON.stringify(r));
const a3 = await mk(ghost);
r = await remind(owner.u, a3);
check('8 a worker with no login cannot be reached: nothing is sent and the owner is told', r.ok && r.v.sent === false && r.v.reason === 'no_login' && (await notes(ghost)).length === 0, JSON.stringify(r));
const a4 = await mk(other.pid, 'awaiting', 'completed');
r = await remind(owner.u, a4);
check('9 a finished job is not reminded', r.ok && r.v.sent === false && r.v.reason === 'done', JSON.stringify(r));
await db.query(`insert into public.push_tokens (person_id, token) values ($1, 'ExponentPushToken[abc]')`, [other.pid]).catch(() => {});
const a5 = await mk(other.pid);
r = await remind(owner.u, a5);
check('10 it reports how many phones are registered (so a worker with none is told honestly)', r.ok && r.v.sent === true && typeof r.v.devices === 'number', JSON.stringify(r));
console.log(results.every(Boolean) ? '\nall passed' : '\nsome failed');
process.exit(results.every(Boolean) ? 0 : 1);
