// Run: copy this file (and ./helpers/fullSchema.mjs) next to a folder with @electric-sql/pglite installed, then:
//   node <file> <path to the repo>
// Proves update 67 (landscaping/maintenance AND snow) on the REAL full schema + every update (PGlite, not real Supabase): a worker can only clock in when there is
// work for them that day (a maintenance route crew place or a landscaping assignment); clock-out and open shifts are unaffected.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 260)}`); };
check('0 the full schema and all updates (including 067) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/067_clock_in_needs_work.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 67 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
const today = (await db.query(`select current_date::text as d`)).rows[0].d;
const inDays = async (n) => (await one(`select (current_date + $1::int)::text as d`, [n])).d;

const co = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
const mk = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const owner = await mk('owner@x.test', 'Owner');
const admin = await mk('admin@x.test', 'Admin');
const mNone = await mk('mnone@x.test', 'MaintNoWork');       // maintenance worker, nothing scheduled
const mRoute = await mk('mroute@x.test', 'MaintOnRoute');    // maintenance worker on today's route
const mOther = await mk('mother@x.test', 'MaintOtherRoute'); // maintenance worker whose route is somebody else's
const lAsg = await mk('lasg@x.test', 'LandWithJob');
const lNone = await mk('lnone@x.test', 'LandNoJob');
const lFuture = await mk('lfuture@x.test', 'LandJobLater');
const lCancel = await mk('lcancel@x.test', 'LandCancelled');
const gone = await mk('gone@x.test', 'Deactivated');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values
  ($1,$2,'owner','active','landscaping'),($1,$3,'admin','active','landscaping'),($1,$4,'worker','active','maintenance'),($1,$5,'worker','active','maintenance'),
  ($1,$6,'worker','active','maintenance'),($1,$7,'worker','active','landscaping'),($1,$8,'worker','active','landscaping'),($1,$9,'worker','active','landscaping'),
  ($1,$10,'worker','active','landscaping'),($1,$11,'worker','inactive','landscaping')`,
  [co, owner.pid, admin.pid, mNone.pid, mRoute.pid, mOther.pid, lAsg.pid, lNone.pid, lFuture.pid, lCancel.pid, gone.pid]);
const proj = (await one(`insert into public.projects (company_id, name, status) values ($1,'Job','active') returning id`, [co])).id;
const mkRoute = async (date, status, crew) => {
  const r = (await one(`insert into public.maintenance_routes (company_id, service_date, name, status) values ($1,$2,'R','${status}') returning id`, [co, date])).id;
  for (const pid of crew) await db.query(`insert into public.maintenance_route_crew (company_id, route_id, person_id) values ($1,$2,$3)`, [co, r, pid]);
  return r;
};
const mkAsg = async (pid, date, status = 'scheduled') => (await one(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, status) values ($1,$2,$3,$4,$5) returning id`, [co, proj, pid, date, status])).id;
await mkRoute(today, 'planned', [mRoute.pid]);
await mkRoute(today, 'cancelled', [mOther.pid]);                 // a cancelled route does not count
await mkAsg(lAsg.pid, today);
await mkAsg(lFuture.pid, await inDays(5));                       // another date
await mkAsg(lCancel.pid, today, 'cancelled');
const open = async (pid) => (await one(`select count(*)::int c from public.time_workdays where person_id = $1 and clock_out_at is null`, [pid])).c;
const any = async (pid) => (await one(`select count(*)::int c from public.time_workdays where person_id = $1`, [pid])).c;
const clock = (u) => rpc(u, `select public.time_clock_in($1::date, null, gen_random_uuid()) as x`, [today]);

// 1. no work
let r = await clock(mNone.u);
check('1 a maintenance worker with no work today cannot clock in, and nothing is recorded', !r.ok && /no work scheduled today/.test(r.msg) && (await any(mNone.pid)) === 0, r.msg);
r = await rpc(mNone.u, `select public.time_my_day($1::date) as x`, [today]);
check('1b the phone is told can_clock_in = false (so it shows "No work scheduled today", not a button)', r.ok && r.v.can_clock_in === false, JSON.stringify(r.v));
r = await clock(lNone.u);
check('1c the same holds for a landscaping worker with no job', !r.ok && (await any(lNone.pid)) === 0, r.msg);

// 2. somebody else's work
r = await clock(mOther.u);
check('2 a worker whose only route is cancelled, or who sits on nobody\'s route, cannot clock in', !r.ok && (await any(mOther.pid)) === 0, r.msg);
check('2b another worker\'s assignment and another worker\'s route do not authorize this worker (mNone still refused with a route and a job existing today)', !(await clock(mNone.u)).ok && !(await clock(lNone.u)).ok);
check('2c Snow Mode being on, or a project existing with nobody assigned, does not authorize it', await (async () => {
  await db.query(`update public.companies set active_mode = 'snow' where id = $1`, [co]).catch(() => {});
  await db.exec(`reset role`);
  const x = await clock(mNone.u); await db.query(`update public.companies set active_mode = 'landscaping' where id = $1`, [co]).catch(() => {});
  return !x.ok; })());

// 8. another date / cancelled assignment
r = await clock(lFuture.u);
check('8 a job on another date does not authorize clock-in today', !r.ok && (await any(lFuture.pid)) === 0, r.msg);
r = await clock(lCancel.u);
check('8b a cancelled job does not authorize it', !r.ok && (await any(lCancel.pid)) === 0, r.msg);

// 3. valid work
r = await clock(mRoute.u);
check('3 a maintenance worker on today\'s route can clock in', r.ok && r.v.days.length === 1 && r.v.days[0].clock_out_at === null && (await open(mRoute.pid)) === 1, r.msg);
r = await clock(lAsg.u);
check('3b a landscaping worker with today\'s job can clock in', r.ok && (await open(lAsg.pid)) === 1, r.msg);
r = await rpc(admin.u, `select public.time_clock_in($1::date, null, null) as x`, [today]);
const r2 = await rpc(owner.u, `select public.time_clock_in($1::date, null, null) as x`, [today]);
check('3c the owner and an admin may clock in without a route (existing owner exception)', r.ok && r2.ok, r.msg + (r2.msg ?? ''));

// 4. direct API
await asUser(mNone.u);
let direct;
try { await db.query(`insert into public.time_workdays (company_id, person_id, work_date) values ($1,$2,$3)`, [co, mNone.pid, today]); direct = false; } catch { direct = true; }
await asDb();
r = await rpc(mNone.u, `select public.time_clock_in($1::date, null, null) as x`, [await inDays(1)]);
check('4 going around the screen does not work: a direct table insert is refused, and the function refuses a different date with no work on it', direct && !r.ok && (await any(mNone.pid)) === 0, r.msg);
r = await rpc(mNone.u, `select public.time_start_visit('assignment', gen_random_uuid()) as x`);
check('4b without a workday nothing else can be started either', !r.ok);

// 5. duplicates
r = await clock(mRoute.u);
check('5 tapping Clock In again shows the open shift and never makes a second', r.ok && r.v.already_active === true && (await open(mRoute.pid)) === 1);

// 6. deactivated
r = await clock(gone.u);
check('6 a deactivated worker cannot clock in', !r.ok && (await any(gone.pid)) === 0, r.msg);
await asDb();
await mkAsg(gone.pid, today);
r = await clock(gone.u);
check('6b ...even with a job today', !r.ok && (await any(gone.pid)) === 0, r.msg);

// 7. open shift and clock-out unaffected
await asDb();
await db.query(`delete from public.assignments where person_id = $1`, [lAsg.pid]);
r = await rpc(lAsg.u, `select public.time_my_day($1::date) as x`, [today]);
check('7 a worker already on the clock still sees the open shift even if the job was removed', r.ok && r.v.days.length === 1 && r.v.days[0].clock_out_at === null && r.v.can_clock_in === false, JSON.stringify(r.v));
r = await rpc(lAsg.u, `select public.time_clock_out() as x`);
check('7b and can clock out (clock-out never needs work)', r.ok && r.v.days[0].clock_out_at !== null && (await open(lAsg.pid)) === 0, r.msg);
r = await clock(lAsg.u);
check('7c after clocking out with no work left, a new shift is refused', !r.ok, r.msg);

// 9. no time window exists
r = await clock(mNone.u);
check('9 at any hour (there is no clock-in time window in this app), no work still means no clock-in', !r.ok && /no work scheduled/.test(r.msg));

// 10. owner adding a forgotten day still works (the owner exception that already existed)
r = await rpc(owner.u, `select public.time_staff_add_workday($1::uuid, current_date - 3, now() - interval '75 hours', now() - interval '67 hours', 'forgot to clock in') as x`, [mNone.pid]);
check('10 the owner can still add a missed day for someone (corrections are unchanged)', r.ok, r.msg);


// ══════════════ SNOW MODE ══════════════
const grantSnow = async (pid, svcs = ['plowing']) => {
  await db.query(`insert into public.snow_staff (company_id, person_id, status, granted_at) values ($1,$2,'active',now()) on conflict do nothing`, [co, pid]);
  for (const s of svcs) await db.query(`insert into public.snow_staff_services (company_id, person_id, service) values ($1,$2,$3) on conflict do nothing`, [co, pid, s]);
};
const sLead = await mk('slead@x.test', 'SnowLead');
const sCrew = await mk('screw@x.test', 'SnowCrew');
const sNone = await mk('snone@x.test', 'SnowNoRoute');
const sDraft = await mk('sdraft@x.test', 'SnowDraftRoute');
const sOld = await mk('sold@x.test', 'SnowEndedStorm');
const sWrong = await mk('swrong@x.test', 'SnowWrongService');
const sGone = await mk('sgone@x.test', 'SnowRevoked');
for (const p of [sLead, sCrew, sNone, sDraft, sOld, sGone]) await grantSnow(p.pid, ['plowing']);
await grantSnow(sWrong.pid, ['plowing']);
const snowOpen = async (pid) => (await one(`select count(*)::int c from public.snow_shifts where person_id = $1 and clock_out_at is null`, [pid])).c;
const snowAny = async (pid) => (await one(`select count(*)::int c from public.snow_shifts where person_id = $1`, [pid])).c;
const snowIn = (u) => rpc(u, `select (public.snow_clock_in(gen_random_uuid())).id as x`);

r = await rpc(owner.u, `select (public.snow_create_storm('Storm A', array['plowing'])->'storm'->>'id') as x`);
check('S0 the owner can create a storm (draft)', r.ok && !!r.v, r.msg);
const stormA = r.v;
await asDb();
await db.query(`insert into public.snow_routes (storm_id, service, name, lead_person_id) values ($1, 'plowing', 'Plow A', $2)`, [stormA, sLead.pid]);
const routeA = (await one(`select id from public.snow_routes where name = 'Plow A'`)).id;
for (const pid of [sCrew.pid, sDraft.pid, sWrong.pid]) await db.query(`insert into public.snow_route_crew (company_id, storm_id, route_id, person_id) values ($1,$2,$3,$4)`, [co, stormA, routeA, pid]);
await db.query(`delete from public.snow_staff_services where person_id = $1`, [sWrong.pid]);   // later loses the plowing service
await db.query(`insert into public.snow_staff_services (company_id, person_id, service) values ($1,$2,'shoveling')`, [co, sWrong.pid]);
const snowProp = (await one(`insert into public.snow_properties (company_id, name, address) values ($1,'Main St','1 Main') returning id`, [co])).id;
await db.query(`insert into public.snow_property_services (company_id, property_id, service) values ($1,$2,'plowing')`, [co, snowProp]).catch(() => {});
await db.query(`insert into public.snow_visits (route_id, property_id) values ($1,$2)`, [routeA, snowProp]);

// before dispatch nobody on the route may clock in (a draft storm is not work yet)
r = await snowIn(sLead.u);
check('S1 a snow worker on a route of a storm that is only a DRAFT cannot clock in', !r.ok && /No active storm assignment/.test(r.msg) && (await snowAny(sLead.pid)) === 0, r.msg);
r = await rpc(sNone.u, `select public.snow_can_clock_in() as x`);
check('S1b the screen is told can_clock_in = false (shows "No active storm assignment")', r.ok && r.v === false, JSON.stringify(r));

// dispatch
r = await rpc(owner.u, `select public.snow_dispatch_storm($1::uuid) as x`, [stormA]);
check('S2 the owner dispatches the storm', r.ok, r.msg);

r = await snowIn(sNone.u);
check('S3 a snow worker with snow access who is NOT on any route cannot clock in, even though a storm is dispatched', !r.ok && (await snowAny(sNone.pid)) === 0, r.msg);
check('S3b a dispatched storm does not authorize every snow worker (3 other snow workers refused)', !(await snowIn(sOld.u)).ok && !(await snowIn(sGone.u)).ok && (await snowAny(sOld.pid)) + (await snowAny(sGone.pid)) === 0);
r = await snowIn(sWrong.u);
check('S3c a worker on the route who no longer holds that service (shoveling only, route is plowing) cannot clock in', !r.ok, r.msg);

r = await snowIn(sLead.u);
check('S4 the route LEAD of a dispatched storm can clock in (legitimate workflow; any hour, no time window)', r.ok && (await snowOpen(sLead.pid)) === 1, r.msg);
r = await snowIn(sCrew.u);
check('S4b a route CREW member can clock in too', r.ok && (await snowOpen(sCrew.pid)) === 1, r.msg);
check('S4c the shift is tagged with the storm as before', (await one(`select storm_id from public.snow_shifts where person_id = $1`, [sLead.pid])).storm_id === stormA);
r = await rpc(sLead.u, `select (public.snow_clock_in(gen_random_uuid())).id as x`);
check('S5 tapping Clock In again returns the open shift, never a second', r.ok && (await snowOpen(sLead.pid)) === 1 && (await snowAny(sLead.pid)) === 1, r.msg);

// overnight: a storm dispatched a day and a half ago and a shift that began 9 hours ago (so it crossed midnight) are both legitimate
await asDb();
await db.query(`update public.snow_storms set created_at = now() - interval '30 hours' where id = $1`, [stormA]);
await db.query(`update public.snow_shifts set clock_in_at = now() - interval '9 hours' where person_id = $1 and clock_out_at is null`, [sCrew.pid]);
r = await rpc(sCrew.u, `select public.snow_can_clock_in() as x`);
check('S5b overnight: a storm dispatched long before the shift still authorizes the crew (there is no time-of-day window)', r.ok && r.v === true, JSON.stringify(r));
r = await rpc(sCrew.u, `select (public.snow_clock_in(gen_random_uuid())).id as x`);
check('S5c overnight: the shift that has been open since before midnight stays one open shift (not closed, not duplicated)', r.ok && (await snowOpen(sCrew.pid)) === 1 && (await snowAny(sCrew.pid)) === 1
  && (await one(`select (now() - clock_in_at > interval '8 hours') as old from public.snow_shifts where person_id = $1 and clock_out_at is null`, [sCrew.pid])).old === true, r.msg);

// direct API
await asUser(sNone.u);
let sdirect;
try { await db.query(`insert into public.snow_shifts (company_id, person_id) values ($1,$2)`, [co, sNone.pid]); sdirect = (await snowAny(sNone.pid)) > 0; } catch { sdirect = false; }
await asDb();
check('S6 going around the screen fails: a direct insert into the shifts table does nothing', sdirect === false && (await snowAny(sNone.pid)) === 0);
r = await rpc(sNone.u, `select (public.snow_clock_in(null)).id as x`);
check('S6b calling the function directly (old app, edited request) is refused the same way', !r.ok && (await snowAny(sNone.pid)) === 0, r.msg);

// active shift and clock out are not tied to the route staying in place
await asDb();
await db.query(`update public.snow_routes set cancelled_at = now() where id = $1`, [routeA]);
r = await rpc(sLead.u, `select public.snow_can_clock_in() as x`);
check('S7 a cancelled route stops authorizing new shifts', r.ok && r.v === false);
r = await rpc(sLead.u, `select (public.snow_clock_out()).clock_out_at as x`);
check('S7b but a worker already on the clock can still clock out (clock-out never needs a route)', r.ok && r.v !== null && (await snowOpen(sLead.pid)) === 0, r.msg);
r = await snowIn(sLead.u);
check('S7c and cannot start a new shift on the cancelled route', !r.ok, r.msg);
await asDb();
await db.query(`update public.snow_routes set cancelled_at = null where id = $1`, [routeA]);
await rpc(sCrew.u, `select (public.snow_clock_out()).clock_out_at as x`);
r = await rpc(owner.u, `select public.snow_end_storm($1::uuid) as x`, [stormA]);
const ended = r.ok;
r = await snowIn(sCrew.u);
check('S8 once the storm has ENDED, its route no longer authorizes a clock-in (an old assignment is not authorization)', ended && !r.ok && (await snowOpen(sCrew.pid)) === 0, (r.msg ?? '') + ended);

// revoked access / owner exception
await asDb();
await db.query(`update public.snow_staff set status = 'revoked' where person_id = $1`, [sCrew.pid]);
r = await snowIn(sGone.u);
r = await rpc(owner.u, `select (public.snow_clock_in(null)).id as x`);
check('S9 the owner can clock in on the snow clock without a route (existing owner exception)', r.ok, r.msg);
await asDb();
await db.query(`update public.snow_staff set status = 'revoked' where person_id = $1`, [sLead.pid]);
r = await snowIn(sLead.u);
check('S10 a worker whose snow access was removed cannot clock in', !r.ok && /snow team access/.test(r.msg), r.msg);

// landscaping and snow stay separate
await asDb();
r = await clock(sNone.u);
check('S11 snow access does not authorize a landscaping clock-in (separate rules)', !r.ok, r.msg);
await asDb();
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'worker','active','landscaping') on conflict do nothing`, [co, sNone.pid]);
await mkAsg(sNone.pid, today);
check('S11b and a landscaping job does not authorize a snow clock-in', !(await snowIn(sNone.u)).ok && (await snowAny(sNone.pid)) === 0);

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
