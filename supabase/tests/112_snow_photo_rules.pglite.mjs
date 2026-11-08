// Update 112: Snow photo rules per property service and per stop. Real full schema on PGlite (not real Supabase).
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';
const repo = process.argv[2];
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
const { db, failures } = await buildFullSchema(repo);
check('0 the full schema including 112 loads', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/112_snow_photo_rules.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 112 can be run a second time', again);
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await db.exec('reset role'); } };
const signUp = async (email, meta) => {
  await db.exec('reset role');
  const u = (await one(`insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`, [email, JSON.stringify(meta)])).id;
  return { u, pid: (await one(`select id from public.people where user_id = $1`, [u])).id };
};
const owner = await signUp('o@x.test', { first_name: 'Owner', last_name: 'O', company_name: 'Acme Snow' });
const co = (await one(`select company_id from public.company_members where person_id = $1 and role = 'owner'`, [owner.pid])).company_id;
const lead = await signUp('lead@x.test', { first_name: 'Lead', last_name: 'L' });
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'worker','active')`, [co, lead.pid]);
await db.query(`insert into public.snow_staff (company_id, person_id, status, granted_at) values ($1,$2,'active',now())`, [co, lead.pid]);
await db.query(`insert into public.snow_staff_services (company_id, person_id, service) values ($1,$2,'plowing')`, [co, lead.pid]);
const cid = (await rpc(owner.u, `select public.add_customer('Cathy', 'Cust', 'cathy@x.test', '7325550101') as x`)).v.person_id;
const prop = (await rpc(owner.u, `select public.ensure_property($1::uuid, 'Cathy Home', '12 Elm St', 'Lakewood', 'NJ', '08701') as x`, [cid])).v;
await rpc(owner.u, `select public.snow_enable_for_property($1::uuid) as x`, [prop.id ?? prop.property_id]);
const sp = (await one(`select id from public.snow_properties where property_id = $1`, [prop.id ?? prop.property_id])).id;
await db.query(`insert into public.snow_property_services (company_id, property_id, service, is_active) values ($1,$2,'plowing',true) on conflict (property_id, service) do update set is_active = true`, [co, sp]);
const st = (await rpc(owner.u, `select public.snow_create_storm('Oct 21 Plowing', 'plowing') as x`)).v;
const stormId = st?.storm?.id ?? st?.id ?? (await one(`select id from public.snow_storms where company_id = $1 limit 1`, [co])).id;
const route = (await one(`insert into public.snow_routes (company_id, storm_id, name, service, lead_person_id, media_required, min_media) values ($1,$2,'North','plowing',$3,false,1) returning id`, [co, stormId, lead.pid])).id;
let pos = 0;
const visit = async (extra = '', vals = []) => { await db.exec('reset role'); pos += 1; return one(`insert into public.snow_visits (company_id, storm_id, route_id, property_id, service, status, position${extra ? ', ' + extra.split('=')[0] : ''}) values ($1,$2,$3,$4,'plowing','pending',${pos}${extra ? ', ' + vals.join(',') : ''}) returning photos_required, min_media`, [co, stormId, route, sp]); };

let v = await visit();
check('1 with no rule on the property, a stop follows the route (nothing is filled in)', v.photos_required === null && v.min_media === null, JSON.stringify(v));
await db.query(`update public.snow_property_services set photos_required = true, photo_count = 3 where property_id = $1 and service = 'plowing'`, [sp]);
v = await visit();
check('2 with a rule on the property, a new stop starts with photos required and that many photos', v.photos_required === true && v.min_media === 3, JSON.stringify(v));
await db.query(`update public.snow_property_services set photos_required = false, photo_count = null where property_id = $1 and service = 'plowing'`, [sp]);
v = await visit();
check('3 a property can switch photos OFF for its stops', v.photos_required === false && v.min_media === null, JSON.stringify(v));
await db.query(`update public.snow_property_services set photos_required = true, photo_count = 5 where property_id = $1 and service = 'plowing'`, [sp]);
v = await visit('photos_required', ['false']);
check('4 a stop given its own setting keeps it (the property rule only fills what is empty)', v.photos_required === false && v.min_media === 5, JSON.stringify(v));
let r1 = true, r2 = true;
try { await db.query(`update public.snow_property_services set photo_count = 0 where property_id = $1`, [sp]); } catch { r1 = false; }
try { await db.query(`update public.snow_visits set min_media = 21 where route_id = $1`, [route]); } catch { r2 = false; }
check('5 the number of photos can only be 1 to 20', !r1 && !r2);
const pre = await one(`select count(*)::int c from public.snow_visits where route_id = $1 and min_media is null and photos_required is null`, [route]);
check('6 stops made before the rule existed are unchanged (still empty)', pre.c === 1, JSON.stringify(pre));
console.log(results.every(Boolean) ? 'all passed' : 'FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
