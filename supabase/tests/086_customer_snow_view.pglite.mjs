// Update 86: what a customer sees about Snow (timeline, "right now" status, services) and their own notification choices.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 86) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/086_customer_snow_view.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 86 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0], rows: r.rows }; } catch (e) { return { ok: false, msg: String(e.message), rows: [] }; } finally { await asDb(); } };
const signUp = async (email, meta) => {
  const u = (await one(`insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`, [email, JSON.stringify(meta)])).id;
  return { u, pid: (await one(`select id from public.people where user_id = $1`, [u])).id };
};

const owner = await signUp('o@x.test', { first_name: 'Owner', last_name: 'O', company_name: 'Acme Snow' });
const co = (await one(`select company_id from public.company_members where person_id = $1 and role = 'owner'`, [owner.pid])).company_id;
// This test is about what the customer sees once an update is SENT, so it uses the manual way (approve, then send). Automatic sending (update 87) has its own test.
await db.query(`update public.snow_settings set auto_share_with_customers = false where company_id = $1`, [co]);
const lead = await signUp('lead@x.test', { first_name: 'Lead', last_name: 'L' });
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'worker','active')`, [co, lead.pid]);
await db.query(`insert into public.snow_staff (company_id, person_id, status, granted_at) values ($1,$2,'active',now())`, [co, lead.pid]);
for (const s of ['plowing', 'salting']) await db.query(`insert into public.snow_staff_services (company_id, person_id, service) values ($1,$2,$3)`, [co, lead.pid, s]);

// A customer (with a login) with a Snow property; another customer with their own.
const mkCustomer = async (first, email, addr) => {
  const cid = (await rpc(owner.u, `select public.add_customer($1, 'Cust', $2, '7325550101') as x`, [first, email])).v.person_id;
  const inv = (await rpc(owner.u, `select public.invite_send($1::uuid) as x`, [cid])).v;
  const acct = await signUp(`${first.toLowerCase()}.login@x.test`, { first_name: first, last_name: 'Cust', invite_token: inv.token });
  const prop = (await rpc(owner.u, `select public.ensure_property($1::uuid, $2, $3, 'Lakewood', 'NJ', '08701') as x`, [cid, `${first} Home`, addr])).v;
  const pid = prop.id ?? prop.property_id;
  await rpc(owner.u, `select public.snow_enable_for_property($1::uuid) as x`, [pid]);
  const sp = (await one(`select id from public.snow_properties where property_id = $1`, [pid])).id;
  for (const s of ['plowing', 'salting']) await db.query(`insert into public.snow_property_services (company_id, property_id, service, is_active) values ($1,$2,$3,true) on conflict (property_id, service) do update set is_active = true`, [co, sp, s]);
  return { cid, acct, sp };
};
const cathy = await mkCustomer('Cathy', 'cathy@x.test', '12 Elm St');
const dan = await mkCustomer('Dan', 'dan@x.test', '9 Oak Ave');
check('1 both customers have a login linked to their own Snow property', cathy.acct.pid === cathy.cid && dan.acct.pid === dan.cid && !!cathy.sp && !!dan.sp);

// Services
let r = await rpc(cathy.acct.u, `select count(*)::int as x from public.snow_my_property_services()`);
check('2 a customer sees the services their property gets (and only theirs)', r.ok && r.v === 2, JSON.stringify(r));

// Nothing yet
check('3 before any storm: no timeline and no "right now" status', (await rpc(cathy.acct.u, `select count(*)::int as x from public.snow_customer_timeline()`)).v === 0 && (await rpc(cathy.acct.u, `select count(*)::int as x from public.snow_customer_status()`)).v === 0);

// A storm: plowing at Cathy's, salting at Cathy's; Dan's property is on a different storm so we can see isolation.
const st = (await rpc(owner.u, `select public.snow_create_storm('Oct 21 Plowing', 'plowing') as x`)).v;
const stormId = st?.storm?.id ?? st?.id ?? (await one(`select id from public.snow_storms where company_id = $1 order by created_at limit 1`, [co])).id;
const route = (await one(`insert into public.snow_routes (company_id, storm_id, name, service, lead_person_id) values ($1,$2,'North','plowing',$3) returning id`, [co, stormId, lead.pid])).id;
const visit = (await one(`insert into public.snow_visits (company_id, storm_id, route_id, property_id, service, status, position) values ($1,$2,$3,$4,'plowing','pending',1) returning id`, [co, stormId, route, cathy.sp])).id;
await db.query(`insert into public.snow_visits (company_id, storm_id, route_id, property_id, service, status, position) values ($1,$2,$3,$4,'plowing','pending',2)`, [co, stormId, route, dan.sp]);
r = await rpc(owner.u, `select public.snow_dispatch_storm($1::uuid) as x`, [stormId]);
check('4 dispatching works', r.ok, r.msg);

r = await rpc(cathy.acct.u, `select state, storm_name from public.snow_customer_status()`);
check('5 right after dispatch the customer sees "scheduled" for their property only, with the storm name', r.ok && r.rows.length === 1 && r.rows[0].state === 'scheduled' && r.rows[0].storm_name === 'Oct 21 Plowing', JSON.stringify(r.rows));

r = await rpc(lead.u, `select public.snow_arrive_visit($1::uuid) as x`, [visit]);
check('6 the lead arrives', r.ok, r.msg);
r = await rpc(cathy.acct.u, `select state, since from public.snow_customer_status()`);
check('7 now the customer sees "on_site" with the arrival time', r.ok && r.rows.length === 1 && r.rows[0].state === 'on_site' && !!r.rows[0].since, JSON.stringify(r.rows));
r = await rpc(dan.acct.u, `select state from public.snow_customer_status()`);
check('8 the other customer still just sees "scheduled" (no one has arrived at their property)', r.ok && r.rows.length === 1 && r.rows[0].state === 'scheduled', JSON.stringify(r.rows));

// Complete with a photo; it is NOT on the timeline until the owner sends it.
await rpc(lead.u, `select public.snow_add_completion_media($1::uuid, 'photo', $2, 1000, null, null) as x`, [visit, `${co}/completion/${visit}/a.jpg`]);
await rpc(lead.u, `select public.snow_add_completion_media($1::uuid, 'photo', $2, 1000, null, null) as x`, [visit, `${co}/completion/${visit}/b.jpg`]);
r = await rpc(lead.u, `select public.snow_complete_visit($1::uuid, 'Done') as x`, [visit]);
check('9 the lead completes the stop', r.ok, r.msg);
check('10 completed but not yet sent: nothing on the customer\'s timeline, and the "right now" status is gone for that property', (await rpc(cathy.acct.u, `select count(*)::int as x from public.snow_customer_timeline()`)).v === 0 && (await rpc(cathy.acct.u, `select count(*)::int as x from public.snow_customer_status()`)).v === 0);

const media = await all(`select id from public.snow_completion_media where visit_id = $1 order by created_at`, [visit]);
for (const m of media) await rpc(owner.u, `select public.snow_review_media($1::uuid, 'approved') as x`, [m.id]);
r = await rpc(owner.u, `select public.snow_send_customer_update($1::uuid) as x`, [visit]);
check('11 the owner approves and sends the update', r.ok, r.msg);
r = await rpc(cathy.acct.u, `select * from public.snow_customer_timeline()`);
check('12 now it is on the timeline with the storm name, the service, the time and both photos', r.ok && r.rows.length === 1 && r.rows[0].storm_name === 'Oct 21 Plowing' && r.rows[0].service === 'plowing' && !!r.rows[0].completed_at && r.rows[0].media.length === 2, JSON.stringify(r.rows));
check('13 another customer never sees it', (await rpc(dan.acct.u, `select count(*)::int as x from public.snow_customer_timeline()`)).v === 0);

// Portal access off hides everything
await rpc(owner.u, `select public.set_customer_portal_access($1::uuid, false) as x`, [cathy.cid]);
check('14 a customer whose access the owner turned off sees nothing (timeline, status, services)', (await rpc(cathy.acct.u, `select count(*)::int as x from public.snow_customer_timeline()`)).v === 0 && (await rpc(cathy.acct.u, `select count(*)::int as x from public.snow_my_property_services()`)).v === 0);
await rpc(owner.u, `select public.set_customer_portal_access($1::uuid, true) as x`, [cathy.cid]);
check('15 turned back on, it all comes back', (await rpc(cathy.acct.u, `select count(*)::int as x from public.snow_customer_timeline()`)).v === 1);

// Notification choices
r = await rpc(cathy.acct.u, `select * from public.snow_my_notify_choices()`);
check('16 by default both messages are on for the customer', r.ok && r.rows[0].crew_arrives === true && r.rows[0].service_finished === true, JSON.stringify(r.rows));
r = await rpc(cathy.acct.u, `select public.snow_set_my_notify_choices(false, null) as x`);
r = await rpc(cathy.acct.u, `select * from public.snow_my_notify_choices()`);
check('17 turning "Crew arrives" off changes only that one', r.ok && r.rows[0].crew_arrives === false && r.rows[0].service_finished === true, JSON.stringify(r.rows));

// The messages really stop. Company setting: send both kinds.
await db.query(`update public.snow_property_notify_prefs set notify_on_arrival = true, notify_on_completion = true where property_id = $1`, [cathy.sp]);
const route2 = (await one(`insert into public.snow_routes (company_id, storm_id, name, service, lead_person_id) values ($1,$2,'South','plowing',$3) returning id`, [co, stormId, lead.pid])).id;
const v2 = (await one(`insert into public.snow_visits (company_id, storm_id, route_id, property_id, service, status, position) values ($1,$2,$3,$4,'plowing','pending',1) returning id`, [co, stormId, route2, cathy.sp])).id;
const arr = await rpc(lead.u, `select public.snow_arrive_visit($1::uuid) as x`, [v2]);
check('17b the lead arrives at the second stop', arr.ok, arr.msg);
const cnt = async (ev) => (await one(`select count(*)::int c from public.snow_notifications where recipient_person_id = $1 and category = 'customer' and event = $2 and visit_id = $3`, [cathy.cid, ev, v2])).c;
const arr2 = await rpc(lead.u, `select 1 as x`);
check('18 with "Crew arrives" off, the customer is NOT sent the arrival message', (await cnt('visit.arrived')) === 0);
await rpc(lead.u, `select public.snow_add_completion_media($1::uuid, 'photo', $2, 1000, null, null) as x`, [v2, `${co}/completion/${v2}/a.jpg`]);
const done2 = await rpc(lead.u, `select public.snow_complete_visit($1::uuid, null) as x`, [v2]);
check('18b the lead completes the second stop', done2.ok, done2.msg);
check('19 "Service finished" is still on, so they ARE sent the finished message', (await cnt('visit.completed')) === 1, String(await cnt('visit.completed')));
await rpc(cathy.acct.u, `select public.snow_set_my_notify_choices(null, false) as x`);
const v3 = (await one(`insert into public.snow_visits (company_id, storm_id, route_id, property_id, service, status, position) values ($1,$2,$3,$4,'plowing','pending',2) returning id`, [co, stormId, route2, cathy.sp])).id;
await rpc(lead.u, `select public.snow_arrive_visit($1::uuid) as x`, [v3]);
await rpc(lead.u, `select public.snow_add_completion_media($1::uuid, 'photo', $2, 1000, null, null) as x`, [v3, `${co}/completion/${v3}/a.jpg`]);
const done3 = await rpc(lead.u, `select public.snow_complete_visit($1::uuid, null) as x`, [v3]);
check('19b the lead completes the third stop', done3.ok, done3.msg);
check('20 with both off, nothing is sent to them at all', (await one(`select count(*)::int c from public.snow_notifications where recipient_person_id = $1 and category = 'customer' and visit_id = $2`, [cathy.cid, v3])).c === 0);
await rpc(cathy.acct.u, `select public.snow_set_my_notify_choices(true, true) as x`);
const v4 = (await one(`insert into public.snow_visits (company_id, storm_id, route_id, property_id, service, status, position) values ($1,$2,$3,$4,'plowing','pending',3) returning id`, [co, stormId, route2, cathy.sp])).id;
const arr4 = await rpc(lead.u, `select public.snow_arrive_visit($1::uuid) as x`, [v4]);
check('20b control: with the choice back on, the arrival message IS sent (so the earlier "not sent" results are real)', arr4.ok && (await one(`select count(*)::int c from public.snow_notifications where recipient_person_id = $1 and category = 'customer' and event = 'visit.arrived' and visit_id = $2`, [cathy.cid, v4])).c === 1, arr4.msg);
check('21 another customer\'s messages are unaffected by their choices', (await rpc(dan.acct.u, `select crew_arrives as x from public.snow_my_notify_choices()`)).v === true);
check('22 nobody can read or change the opt-out table directly', !(await rpc(cathy.acct.u, `select count(*)::int as x from public.snow_customer_opt_outs`)).ok);

console.log(results.every(Boolean) ? '\nall passed' : '\nsome failed');
process.exit(results.every(Boolean) ? 0 : 1);
