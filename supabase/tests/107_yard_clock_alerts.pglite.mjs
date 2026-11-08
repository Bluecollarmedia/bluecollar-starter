// Update 107: clock-in location alerts, using the company's existing yard. Real full schema on PGlite (not real Supabase).
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';
const repo = process.argv[2];
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
const { db, failures } = await buildFullSchema(repo);
check('0 the full schema including 107 loads', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/107_yard_clock_alerts.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('1 update 107 can be run a second time', again);
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asRole = async (role, u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u ?? ''}', false); set role ${role};`); };
const call = async (role, u, sql, p) => { await asRole(role, u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: e.message }; } };
const mkUser = async (email) => {
  await db.exec('reset role');
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1,$2,'T','T') returning id`, [u, email])).id;
  return { u, pid };
};
await db.exec('reset role');
const co = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
const owner = await mkUser('o@x.test');
const worker = await mkUser('w@x.test');
const worker2 = await mkUser('w2@x.test');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'owner','active','landscaping'),($1,$3,'worker','active','landscaping'),($1,$4,'worker','active','landscaping')`, [co, owner.pid, worker.pid, worker2.pid]);
const mkDay = async (pid, day) => { await db.exec('reset role'); return (await one(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, clock_out_at) values ($1,$2,$3::date,($3::date + time '08:00')::timestamptz,($3::date + time '09:00')::timestamptz) returning id`, [co, pid, day])).id; };

const LAT = 40.0960; const LNG = -74.2170;
const SET = (r = 152, on = true, mail = null) => call('authenticated', owner.u, `select public.owner_set_yard_alerts($1,$2,$3) as x`, [r, on, mail]);
const REC = (u, d, lat, lng, note = null) => call('authenticated', u, `select public.time_record_clock_in_location($1,$2,$3,10,$4) as x`, [d, lat, lng, note]);

let r = await call('authenticated', owner.u, `select public.owner_get_yard_alerts() as x`);
check('2 before anything is set: no yard, alerts off, default radius', r.ok && r.v.yard_set === false && r.v.alert_on === false && r.v.radius_m === 152, JSON.stringify(r));
{
  const x = await call('authenticated', worker.u, `select public.owner_set_yard_alerts(150,true,null) as x`);
  const y = await call('authenticated', worker.u, `select public.owner_get_yard_alerts() as x`);
  check('3 a worker cannot read or change the alert settings', !x.ok && !y.ok, JSON.stringify([x, y]));
}
const anon = await call('anon', null, `select public.owner_get_yard_alerts() as x`);
check('4 a signed-out caller cannot read them', !anon.ok);
r = await SET(5);
check('5 a radius that is too small is refused', !r.ok, JSON.stringify(r));
r = await SET(152, true, 'not-an-email');
check('6 a bad alert email is refused', !r.ok, JSON.stringify(r));

// The yard itself is the company's existing Yard Location.
await db.exec('reset role');
await db.query(`update public.companies set yard_address = '111 Spruce St', yard_city = 'Lakewood', yard_state = 'NJ', yard_latitude = $2, yard_longitude = $3 where id = $1`, [co, LAT, LNG]);
r = await SET(152, true, 'boss@x.test');
check('7 the owner turns alerts on; the existing yard shows with them', r.ok && r.v.yard_set === true && r.v.alert_on === true && r.v.alert_email === 'boss@x.test' && /Spruce/.test(r.v.yard_address), JSON.stringify(r));

const d1 = await mkDay(worker.pid, '2026-12-08');
r = await REC(worker.u, d1, LAT + 0.0003, LNG);
check('8 at the yard: recorded, inside, no email needed', r.ok && r.v.recorded === true && r.v.outside === false && r.v.alert_needed === false, JSON.stringify(r));
r = await REC(worker.u, d1, LAT + 0.05, LNG);
check('9 a second record for the same workday does nothing', r.ok && r.v.recorded === false && r.v.alert_needed === false, JSON.stringify(r));

const d2 = await mkDay(worker.pid, '2026-12-09');
r = await REC(worker.u, d2, LAT + 0.01, LNG);
check('10 about 1.1 km away: outside, and the owner should be emailed', r.ok && r.v.outside === true && r.v.alert_needed === true && r.v.distance_m > 1000 && r.v.distance_m < 1200, JSON.stringify(r));

const d3 = await mkDay(worker.pid, '2026-12-10');
r = await call('authenticated', worker.u, `select public.time_record_clock_in_location($1,null,null,null,'location unavailable') as x`, [d3]);
check('11 no location could be read: the owner should still be emailed', r.ok && r.v.recorded === true && r.v.alert_needed === true && r.v.outside === null, JSON.stringify(r));

const d4 = await mkDay(worker2.pid, '2026-12-10');
r = await REC(worker.u, d4, LAT, LNG);
check('12 a worker cannot record a location for someone else\'s workday', !r.ok, JSON.stringify(r));

await SET(152, false);
const d5 = await mkDay(worker.pid, '2026-12-11');
r = await REC(worker.u, d5, LAT + 0.01, LNG);
check('13 with alerts switched off nobody is emailed, even far away', r.ok && r.v.outside === true && r.v.alert_needed === false, JSON.stringify(r));

await SET(1000, true);
const d6 = await mkDay(worker.pid, '2026-12-12');
r = await REC(worker.u, d6, LAT + 0.005, LNG);
check('14 the radius is the owner\'s choice: 550 m away is inside a 1000 m yard', r.ok && r.v.outside === false && r.v.alert_needed === false, JSON.stringify(r));

await db.exec('reset role');
await db.query(`update public.companies set yard_latitude = null, yard_longitude = null where id = $1`, [co]);
const d7 = await mkDay(worker.pid, '2026-12-13');
r = await REC(worker.u, d7, LAT + 0.5, LNG);
check('15 with no yard set nothing is flagged and nobody is emailed', r.ok && r.v.recorded === true && r.v.yard_set === false && r.v.alert_needed === false, JSON.stringify(r));

for (const [who, role, u] of [['signed out', 'anon', null], ['owner', 'authenticated', owner.u], ['worker', 'authenticated', worker.u]]) {
  const bad = [];
  for (const t of ['company_yard_alerts', 'time_clock_locations']) {
    const sel = await call(role, u, `select count(*) as x from public.${t}`);
    const del = await call(role, u, `delete from public.${t} returning 1 as x`);
    if (sel.ok || del.ok) bad.push(t);
  }
  check(`16 ${who} cannot read or delete either table directly`, bad.length === 0, JSON.stringify(bad));
}
console.log(results.every(Boolean) ? 'all passed' : 'FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
