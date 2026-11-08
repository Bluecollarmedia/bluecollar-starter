// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && copy this file (and ./helpers/fullSchema.mjs) beside it, then:
//   node <file> <path to the repo>
// Proves update 60 on the REAL full schema + every update (PGlite, not real Supabase): each property (stop) on a snow route can carry
// the owner's note and its own "photos required" setting. Finishing a stop checks the property's setting first, then the route's rule.
// Only owners/admins can change them.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 240)}`); };
check('0 the full schema and all updates (including 060) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/060_snow_stop_notes_photos.sql`, 'utf8')); } catch (e) { again = false; }
check('0b update 60 can be run a second time', again);
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
const prop = (await one(`insert into public.snow_properties (company_id, name, address) values ($1, 'Oak Plaza', '1 Oak St') returning id`, [co])).id;
await db.query(`insert into public.snow_property_services (company_id, property_id, service, is_active) values ($1, $2, 'plowing', true)`, [co, prop]);

async function setup(routeRequiresPhotos) {
  const st = (await one(`insert into public.snow_storms (company_id, name, service, status) values ($1, 'Storm', 'plowing', 'draft') returning id`, [co])).id;
  const r = (await one(`insert into public.snow_routes (company_id, storm_id, service, name, media_required, min_media) values ($1, $2, 'plowing', 'Route 1', $3, 1) returning id`, [co, st, routeRequiresPhotos])).id;
  const visit = async (pos) => (await one(`insert into public.snow_visits (company_id, storm_id, route_id, service, property_id, position, property_name) values ($1, $2, $3, 'plowing', $4, $5, 'Oak Plaza') returning id`, [co, st, r, prop, pos])).id;
  const v = [await visit(0), await visit(1), await visit(2)];
  await db.query(`update public.snow_storms set status = 'dispatched', dispatched_at = now() where id = $1`, [st]);
  return { st, r, v };
}
const finish = async (id) => {
  await db.query(`update public.snow_visits set status = 'arrived', arrived_at = now() where id = $1`, [id]);
  return fails(`update public.snow_visits set status = 'completed' where id = $1`, [id]);
};

// Route does NOT require photos
const a = await setup(false);
await db.query(`update public.snow_visits set photos_required = true where id = $1`, [a.v[0]]);
let f = await finish(a.v[0]);
check('1 a property marked "photos required" cannot be finished without a photo, even when the route does not require them', f.raised && /more photo/.test(f.msg), f.msg);
await db.query(`insert into public.snow_completion_media (company_id, storm_id, route_id, visit_id, property_id, service, kind, file_key) values ($1,$2,$3,$4,$5,'plowing','photo','k/' || gen_random_uuid()::text)`, [co, a.st, a.r, a.v[0], prop]);
f = await fails(`update public.snow_visits set status = 'completed' where id = $1`, [a.v[0]]);
check('2 once it has its photo it can be finished', !f.raised, f.msg);
f = await finish(a.v[1]);
check('3 a property with no setting follows the route: no photo needed here', !f.raised, f.msg);

// Route DOES require photos
const b = await setup(true);
await db.query(`update public.snow_visits set photos_required = false where id = $1`, [b.v[0]]);
f = await finish(b.v[0]);
check('4 a property marked "no photos needed" can be finished without one, even when the route requires them', !f.raised, f.msg);
f = await finish(b.v[1]);
check('5 a property with no setting follows the route: photo needed here', f.raised && /more photo/.test(f.msg), f.msg);

// Who can change them
f = await fails(`update public.snow_visits set owner_note = 'Gate code 1234' where id = $1`, [b.v[2]]);
check('6 a note can be saved on a property', !f.raised && (await one(`select owner_note from public.snow_visits where id = $1`, [b.v[2]])).owner_note === 'Gate code 1234', f.msg);
f = await fails(`update public.snow_visits set owner_note = repeat('x', 1001) where id = $1`, [b.v[2]]);
check('7 a note over 1000 characters is refused', f.raised, f.msg);
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
await asUser(owner.u);
f = await fails(`update public.snow_visits set owner_note = 'Pile snow by the fence', photos_required = true where id = $1`, [b.v[2]]);
await db.exec('reset role');
let row = await one(`select owner_note, photos_required from public.snow_visits where id = $1`, [b.v[2]]);
check('8 the owner can change the note and the photo setting', !f.raised && row.owner_note === 'Pile snow by the fence' && row.photos_required === true, JSON.stringify(row) + f.msg);
await asUser(worker.u);
await db.query(`update public.snow_visits set owner_note = 'hacked', photos_required = false where id = $1`, [b.v[2]]);
await db.exec('reset role');
row = await one(`select owner_note, photos_required from public.snow_visits where id = $1`, [b.v[2]]);
check('9 a worker cannot change them (nothing changed)', row.owner_note === 'Pile snow by the fence' && row.photos_required === true, JSON.stringify(row));

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
