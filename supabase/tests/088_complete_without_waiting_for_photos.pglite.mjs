
// Update 88: a worker never waits for photos. A stop completes with none saved, and photos still arrive (and reach the customer) afterwards.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 88) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/088_complete_stop_without_waiting_for_photos.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 88 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0], rows: r.rows }; } catch (e) { return { ok: false, msg: String(e.message) }; } };
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
const other = await signUp('other@x.test', { first_name: 'Other', last_name: 'W' });
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'worker','active')`, [co, other.pid]);

const cid = (await rpc(owner.u, `select public.add_customer('Cathy', 'Cust', 'cathy@x.test', '7325550101') as x`)).v.person_id;
const inv = (await rpc(owner.u, `select public.invite_send($1::uuid) as x`, [cid])).v;
const cathy = await signUp('cathy.login@x.test', { first_name: 'Cathy', last_name: 'Cust', invite_token: inv.token });
const prop = (await rpc(owner.u, `select public.ensure_property($1::uuid, 'Cathy Home', '12 Elm St', 'Lakewood', 'NJ', '08701') as x`, [cid])).v;
await rpc(owner.u, `select public.snow_enable_for_property($1::uuid) as x`, [prop.id ?? prop.property_id]);
const sp = (await one(`select id from public.snow_properties where property_id = $1`, [prop.id ?? prop.property_id])).id;
await db.query(`insert into public.snow_property_services (company_id, property_id, service, is_active) values ($1,$2,'plowing',true) on conflict (property_id, service) do update set is_active = true`, [co, sp]);

const st = (await rpc(owner.u, `select public.snow_create_storm('Oct 21 Plowing', 'plowing') as x`)).v;
const stormId = st?.storm?.id ?? st?.id ?? (await one(`select id from public.snow_storms where company_id = $1 limit 1`, [co])).id;
// Photos ARE required on this route (2 of them): completing must still work with none.
const route = (await one(`insert into public.snow_routes (company_id, storm_id, name, service, lead_person_id, media_required, min_media) values ($1,$2,'North','plowing',$3,true,2) returning id`, [co, stormId, lead.pid])).id;
const mkVisit = async (pos) => (await db.exec('reset role'), await one(`insert into public.snow_visits (company_id, storm_id, route_id, property_id, service, status, position) values ($1,$2,$3,$4,'plowing','pending',$5) returning id`, [co, stormId, route, sp, pos])).id;
const v1 = await mkVisit(1);
const v2 = await mkVisit(2); // made now: the storm now ends by itself when its last stop is done (update 93)
await rpc(owner.u, `select public.snow_dispatch_storm($1::uuid) as x`, [stormId]);
const timeline = async () => (await rpc(cathy.u, `select * from public.snow_customer_timeline()`)).rows;

await rpc(lead.u, `select public.snow_arrive_visit($1::uuid) as x`, [v1]);
const done = await rpc(lead.u, `select public.snow_complete_visit($1::uuid, 'plowed') as x`, [v1]);
check('1 the lead completes a stop that needs 2 photos with NONE saved', done.ok, done.msg);
check('2 the stop is recorded as completed', (await one(`select status from public.snow_visits where id = $1`, [v1])).status === 'completed');

// A photo arriving later (the app uploads in the background and attaches it afterwards)
const late = await rpc(lead.u, `select public.snow_add_completion_media($1::uuid, 'photo', $2, 1000, null, null) as x`, [v1, `${co}/completion/${v1}/late1.jpg`]);
check('3 the lead can still attach a photo to the completed stop', late.ok, late.msg);
const late2 = await rpc(lead.u, `select public.snow_add_completion_media($1::uuid, 'photo', $2, 1000, null, null) as x`, [v1, `${co}/completion/${v1}/late1.jpg`]);
check('4 attaching the same photo again (a retry) is harmless and gives the same record', late2.ok && late2.v === late.v, JSON.stringify([late, late2]));
check('5 only one record exists for it', (await one(`select count(*)::int c from public.snow_completion_media where visit_id = $1`, [v1])).c === 1);
const t = await timeline();
check('6 the late photo reaches the customer by itself (update 87)', t.length === 1 && t[0].media.length === 1, JSON.stringify(t));

// Still guarded
const wrong = await rpc(lead.u, `select public.snow_add_completion_media($1::uuid, 'photo', $2, 1000, null, null) as x`, [v1, `${co}/completion/00000000-0000-0000-0000-000000000000/x.jpg`]);
check('7 a file that belongs to a different stop is refused', !wrong.ok, JSON.stringify(wrong));
const stranger = await rpc(other.u, `select public.snow_add_completion_media($1::uuid, 'photo', $2, 1000, null, null) as x`, [v1, `${co}/completion/${v1}/sneaky.jpg`]);
check('8 a worker who is not the route lead cannot attach photos', !stranger.ok, JSON.stringify(stranger));
const cust = await rpc(cathy.u, `select public.snow_add_completion_media($1::uuid, 'photo', $2, 1000, null, null) as x`, [v1, `${co}/completion/${v1}/c.jpg`]);
check('9 a customer cannot attach photos', !cust.ok, JSON.stringify(cust));

// The other rules of a completion are unchanged
const early = await rpc(lead.u, `select public.snow_complete_visit($1::uuid, null) as x`, [v2]);
check('10 "Tap I\'m Here first" still applies when the owner requires arrival', !early.ok && /I'm Here/.test(early.msg), JSON.stringify(early));
await rpc(lead.u, `select public.snow_arrive_visit($1::uuid) as x`, [v2]);
const done2 = await rpc(lead.u, `select public.snow_complete_visit($1::uuid, null) as x`, [v2]);
check('11 and a second stop completes with no photos too', done2.ok, done2.msg);
const again2 = await rpc(lead.u, `select public.snow_complete_visit($1::uuid, null) as x`, [v2]);
check('12 completing twice (a double tap) is harmless', again2.ok, again2.msg);

console.log(results.every(Boolean) ? '\nall passed' : '\nsome failed');
process.exit(results.every(Boolean) ? 0 : 1);
