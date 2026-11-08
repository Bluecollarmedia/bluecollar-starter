// Update 93: a storm ends by itself when its last stop is finished or skipped. Reopen still works.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 93) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/093_storm_ends_when_all_stops_done.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 93 can be run a second time', again);

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

const cid = (await rpc(owner.u, `select public.add_customer('Cathy', 'Cust', 'cathy@x.test', '7325550101') as x`)).v.person_id;
const prop = (await rpc(owner.u, `select public.ensure_property($1::uuid, 'Cathy Home', '12 Elm St', 'Lakewood', 'NJ', '08701') as x`, [cid])).v;
await rpc(owner.u, `select public.snow_enable_for_property($1::uuid) as x`, [prop.id ?? prop.property_id]);
const sp = (await one(`select id from public.snow_properties where property_id = $1`, [prop.id ?? prop.property_id])).id;
await db.query(`insert into public.snow_property_services (company_id, property_id, service, is_active) values ($1,$2,'plowing',true) on conflict (property_id, service) do update set is_active = true`, [co, sp]);

const newStorm = async (name) => {
  const st = (await rpc(owner.u, `select public.snow_create_storm($1, 'plowing') as x`, [name])).v;
  const id = st?.storm?.id ?? st?.id;
  const route = (await one(`insert into public.snow_routes (company_id, storm_id, name, service, lead_person_id) values ($1,$2,'North','plowing',$3) returning id`, [co, id, lead.pid])).id;
  const mk = async (pos) => (await db.exec('reset role'), await one(`insert into public.snow_visits (company_id, storm_id, route_id, property_id, service, status, position) values ($1,$2,$3,$4,'plowing','pending',$5) returning id`, [co, id, route, sp, pos])).id;
  return { id, route, mk };
};
const status = async (id) => (await one(`select status from public.snow_storms where id = $1`, [id])).status;
const finish = async (v) => { await rpc(lead.u, `select public.snow_arrive_visit($1::uuid) as x`, [v]); return rpc(lead.u, `select public.snow_complete_visit($1::uuid, 'plowed') as x`, [v]); };

// ── 1. The last stop ends the storm ──
const s1 = await newStorm('Storm one');
const a = await s1.mk(1); const b = await s1.mk(2);
await rpc(owner.u, `select public.snow_dispatch_storm($1::uuid) as x`, [s1.id]);
let r = await finish(a);
check('1 finishing the first of two stops leaves the storm open', r.ok && (await status(s1.id)) === 'dispatched', r.msg);
r = await finish(b);
check('2 finishing the LAST stop ends the storm by itself', r.ok && (await status(s1.id)) === 'ended', r.msg);
const st = await one(`select ended_at, ended_by from public.snow_storms where id = $1`, [s1.id]);
check('3 it is stamped with when it ended', !!st.ended_at);
check('4 it is stamped with who ended it (the lead who finished the last stop), like a manual end', st.ended_by === lead.pid, JSON.stringify(st));

// ── 2. Reopen still works, and a new stop then ends it again ──
r = await rpc(owner.u, `select public.snow_reopen_storm($1::uuid) as x`, [s1.id]);
check('5 the owner can reopen the storm', r.ok && (await status(s1.id)) === 'dispatched', r.msg);
const c = await s1.mk(3);
check('6 a stop added after reopening keeps it open', (await status(s1.id)) === 'dispatched');
r = await finish(c);
check('7 and finishing that stop ends it again', r.ok && (await status(s1.id)) === 'ended', r.msg);

// ── 3. A skipped last stop counts too ──
const s2 = await newStorm('Storm two');
const d = await s2.mk(1); const e = await s2.mk(2);
await rpc(owner.u, `select public.snow_dispatch_storm($1::uuid) as x`, [s2.id]);
await finish(d);
await db.exec('reset role');
await db.query(`insert into public.snow_skip_requests (company_id, storm_id, route_id, visit_id, property_id, requested_by, status, reason) values ($1,$2,$3,$4,$5,$6,'pending','Gate locked')`, [co, s2.id, s2.route, e, sp, lead.pid]);
await db.query(`update public.snow_skip_requests set status = 'approved', decided_by = $2, decided_at = now() where visit_id = $1`, [e, owner.pid]);
await db.query(`update public.snow_visits set status = 'skipped' where id = $1`, [e]);
check('8 a stop that is skipped counts as done', (await status(s2.id)) === 'ended');

// ── 4. It waits for a pending skip request ──
const s3 = await newStorm('Storm three');
const f = await s3.mk(1); const g = await s3.mk(2);
await rpc(owner.u, `select public.snow_dispatch_storm($1::uuid) as x`, [s3.id]);
await finish(f);
await db.exec('reset role');
await db.query(`insert into public.snow_skip_requests (company_id, storm_id, route_id, visit_id, property_id, requested_by, status, reason) values ($1,$2,$3,$4,$5,$6,'pending','Gate locked')`, [co, s3.id, s3.route, g, sp, lead.pid]);
await finish(g).catch(() => {});
check('9 a pending skip request keeps the storm open until the owner decides', (await status(s3.id)) === 'dispatched');

// ── 5. A draft or never-started storm never ends ──
const s4 = await newStorm('Storm four');
const h = await s4.mk(1);
await db.exec('reset role');
await db.query(`update public.snow_visits set status = 'completed' where id = $1`, [h]).catch(() => {});
check('10 a storm that was never dispatched is left alone', (await status(s4.id)) === 'draft');

console.log(results.every(Boolean) ? '\nall passed' : '\nsome failed');
process.exit(results.every(Boolean) ? 0 : 1);
