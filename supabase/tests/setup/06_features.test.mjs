// Kept features: the public request form (choices = brand.js), crews, announcements and customer messages, job chat,
// the public weather switch, and the push trigger using the FILL IN functions_url.
import { freshDb, read } from '../helpers/setupDb.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { REPO } from '../helpers/setupDb.mjs';

export default async function run({ check }) {
  const { db, one, as, ownerWithCompany, member } = await freshDb();

  // ── service requests ──
  const brand = createRequire(import.meta.url)(path.join(REPO, 'src/config/brand.js'));
  const choices = (brand.default ?? brand).wording.serviceTypes;
  const allowed = (read('supabase/setup.sql').match(/allowed constant text\[\] := array\[([\s\S]*?)\];/) || [])[1] || '';
  const sqlChoices = [...allowed.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  check('1 the request form\'s service choices in setup.sql are exactly brand.js wording.serviceTypes', JSON.stringify(sqlChoices) === JSON.stringify(choices), JSON.stringify({ sqlChoices, choices }));
  const none = await as(null, `select public.submit_service_request('residential', array['Repair'], '', 'Anytown', 'Pat Lee', '555-010-0142', '') x`);
  check('2 with no company yet, the form says requests are not available', !none.ok && /not available/.test(none.msg));
  const A = await ownerWithCompany('owner@example.com', 'Company A');
  const admin = await member(A.cid, 'admin@example.com', 'admin', 'Ada');
  const w1 = await member(A.cid, 'w1@example.com', 'worker', 'Wes');
  const w2 = await member(A.cid, 'w2@example.com', 'worker', 'Wanda');
  const c1 = await member(A.cid, 'c1@example.com', 'customer', 'Cora');
  const c2 = await member(A.cid, 'c2@example.com', 'customer', 'Cal');
  let allOk = true;
  for (const [i, s] of choices.entries()) {
    const r = await as(null, `select public.submit_service_request('commercial', array[$1], 'Details', 'Anytown', 'Visitor ${i}', $2, '') x`, [s, `555010${String(1000 + i)}`]);
    if (!r.ok) { allOk = false; console.log(r.msg); }
  }
  check('3 a signed-out visitor can send a request for every choice in brand.js', allOk);
  const old = await as(null, `select public.submit_service_request('residential', array['Snow & Storm Response'], '', 'Anytown', 'Pat Lee', '5550109999', '') x`);
  check('4 an old landscape service name is refused', !old.ok && /at least one service/.test(old.msg));
  check('5 the owner and the admin each get a notice; visitors and workers cannot read requests', (await one(`select count(*)::int n from public.app_notifications where event_type = 'service_request' and recipient_id = $1`, [admin.pid])).n === choices.length
    && (await as(null, `select count(*)::int n from public.service_requests`)).ok === false && (await as(w1.u, `select count(*)::int n from public.service_requests`)).v === 0
    && (await as(A.u, `select count(*)::int n from public.service_requests`)).v === choices.length);
  check('6 nobody can insert a request directly', !(await as(A.u, `insert into public.service_requests (company_id, property_type, services, town, name, phone, phone_digits) values ($1, 'residential', '{Repair}', 'X', 'Y', '1', '1')`, [A.cid])).ok);

  // ── crews ──
  const crew = await as(A.u, `insert into public.crews (company_id, name) values ($1, 'Crew A') returning id, color`, [A.cid]);
  check('7 a new crew gets the plain dark colour #2B2B2B', crew.ok && crew.rows[0].color === '#2B2B2B', JSON.stringify(crew));
  const crewB = (await as(A.u, `insert into public.crews (company_id, name) values ($1, 'Crew B') returning id`, [A.cid])).v;
  const addTo = (c, p) => as(A.u, `insert into public.crew_members (company_id, crew_id, person_id) values ($1, $2, $3)`, [A.cid, c, p]);
  check('8 a worker can be in two crews, but not twice in one', (await addTo(crew.v, w1.pid)).ok && (await addTo(crewB, w1.pid)).ok && !(await addTo(crew.v, w1.pid)).ok);
  check('9 crew names are unique in a company', !(await as(A.u, `insert into public.crews (company_id, name) values ($1, 'Crew A')`, [A.cid])).ok);
  check('10 workers see crews but cannot change them', (await as(w2.u, `select count(*)::int n from public.crews`)).v === 2
    && !(await as(w2.u, `insert into public.crews (company_id, name) values ($1, 'Mine')`, [A.cid])).ok
    && (await as(w2.u, `with d as (delete from public.crews returning 1) select count(*)::int n from d`)).v === 0);
  check('11 there is no "maintenance crew" switch any more', (await one(`select count(*)::int n from information_schema.columns where table_name = 'crews' and column_name like '%maint%'`)).n === 0);

  // ── announcements and customer messages ──
  check('12 the owner posts a team announcement; workers read it; a worker or customer cannot post one',
    (await as(A.u, `insert into public.announcements (company_id, created_by, title, body, audience) values ($1, $2, 'Safety', 'Vests on', 'all_workers')`, [A.cid, A.pid])).ok
    && (await as(w1.u, `select count(*)::int n from public.announcements`)).v === 1
    && !(await as(w1.u, `insert into public.announcements (company_id, created_by, title, body, audience) values ($1, $2, 'x', 'y', 'all_workers')`, [A.cid, w1.pid])).ok
    && !(await as(c1.u, `insert into public.announcements (company_id, created_by, title, body, audience) values ($1, $2, 'x', 'y', 'all_workers')`, [A.cid, c1.pid])).ok);
  const job1 = (await one(`insert into public.projects (company_id, customer_id, name, status) values ($1, $2, 'Cora job', 'active') returning id`, [A.cid, c1.pid])).id;
  const reach = await as(A.u, `select public.customer_message_reach() x`);
  check('13 message reach counts all customers and customers with an active job (no Snow or maintenance groups)', reach.ok && reach.v.customers_all === 2 && reach.v.customers_active === 1
    && Object.keys(reach.v).length === 2, JSON.stringify(reach));
  const sent = await as(A.u, `select public.send_customer_announcement('Holiday hours', 'Closed Monday', 'customers_active') x`);
  check('14 a message to active-job customers reaches only them', sent.ok && sent.v.recipients === 1
    && (await one(`select count(*)::int n from public.app_notifications where recipient_id = $1 and event_type = 'announcement_posted'`, [c1.pid])).n === 1
    && (await one(`select count(*)::int n from public.app_notifications where recipient_id = $1 and event_type = 'announcement_posted'`, [c2.pid])).n === 0);
  check('15 the old Snow / maintenance customer groups are refused', !(await as(A.u, `select public.send_customer_announcement('x', 'y', 'customers_snow') x`)).ok
    && !(await as(A.u, `select public.send_customer_announcement('x', 'y', 'customers_maintenance') x`)).ok);
  check('16 a worker cannot message customers', !(await as(w1.u, `select public.send_customer_announcement('x', 'y', 'customers_all') x`)).ok);

  // ── job chat ──
  const msg = (u, pid, body) => as(u, `insert into public.project_messages (project_id, sender_id, body) values ($1, $2, $3)`, [job1, pid, body]);
  check('17 the customer and the owner chat on the customer\'s job', (await msg(c1.u, c1.pid, 'Hello')).ok && (await msg(A.u, A.pid, 'Hi Cora')).ok
    && (await as(c1.u, `select count(*)::int n from public.project_messages where project_id = $1`, [job1])).v === 2);
  check('18 another customer cannot read or write that chat, nor pretend to be someone else', (await as(c2.u, `select count(*)::int n from public.project_messages`)).v === 0
    && !(await msg(c2.u, c2.pid, 'Sneaky')).ok && !(await msg(c1.u, A.pid, 'Fake owner')).ok);

  // ── public weather switch ──
  check('19 the public (signed-out) weather area starts OFF', (await as(null, `select public.public_weather_config() x`)).v.enabled === false);
  check('20 only the owner can turn it on; anyone may then see that it is on', !(await as(admin.u, `select public.set_public_weather_enabled(true) x`)).ok
    && !(await as(null, `select public.set_public_weather_enabled(true) x`)).ok
    && (await as(A.u, `select public.set_public_weather_enabled(true) x`)).ok && (await as(null, `select public.public_weather_config() x`)).v.enabled === true);

  // ── push trigger and the FILL IN address ──
  await db.query(`insert into public.push_tokens (token, person_id, platform) values ('tok-1', $1, 'ios')`, [w1.pid]);
  await as(A.u, `insert into public.app_notifications (company_id, recipient_id, event_type, title, body) values ($1, $2, 'announcement_posted', 't', 'b')`, [A.cid, w1.pid]);
  check('21 while functions_url is still the FILL IN placeholder, no push call is attempted', (await one(`select count(*)::int n from net.calls`)).n === 0);
  await db.query(`update public.app_settings set value = 'https://abc123.supabase.co/functions/v1' where key = 'functions_url'`);
  await as(A.u, `insert into public.app_notifications (company_id, recipient_id, event_type, title, body) values ($1, $2, 'announcement_posted', 't2', 'b2')`, [A.cid, w1.pid]);
  const call = await one(`select url, body from net.calls order by id desc limit 1`);
  check('22 once it is filled in, each notice calls send-notification at that address with only the notice id', call && call.url === 'https://abc123.supabase.co/functions/v1/send-notification'
    && Object.keys(call.body).join() === 'id', JSON.stringify(call));
}
