// Update 101: the owner settles a day waiting for review with NO hours. Real full schema on PGlite (not real Supabase).
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 101) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/101_settle_with_no_hours.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 101 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };

const co = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
const mk = async (email, name) => {
  await asDb();
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const owner = await mk('owner@x.test', 'Owner');
const w = await mk('w@x.test', 'Yosef');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'owner','active','landscaping'),($1,$3,'worker','active','landscaping')`, [co, owner.pid, w.pid]);
const lateIn = (await one(`select (date_trunc('day', now() at time zone 'America/New_York') - interval '1 hour') at time zone 'America/New_York' as t`)).t;
const wd = (await one(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at) values ($1,$2,(now() at time zone 'America/New_York')::date - 1,$3) returning id`, [co, w.pid, lateIn])).id;
let r = await rpc(owner.u, `select public.time_review_list() as x`);
check('1 setup: the forgotten day is on the list', r.ok && r.v.length === 1, JSON.stringify(r));

r = await rpc(w.u, `select public.time_settle_no_hours($1::uuid) as x`, [wd]);
check('2 a worker cannot settle a day', !r.ok, r.msg);
r = await rpc(owner.u, `select public.time_settle_no_hours($1::uuid, 'Clocked in by mistake') as x`, [wd]);
const d = await one(`select * from public.time_workdays where id = $1`, [wd]);
check('3 the owner settles it: zero length, closed', r.ok && d.status === 'closed' && +new Date(d.clock_out_at) === +new Date(d.clock_in_at), r.msg + JSON.stringify(d));
r = await rpc(owner.u, `select public.time_review_list() as x`);
check('4 it is off the list', r.ok && r.v.length === 0, JSON.stringify(r));
check('5 the history has it with the reason', +(await one(`select count(*) from public.time_audit where workday_id = $1 and action = 'settled_no_hours' and reason = 'Clocked in by mistake'`, [wd])).count === 1);
r = await rpc(owner.u, `select public.time_settle_no_hours($1::uuid) as x`, [wd]);
check('6 doing it again is refused (already settled)', !r.ok && /already settled/.test(r.msg), r.msg);
check('7 it counts zero paid time', +(await one(`select public._time_net_ms($1) as ms`, [wd])).ms === 0);

console.log(results.every(Boolean) ? '\nall passed' : '\nsome failed');
process.exit(results.every(Boolean) ? 0 : 1);
