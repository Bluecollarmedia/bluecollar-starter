// Update 96: a Snow stop photo can be deleted by the owner/admin and by the person who uploaded it; nobody else.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 97) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/097_workers_delete_own_snow_photo.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 97 can be run a second time', again);

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
const other = await signUp('other@x.test', { first_name: 'Other', last_name: 'W' });
for (const p of [lead, other]) await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'worker','active')`, [co, p.pid]);
await db.query(`insert into public.snow_staff (company_id, person_id, status, granted_at) values ($1,$2,'active',now())`, [co, lead.pid]);
await db.query(`insert into public.snow_staff_services (company_id, person_id, service) values ($1,$2,'plowing')`, [co, lead.pid]);
const cid = (await rpc(owner.u, `select public.add_customer('Cathy', 'Cust', 'cathy@x.test', '7325550101') as x`)).v.person_id;
const prop = (await rpc(owner.u, `select public.ensure_property($1::uuid, 'Home', '12 Elm St', 'Lakewood', 'NJ', '08701') as x`, [cid])).v;
await rpc(owner.u, `select public.snow_enable_for_property($1::uuid) as x`, [prop.id ?? prop.property_id]);
const sp = (await one(`select id from public.snow_properties where property_id = $1`, [prop.id ?? prop.property_id])).id;
await db.query(`insert into public.snow_property_services (company_id, property_id, service, is_active) values ($1,$2,'plowing',true) on conflict (property_id, service) do update set is_active = true`, [co, sp]);
const st = (await rpc(owner.u, `select public.snow_create_storm('S', 'plowing') as x`)).v;
const stormId = st?.storm?.id ?? st?.id;
const route = (await one(`insert into public.snow_routes (company_id, storm_id, name, service, lead_person_id) values ($1,$2,'N','plowing',$3) returning id`, [co, stormId, lead.pid])).id;
const visit = (await one(`insert into public.snow_visits (company_id, storm_id, route_id, property_id, service, status, position) values ($1,$2,$3,$4,'plowing','pending',1) returning id`, [co, stormId, route, sp])).id;
await rpc(owner.u, `select public.snow_dispatch_storm($1::uuid) as x`, [stormId]);
await rpc(lead.u, `select public.snow_arrive_visit($1::uuid) as x`, [visit]);
await rpc(lead.u, `select public.snow_complete_visit($1::uuid, null) as x`, [visit]);
const add = async (n) => (await rpc(lead.u, `select public.snow_add_completion_media($1::uuid, 'photo', $2, 1000, null, null) as x`, [visit, `${co}/completion/${visit}/${n}.jpg`])).v;
const count = async () => +(await one(`select count(*) from public.snow_completion_media where visit_id = $1`, [visit])).count;
const m1 = await add('a'); const m2 = await add('b'); const m3 = await add('c');
check('1 setup: three photos on the stop', (await count()) === 3);
let r = await rpc(other.u, `select public.snow_delete_media($1::uuid)`, [m1]);
check('2 a worker cannot delete it', !r.ok && /not found/i.test(r.msg) && (await count()) === 3, r.msg);
r = await rpc(lead.u, `select public.snow_delete_media($1::uuid)`, [m1]);
check('3 the person who uploaded it can delete it (update 97), even after the stop is completed', r.ok && (await count()) === 2, r.msg);
r = await rpc(owner.u, `select public.snow_delete_media($1::uuid)`, [m2]);
check('4 the owner can delete a photo', r.ok && (await count()) === 1, r.msg);
// (photos reach the customer by themselves, update 87, so this one is already shared)
r = await rpc(owner.u, `select public.snow_delete_media($1::uuid)`, [m3]);
check('5 even one already sent to the customer (it disappears for them)', r.ok && (await count()) === 0, r.msg);
r = await rpc(owner.u, `select public.snow_delete_media($1::uuid)`, [m3]);
check('6 deleting one that is already gone says so', !r.ok && /not found/i.test(r.msg), r.msg);
console.log(results.every(Boolean) ? '\nall passed' : '\nsome failed');
process.exit(results.every(Boolean) ? 0 : 1);
