// Update 109: clocking in and out is always possible, with or without scheduled work. Real full schema on PGlite.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';
const repo = process.argv[2];
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
const { db, failures } = await buildFullSchema(repo);
check('0 the full schema including 109 loads', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/109_clock_in_any_time.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('1 update 109 can be run a second time', again);
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
const w = await mk('w@x.test', 'Worker With No Job');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'owner','active','landscaping'),($1,$3,'worker','active','landscaping')`, [co, owner.pid, w.pid]);
await db.query(`insert into public.worker_hourly_rates (company_id, person_id, hourly_rate, effective_date) values ($1,$2,20,'2020-01-01')`, [co, w.pid]);

let r = await rpc(w.u, `select public.time_my_day($1::date) as x`, [today]);
check('2 a worker with nothing scheduled is told they can clock in', r.ok && r.v.can_clock_in === true, JSON.stringify(r.v?.can_clock_in) + (r.msg ?? ''));
r = await rpc(w.u, `select public.time_clock_in($1::date, null, gen_random_uuid()) as x`, [today]);
check('3 and they can clock in', r.ok && r.v.days.length === 1 && r.v.days[0].clock_out_at === null, r.msg);
r = await rpc(w.u, `select public.time_clock_out() as x`);
check('4 and clock out', r.ok && r.v.days[0].clock_out_at !== null, r.msg);
r = await rpc(w.u, `select public.time_clock_in($1::date, null, gen_random_uuid()) as x`, [today]);
check('5 and clock back in again, any number of times', r.ok && r.v.days.length === 2 && r.v.days[1].clock_out_at === null, r.msg);
await db.exec('reset role');
const snow = await one(`select public._snow_may_clock_in($1, $2) as ok`, [w.pid, co]);
check('6 the Snow check also says yes with no route and no dispatched storm', snow.ok === true, JSON.stringify(snow));
console.log(results.every(Boolean) ? 'all passed' : 'FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
