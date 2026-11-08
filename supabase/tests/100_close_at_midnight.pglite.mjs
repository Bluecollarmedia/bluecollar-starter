// Update 100: a workday nobody clocked out of ends at local midnight, at zero hours, until the owner accepts an end time.
// Real full schema on PGlite (not real Supabase).
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 100) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/100_close_at_midnight.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 100 can be run a second time', again);

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
  await db.query(`update public.people set first_name = $2 where id = $1`, [pid, name]);
  return { u, pid };
};
const owner = await mk('owner@x.test', 'Owner');
const late = await mk('late@x.test', 'Late');     // clocked in before local midnight, never clocked out
const fresh = await mk('fresh@x.test', 'Fresh');  // clocked in today
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'owner','active','landscaping'),($1,$3,'worker','active','maintenance'),($1,$4,'worker','active','landscaping')`, [co, owner.pid, late.pid, fresh.pid]);
const tz = (await one(`select public._time_tz($1) as z`, [co])).z;
check('1 the company day ends in Eastern time unless changed', tz === 'America/New_York', tz);

// "Yesterday 23:00 local": one hour before the most recent local midnight.
const lateIn = (await one(`select (date_trunc('day', now() at time zone 'America/New_York') - interval '1 hour') at time zone 'America/New_York' as t`)).t;
await db.query(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at) values ($1,$2,(now() at time zone 'America/New_York')::date - 1,$3)`, [co, late.pid, lateIn]);
await db.query(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at) values ($1,$2,(now() at time zone 'America/New_York')::date, now() - interval '1 minute')`, [co, fresh.pid]);
const day = async (pid) => (await db.query(`select * from public.time_workdays where person_id = $1`, [pid])).rows[0];

check('2 setup: the day started before midnight is still open', !(await day(late.pid)).clock_out_at);
let r = await rpc(owner.u, `select public.time_scan_alerts() as x`);
const L = await day(late.pid);
check('3 the owner opening their screens closes it at zero hours and flags it', r.ok && L.status === 'needs_review' && +new Date(L.clock_out_at) === +new Date(L.clock_in_at), r.msg + JSON.stringify(L));
check('4 the history says why', +(await one(`select count(*) from public.time_audit where workday_id = $1 and action = 'flagged' and reason like '%midnight%'`, [L.id])).count === 1);
const F = await day(fresh.pid);
check('5 a day started today is left alone', F.status === 'active' && !F.clock_out_at, JSON.stringify(F));

r = await rpc(owner.u, `select public.time_review_list() as x`);
check('6 it is on the Needs your OK list', r.ok && r.v.length === 1 && r.v[0].person_id === late.pid, JSON.stringify(r));

// A second forgotten day found by the list itself (the owner never opened the other screens).
const late2 = await mk('late2@x.test', 'Late2');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'worker','active','landscaping')`, [co, late2.pid]);
await db.query(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at) values ($1,$2,(now() at time zone 'America/New_York')::date - 1,$3)`, [co, late2.pid, lateIn]);
r = await rpc(owner.u, `select public.time_review_list() as x`);
check('7 the list itself flags a forgotten day first, so it shows up even if nobody opened the app', r.ok && r.v.length === 2, JSON.stringify(r.v?.map((x) => x.name)));

// The worker opening the app also gets it flagged and can clock in fresh.
const late3 = await mk('late3@x.test', 'Late3');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'worker','active','landscaping')`, [co, late3.pid]);
await db.query(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at) values ($1,$2,(now() at time zone 'America/New_York')::date - 1,$3)`, [co, late3.pid, lateIn]);
r = await rpc(late3.u, `select public.time_my_day(null) as x`);
check('8 the worker opening the app flags it too', r.ok && (await day(late3.pid)).status === 'needs_review', r.msg);

// Accepting a suggestion still works for a midnight-flagged day when something was finished.
const prop = (await one(`insert into public.maintenance_properties (company_id, name, address) values ($1,'Chase','1 St') returning id`, [co])).id;
const contract = (await one(`insert into public.maintenance_contracts (company_id, property_id, name) values ($1,$2,'2026') returning id`, [co, prop])).id;
const route = (await one(`insert into public.maintenance_routes (company_id, service_date, name) values ($1,(now() at time zone 'America/New_York')::date - 1,'R') returning id`, [co])).id;
await db.query(`insert into public.maintenance_route_crew (company_id, route_id, person_id) values ($1,$2,$3)`, [co, route, late.pid]);
await db.query(`insert into public.maintenance_stops (company_id, route_id, property_id, contract_id, sort_order, status, completed_at) values ($1,$2,$3,$4,1,'completed',$5)`, [co, route, prop, contract, new Date(+new Date(lateIn) + 1800000).toISOString()]);
r = await rpc(owner.u, `select public.time_accept_suggested_end($1::uuid) as x`, [L.id]);
const L2 = await day(late.pid);
check('9 one tap settles it at the last finished stop', r.ok && L2.status === 'closed' && Math.abs(+new Date(L2.clock_out_at) - (+new Date(lateIn) + 1800000)) < 2000, r.msg + JSON.stringify(L2));

console.log(results.every(Boolean) ? '\nall passed' : '\nsome failed');
process.exit(results.every(Boolean) ? 0 : 1);
