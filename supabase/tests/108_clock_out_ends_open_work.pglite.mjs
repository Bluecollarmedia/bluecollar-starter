// Update 108: clocking out for the day ends open project time, an open break and an open route-stop interval. Real full schema on PGlite.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';
const repo = process.argv[2];
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
const { db, failures } = await buildFullSchema(repo);
check('0 the full schema including 108 loads', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/108_clock_out_ends_open_work.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('1 update 108 can be run a second time', again);
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: e.message }; } finally { await db.exec('reset role'); } };
const today = (await db.query(`select current_date::text as d`)).rows[0].d;
const co = (await one(`insert into public.companies (name) values ('Test Co') returning id`)).id;
const mk = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1,$2,$3,'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const owner = await mk('o@x.test', 'Owner');
const w1 = await mk('w1@x.test', 'Land One');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'owner','active','landscaping'),($1,$3,'worker','active','landscaping')`, [co, owner.pid, w1.pid]);
const project = (await one(`insert into public.projects (company_id, name, status) values ($1,'Job A','active') returning id`, [co])).id;
const asg = (await one(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, sort_order, status) values ($1,$2,$3,$4,1,'confirmed') returning id`, [co, project, w1.pid, today])).id;
await db.query(`insert into public.worker_hourly_rates (company_id, person_id, hourly_rate, effective_date) values ($1,$2,20,'2020-01-01')`, [co, w1.pid]);
await db.query(`insert into public.time_settings (company_id, breaks_enabled, breaks_paid) values ($1, true, false)`, [co]);

let r = await rpc(w1.u, `select public.time_clock_in($1::date, null, gen_random_uuid()) as x`, [today]);
check('2 the worker clocks in', r.ok, r.msg);
r = await rpc(w1.u, `select public.time_start_visit('assignment', $1::uuid) as x`, [asg]);
check('3 the worker starts the project', r.ok && !!r.v.current, JSON.stringify(r));
r = await rpc(w1.u, `select public.time_clock_out() as x`);
check('4 clocking out for the day works even though the project was never completed', r.ok && r.v.days[0].clock_out_at !== null && r.v.days[0].status === 'closed', r.msg);
r = await rpc(w1.u, `select public.time_my_day($1::date) as x`, [today]);
check('5 nothing is left running: no current visit', r.ok && !r.v.current, JSON.stringify(r.v?.current));
await db.exec('reset role');
const a = await one(`select status from public.assignments where id = $1`, [asg]);
const co2 = await one(`select count(*)::int c from public.check_outs where assignment_id = $1`, [asg]);
const open = await one(`select count(*)::int c from public.time_intervals where person_id = $1 and ended_at is null`, [w1.pid]);
check('6 the project is marked completed, with a check-out record, and no interval is left open', a.status === 'completed' && co2.c === 1 && open.c === 0, JSON.stringify([a, co2, open]));

// a second day: a break still running ends too
await db.query(`delete from public.time_workdays where person_id = $1`, [w1.pid]);
await db.query(`update public.assignments set status = 'confirmed' where id = $1`, [asg]);
r = await rpc(w1.u, `select public.time_clock_in($1::date, null, gen_random_uuid()) as x`, [today]);
r = await rpc(w1.u, `select public.time_break_start() as x`);
check('7 a break can be started', r.ok, r.msg);
r = await rpc(w1.u, `select public.time_clock_out() as x`);
check('8 clocking out with the break still running works and ends the break', r.ok && r.v.days[0].breaks.length === 1 && r.v.days[0].breaks[0].ended_at !== null, r.msg);
r = await rpc(w1.u, `select public.time_clock_out() as x`);
check('9 clocking out again is harmless (already closed)', r.ok && r.v.already_closed === true, r.msg);
console.log(results.every(Boolean) ? 'all passed' : 'FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
