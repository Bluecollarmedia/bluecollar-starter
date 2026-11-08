// Update 110: a Snow route can have any number of crew leads. Real full schema on PGlite (not real Supabase).
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 110) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/110_snow_multiple_leads.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 110 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0], rows: r.rows }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await db.exec('reset role'); } };
const signUp = async (email, meta) => {
  await db.exec('reset role');
  const u = (await one(`insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`, [email, JSON.stringify(meta)])).id;
  return { u, pid: (await one(`select id from public.people where user_id = $1`, [u])).id };
};

const owner = await signUp('o@x.test', { first_name: 'Owner', last_name: 'O', company_name: 'Acme Snow' });
const co = (await one(`select company_id from public.company_members where person_id = $1 and role = 'owner'`, [owner.pid])).company_id;
const worker = async (email, name, snowTeam = true) => {
  const w = await signUp(email, { first_name: name, last_name: 'W' });
  await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'worker','active')`, [co, w.pid]);
  if (snowTeam) {
    await db.query(`insert into public.snow_staff (company_id, person_id, status, granted_at) values ($1,$2,'active',now())`, [co, w.pid]);
    await db.query(`insert into public.snow_staff_services (company_id, person_id, service) values ($1,$2,'plowing')`, [co, w.pid]);
  }
  return w;
};
const l1 = await worker('l1@x.test', 'LeadOne');
const l2 = await worker('l2@x.test', 'LeadTwo');
const l3 = await worker('l3@x.test', 'LeadThree');
const crew = await worker('c@x.test', 'Crew');
const nosnow = await worker('n@x.test', 'NoSnow', false);
const stranger = await worker('s@x.test', 'Stranger');

const cid = (await rpc(owner.u, `select public.add_customer('Cathy', 'Cust', 'cathy@x.test', '7325550101') as x`)).v.person_id;
const prop = (await rpc(owner.u, `select public.ensure_property($1::uuid, 'Cathy Home', '12 Elm St', 'Lakewood', 'NJ', '08701') as x`, [cid])).v;
await rpc(owner.u, `select public.snow_enable_for_property($1::uuid) as x`, [prop.id ?? prop.property_id]);
const sp = (await one(`select id from public.snow_properties where property_id = $1`, [prop.id ?? prop.property_id])).id;
await db.query(`insert into public.snow_property_services (company_id, property_id, service, is_active) values ($1,$2,'plowing',true) on conflict (property_id, service) do update set is_active = true`, [co, sp]);
const st = (await rpc(owner.u, `select public.snow_create_storm('Oct 21 Plowing', 'plowing') as x`)).v;
const stormId = st?.storm?.id ?? st?.id ?? (await one(`select id from public.snow_storms where company_id = $1 limit 1`, [co])).id;
const route = (await one(`insert into public.snow_routes (company_id, storm_id, name, service, lead_person_id, media_required, min_media) values ($1,$2,'North','plowing',$3,true,1) returning id`, [co, stormId, l1.pid])).id;
const mkVisit = async (pos) => (await db.exec('reset role'), (await one(`insert into public.snow_visits (company_id, storm_id, route_id, property_id, service, status, position) values ($1,$2,$3,$4,'plowing','pending',$5) returning id`, [co, stormId, route, sp, pos])).id);
const v1 = await mkVisit(1);
const v2 = await mkVisit(2); // stays pending so the storm keeps running (it ends by itself when its last stop is done)
await rpc(owner.u, `select public.snow_dispatch_storm($1::uuid) as x`, [stormId]);

const LEADS = (u, ids) => rpc(u, `select public.snow_set_route_leads($1::uuid, $2::uuid[]) as x`, [route, ids]);
const leadsOf = (v) => (v?.leads ?? []);

// ── three leads ──
let r = await LEADS(owner.u, [l1.pid, l2.pid, l3.pid]);
check('1 the owner sets three leads; the first stays first', r.ok && JSON.stringify(leadsOf(r.v)) === JSON.stringify([l1.pid, l2.pid, l3.pid]), JSON.stringify(r));
const asg = await one(`select lead_person_id, (select count(*)::int from public.snow_route_extra_leads where route_id = $1) n from public.snow_routes where id = $1`, [route]);
check('2 the route\'s first lead column is unchanged and two more are listed', asg.lead_person_id === l1.pid && asg.n === 2, JSON.stringify(asg));
r = await rpc(l2.u, `select public.snow_arrive_visit($1::uuid) as x`, [v1]);
check('3 a second lead can mark arrival', r.ok, r.msg);
r = await rpc(l3.u, `select public.snow_complete_visit($1::uuid, 'plowed') as x`, [v1]);
check('4 a third lead can finish the stop', r.ok, r.msg);
for (const [who, p] of [['L2', l2], ['L3', l3]]) {
  const mine = await rpc(p.u, `select * from public.snow_my_routes()`);
  check(`5 ${who} sees the route as a lead`, mine.ok && mine.rows.some((x) => x.route_id === route && x.role === 'lead'), JSON.stringify(mine.rows));
}
r = await rpc(stranger.u, `select public.snow_arrive_visit($1::uuid) as x`, [v1]);
check('6 someone who is not a lead cannot act on the route', !r.ok, JSON.stringify(r));
r = await rpc(l2.u, `select public.snow_set_route_leads($1::uuid, $2::uuid[]) as x`, [route, [l1.pid]]);
check('7 a lead cannot change the leads (only owner or admin)', !r.ok, JSON.stringify(r));
await asUser(l2.u);
let direct = true;
try { await db.query(`insert into public.snow_route_extra_leads (company_id, storm_id, route_id, person_id) values ($1,$2,$3,$4)`, [co, stormId, route, stranger.pid]); } catch { direct = false; }
await db.exec('reset role');
check('8 nobody can write the extra-leads table directly', !direct);

// ── leads and crew never overlap ──
r = await rpc(owner.u, `select public.snow_set_route_crew($1::uuid, $2::uuid[]) as x`, [route, [crew.pid]]);
check('9 a crew member can be added', r.ok, r.msg);
r = await rpc(owner.u, `select public.snow_set_route_crew($1::uuid, $2::uuid[]) as x`, [route, [crew.pid, l2.pid]]);
check('10 a lead cannot also be put on the crew', !r.ok && /already leads/.test(r.msg ?? ''), JSON.stringify(r));
r = await LEADS(owner.u, [l1.pid, l2.pid, l3.pid, crew.pid]);
const crewLeft = (await one(`select count(*)::int c from public.snow_route_crew where route_id = $1`, [route])).c;
check('11 making the crew member a lead takes them off the crew', r.ok && leadsOf(r.v).length === 4 && crewLeft === 0, JSON.stringify([r, crewLeft]));

// ── removing and reordering ──
r = await LEADS(owner.u, [l1.pid, l2.pid]);
check('12 removing leads leaves the rest', r.ok && JSON.stringify(leadsOf(r.v)) === JSON.stringify([l1.pid, l2.pid]), JSON.stringify(r));
r = await rpc(l3.u, `select public.snow_arrive_visit($1::uuid) as x`, [v1]);
check('13 a removed lead can no longer act', !r.ok, JSON.stringify(r));
r = await LEADS(owner.u, [l2.pid]);
const first = (await one(`select lead_person_id from public.snow_routes where id = $1`, [route])).lead_person_id;
check('14 when the first lead is taken out, the next becomes the first lead', r.ok && first === l2.pid && JSON.stringify(leadsOf(r.v)) === JSON.stringify([l2.pid]), JSON.stringify([r, first]));
r = await LEADS(owner.u, [l2.pid, l1.pid]);
check('15 the same list again changes nothing (repeating is safe)', r.ok && (await one(`select lead_person_id from public.snow_routes where id = $1`, [route])).lead_person_id === l2.pid, JSON.stringify(r));
r = await LEADS(owner.u, [l2.pid, nosnow.pid]);
check('16 someone who is not on the snow team cannot be made a lead', !r.ok && /snow team/.test(r.msg ?? ''), JSON.stringify(r));
r = await LEADS(owner.u, []);
check('17 an empty list leaves the route with no lead', r.ok && leadsOf(r.v).length === 0 && (await one(`select lead_person_id from public.snow_routes where id = $1`, [route])).lead_person_id === null, JSON.stringify(r));

// ── older paths still work; the first lead set directly is never also an extra ──
await LEADS(owner.u, [l2.pid, l3.pid]);
await db.exec('reset role');
await db.query(`update public.snow_routes set lead_person_id = $2 where id = $1`, [route, l3.pid]);
const dup = (await one(`select count(*)::int c from public.snow_route_extra_leads where route_id = $1 and person_id = $2`, [route, l3.pid])).c;
check('18 setting the first lead the old way takes that person out of the extra leads', dup === 0, dup);

// ── notifications ──
await LEADS(owner.u, [l3.pid, l1.pid]);
const note = await one(`select count(*)::int c from public.snow_notifications where recipient_person_id = $1 and event = 'route.lead_assigned' and route_id = $2`, [l1.pid, route]);
check('19 a lead added after the storm went out is told', note.c >= 1, JSON.stringify(note));

// ── a cancelled route has no leads ──
await db.exec('reset role');
await db.query(`update public.snow_routes set cancelled_at = now() where id = $1`, [route]);
r = await rpc(l1.u, `select public.snow_arrive_visit($1::uuid) as x`, [v1]);
check('20 once the route is cancelled no lead can act on it', !r.ok, JSON.stringify(r));

console.log(results.every(Boolean) ? 'all passed' : 'FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
