// Update 91: the crew leader clocks the whole crew out after the last Maintenance stop.
// Real full schema + every update on PGlite (not real Supabase).
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
// Update 98 closes the crew by itself when the last stop is finished, so this older button is tested as it stood at update 97.
// (How the two fit together is tested in 098_auto_close_workday.pglite.mjs.)
const { db, failures } = await buildFullSchema(repo, { upTo: 97 });
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`);
check('0 the full schema and all updates (including 91) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/091_clock_out_whole_crew.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 91 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
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
const lead = await mk('lead@x.test', 'Lead');
const a = await mk('a@x.test', 'Ann');       // clocked in, nothing running -> closed
const b = await mk('b@x.test', 'Bo');        // on a break -> reported, left alone
const c = await mk('c@x.test', 'Cy');        // already clocked out -> untouched
const d = await mk('d@x.test', 'Dee');       // not on the route -> untouched
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'owner','active','landscaping'),($1,$3,'worker','active','maintenance'),($1,$4,'worker','active','maintenance'),($1,$5,'worker','active','maintenance'),($1,$6,'worker','active','maintenance'),($1,$7,'worker','active','maintenance')`, [co, owner.pid, lead.pid, a.pid, b.pid, c.pid, d.pid]);
const prop = (await one(`insert into public.maintenance_properties (company_id, name, address) values ($1,'Chase','1 St') returning id`, [co])).id;
const contract = (await one(`insert into public.maintenance_contracts (company_id, property_id, name) values ($1,$2,'2026') returning id`, [co, prop])).id;
const route = (await one(`insert into public.maintenance_routes (company_id, service_date, name) values ($1,$2,'Route 1') returning id`, [co, today])).id;
await db.query(`insert into public.maintenance_route_crew (company_id, route_id, person_id) values ($1,$2,$3),($1,$2,$4),($1,$2,$5),($1,$2,$6)`, [co, route, lead.pid, a.pid, b.pid, c.pid]);
await db.query(`update public.maintenance_routes set lead_person_id = $2 where id = $1`, [route, lead.pid]);
const stop = (await one(`insert into public.maintenance_stops (company_id, route_id, property_id, contract_id, sort_order) values ($1,$2,$3,$4,1) returning id`, [co, route, prop, contract])).id;

const clockIn = (u) => rpc(u, `select public.time_clock_in($1::date, null, gen_random_uuid()) as x`, [today]);
for (const [p, n] of [[lead, 'Lead'], [a, 'Ann'], [b, 'Bo'], [c, 'Cy'], [d, 'Dee']]) await db.query(`update public.people set first_name = $2 where id = $1`, [p.pid, n]);
for (const p of [lead, a, b, c]) await clockIn(p.u);
await db.query(`insert into public.time_workdays (company_id, person_id, work_date) values ($1,$2,current_date)`, [co, d.pid]);
const wdOf = async (pid) => (await db.query(`select * from public.time_workdays where person_id = $1`, [pid])).rows[0];
await db.query(`update public.time_workdays set clock_out_at = now(), status = 'closed' where person_id = $1`, [c.pid]);
const cOut = (await wdOf(c.pid)).clock_out_at;
const bd = await wdOf(b.pid);
await db.query(`insert into public.time_breaks (company_id, workday_id, person_id) values ($1,$2,$3)`, [co, bd.id, b.pid]);

const crewOut = (u) => rpc(u, `select public.maintenance_clock_out_crew($1::uuid) as x`, [route]);

let r = await crewOut(lead.u);
check('1 it is refused while a stop is still open', !r.ok && /Finish every stop/.test(r.msg), r.msg);
await db.query(`update public.maintenance_stops set status = 'completed', completed_at = now() where id = $1`, [stop]);

r = await crewOut(a.u);
check('2 a crew member who is not the leader cannot do it', !r.ok && /Only the crew leader/.test(r.msg), r.msg);
r = await crewOut(d.u);
check('3 someone who is not on the route cannot do it', !r.ok && /Only the crew leader/.test(r.msg), r.msg);

r = await crewOut(lead.u);
check('4 the leader clocks the crew out', r.ok, r.msg);
const names = (r.v?.closed ?? []).map((x) => x.first_name).sort();
check('5 the leader and the clocked-in crew member are closed', JSON.stringify(names) === JSON.stringify(['Ann', 'Lead']), JSON.stringify(r.v));
check('6 their days are closed with a real end time', (await wdOf(a.pid)).status === 'closed' && !!(await wdOf(a.pid)).clock_out_at && (await wdOf(lead.pid)).status === 'closed');
check('7 someone on a break is left alone and reported', (r.v?.still_working ?? []).length === 1 && r.v.still_working[0].first_name === 'Bo' && !(await wdOf(b.pid)).clock_out_at, JSON.stringify(r.v));
check('8 a day already closed is not touched', +new Date((await wdOf(c.pid)).clock_out_at) === +new Date(cOut));
check('9 a worker not on the route is not touched', !(await wdOf(d.pid)).clock_out_at);
check('10 each closing is written to the history', +(await one(`select count(*) from public.time_audit where action = 'crew_clock_out'`)).count === 2);

r = await crewOut(lead.u);
check('11 doing it again changes nothing more', r.ok && r.v.closed.length === 0 && r.v.still_working.length === 1, JSON.stringify(r.v));
r = await crewOut(owner.u);
check('12 the owner can do it too', r.ok, r.msg);
r = await rpc(lead.u, `select public.maintenance_clock_out_crew(gen_random_uuid()) as x`);
check('13 an unknown route is refused', !r.ok && /Route not found/.test(r.msg), r.msg);
