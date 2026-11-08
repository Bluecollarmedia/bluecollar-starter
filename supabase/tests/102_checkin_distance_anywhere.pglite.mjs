// Update 102: a check-in distance of 0 means Anywhere, for projects and maintenance properties. Real full schema on PGlite (not real Supabase).
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 102) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/102_checkin_distance_anywhere.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 102 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };

const co = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
const mk = async (email, name) => {
  await asDb();
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const owner = await mk('owner@x.test', 'Owner');
const w = await mk('w@x.test', 'Wes');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'owner','active','landscaping'),($1,$3,'worker','active','landscaping')`, [co, owner.pid, w.pid]);

// ── Projects ──
const proj = async (name, radius) => {
  const p = (await one(`insert into public.projects (company_id, name, status, latitude, longitude) values ($1,$2,'active',41.50,-81.70) returning id`, [co, name])).id;
  if (radius !== undefined) await db.query(`insert into public.project_settings (company_id, project_id, checkin_radius_meters) values ($1,$2,$3) on conflict (project_id) do update set checkin_radius_meters = $3`, [co, p, radius]);
  return p;
};
const asg = async (p) => (await one(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, status) values ($1,$2,$3,current_date,'scheduled') returning id`, [co, p, w.pid])).id;
const checkIn = async (p, a, lat, lng) => {
  await asUser(w.u);
  try {
    await db.query(`insert into public.check_ins (company_id, assignment_id, project_id, person_id, gps) values ($1,$2,$3,$4,$5::jsonb)`, [co, a, p, w.pid, JSON.stringify({ latitude: lat, longitude: lng, accuracy: 10 })]);
    return { ok: true };
  } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); }
};
const far = [42.50, -81.70]; // about 111 km away

const pLimited = await proj('Limited', 200);
let r = await checkIn(pLimited, await asg(pLimited), ...far);
check('1 a project with a distance still refuses a worker who is far away', !r.ok && /too far/i.test(r.msg), r.msg);

const pAny = await proj('Anywhere', 0);
r = await checkIn(pAny, await asg(pAny), ...far);
check('2 a project set to Anywhere (0) lets a far-away worker check in', r.ok, r.msg);

const pDefault = await proj('Default');
r = await checkIn(pDefault, await asg(pDefault), ...far);
check('3 a project with no saved distance still uses the default and refuses', !r.ok && /too far/i.test(r.msg), r.msg);

// ── Maintenance ──
const prop = (await one(`insert into public.maintenance_properties (company_id, name, address, latitude, longitude, checkin_radius_m) values ($1,'Chase','1 St',41.50,-81.70,0) returning id`, [co])).id;
check('4 a maintenance property can be saved with distance 0 (Anywhere)', !!prop);
let threw = false;
try { await db.query(`update public.maintenance_properties set checkin_radius_m = 10 where id = $1`, [prop]); } catch { threw = true; }
check('5 an in-between nonsense value (10 m) is still refused', threw);
await db.query(`update public.maintenance_properties set checkin_radius_m = 5000 where id = $1`, [prop]).then(() => check('6 more than 2000 m is still refused', false), () => check('6 more than 2000 m is still refused', true));
const loc = (lat, lng, radius) => one(`select (public._maint_location($1::double precision,$2::double precision,20::double precision,'ok',41.50::double precision,-81.70::double precision,$3::double precision)).status as s`, [lat, lng, radius]);
check('7 far away with Anywhere is recorded as verified', (await loc(...far, 0)).s === 'verified');
check('8 far away with a normal distance is still outside the radius', (await loc(...far, 150)).s === 'outside_radius');
check('9 at the property with a normal distance is verified', (await loc(41.50, -81.70, 150)).s === 'verified');

console.log(results.every(Boolean) ? '\nall passed' : '\nsome failed');
process.exit(results.every(Boolean) ? 0 : 1);
