// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && copy this file (and ./helpers/fullSchema.mjs) beside it, then:
//   node <file> <path to the repo>
// Proves update 50 on the REAL full schema + every update (PGlite, not real Supabase): the owner can delete a storm of ANY status with
// everything that hangs off it; a worker or a stranger cannot; the 020b "keep history" rules still block every other delete.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + String(detail).slice(0, 220)}`); };
check('0 the full schema and all updates (including 050) load', failures.length === 0, JSON.stringify(failures));
let again2 = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/050_snow_delete_any_storm.sql`, 'utf8')); } catch (e) { again2 = false; }
check('0b update 50 can be run a second time', again2);
// Update 61 (later) replaces snow_delete_storm, so put it back after re-running 50 (the real order).
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/061_snow_combined_routes.sql`, 'utf8')); } catch (e) { check('0c update 61 re-applies after 50', false, e.message); }
// Re-running 50 above puts its original guard back; in the real order, later updates (80's lock-down, 85's guard fix) come after it, so apply them again.
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/085_drop_old_code_functions.sql`, 'utf8')); } catch (e) { check('0d update 85 re-applies after 50', false, e.message); }
const fails = async (sql, p) => { try { await db.query(sql, p); return { raised: false, msg: '' }; } catch (e) { return { raised: true, msg: String(e.message) }; } };
const one = async (sql, p) => (await db.query(sql, p)).rows[0];

// ── fixtures (as the database owner, so row rules don't get in the way of building the data)
const co = (await one(`insert into public.companies (name) values ('Test Co') returning id`)).id;
const mk = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const owner = await mk('owner@x.test', 'Owner');
const worker = await mk('worker@x.test', 'Worker');
const stranger = await mk('stranger@x.test', 'Stranger');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1, $2, 'owner', 'active'), ($1, $3, 'worker', 'active')`, [co, owner.pid, worker.pid]);
const prop = (await one(`insert into public.snow_properties (company_id, name, address) values ($1, 'Oak Plaza', '1 Oak St') returning id`, [co])).id;
await db.query(`insert into public.snow_property_services (company_id, property_id, service, is_active) values ($1, $2, 'plowing', true)`, [co, prop]);

async function storm(status, name) {
  const st = (await one(`insert into public.snow_storms (company_id, name, service, status) values ($1, $2, 'plowing', 'draft') returning id`, [co, name])).id;
  const r = (await one(`insert into public.snow_routes (company_id, storm_id, service, name) values ($1, $2, 'plowing', 'Route 1') returning id`, [co, st])).id;
  const v1 = (await one(`insert into public.snow_visits (company_id, storm_id, route_id, service, property_id, position, property_name) values ($1, $2, $3, 'plowing', $4, 0, 'Oak Plaza') returning id`, [co, st, r, prop])).id;
  const v2 = (await one(`insert into public.snow_visits (company_id, storm_id, route_id, service, property_id, position, property_name) values ($1, $2, $3, 'plowing', $4, 1, 'Oak Plaza') returning id`, [co, st, r, prop])).id;
  if (status !== 'draft') {
    await db.query(`update public.snow_storms set status = 'dispatched', dispatched_at = now() where id = $1`, [st]);
    await db.query(`update public.snow_visits set status = 'arrived', arrived_at = now() where id = $1`, [v1]);
    await db.query(`update public.snow_visits set status = 'completed', completed_at = now() where id = $1`, [v1]);
    await db.query(`insert into public.snow_completion_media (company_id, storm_id, route_id, visit_id, property_id, service, kind, file_key) values ($1,$2,$3,$4,$5,'plowing','photo','k/' || gen_random_uuid()::text)`, [co, st, r, v1, prop]);
    await db.query(`insert into public.snow_skip_requests (company_id, storm_id, route_id, visit_id, property_id, reason) values ($1,$2,$3,$4,$5,'blocked')`, [co, st, r, v2, prop]);
  }
  if (status === 'ended') await db.query(`update public.snow_storms set status = 'ended', ended_at = now() where id = $1`, [st]);
  return { st, r, v1, v2 };
}
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u ?? ''}', false); set role authenticated;`); };
const count = async (table, st) => (await one(`select count(*)::int n from public.${table} where storm_id = $1`, [st])).n;
const asOwnerDb = async () => { await db.exec(`reset role`); };

const draft = await storm('draft', 'Draft storm');
const live = await storm('dispatched', 'Dispatched storm');
const ended = await storm('ended', 'Ended storm');
check('1 fixtures exist: a draft, a dispatched and an ended storm with worked stops, a photo record and a skip request', (await count('snow_visits', live.st)) === 2 && (await count('snow_completion_media', ended.st)) === 1 && (await count('snow_skip_requests', live.st)) === 1);

// ── the old rules, for contrast
await asUser(owner.u);
let f = await fails(`delete from public.snow_storms where id = $1`, [live.st]);
check('2 a plain delete of a dispatched storm is still refused (the 020b rule is not weakened)', f.raised && /can't be deleted/.test(f.msg), f.msg);
f = await fails(`delete from public.snow_visits where id = $1`, [ended.v1]);
check('3 a plain delete of a worked stop is still refused', f.raised, f.msg);

// ── who may use the new function
await asUser(worker.u);
f = await fails(`select public.snow_delete_storm($1)`, [live.st]);
await db.exec(`reset role`);
check('4 a worker cannot delete a storm (and nothing was deleted)', f.raised && /Storm not found/.test(f.msg) && (await count('snow_visits', live.st)) === 2, f.msg);
await asUser(stranger.u);
f = await fails(`select public.snow_delete_storm($1)`, [live.st]);
check('5 a stranger (not on the team) cannot delete a storm', f.raised && /Storm not found/.test(f.msg), f.msg);
await asUser(null);
f = await fails(`select public.snow_delete_storm($1)`, [live.st]);
check('6 a signed-out caller cannot delete a storm', f.raised, f.msg);
await db.exec(`reset role; set role anon`);
f = await fails(`select public.snow_delete_storm($1)`, [live.st]);
check('7 the signed-out role is not even allowed to call it', f.raised && /permission denied/i.test(f.msg), f.msg);

// ── the owner deletes each kind
await asUser(owner.u);
let res = (await one(`select public.snow_delete_storm($1) as r`, [draft.st])).r;
check('8 owner can delete a draft; it reports what went', res.status === 'draft' && res.routes === 1 && res.stops === 2 && res.completed_stops === 0, JSON.stringify(res));
res = (await one(`select public.snow_delete_storm($1) as r`, [live.st])).r;
check('9 owner can delete a DISPATCHED storm with worked stops and photos', res.status === 'dispatched' && res.routes === 1 && res.stops === 2 && res.completed_stops === 1 && res.media === 1, JSON.stringify(res));
res = (await one(`select public.snow_delete_storm($1) as r`, [ended.st])).r;
check('10 owner can delete an ENDED storm too', res.status === 'ended' && res.media === 1, JSON.stringify(res));
await asOwnerDb();
check('11 everything under them is gone: storms, routes, stops, photo records', (await one(`select (select count(*) from public.snow_storms where company_id = $1)::int a, (select count(*) from public.snow_routes where company_id = $1)::int b, (select count(*) from public.snow_visits where company_id = $1)::int c, (select count(*) from public.snow_completion_media where company_id = $1)::int d`, [co])).a === 0);
const left = await one(`select (select count(*) from public.snow_routes where company_id = $1)::int b, (select count(*) from public.snow_visits where company_id = $1)::int c, (select count(*) from public.snow_completion_media where company_id = $1)::int d`, [co]);
check('11b ...routes 0, stops 0, photo records 0', left.b === 0 && left.c === 0 && left.d === 0, JSON.stringify(left));
check('12 the property is untouched (only the storm data was deleted)', (await one(`select count(*)::int n from public.snow_properties where id = $1`, [prop])).n === 1);

// ── the guard is shut again afterwards
const again = await storm('dispatched', 'Another');
await asUser(owner.u);
f = await fails(`delete from public.snow_storms where id = $1`, [again.st]);
check('13 after a purge the protection is back: a plain delete is refused again', f.raised && /can't be deleted/.test(f.msg), f.msg);
await asOwnerDb();
check('14 the deletion was written to the activity log', (await one(`select count(*)::int n from public.snow_activity_events where company_id = $1 and action like '%deleted%'`, [co])).n > 0);

const bad = results.filter((r) => !r).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
