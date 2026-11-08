// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && copy this file (and ./helpers/fullSchema.mjs) beside it, then:
//   node <file> <path to the repo>
// Proves update 52 on the REAL full schema + every update (PGlite, not real Supabase): a worker's check-in is refused outside the
// project's saved distance, with a vague/missing GPS fix, and accepted inside it; owners are not limited; one project's distance
// never affects another's.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + String(detail).slice(0, 240)}`); };
check('0 the full schema and all updates (including 052) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/052_checkin_radius_enforcement.sql`, 'utf8')); } catch (e) { again = false; }
check('0b update 52 can be run a second time', again);
const fails = async (sql, p) => { try { await db.query(sql, p); return { raised: false, msg: '' }; } catch (e) { return { raised: true, msg: String(e.message) }; } };
const one = async (sql, p) => (await db.query(sql, p)).rows[0];

const co = (await one(`insert into public.companies (name) values ('Test Co') returning id`)).id;
const mk = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const owner = await mk('owner@x.test', 'Owner');
const worker = await mk('worker@x.test', 'Worker');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1, $2, 'owner', 'active'), ($1, $3, 'worker', 'active')`, [co, owner.pid, worker.pid]);

const LAT = 40.0, LON = -74.0;               // 0.001 degrees of latitude is about 111 m
const project = async (name, lat, lon, radius) => {
  const id = (await one(`insert into public.projects (company_id, name, latitude, longitude) values ($1, $2, $3, $4) returning id`, [co, name, lat, lon])).id;
  if (radius !== undefined) await db.query(`insert into public.project_settings (company_id, project_id, checkin_radius_meters) values ($1, $2, $3)`, [co, id, radius]);
  return id;
};
const a = await project('A: 500 ft', LAT, LON, 152);   // 500 ft
const b = await project('B: 1 mile', LAT, LON, 1609);
const c = await project('C: no saved distance', LAT, LON);
const d = await project('D: no coordinates', null, null, 152);

const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const gps = (dLat, accuracy = 10) => JSON.stringify({ latitude: LAT + dLat, longitude: LON, accuracy });
const checkIn = (who, project, g) => who === 'work'
  ? [`insert into public.work_sessions (company_id, person_id, project_id, check_in_time, check_in_gps, status) values ($1, $2, $3, now(), $4::jsonb, 'active')`, [co, worker.pid, project, g]]
  : [`insert into public.check_ins (company_id, person_id, project_id, gps) values ($1, $2, $3, $4::jsonb)`, [co, worker.pid, project, g]];

await asUser(worker.u);
for (const table of ['check_ins', 'work_sessions']) {
  let f = await fails(...checkIn(table === 'check_ins' ? 'ci' : 'work', a, gps(0.001)));
  check(`1 ${table}: inside the saved 500 ft (about 111 m) is accepted`, !f.raised, f.msg);
  f = await fails(...checkIn(table === 'check_ins' ? 'ci' : 'work', a, gps(0.003)));
  check(`2 ${table}: about 333 m away is refused with a clear message`, f.raised && /too far from this project/.test(f.msg), f.msg);
}
let f = await fails(...checkIn('ci', a, gps(0.0015, 30)));
check('3 the phone\'s own error margin counts: 167 m away with 30 m accuracy is inside 152 m + 30 m', !f.raised, f.msg);
f = await fails(...checkIn('ci', a, gps(0.0016, 5)));
check('4 ...but 178 m away with 5 m accuracy is not', f.raised && /too far/.test(f.msg), f.msg);
f = await fails(...checkIn('ci', a, gps(0.0005, 250)));
check('5 a GPS fix that vague (250 m) is refused even though it reads close', f.raised && /not accurate enough/.test(f.msg), f.msg);
f = await fails(...checkIn('ci', a, null));
check('6 no GPS fix at all is refused', f.raised && /location is needed/.test(f.msg), f.msg);
f = await fails(...checkIn('ci', a, JSON.stringify({ latitude: 'abc', longitude: LON })));
check('7 a garbage location is refused', f.raised, f.msg);
f = await fails(...checkIn('ci', a, JSON.stringify({ latitude: 0, longitude: 0, accuracy: 5 })));
check('8 (0, 0) is not a location', f.raised, f.msg);

f = await fails(...checkIn('ci', b, gps(0.01)));
check('9 project B has its own distance: 1.1 km away is fine inside its 1 mile, while A refuses much less', !f.raised, f.msg);
f = await fails(...checkIn('ci', a, gps(0.01)));
check('10 ...and A still refuses the same spot (one project\'s distance never affects another)', f.raised, f.msg);
f = await fails(...checkIn('ci', c, gps(0.006)));
check('11 no saved distance: the half-mile default applies (667 m is inside 805 m)', !f.raised, f.msg);
f = await fails(...checkIn('ci', c, gps(0.009)));
check('12 ...and 1 km is outside it', f.raised, f.msg);
f = await fails(...checkIn('ci', d, gps(0.5)));
check('13 a project with no saved coordinates can\'t be measured here (the app asks the office to fix the address)', !f.raised, f.msg);

const before = (await one(`select count(*)::int n from public.check_ins`)).n;
await fails(...checkIn('ci', a, gps(0.05)));
check('14 a refused check-in leaves no record behind', (await one(`select count(*)::int n from public.check_ins`)).n === before);

await asUser(owner.u);
f = await fails(`insert into public.check_ins (company_id, person_id, project_id, gps) values ($1, $2, $3, $4::jsonb)`, [co, owner.pid, a, gps(0.05)]);
check('15 an owner is not limited by the distance (they check in or correct records without being on site)', !f.raised, f.msg);

await db.exec('reset role');
console.log(results.every(Boolean) ? '\nall passed' : `\n${results.filter((r) => !r).length} failed`);
process.exit(results.every(Boolean) ? 0 : 1);
