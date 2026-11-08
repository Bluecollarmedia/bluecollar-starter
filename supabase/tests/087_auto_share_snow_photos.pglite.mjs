// Update 87: a completed stop's photos reach the customer by themselves; the owner can turn that off and can still withdraw a photo.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 87) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/087_auto_share_snow_photos.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 87 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0], rows: r.rows }; } catch (e) { return { ok: false, msg: String(e.message), rows: [] }; } finally { await asDb(); } };
const signUp = async (email, meta) => {
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
const inv = (await rpc(owner.u, `select public.invite_send($1::uuid) as x`, [cid])).v;
const cathy = await signUp('cathy.login@x.test', { first_name: 'Cathy', last_name: 'Cust', invite_token: inv.token });
const prop = (await rpc(owner.u, `select public.ensure_property($1::uuid, 'Cathy Home', '12 Elm St', 'Lakewood', 'NJ', '08701') as x`, [cid])).v;
await rpc(owner.u, `select public.snow_enable_for_property($1::uuid) as x`, [prop.id ?? prop.property_id]);
const sp = (await one(`select id from public.snow_properties where property_id = $1`, [prop.id ?? prop.property_id])).id;
await db.query(`insert into public.snow_property_services (company_id, property_id, service, is_active) values ($1,$2,'plowing',true) on conflict (property_id, service) do update set is_active = true`, [co, sp]);

const st = (await rpc(owner.u, `select public.snow_create_storm('Oct 21 Plowing', 'plowing') as x`)).v;
const stormId = st?.storm?.id ?? st?.id ?? (await one(`select id from public.snow_storms where company_id = $1 limit 1`, [co])).id;
const route = (await one(`insert into public.snow_routes (company_id, storm_id, name, service, lead_person_id) values ($1,$2,'North','plowing',$3) returning id`, [co, stormId, lead.pid])).id;
const mkVisit = async (pos) => (await one(`insert into public.snow_visits (company_id, storm_id, route_id, property_id, service, status, position) values ($1,$2,$3,$4,'plowing','pending',$5) returning id`, [co, stormId, route, sp, pos])).id;
const v1 = await mkVisit(1);
const v2 = await mkVisit(2); // made now: the storm now ends by itself when its last stop is done (update 93)
await rpc(owner.u, `select public.snow_dispatch_storm($1::uuid) as x`, [stormId]);
const timeline = async () => (await rpc(cathy.u, `select * from public.snow_customer_timeline()`)).rows;

check('1 the setting is ON by default', (await one(`select auto_share_with_customers a from public.snow_settings where company_id = $1`, [co])).a === true);

// Automatic (default)
await rpc(lead.u, `select public.snow_arrive_visit($1::uuid) as x`, [v1]);
for (const k of ['a', 'b']) await rpc(lead.u, `select public.snow_add_completion_media($1::uuid, 'photo', $2, 1000, null, null) as x`, [v1, `${co}/completion/${v1}/${k}.jpg`]);
check('2 before the stop is completed the customer sees nothing', (await timeline()).length === 0);
const done = await rpc(lead.u, `select public.snow_complete_visit($1::uuid, null) as x`, [v1]);
check('3 the lead completes the stop', done.ok, done.msg);
let t = await timeline();
check('4 the customer sees it at once, with both photos, and the owner did nothing', t.length === 1 && t[0].media.length === 2, JSON.stringify(t));
const rows = await db.query(`select review_status, shared_at is not null as shared from public.snow_completion_media where visit_id = $1`, [v1]).then((r) => r.rows);
check('5 the photos are marked approved and shared', rows.length === 2 && rows.every((r) => r.review_status === 'approved' && r.shared));
check('6 it is recorded as an automatic send in the activity log', (await one(`select count(*)::int c from public.snow_activity_events where visit_id = $1 and action = 'visit.customer_update_sent'`, [v1])).c >= 1);

// A photo the owner adds afterwards is shared too
const add = await rpc(owner.u, `select public.snow_owner_add_media($1::uuid, 'photo', $2, 1000, null, null) as x`, [v1, `${co}/completion/${v1}/c.jpg`]);
t = await timeline();
check('7 a photo the owner adds to that stop later reaches the customer too', add.ok && t[0].media.length === 3, JSON.stringify({ add, n: t[0]?.media?.length }));

// The owner can still withdraw one
const mid = (await one(`select id from public.snow_completion_media where file_key like '%/c.jpg'`)).id;
const wd = await rpc(owner.u, `select public.snow_withdraw_media($1::uuid, 'Not for the customer') as x`, [mid]);
t = await timeline();
check('8 the owner can still withdraw a photo, and the customer stops seeing it', wd.ok && t[0].media.length === 2, JSON.stringify({ wd, n: t[0]?.media?.length }));

// Manual mode: the old way still works
await rpc(owner.u, `update public.snow_settings set auto_share_with_customers = false where company_id = $1`, [co]).catch(() => null);
await db.query(`update public.snow_settings set auto_share_with_customers = false where company_id = $1`, [co]);
await rpc(lead.u, `select public.snow_arrive_visit($1::uuid) as x`, [v2]);
await rpc(lead.u, `select public.snow_add_completion_media($1::uuid, 'photo', $2, 1000, null, null) as x`, [v2, `${co}/completion/${v2}/a.jpg`]);
await rpc(lead.u, `select public.snow_complete_visit($1::uuid, null) as x`, [v2]);
t = await timeline();
check('9 with the switch OFF, the next stop does NOT reach the customer by itself', t.length === 1 && !t.some((x) => x.visit_id === v2), JSON.stringify(t.map((x) => x.visit_id)));
check('10 and its photo waits for review', (await one(`select review_status, shared_at is null as unshared from public.snow_completion_media where visit_id = $1`, [v2])).review_status === 'pending');
const m2 = (await one(`select id from public.snow_completion_media where visit_id = $1`, [v2])).id;
await rpc(owner.u, `select public.snow_review_media($1::uuid, 'approved') as x`, [m2]);
const sent = await rpc(owner.u, `select public.snow_send_customer_update($1::uuid) as x`, [v2]);
t = await timeline();
check('11 the owner can still approve and send by hand', sent.ok && t.length === 2, JSON.stringify({ sent, n: t.length }));

// Another customer never sees it
const dan = await rpc(owner.u, `select public.add_customer('Dan', 'Cust', 'dan@x.test', '7325550202') as x`);
const danInv = (await rpc(owner.u, `select public.invite_send($1::uuid) as x`, [dan.v.person_id])).v;
const danAcct = await signUp('dan.login@x.test', { first_name: 'Dan', last_name: 'Cust', invite_token: danInv.token });
check('12 another customer sees none of it', (await rpc(danAcct.u, `select count(*)::int as x from public.snow_customer_timeline()`)).v === 0);

console.log(results.every(Boolean) ? '\nall passed' : '\nsome failed');
process.exit(results.every(Boolean) ? 0 : 1);
