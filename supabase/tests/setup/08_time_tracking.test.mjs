// Time tracking in depth: request ids and the open-day rule,
// trucks at clock-in, breaks, job order, required photos, owner corrections with history, approval, pay-rate snapshots, alerts,
// skip requests, the owner clocking a worker in and out by hand, companies kept apart, and nothing written around the functions.
// The scheduled work is projects + assignments (a job for a worker on a date). 04_time_clock.test.mjs covers the plain day.
import { freshDb } from '../helpers/setupDb.mjs';

export default async function run({ check }) {
  const { db, one, all, as, signUp, ownerWithCompany, extraCompany, member } = await freshDb();
  const A = await ownerWithCompany('owner@example.com', 'Company A');
  const admin = await member(A.cid, 'admin@example.com', 'admin', 'Ada');
  const cust = await member(A.cid, 'cust@example.com', 'customer', 'Cora');
  const stranger = await signUp('stranger@example.com', { first_name: 'Stan', last_name: 'Ger' });
  const B = await extraCompany('Company B');
  const ownerB = await signUp('ownerb@example.com', { first_name: 'Bo', last_name: 'B' });
  await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1, $2, 'owner', 'active')`, [B, ownerB.pid]);
  const wB = await member(B, 'wb@example.com', 'worker', 'Wyatt');
  const today = (await one(`select current_date::text d`)).d;
  const iso = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();
  const mkProj = async (cid, name) => (await one(`insert into public.projects (company_id, name, status) values ($1, $2, 'active') returning id`, [cid, name])).id;
  const mkAsg = async (cid, proj, pid, order = 1, truck = null) => (await one(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, sort_order, status, truck_id)
    values ($1, $2, $3, current_date, $4, 'scheduled', $5) returning id`, [cid, proj, pid, order, truck])).id;
  const n = async (sql, p) => (await one(sql, p)).n;
  const day = (u) => as(u, `select public.time_my_day(current_date) x`);

  // ═══ 1. clock-in: request ids, one open day, trucks ═══
  const wA = await member(A.cid, 'wa@example.com', 'worker', 'Abe');
  const pJ1 = await mkProj(A.cid, 'Job One');
  const pJ2 = await mkProj(A.cid, 'Job Two');
  const j1 = await mkAsg(A.cid, pJ1, wA.pid, 1);
  const j2 = await mkAsg(A.cid, pJ2, wA.pid, 2);
  await db.query(`insert into public.worker_hourly_rates (company_id, person_id, hourly_rate, effective_date) values ($1, $2, 25, '2020-01-01')`, [A.cid, wA.pid]);
  const reqId = (await one(`select gen_random_uuid() g`)).g;
  const t1 = await as(wA.u, `select public.time_clock_in(current_date, null, $1::uuid) x`, [reqId]);
  const t2 = await as(wA.u, `select public.time_clock_in(current_date, null, $1::uuid) x`, [reqId]);
  const t3 = await as(wA.u, `select public.time_clock_in(current_date, null, gen_random_uuid()) x`);
  check('1 Clock In sent twice with the same request id, then again from another phone, makes ONE open workday', t1.ok && t1.v.days[0].status === 'active'
    && t2.ok && t2.v.already_active === true && t3.ok && t3.v.already_active === true
    && await n(`select count(*)::int n from public.time_workdays where person_id = $1`, [wA.pid]) === 1, JSON.stringify([t1.msg, t2.msg, t3.msg]));
  let raised = null; try { await db.query(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at) values ($1, $2, current_date, now() + interval '1 minute')`, [A.cid, wA.pid]); } catch (e) { raised = e.message; }
  check('2 the database itself refuses a second open (overlapping) workday, even written directly', !!raised, raised);
  raised = null; try { await db.query(`update public.time_workdays set clock_out_at = clock_in_at - interval '1 minute' where person_id = $1`, [wA.pid]); } catch (e) { raised = e.message; }
  check('3 a clock-out before the clock-in is refused', !!raised && /before the clock-in/.test(raised), raised);
  check('4 the hourly rate in force is saved with the workday', Number((await one(`select r.hourly_rate from public.time_workday_rates r join public.time_workdays w on w.id = r.workday_id where w.person_id = $1`, [wA.pid])).hourly_rate) === 25);

  const truckA = (await one(`insert into public.trucks (company_id, name) values ($1, 'Truck A') returning id`, [A.cid])).id;
  const truckB = (await one(`insert into public.trucks (company_id, name) values ($1, 'Truck B') returning id`, [A.cid])).id;
  const truckOther = (await one(`insert into public.trucks (company_id, name) values ($1, 'B Co Truck') returning id`, [B])).id;
  const tw1 = await member(A.cid, 'tw1@example.com', 'worker', 'Tia');
  const tw2 = await member(A.cid, 'tw2@example.com', 'worker', 'Ty');
  const tw3 = await member(A.cid, 'tw3@example.com', 'worker', 'Tom');
  const tw4 = await member(A.cid, 'tw4@example.com', 'worker', 'Tess');
  const pCrew = await mkProj(A.cid, 'Crew Job');
  const pSolo = await mkProj(A.cid, 'Solo Job');
  await mkAsg(A.cid, pSolo, tw1.pid, 1, truckA);
  await mkAsg(A.cid, pCrew, tw2.pid);
  await mkAsg(A.cid, pSolo, tw3.pid);
  await mkAsg(A.cid, pCrew, tw4.pid);
  let r = await as(tw1.u, `select public.time_clock_in(current_date, $1::uuid, null) x`, [truckB]);
  check('5 when the owner put a truck on the worker\'s job, that truck is used (the worker\'s pick is ignored)', r.ok && r.v.days[0].truck.name === 'Truck A' && r.v.days[0].truck.source === 'owner', JSON.stringify(r.v?.days?.[0]?.truck) + (r.msg ?? ''));
  r = await as(tw2.u, `select public.time_clock_in(current_date, $1::uuid, null) x`, [truckB]);
  check('6 with no owner truck the worker picks one and it is recorded as theirs', r.ok && r.v.days[0].truck.name === 'Truck B' && r.v.days[0].truck.source === 'worker', r.msg);
  r = await as(stranger.u, `select public.time_clock_in(current_date, null, null) x`);
  check('7 someone who is not on any team cannot clock in', !r.ok && /not on a team/.test(r.msg), r.msg);
  r = await as(tw3.u, `select public.time_trucks_for_clock_in(current_date) x`);
  check('8 a truck in use by someone not on the same job is shown as in use', r.ok && r.v.trucks.find((x) => x.name === 'Truck B').in_use === true
    && !r.v.trucks.some((x) => x.name === 'B Co Truck'), JSON.stringify(r.v));
  r = await as(tw3.u, `select public.time_clock_in(current_date, $1::uuid, null) x`, [truckB]);
  check('9 ...and cannot be taken (the server refuses it too)', !r.ok && /already in use/.test(r.msg), r.msg);
  r = await as(tw4.u, `select public.time_clock_in(current_date, $1::uuid, null) x`, [truckB]);
  check('10 a crew mate on the same job that day can share the truck', r.ok && r.v.days[0].truck.name === 'Truck B', r.msg);
  r = await as(tw3.u, `select public.time_clock_in(current_date, $1::uuid, null) x`, [truckOther]);
  check('11 another company\'s truck cannot be picked', !r.ok && /isn't available/.test(r.msg), r.msg);

  // ═══ 2. breaks, job order, photos, the job's older records (063 + review 56-58 + owner_clock_in_out 10-13) ═══
  r = await as(wA.u, `select public.time_break_start() x`);
  check('12 breaks are off until the owner turns them on', !r.ok && /turned off/.test(r.msg), r.msg);
  await db.query(`insert into public.time_settings (company_id, breaks_enabled, breaks_paid) values ($1, true, false)`, [A.cid]);
  r = await as(wA.u, `select public.time_break_start() x`);
  check('13 with breaks on a worker starts one; it is unpaid because the owner said so', r.ok && r.v.days[0].breaks.length === 1 && r.v.days[0].breaks[0].paid === false, r.msg);
  r = await as(wA.u, `select public.time_start_visit('assignment', $1::uuid) x`, [j1]);
  check('14 a job cannot be started during a break', !r.ok && /End your break/.test(r.msg), r.msg);
  const wdA = (await one(`select id from public.time_workdays where person_id = $1`, [wA.pid])).id;
  r = await as(A.u, `select public.time_staff_edit_workday($1::uuid, null, now(), 'Sent home') x`, [wdA]);
  check('15 the owner cannot clock a worker out by hand while the break is running (and is told why)', !r.ok && /break is still running/i.test(r.msg), r.msg);
  r = await as(wA.u, `select public.time_break_end() x`);
  check('16 ending the break closes it (and the day stays open: jobs are still waiting)', r.ok && r.v.days[0].breaks[0].ended_at !== null && r.v.days[0].clock_out_at === null, r.msg);
  r = await as(wA.u, `select public.time_start_visit('assignment', $1::uuid) x`, [j2]);
  check('17 the second job is locked until the first is done', !r.ok && /Finish Job One first/.test(r.msg), r.msg);
  await db.query(`update public.time_settings set require_start_photo = true, require_complete_photo = true where company_id = $1`, [A.cid]);
  r = await as(wA.u, `select public.time_start_visit('assignment', $1::uuid) x`, [j1]);
  check('18 the start photo is required when the owner says so', !r.ok && /start photo/.test(r.msg), r.msg);
  const photo = (proj, by, url, key, phase, extra = '') => db.query(`insert into public.project_photos (company_id, project_id, uploaded_by, file_url, file_key, time_phase${extra ? ', ' + extra.split('=')[0] : ''})
    values ($1, $2, $3, $4, $5, $6${extra ? ', ' + extra.split('=')[1] : ''})`, [A.cid, proj, by, url, key, phase]);
  await photo(pJ1, wA.pid, 'https://x/empty.jpg', '', 'start');
  r = await as(wA.u, `select public.time_start_visit('assignment', $1::uuid) x`, [j1]);
  check('19 a photo row with no stored file does not count as the start photo', !r.ok && /start photo/.test(r.msg), r.msg);
  await photo(pJ1, wA.pid, 'https://x/old.jpg', 'p/old.jpg', 'start', `created_at=now() - interval '2 days'`);
  r = await as(wA.u, `select public.time_start_visit('assignment', $1::uuid) x`, [j1]);
  check('20 a start photo from before this workday does not count', !r.ok && /start photo/.test(r.msg), r.msg);
  await photo(pJ1, tw1.pid, 'https://x/other.jpg', 'p/other.jpg', 'start');
  r = await as(wA.u, `select public.time_start_visit('assignment', $1::uuid) x`, [j1]);
  check('21 a photo another employee took does not count for this one', !r.ok && /start photo/.test(r.msg), r.msg);
  await photo(pJ1, wA.pid, 'https://x/new.jpg', 'p/new.jpg', 'start', `taken_at=now() - interval '5 days'`);
  r = await as(wA.u, `select public.time_start_visit('assignment', $1::uuid, null, null, null, 'ok', '{"lat":41.5,"lng":-81.7}'::jsonb) x`, [j1]);
  check('22 a photo saved by the server after clock-in counts (the phone\'s own "taken at" is not trusted); the job starts', r.ok, r.msg);
  check('23 starting writes the job\'s check-in, an active work session and the assignment status', await n(`select count(*)::int n from public.check_ins where assignment_id = $1`, [j1]) === 1
    && (await one(`select status from public.work_sessions where assignment_id = $1`, [j1])).status === 'active'
    && (await one(`select status from public.assignments where id = $1`, [j1])).status === 'checked_in');
  r = await as(A.u, `select public.time_staff_edit_workday($1::uuid, null, now(), 'Sent home') x`, [wdA]);
  check('24 ...nor while a job timer is running (and is told why)', !r.ok && /job visit is still running/i.test(r.msg), r.msg);
  const vJ1 = (await one(`select id from public.time_visits where project_id = $1`, [pJ1])).id;
  r = await as(wA.u, `select public.time_complete_visit($1::uuid) x`, [vJ1]);
  check('25 the completion photo is required when the owner says so', !r.ok && /completion photo/.test(r.msg), r.msg);
  await photo(pJ1, wA.pid, 'https://x/done.jpg', 'p/done.jpg', 'complete');
  r = await as(wA.u, `select public.time_complete_visit($1::uuid) x`, [vJ1]);
  check('26 completing closes the work session with a duration and marks the assignment done', r.ok
    && (await one(`select status, duration_minutes from public.work_sessions where assignment_id = $1`, [j1])).status === 'completed'
    && (await one(`select status from public.assignments where id = $1`, [j1])).status === 'completed', r.msg);
  await db.query(`update public.time_settings set require_start_photo = false, require_complete_photo = false where company_id = $1`, [A.cid]);
  check('27 the job time keeps the rate in force (25)', Number((await one(`select r.hourly_rate from public.time_interval_rates r join public.time_intervals i on i.id = r.interval_id where i.person_id = $1`, [wA.pid])).hourly_rate) === 25);
  await db.query(`update public.worker_hourly_rates set hourly_rate = 40 where person_id = $1`, [wA.pid]);
  check('28 changing the rate later does not rewrite the rate saved on past work', Number((await one(`select r.hourly_rate from public.time_workday_rates r join public.time_workdays w on w.id = r.workday_id where w.person_id = $1`, [wA.pid])).hourly_rate) === 25
    && Number((await one(`select r.hourly_rate from public.time_interval_rates r join public.time_intervals i on i.id = r.interval_id where i.person_id = $1`, [wA.pid])).hourly_rate) === 25);
  r = await as(wA.u, `select public.time_clock_out() x`);
  check('29 with nothing running the worker clocks out (the unstarted second job stays as it is)', r.ok && r.v.days[0].status === 'closed'
    && (await one(`select status from public.assignments where id = $1`, [j2])).status === 'scheduled', r.msg);
  r = await as(wA.u, `select public.time_start_visit('assignment', $1::uuid) x`, [j2]);
  check('30 nothing can be started after clock-out', !r.ok && /Clock in/.test(r.msg), r.msg);

  // ═══ 3. owner corrections, approval, billing, void, pay rates ═══
  const wC = await member(A.cid, 'wc@example.com', 'worker', 'Cal');
  const wD = await member(A.cid, 'wd@example.com', 'worker', 'Dee');
  const pC = await mkProj(A.cid, 'Job C');
  await db.query(`insert into public.worker_hourly_rates (company_id, person_id, hourly_rate, effective_date) values ($1, $2, 20, '2020-01-01')`, [A.cid, wC.pid]);
  r = await as(A.u, `select public.time_staff_add_workday($1::uuid, current_date, $2::timestamptz, $3::timestamptz, 'Forgot to clock in') x`, [wC.pid, iso(600), iso(120)]);
  check('31 the owner adds a missing workday with a reason', r.ok, r.msg);
  const wid = r.v;
  r = await as(A.u, `select public.time_staff_add_workday($1::uuid, current_date, $2::timestamptz, $3::timestamptz, '') x`, [wD.pid, iso(300), iso(200)]);
  check('32 a correction without a reason is refused', !r.ok && /reason/.test(r.msg), r.msg);
  r = await as(wC.u, `select public.time_staff_add_workday($1::uuid, current_date, $2::timestamptz, null, 'x y z') x`, [wC.pid, iso(60)]);
  check('33 a worker cannot make corrections', !r.ok && /Only the owner/.test(r.msg), r.msg);
  let a = await all(`select action, reason, actor_id from public.time_audit where workday_id = $1`, [wid]);
  check('34 the history records what, who and why', a.length === 1 && a[0].action === 'added' && a[0].reason === 'Forgot to clock in' && a[0].actor_id === A.pid, JSON.stringify(a));
  check('35 the rate in force is saved with the added day', Number((await one(`select hourly_rate from public.time_workday_rates where workday_id = $1`, [wid])).hourly_rate) === 20);
  const vid = (await one(`insert into public.time_visits (company_id, source, project_id, visit_date, label, target_minutes) values ($1, 'project_day', $2, current_date, 'Job C', 60) returning id`, [A.cid, pC])).id;
  r = await as(A.u, `select public.time_staff_add_interval($1::uuid, $2::uuid, $3::timestamptz, $4::timestamptz, 'Added from the foreman') x`, [vid, wC.pid, iso(500), iso(380)]);
  check('36 the owner adds an employee\'s time at a job by hand', r.ok, r.msg);
  const iid = r.v;
  check('37 the job visit\'s status follows that time, and the rate is saved with it', (await one(`select status from public.time_visits where id = $1`, [vid])).status === 'completed'
    && Number((await one(`select hourly_rate from public.time_interval_rates where interval_id = $1`, [iid])).hourly_rate) === 20);
  r = await as(A.u, `select public.time_staff_add_interval($1::uuid, $2::uuid, $3::timestamptz, $4::timestamptz, 'overlap') x`, [vid, wC.pid, iso(450), iso(400)]);
  check('38 overlapping job time for the same employee is refused', !r.ok && /overlaps/.test(r.msg), r.msg);
  r = await as(A.u, `select public.time_staff_add_interval($1::uuid, $2::uuid, $3::timestamptz, $4::timestamptz, 'outside') x`, [vid, wC.pid, iso(700), iso(650)]);
  check('39 job time outside the workday is refused', !r.ok, r.msg);
  const origIn = (await one(`select clock_in_at from public.time_workdays where id = $1`, [wid])).clock_in_at;
  r = await as(A.u, `select public.time_staff_edit_workday($1::uuid, $2::timestamptz, null, 'Arrived earlier') x`, [wid, iso(610)]);
  a = await all(`select old_value, reason, was_approved from public.time_audit where workday_id = $1 and field = 'clock_in_at' and action = 'corrected'`, [wid]);
  check('40 the owner corrects the clock-in; the original value, reason and approval state are kept', r.ok && a.length === 1
    && new Date(a[0].old_value).getTime() === new Date(origIn).getTime() && a[0].reason === 'Arrived earlier' && a[0].was_approved === false, r.msg + JSON.stringify(a));
  r = await as(A.u, `select public.time_staff_edit_workday($1::uuid, $2::timestamptz, null, 'later than the first visit') x`, [wid, iso(450)]);
  check('41 moving the clock-in past recorded job time is refused', !r.ok && /outside/.test(r.msg), r.msg);
  r = await as(A.u, `select public.time_staff_edit_workday($1::uuid, null, $2::timestamptz, 'future') x`, [wid, new Date(Date.now() + 3600000).toISOString()]);
  check('42 a time in the future is refused', !r.ok && /future/.test(r.msg), r.msg);
  r = await as(A.u, `select public.time_approve_workday($1::uuid) x`, [wid]);
  const r2 = await as(A.u, `select public.time_approve_workday($1::uuid) x`, [wid]);
  check('43 the owner approves a clean day; approving twice changes nothing (version stays 1)', r.ok && r2.ok
    && (await one(`select status, approval_version v from public.time_workdays where id = $1`, [wid])).v === 1, r.msg);
  r = await as(A.u, `select public.time_staff_edit_interval($1::uuid, null, $2::timestamptz, 'Left 10 min early') x`, [iid, iso(390)]);
  a = await all(`select was_approved, old_value, new_value from public.time_audit where visit_id = $1 and field = 'ended_at'`, [vid]);
  check('44 correcting an APPROVED day reopens it; the history says it was approved, with old and new time', r.ok
    && (await one(`select status from public.time_workdays where id = $1`, [wid])).status === 'reopened' && a.length === 1 && a[0].was_approved === true
    && JSON.stringify(a[0].old_value) !== JSON.stringify(a[0].new_value), r.msg + JSON.stringify(a));
  r = await as(A.u, `select public.time_approve_workday($1::uuid) x`, [wid]);
  check('45 it can be approved again (version 2)', r.ok && (await one(`select approval_version v from public.time_workdays where id = $1`, [wid])).v === 2, r.msg);
  r = await as(A.u, `select public.time_reopen_workday($1::uuid, 'Payroll question') x`, [wid]);
  check('46 the owner reopens an approved day with a reason', r.ok && (await one(`select status from public.time_workdays where id = $1`, [wid])).status === 'reopened', r.msg);
  const open = (await one(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at) values ($1, $2, current_date, now() - interval '10 hours') returning id`, [A.cid, wD.pid])).id;
  r = await as(A.u, `select public.time_approve_workday($1::uuid) x`, [open]);
  check('47 a day with no clock-out cannot be approved', !r.ok && /no clock-out/.test(r.msg), r.msg);
  r = await as(A.u, `select public.time_staff_edit_workday($1::uuid, null, $2::timestamptz, 'Forgot to clock out') x`, [open, iso(300)]);
  a = await all(`select action from public.time_audit where workday_id = $1 and field = 'clock_out_at'`, [open]);
  check('48 the owner sets a missing clock-out: the day closes and the history says the owner set it', r.ok
    && (await one(`select status from public.time_workdays where id = $1`, [open])).status === 'closed' && a.length === 1 && a[0].action === 'clock_out_set', r.msg + JSON.stringify(a));
  r = await as(A.u, `select public.time_set_visit_billable($1::uuid, false, 'Callback - our mistake') x`, [vid]);
  check('49 a job visit can be marked non-billable (its times follow) with history; the times themselves are untouched', r.ok
    && (await one(`select billable, status from public.time_intervals where id = $1`, [iid])).billable === false
    && (await one(`select status from public.time_intervals where id = $1`, [iid])).status === 'completed'
    && await n(`select count(*)::int n from public.time_audit where visit_id = $1 and action = 'billable_changed'`, [vid]) === 1, r.msg);
  r = await as(A.u, `select public.time_staff_void_interval($1::uuid, 'Entered by mistake') x`, [iid]);
  check('50 job time can be voided; it stays in the records as void', r.ok && (await one(`select status from public.time_intervals where id = $1`, [iid])).status === 'void', r.msg);
  r = await as(A.u, `select public.time_set_hourly_rate($1::uuid, 30, current_date, 'Raise') x`, [wC.pid]);
  check('51 the owner sets a new hourly rate; the old rate row is ended, not edited', r.ok
    && await n(`select count(*)::int n from public.worker_hourly_rates where person_id = $1`, [wC.pid]) === 2
    && (await one(`select end_date from public.worker_hourly_rates where person_id = $1 and hourly_rate = 20`, [wC.pid])).end_date !== null, r.msg);
  check('52 the rates saved on past workdays and job times did not change', Number((await one(`select hourly_rate from public.time_workday_rates where workday_id = $1`, [wid])).hourly_rate) === 20
    && Number((await one(`select hourly_rate from public.time_interval_rates where interval_id = $1`, [iid])).hourly_rate) === 20);
  check('53 a new rate cannot start before the current one; a worker cannot change pay rates', !(await as(A.u, `select public.time_set_hourly_rate($1::uuid, 35, '2019-01-01', 'back-dated') x`, [wC.pid])).ok
    && !(await as(wC.u, `select public.time_set_hourly_rate($1::uuid, 99, current_date, 'me') x`, [wC.pid])).ok);

  // ═══ 4. alerts (064 30-40, review 75b-d) ═══
  await db.query(`delete from public.time_alerts`);
  await db.query(`delete from public.app_notifications`);
  const pT = await mkProj(A.cid, 'Job T');
  const vT = (await one(`insert into public.time_visits (company_id, source, project_id, visit_date, label, status, started_at, target_minutes) values ($1, 'project_day', $2, current_date, 'Job T', 'in_progress', now() - interval '3 hours', 60) returning id`, [A.cid, pT])).id;
  r = await as(A.u, `select public.time_scan_alerts() x`);
  check('54 over-target alerts are off by default (nothing is raised)', r.ok && await n(`select count(*)::int n from public.time_alerts where kind = 'over_target'`) === 0, r.msg);
  await db.query(`update public.time_settings set target_alerts_enabled = true, target_notify_crew = true, overtime_alerts_enabled = true where company_id = $1`, [A.cid]);
  r = await as(A.u, `select public.time_scan_alerts() x`);
  check('55 with the switch on, a job past its target raises one alert and tells the owner', r.ok && await n(`select count(*)::int n from public.time_alerts where kind = 'over_target' and visit_id = $1`, [vT]) === 1
    && await n(`select count(*)::int n from public.app_notifications where recipient_id = $1 and event_type = 'time_over_target'`, [A.pid]) === 1, r.msg);
  await as(A.u, `select public.time_scan_alerts() x`);
  check('56 scanning again repeats neither the alert nor the notice', await n(`select count(*)::int n from public.time_alerts where kind = 'over_target'`) === 1
    && await n(`select count(*)::int n from public.app_notifications where event_type = 'time_over_target' and recipient_id = $1`, [A.pid]) === 1);
  check('57 the settings changes are in the time history', await n(`select count(*)::int n from public.time_audit where entity = 'settings'`) >= 2);
  // a crew member on a job that goes over target gets a neutral prompt
  const wI = await member(A.cid, 'wi@example.com', 'worker', 'Ivy');
  const pT2 = await mkProj(A.cid, 'Job T2');
  const vT2 = (await one(`insert into public.time_visits (company_id, source, project_id, visit_date, label, status, started_at, target_minutes) values ($1, 'project_day', $2, current_date, 'Job T2', 'in_progress', now() - interval '3 hours', 60) returning id`, [A.cid, pT2])).id;
  const wdI = (await one(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at) values ($1, $2, current_date, now() - interval '10 minutes') returning id`, [A.cid, wI.pid])).id;
  await db.query(`insert into public.time_intervals (company_id, visit_id, workday_id, person_id, started_at) values ($1, $2, $3, $4, now() - interval '5 minutes')`, [A.cid, vT2, wdI, wI.pid]);
  await as(A.u, `select public.time_scan_alerts() x`);
  const crew = await all(`select body from public.app_notifications where recipient_id = $1 and event_type = 'time_progress_check'`, [wI.pid]);
  check('58 the crew gets a neutral progress check (no target, minutes or average in it)', crew.length === 1 && !/\d+\s*(min|hour)|target|average/i.test(crew[0].body), JSON.stringify(crew));
  // overtime
  const wH = await member(A.cid, 'wh@example.com', 'worker', 'Hal');
  await db.query(`insert into public.time_person_settings (person_id, company_id, daily_alert_hours) values ($1, $2, 8)`, [wH.pid, A.cid]);
  await db.query(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, clock_out_at, status) values ($1, $2, current_date, now() - interval '8 hours 30 minutes', now() - interval '10 minutes', 'closed')`, [A.cid, wH.pid]);
  await as(A.u, `select public.time_scan_alerts() x`);
  check('59 reaching the employee\'s daily alert hours raises an alert', await n(`select count(*)::int n from public.time_alerts where kind = 'overtime_reached' and person_id = $1`, [wH.pid]) === 1);
  r = await day(wH.u);
  check('60 a worker\'s own day contains no rates, targets, alerts or costs', r.ok && !/rate|target|alert|cost|average/i.test(JSON.stringify(r.v)), JSON.stringify(r.v).slice(0, 300));
  check('61 the per-employee alert hours live in their own table (no Payroll Estimate overtime row is made), and the owner reads them',
    await n(`select count(*)::int n from public.worker_pay_settings where person_id = $1`, [wH.pid]) === 0
    && (await as(A.u, `select count(*)::int n from public.time_person_settings where person_id = $1`, [wH.pid])).v === 1);
  // a workday left open too long
  const wG = await member(A.cid, 'wg@example.com', 'worker', 'Gus');
  const stale = (await one(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at) values ($1, $2, current_date - 1, now() - interval '16 hours') returning id`, [A.cid, wG.pid])).id;
  await day(wH.u);
  await day(wH.u);
  check('62 a workday still open past the owner\'s limit raises one "still clocked in" alert (scanning again does not repeat it)',
    await n(`select count(*)::int n from public.time_alerts where kind = 'open_workday' and workday_id = $1`, [stale]) === 1);
  r = await as(A.u, `select public.time_staff_edit_workday($1::uuid, null, $2::timestamptz, 'Forgot to clock out') x`, [stale, iso(16 * 60 - 480)]);
  await as(A.u, `select public.time_scan_alerts() x`);
  check('63 once the owner sets the clock-out, that alert closes by itself', r.ok && (await one(`select status from public.time_alerts where kind = 'open_workday' and workday_id = $1`, [stale])).status === 'resolved', r.msg);
  const wF = await member(A.cid, 'wf@example.com', 'worker', 'Fay');
  const flagged = (await one(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at) values ($1, $2, current_date - 1, now() - interval '30 hours') returning id`, [A.cid, wF.pid])).id;
  r = await day(wF.u);
  check('64 a worker who forgot to clock out yesterday: the old day is flagged "needs review" at zero hours (not closed at "now")',
    r.ok && r.v.days.length === 1 && r.v.days[0].status === 'needs_review' && r.v.days[0].clock_out_at === r.v.days[0].clock_in_at
    && await n(`select count(*)::int n from public.app_notifications where recipient_id = $1 and event_type = 'time_unusual' and linked_entity_id = $2`, [A.pid, flagged]) === 1, JSON.stringify(r.v?.days));
  // skip request alert
  const wJ = await member(A.cid, 'wj@example.com', 'worker', 'Jo');
  const pJ = await mkProj(A.cid, 'Job J');
  const jJ = await mkAsg(A.cid, pJ, wJ.pid);
  const sk = await as(wJ.u, `select public.time_request_skip('assignment', $1::uuid, 'Gate locked') x`, [jJ]);
  check('65 a skip request raises one owner alert', sk.ok && await n(`select count(*)::int n from public.time_alerts where kind = 'skip_request' and status = 'open' and person_id = $1`, [wJ.pid]) === 1, sk.msg);
  r = await as(wJ.u, `select public.time_decide_skip($1::uuid, true) x`, [sk.v.request_id]);
  check('66 a worker cannot approve their own skip', !r.ok, r.msg);
  r = await as(A.u, `select public.time_decide_skip($1::uuid, false, 'Try again later') x`, [sk.v.request_id]);
  check('67 the owner denies it: its alert is resolved, the job is not cancelled, and the decision is in the history', r.ok
    && await n(`select count(*)::int n from public.time_alerts where kind = 'skip_request' and status = 'open' and person_id = $1`, [wJ.pid]) === 0
    && (await one(`select status from public.assignments where id = $1`, [jJ])).status === 'scheduled'
    && await n(`select count(*)::int n from public.time_audit where action = 'skip_denied'`) === 1, r.msg);

  // ═══ 5. the owner clocks a worker in and out by hand (owner_clock_in_out) ═══
  const wE = await member(A.cid, 'we@example.com', 'worker', 'Eve');
  const wE2 = await member(A.cid, 'we2@example.com', 'worker', 'Ezra');
  const wds = async (pid) => (await db.query(`select * from public.time_workdays where person_id = $1 order by clock_in_at`, [pid])).rows;
  const ownerIn = (u, pid, reason) => as(u, `select public.time_staff_add_workday($1::uuid, current_date, now(), null, $2) x`, [pid, reason]);
  const ownerOut = (u, w, reason) => as(u, `select public.time_staff_edit_workday($1::uuid, null, now(), $2) x`, [w, reason]);
  r = await ownerIn(A.u, wE.pid, 'Forgot to clock in');
  let rows = await wds(wE.pid);
  check('68 the owner starts an open workday for a worker, with a rate row and a history row with the reason', r.ok && rows.length === 1 && !rows[0].clock_out_at && rows[0].status === 'active'
    && await n(`select count(*)::int n from public.time_workday_rates where workday_id = $1`, [rows[0].id]) === 1
    && await n(`select count(*)::int n from public.time_audit where workday_id = $1 and action = 'added' and reason = 'Forgot to clock in'`, [rows[0].id]) === 1, r.msg);
  r = await day(wE.u);
  check('69 the worker\'s own phone sees an ACTIVE day', r.ok && r.v.days.length === 1 && r.v.days[0].status === 'active' && !r.v.days[0].clock_out_at, JSON.stringify(r.v?.days));
  r = await ownerIn(A.u, wE.pid, 'Again by mistake');
  check('70 clocking in someone already clocked in is refused, and nothing extra is made', !r.ok && /overlaps another workday|uq_time_workday_open|duplicate key/i.test(r.msg) && (await wds(wE.pid)).length === 1, r.msg);
  r = await ownerIn(wE2.u, wE.pid, 'A coworker tries');
  const r3 = await ownerOut(wE2.u, rows[0].id, 'A coworker tries');
  check('71 a worker cannot clock another worker in or out', !r.ok && /owner/i.test(r.msg) && !r3.ok, r.msg);
  r = await ownerIn(A.u, wE2.pid, 'x');
  check('72 a reason of at least 3 letters is required', !r.ok && /reason/i.test(r.msg), r.msg);
  r = await ownerOut(A.u, rows[0].id, 'Sent home');
  rows = await wds(wE.pid);
  check('73 the owner closes the running day at the real time; the close is in the history with the reason', r.ok && !!rows[0].clock_out_at && rows[0].status === 'closed'
    && await n(`select count(*)::int n from public.time_audit where workday_id = $1 and action = 'clock_out_set' and reason = 'Sent home'`, [rows[0].id]) === 1, r.msg);
  r = await day(wE.u);
  check('74 the worker\'s phone sees the day CLOSED', r.ok && r.v.days.length === 1 && !!r.v.days[0].clock_out_at && r.v.days[0].status === 'closed', JSON.stringify(r.v?.days));
  r = await ownerIn(A.u, wE.pid, 'Came back');
  rows = await wds(wE.pid);
  check('75 the owner can start a NEW session the same day; the closed one is left alone', r.ok && rows.length === 2 && !!rows[0].clock_out_at && !rows[1].clock_out_at, r.msg);
  await ownerOut(A.u, rows[1].id, 'Done');
  r = await as(A.u, `select public.time_staff_add_workday($1::uuid, current_date, now() - interval '30 minutes', null, 'Overlap test') x`, [wE.pid]);
  check('76 a day that would overlap an earlier one is refused', !r.ok && /overlaps another workday/i.test(r.msg), r.msg);

  // ═══ 6. a day built by hand for company A, used below (review fixtures) ═══
  const wK = await member(A.cid, 'wk@example.com', 'worker', 'Kim');
  const wK2 = await member(A.cid, 'wk2@example.com', 'worker', 'Kip');
  const pX = await mkProj(A.cid, 'Job X');
  const jX = await mkAsg(A.cid, pX, wK2.pid);
  r = await as(A.u, `select public.time_staff_add_workday($1::uuid, current_date, $2::timestamptz, $3::timestamptz, 'Forgot to clock in') x`, [wK.pid, iso(900), iso(600)]);
  const wdK = r.v;
  const visitX = (await one(`insert into public.time_visits (company_id, source, project_id, visit_date, label) values ($1, 'project_day', $2, current_date, 'Job X') returning id`, [A.cid, pX])).id;
  const intK = (await as(A.u, `select public.time_staff_add_interval($1::uuid, $2::uuid, $3::timestamptz, $4::timestamptz, 'by hand') x`, [visitX, wK.pid, iso(880), iso(800)])).v;
  r = await as(A.u, `select public.time_staff_add_break($1::uuid, $2::timestamptz, $3::timestamptz, false, 'lunch') x`, [wdK, iso(790), iso(760)]);
  const brkK = r.v;
  check('77 the owner builds a day by hand (workday, job time, break)', !!wdK && !!intK && !!brkK, r.msg);
  const skipA = (await as(wK2.u, `select public.time_request_skip('assignment', $1::uuid, 'Gate locked') x`, [jX])).v.request_id;
  const alertA = (await one(`select id from public.time_alerts where skip_request_id = $1`, [skipA])).id;
  // company B records real time too
  const pB = await mkProj(B, 'B Job');
  const jB = await mkAsg(B, pB, wB.pid);
  await as(wB.u, `select public.time_clock_in(current_date) x`);
  r = await as(wB.u, `select public.time_start_visit('assignment', $1::uuid) x`, [jB]);
  check('78 a worker of company B clocks in and starts a B job', r.ok, r.msg);
  const pA1 = await mkProj(A.cid, 'Estimated Job');
  await db.query(`insert into public.time_settings (company_id, breaks_enabled) values ($1, false)`, [B]);
  await db.query(`insert into public.time_person_settings (person_id, company_id, daily_alert_hours) values ($1, $2, 9)`, [wB.pid, B]);
  await db.query(`insert into public.time_property_targets (company_id, project_id, target_minutes) values ($1, $2, 45), ($3, $4, 30)`, [A.cid, pA1, B, pB]);
  await db.query(`insert into public.time_project_estimates (project_id, company_id, labor_hours) values ($1, $2, 10), ($3, $4, 12)`, [pA1, A.cid, pB, B]);

  // ═══ 7. companies are kept apart; roles (time_tracking_review) ═══
  const TABLES = ['time_settings', 'time_person_settings', 'time_property_targets', 'time_workdays', 'time_workday_rates', 'time_breaks', 'time_visits', 'time_intervals',
    'time_interval_rates', 'time_skip_requests', 'time_audit', 'time_alerts', 'time_project_estimates', 'time_clock_locations'];
  const seen = async (u, cid) => {
    const out = {};
    for (const tb of TABLES) {
      const x = await as(u, `select count(*) filter (where company_id <> $1)::int as other, count(*)::int as total from public.${tb}`, [cid]);
      out[tb] = x.ok ? x.rows[0] : { other: 0, total: 0, refused: true };
    }
    return out;
  };
  let s = await seen(ownerB.u, B);
  check('79 owner B reads only company B rows in every time table (none of A\'s)', TABLES.every((tb) => s[tb].other === 0) && s.time_workdays.total === 1, JSON.stringify(s));
  s = await seen(A.u, A.cid);
  check('80 owner A reads only company A rows (none of B\'s), and does see A\'s', TABLES.every((tb) => s[tb].other === 0) && s.time_workdays.total >= 5
    && s.time_intervals.total > 0 && s.time_interval_rates.total > 0, JSON.stringify(s));
  s = await seen(admin.u, A.cid);
  check('81 an admin sees company A\'s rows like the owner does', TABLES.every((tb) => s[tb].other === 0) && s.time_workdays.total >= 5, JSON.stringify(s));
  const nothing = async (u, cid) => { const x = await seen(u, cid); return TABLES.every((tb) => x[tb].total === 0) ? '' : JSON.stringify(x); };
  let why = await nothing(wB.u, B) + await nothing(wA.u, A.cid);
  check('82 workers (of either company) read nothing from any time table: no pay rates, targets or other people\'s hours (only their own day through the functions)', why === '', why);
  why = await nothing(cust.u, A.cid) + await nothing(null, A.cid);
  check('83 a customer and a signed-out visitor read nothing from any time table', why === '', why);

  const snap = async () => JSON.stringify(await one(`select (select count(*) from public.time_audit)::int a, (select md5(string_agg(w::text, '|' order by w.id)) from public.time_workdays w) w,
    (select md5(string_agg(i::text, '|' order by i.id)) from public.time_intervals i) i, (select md5(string_agg(b::text, '|' order by b.id)) from public.time_breaks b) b,
    (select md5(string_agg(x::text, '|' order by x.id)) from public.time_skip_requests x) s, (select md5(string_agg(v::text, '|' order by v.id)) from public.time_visits v) v,
    (select md5(string_agg(h::text, '|' order by h.id)) from public.worker_hourly_rates h) h, (select md5(string_agg(al::text, '|' order by al.id)) from public.time_alerts al) al`));
  const before = await snap();
  const attacks = [
    ['edit a workday', `select public.time_staff_edit_workday($1::uuid, $2::timestamptz, null, 'sneaky edit')`, [wdK, iso(950)]],
    ['add a workday', `select public.time_staff_add_workday($1::uuid, current_date, $2::timestamptz, $3::timestamptz, 'sneaky add')`, [wA.pid, iso(300), iso(200)]],
    ['edit a break', `select public.time_staff_edit_break($1::uuid, $2::timestamptz, null, 'sneaky edit')`, [brkK, iso(795)]],
    ['add a break', `select public.time_staff_add_break($1::uuid, $2::timestamptz, $3::timestamptz, true, 'sneaky add')`, [wdK, iso(700), iso(690)]],
    ['edit job time', `select public.time_staff_edit_interval($1::uuid, $2::timestamptz, null, 'sneaky edit')`, [intK, iso(870)]],
    ['add job time', `select public.time_staff_add_interval($1::uuid, $2::uuid, $3::timestamptz, $4::timestamptz, 'sneaky add')`, [visitX, wK.pid, iso(780), iso(770)]],
    ['void job time', `select public.time_staff_void_interval($1::uuid, 'sneaky void')`, [intK]],
    ['change billing', `select public.time_set_visit_billable($1::uuid, false, 'sneaky billing')`, [visitX]],
    ['approve', `select public.time_approve_workday($1::uuid)`, [wdK]],
    ['reopen', `select public.time_reopen_workday($1::uuid, 'sneaky reopen')`, [wdK]],
    ['set a pay rate', `select public.time_set_hourly_rate($1::uuid, 99, current_date, 'sneaky rate')`, [wK.pid]],
    ['decide a skip', `select public.time_decide_skip($1::uuid, true, 'sneaky')`, [skipA]],
    ['resolve an alert', `select public.time_alert_resolve($1::uuid)`, [alertA]],
  ];
  const slipped = [];
  for (const [label, sql, p] of attacks) if ((await as(ownerB.u, sql, p)).ok) slipped.push(label);
  check(`84 owner B cannot use any owner function on company A's records (${attacks.length} tried)`, slipped.length === 0, slipped.join('; '));
  check('85 ...and nothing in company A changed (history, workdays, job times, breaks, skips, rates, alerts identical)', (await snap()) === before);
  r = await as(ownerB.u, `select public.time_scan_alerts() x`);
  check('86 owner B scanning alerts only touches company B (company A\'s open alerts are untouched)', r.ok
    && await n(`select count(*)::int n from public.time_alerts where company_id = $1 and status = 'open'`, [A.cid]) >= 1, r.msg);
  const vB = (await one(`select id from public.time_visits where project_id = $1`, [pB])).id;
  const x1 = await as(wB.u, `select public.time_start_visit('assignment', $1::uuid) x`, [jX]);
  const x2 = await as(wB.u, `select public.time_complete_visit($1::uuid) x`, [visitX]);
  const x3 = await as(wB.u, `select public.time_request_skip('assignment', $1::uuid, 'nope') x`, [jX]);
  check('87 worker B cannot start, complete or ask to skip company A\'s jobs or visits', !x1.ok && !x2.ok && !x3.ok, [x1.msg, x2.msg, x3.msg].join(' | '));
  r = await as(wE2.u, `select public.time_complete_visit($1::uuid) x`, [vB]);
  const r4 = await as(wK2.u, `select public.time_complete_visit($1::uuid) x`, [visitX]);
  check('88 a worker cannot complete someone else\'s job visit by passing its id (in another company, or in their own)', !r.ok && !r4.ok && /haven't started/.test(r4.msg), r.msg + ' | ' + r4.msg);
  await as(wE2.u, `select public.time_withdraw_skip($1::uuid)`, [skipA]);
  await as(wB.u, `select public.time_withdraw_skip($1::uuid)`, [skipA]);
  check('89 a worker cannot withdraw another person\'s skip request', (await one(`select status from public.time_skip_requests where id = $1`, [skipA])).status === 'pending');
  r = await as(wE2.u, `select public.time_my_skip_requests() x`);
  const r5 = await as(wK2.u, `select public.time_my_skip_requests() x`);
  check('90 a worker\'s skip list has only their own requests', r.ok && r.v.length === 0 && r5.ok && r5.v.length === 1 && r5.v[0].id === skipA, JSON.stringify([r.v, r5.v]));
  r = await day(wE.u);
  check('91 a worker\'s day lists only their own workdays (no person ids or rates inside)', r.ok && r.v.days.length === 2 && !/person|rate/i.test(JSON.stringify(r.v.days)), JSON.stringify(r.v).slice(0, 300));
  const staffCalls = [
    `select public.time_scan_alerts()`, `select public.time_alert_resolve('${alertA}'::uuid)`, `select public.time_approve_workday('${wdK}'::uuid)`,
    `select public.time_reopen_workday('${wdK}'::uuid, 'because')`, `select public.time_decide_skip('${skipA}'::uuid, true, null)`,
    `select public.time_set_hourly_rate('${wK.pid}'::uuid, 50, current_date, 'x')`, `select public.time_staff_void_interval('${intK}'::uuid, 'because')`,
    `select public.time_staff_edit_workday('${wdK}'::uuid, now() - interval '20 hours', null, 'because')`, `select public.time_set_visit_billable('${visitX}'::uuid, false, 'because')`,
    `select public.time_staff_edit_break('${brkK}'::uuid, now() - interval '20 hours', null, 'because')`, `select public.time_staff_edit_interval('${intK}'::uuid, now() - interval '20 hours', null, 'because')`,
    `select public.time_staff_add_workday('${wK.pid}'::uuid, current_date, now() - interval '1 hour', null, 'because')`, `select public.time_review_list()`,
    `select public.time_settle_no_hours('${wdK}'::uuid, 'because')`, `select public.time_accept_all_suggested_ends()`,
  ];
  for (const [num, who, u] of [['92', 'a worker', wK2.u], ['92b', 'a customer', cust.u]]) {
    const through = [];
    for (const sql of staffCalls) if ((await as(u, sql)).ok) through.push(sql.slice(14, 50));
    check(`${num} ${who} is refused by every owner function (${staffCalls.length} tried)`, through.length === 0, through.join('; '));
  }
  check('93 an admin can use the owner functions (scan alerts, resolve an alert)', (await as(admin.u, `select public.time_scan_alerts()`)).ok
    && (await as(admin.u, `select public.time_alert_resolve($1::uuid)`, [alertA])).ok);
  r = await day(cust.u);
  check('94 a customer cannot open a workday', !r.ok && !(await as(cust.u, `select public.time_clock_in(current_date) x`)).ok, r.msg);
  const anonFns = [`select public.time_my_day(current_date)`, `select public.time_clock_in(current_date, null, null)`, `select public.time_scan_alerts()`, `select public.time_approve_workday('${wdK}'::uuid)`,
    `select public.time_staff_add_workday('${wA.pid}'::uuid, current_date, now(), null, 'x y z')`, `select public.time_decide_skip('${skipA}'::uuid, true, null)`, `select public.time_start_visit('assignment', '${jX}'::uuid)`];
  const anonThrough = [];
  for (const sql of anonFns) if ((await as(null, sql)).ok) anonThrough.push(sql);
  check('95 a signed-out visitor can run none of the time functions', anonThrough.length === 0, anonThrough.join('; '));

  // direct writes around the functions
  const direct = [
    `insert into public.time_workdays (company_id, person_id, work_date) values ('${A.cid}', '${wK2.pid}', current_date)`, `update public.time_workdays set status = 'approved'`, `delete from public.time_workdays`,
    `update public.time_intervals set ended_at = now()`, `delete from public.time_intervals`, `update public.time_breaks set paid = true`, `delete from public.time_breaks`,
    `update public.time_visits set billable = false`, `delete from public.time_visits`, `update public.time_workday_rates set hourly_rate = 1`, `update public.time_interval_rates set hourly_rate = 1`,
    `update public.time_skip_requests set status = 'approved'`, `delete from public.time_skip_requests`, `update public.time_audit set reason = 'edited'`, `delete from public.time_audit`,
    `insert into public.time_audit (company_id, entity, action) values ('${A.cid}', 'x', 'y')`, `update public.time_alerts set status = 'resolved'`, `delete from public.time_alerts`,
  ];
  for (const [num, who, u] of [['96', 'the owner', A.u], ['96b', 'a worker', wA.u]]) {
    const snapBefore = await snap();
    const hits = [];
    for (const sql of direct) if ((await as(u, sql)).ok) hits.push(sql.slice(0, 50));
    check(`${num} ${who}: all ${direct.length} direct writes to the time record tables are refused outright and no row changed`, hits.length === 0 && (await snap()) === snapBefore, hits.join('; '));
  }
  const f1 = await as(wA.u, `insert into public.time_settings (company_id, breaks_enabled) values ($1, true) on conflict (company_id) do update set breaks_enabled = true`, [A.cid]);
  const f2 = await as(wA.u, `insert into public.time_property_targets (company_id, project_id, target_minutes) values ($1, $2, 20)`, [A.cid, pJ2]);
  const f3 = await as(wA.u, `insert into public.time_person_settings (person_id, company_id, daily_alert_hours) values ($1, $2, 1)`, [wA.pid, A.cid]);
  const f4 = await as(wA.u, `insert into public.time_project_estimates (project_id, company_id, labor_hours) values ($1, $2, 1)`, [pJ2, A.cid]);
  check('97 a worker cannot change the owner\'s time settings, job targets, alert hours or labor estimates', !f1.ok && !f2.ok && !f3.ok && !f4.ok);
  r = await as(A.u, `insert into public.time_property_targets (company_id, project_id, target_minutes) values ($1, $2, 20)`, [A.cid, pB]);
  check('98 a job target cannot point at another company\'s job', !r.ok && /another company/.test(r.msg), r.msg);
  r = await as(A.u, `insert into public.time_person_settings (person_id, company_id, daily_alert_hours) values ($1, $2, 8)`, [wB.pid, A.cid]);
  check('99 alert hours cannot be set for another company\'s employee', !r.ok && /not on this company/.test(r.msg), r.msg);
  r = await as(A.u, `insert into public.time_project_estimates (project_id, company_id, labor_hours) values ($1, $2, 5)`, [pB, A.cid]);
  check('100 a labor estimate cannot point at another company\'s job', !r.ok, r.msg);
  raised = null; try { await db.query(`insert into public.time_workdays (company_id, person_id, work_date, truck_id) values ($1, $2, current_date - 3, $3)`, [A.cid, wK2.pid, truckOther]); } catch (e) { raised = e.message; }
  check('101 a workday cannot use another company\'s truck', !!raised && /another company/.test(raised), raised);
  raised = null; try { await db.query(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, clock_out_at) values ($1, $2, current_date - 3, now() - interval '70 hours', now() - interval '60 hours')`, [A.cid, wB.pid]); } catch (e) { raised = e.message; }
  check('102 a workday cannot be filed for someone who is not on the company\'s team', !!raised && /not on this company/.test(raised), raised);
  let u1 = null; let u2 = null;
  try { await db.query(`update public.time_audit set reason = 'edited' where company_id = $1`, [A.cid]); } catch (e) { u1 = e.message; }
  try { await db.query(`delete from public.time_audit where company_id = $1`, [A.cid]); } catch (e) { u2 = e.message; }
  check('103 nobody (not even the database admin) can edit or delete a time history row directly', /can't be changed/.test(u1 ?? '') && /can't be changed/.test(u2 ?? ''), `${u1} | ${u2}`);

  // ═══ 8. skip requests, cancelling mid-job, owner out of order (review 42-60) ═══
  const wL = await member(A.cid, 'wl@example.com', 'worker', 'Lou');
  const wM = await member(A.cid, 'wm@example.com', 'worker', 'Max');
  const pL1 = await mkProj(A.cid, 'Job L1');
  const pL2 = await mkProj(A.cid, 'Job L2');
  const l1 = await mkAsg(A.cid, pL1, wL.pid, 1);
  const l2 = await mkAsg(A.cid, pL2, wL.pid, 2);
  const m1 = await mkAsg(A.cid, pL2, wM.pid, 1);
  await as(wL.u, `select public.time_clock_in(current_date) x`);
  r = await as(wL.u, `select public.time_request_skip('assignment', $1::uuid, 'Customer away') x`, [l2]);
  check('104 a worker cannot ask to skip a later job while an earlier one is not done', !r.ok && /Finish Job L1 before/.test(r.msg), r.msg);
  await as(wL.u, `select public.time_start_visit('assignment', $1::uuid) x`, [l1]);
  r = await as(wL.u, `select public.time_request_skip('assignment', $1::uuid, 'Customer away') x`, [l1]);
  check('105 a worker cannot ask to skip the job they are working on right now', !r.ok && /working on this job right now/.test(r.msg), r.msg);
  await db.query(`update public.assignments set status = 'cancelled' where id = $1`, [l1]);
  const vL1 = (await one(`select id from public.time_visits where project_id = $1`, [pL1])).id;
  r = await as(wL.u, `select public.time_complete_visit($1::uuid) x`, [vL1]);
  check('106 if the owner cancels the job while the worker is on site, the worker can still finish it (the job stays cancelled, the day stays open)', r.ok
    && (await one(`select status from public.assignments where id = $1`, [l1])).status === 'cancelled' && r.v.days[0].clock_out_at === null, r.msg);
  const q = (await as(wL.u, `select public.time_request_skip('assignment', $1::uuid, 'Locked gate') x`, [l2])).v?.request_id;
  r = await as(wL.u, `select public.time_start_visit('assignment', $1::uuid) x`, [l2]);
  check('107 a worker who starts the work withdraws their own pending skip request', r.ok && !!q && (await one(`select status from public.time_skip_requests where id = $1`, [q])).status === 'withdrawn', r.msg);
  const qm = (await as(wM.u, `select public.time_request_skip('assignment', $1::uuid, 'Dog loose') x`, [m1])).v?.request_id;
  r = await as(A.u, `select public.time_decide_skip($1::uuid, true, 'ok') x`, [qm]);
  check('108 a skip cannot be approved while someone is timing work on that job (it would strand their timer)', !r.ok && /timing work on this job/.test(r.msg), r.msg);
  const vL2 = (await one(`select id from public.time_visits where project_id = $1`, [pL2])).id;
  await as(wL.u, `select public.time_complete_visit($1::uuid) x`, [vL2]);
  check('109 finishing the last job of the day clocks the worker out by itself (history says so)', (await one(`select status from public.time_workdays where person_id = $1`, [wL.pid])).status === 'closed'
    && await n(`select count(*)::int n from public.time_audit where person_id = $1 and action = 'auto_clock_out'`, [wL.pid]) === 1);
  r = await as(A.u, `select public.time_decide_skip($1::uuid, true, 'ok') x`, [qm]);
  check('110 once nobody is timing it, the owner approves: the job is cancelled, never completed, and no time was invented for it', r.ok && r.v.status === 'approved'
    && (await one(`select status from public.assignments where id = $1`, [m1])).status === 'cancelled'
    && await n(`select count(*)::int n from public.time_intervals where person_id = $1`, [wM.pid]) === 0, r.msg);
  const wN = await member(A.cid, 'wn@example.com', 'worker', 'Ned');
  const nJ = await mkAsg(A.cid, pL1, wN.pid);
  const qn = (await as(wN.u, `select public.time_request_skip('assignment', $1::uuid, 'Rain') x`, [nJ])).v?.request_id;
  await db.query(`update public.assignments set status = 'completed' where id = $1`, [nJ]);
  r = await as(A.u, `select public.time_decide_skip($1::uuid, true, 'ok') x`, [qn]);
  check('111 a late decision on a job that was finished meanwhile closes the request instead of failing', r.ok && r.v.status === 'withdrawn'
    && (await one(`select status from public.assignments where id = $1`, [nJ])).status === 'completed', r.msg);
  // the owner may work out of order, and it is written down once
  const pO1 = await mkProj(A.cid, 'Owner First');
  const pO2 = await mkProj(A.cid, 'Owner Second');
  await mkAsg(A.cid, pO1, A.pid, 1);
  const o2 = await mkAsg(A.cid, pO2, A.pid, 2);
  await as(A.u, `select public.time_clock_in(current_date) x`);
  r = await as(A.u, `select public.time_start_visit('assignment', $1::uuid) x`, [o2]);
  const ov = await all(`select actor_id, new_value from public.time_audit where action = 'order_override'`);
  check('112 the owner can start a later job out of order; it is in the history with the job that was skipped over', r.ok && ov.length === 1 && ov[0].actor_id === A.pid
    && /Owner First/.test(JSON.stringify(ov[0].new_value)), r.msg + JSON.stringify(ov));
  r = await as(A.u, `select public.time_start_visit('assignment', $1::uuid) x`, [o2]);
  check('113 a double tap by the owner does not write a second override row', r.ok && await n(`select count(*)::int n from public.time_audit where action = 'order_override'`) === 1, r.msg);
  r = await as(A.u, `select public.time_clock_out() x`);
  check('114 the owner clocks out; the running job ends with the day', r.ok && r.v.days.some((d) => d.clock_out_at)
    && await n(`select count(*)::int n from public.time_intervals where person_id = $1 and ended_at is null`, [A.pid]) === 0, r.msg);

  // ═══ 9. breaks vs job time, no-op corrections, void, blank rates, guards (review 61-92) ═══
  r = await as(A.u, `select public.time_staff_add_break($1::uuid, $2::timestamptz, $3::timestamptz, true, 'overlaps the job') x`, [wdK, iso(850), iso(840)]);
  check('115 an owner-added break that overlaps job time is refused', !r.ok && /overlaps time at a job/.test(r.msg), r.msg);
  r = await as(A.u, `select public.time_staff_edit_interval($1::uuid, null, $2::timestamptz, 'now runs into the lunch break') x`, [intK, iso(770)]);
  check('116 stretching job time into a break is refused', !r.ok && /overlaps a break/.test(r.msg), r.msg);
  await as(A.u, `select public.time_approve_workday($1::uuid)`, [wdK]);
  const auditBefore = await n(`select count(*)::int n from public.time_audit`);
  r = await as(A.u, `select public.time_staff_edit_workday($1::uuid, (select clock_in_at from public.time_workdays where id = $1), null, 'same times') x`, [wdK]);
  const r6 = await as(A.u, `select public.time_staff_edit_interval($1::uuid, (select started_at from public.time_intervals where id = $1), null, 'same times') x`, [intK]);
  const r7 = await as(A.u, `select public.time_staff_edit_break($1::uuid, (select started_at from public.time_breaks where id = $1), null, 'same times') x`, [brkK]);
  check('117 a correction that changes nothing does not reopen an approved day or add history', r.ok && r6.ok && r7.ok
    && (await one(`select status from public.time_workdays where id = $1`, [wdK])).status === 'approved' && await n(`select count(*)::int n from public.time_audit`) === auditBefore, [r.msg, r6.msg, r7.msg].join(' | '));
  const intJ1 = await one(`select id, legacy_session_id from public.time_intervals where visit_id = $1 and person_id = $2`, [vJ1, wA.pid]);
  r = await as(A.u, `select public.time_staff_void_interval($1::uuid, 'Entered by mistake') x`, [intJ1.id]);
  const sess = await one(`select duration_minutes, status, correction from public.work_sessions where id = $1`, [intJ1.legacy_session_id]);
  check('118 voiding job time also zeroes its work session (Hours / Payroll Estimate stop counting it); the original is kept in its note', r.ok
    && Number(sess.duration_minutes) === 0 && sess.status === 'corrected' && sess.correction?.voided_by_time_tracking === true && sess.correction?.original_duration_minutes != null, JSON.stringify(sess));
  r = await as(A.u, `select public.time_staff_void_interval($1::uuid, 'Entered by mistake again') x`, [intJ1.id]);
  check('119 voiding twice changes nothing and adds no second history row', r.ok && await n(`select count(*)::int n from public.time_audit where action = 'voided' and entity_id = $1`, [intJ1.id]) === 1);
  r = await as(A.u, `select public.time_staff_edit_interval($1::uuid, now() - interval '5 hours', null, 'edit a removed time') x`, [intJ1.id]);
  check('120 removed job time cannot be edited; a job visit whose only time was removed becomes void', !r.ok && /was removed/.test(r.msg)
    && (await one(`select status from public.time_visits where id = $1`, [vJ1])).status === 'void', r.msg);
  const wP = await member(A.cid, 'wp@example.com', 'worker', 'Pia');
  const addDay = async (daysAgo, from, to, reason) => (await as(A.u, `select public.time_staff_add_workday($1::uuid, current_date - $2::int, $3::timestamptz, $4::timestamptz, $5) x`,
    [wP.pid, daysAgo, iso(daysAgo * 1440 + from), iso(daysAgo * 1440 + to), reason])).v;
  const d1 = await addDay(2, 500, 440, 'forgot day 1');
  const d2 = await addDay(1, 500, 440, 'forgot day 2');
  const d3 = await addDay(1, 400, 340, 'forgot day 3');
  await as(A.u, `select public.time_approve_workday($1::uuid)`, [d3]);
  check('121 time recorded before any pay rate exists has a blank rate', await n(`select count(*)::int n from public.time_workday_rates where workday_id in ($1, $2, $3) and hourly_rate is null`, [d1, d2, d3]) === 3);
  r = await as(A.u, `select public.time_set_hourly_rate($1::uuid, 22, current_date - 1, 'First rate') x`, [wP.pid]);
  const rates = await all(`select workday_id, hourly_rate from public.time_workday_rates where workday_id in ($1, $2, $3)`, [d1, d2, d3]);
  const rateOf = (id) => rates.find((x) => x.workday_id === id)?.hourly_rate;
  check('122 the first rate fills the blank on unapproved days from its start date only (not earlier days, not approved days), and that is in the history', r.ok
    && Number(rateOf(d2)) === 22 && rateOf(d1) === null && rateOf(d3) === null
    && await n(`select count(*)::int n from public.time_audit where action = 'rate_filled' and person_id = $1`, [wP.pid]) === 1, JSON.stringify(rates));
  r = await as(A.u, `select public.time_set_hourly_rate($1::uuid, 30, current_date, 'Raise') x`, [wP.pid]);
  check('123 a raise never changes a rate that was already saved', r.ok && Number((await one(`select hourly_rate from public.time_workday_rates where workday_id = $1`, [d2])).hourly_rate) === 22, r.msg);
  r = await as(A.u, `select public.time_staff_add_workday($1::uuid, current_date - 12, $2::timestamptz, $3::timestamptz, 'typo: wrong clock-out day') x`, [wP.pid, iso(12 * 1440 + 480), iso(10 * 1440)]);
  check('124 a workday longer than 24 hours is refused when the owner types it in', !r.ok && /longer than 24 hours/.test(r.msg), r.msg);
  r = await as(A.u, `select public.time_staff_edit_workday($1::uuid, null, now() - interval '1 minute', 'push the day out to 2 days') x`, [d1]);
  check('125 correcting a day so it runs past 24 hours is refused too', !r.ok && /longer than 24 hours/.test(r.msg), r.msg);
  const wQ = await member(A.cid, 'wq@example.com', 'worker', 'Quin');
  const night = (await one(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, clock_out_at, status) values ($1, $2, '2026-03-07', '2026-03-07T23:00:00Z', '2026-03-08T07:00:00Z', 'closed') returning id`, [A.cid, wQ.pid])).id;
  await db.query(`insert into public.time_breaks (company_id, workday_id, person_id, started_at, ended_at, paid) values ($1, $2, $3, '2026-03-08T02:00:00Z', '2026-03-08T02:30:00Z', false)`, [A.cid, night, wQ.pid]);
  const net = Number((await one(`select public._time_net_ms($1) ms`, [night])).ms);
  check('126 a shift across midnight (and a US clock change) is 8 elapsed hours; a 30-minute unpaid break leaves 7.5 payable', net === 7.5 * 3600000, String(net));
  raised = null; try { await db.query(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, clock_out_at, status) values ($1, $2, '2026-03-08', '2026-03-08T05:00:00Z', '2026-03-08T09:00:00Z', 'closed')`, [A.cid, wQ.pid]); } catch (e) { raised = e.message; }
  check('127 a second workday that overlaps the first is refused (hours cannot be counted twice)', !!raised && /overlaps/.test(raised), raised);

  // ═══ 10. deleting things keeps the time history (review 35, 38, 52) ═══
  const leaving = await member(A.cid, 'leaving@example.com', 'admin', 'Lee');
  r = await as(leaving.u, `select public.time_staff_add_workday($1::uuid, current_date - 7, $2::timestamptz, $3::timestamptz, 'forgot too') x`, [wP.pid, iso(7 * 1440 + 500), iso(7 * 1440 + 400)]);
  raised = null; try { await db.query(`delete from public.company_members where person_id = $1`, [leaving.pid]); await db.query(`delete from public.people where id = $1`, [leaving.pid]); } catch (e) { raised = e.message; }
  check('128 deleting a person who made corrections works; the history keeps the row and just forgets who', r.ok && !raised
    && await n(`select count(*)::int n from public.time_audit where action = 'added' and actor_id is null and reason = 'forgot too'`) === 1, (r.msg ?? '') + raised);
  raised = null; try { await db.query(`delete from public.projects where id = $1`, [pJ1]); } catch (e) { raised = e.message; }
  check('129 deleting a job that has recorded time works, and its time stays', !raised && await n(`select count(*)::int n from public.time_visits where id = $1`, [vJ1]) === 1, raised);
  await as(ownerB.u, `select public.time_staff_add_workday($1::uuid, current_date - 3, $2::timestamptz, $3::timestamptz, 'forgot') x`, [wB.pid, iso(3 * 1440 + 500), iso(3 * 1440 + 400)]);
  const histB = await n(`select count(*)::int n from public.time_audit where company_id = $1`, [B]);
  raised = null;
  try { await db.exec(`select set_config('app.allow_company_delete', 'on', false)`); await db.query(`delete from public.companies where id = $1`, [B]); } catch (e) { raised = e.message; } finally { await db.exec(`select set_config('app.allow_company_delete', 'off', false)`); }
  check('130 wiping a whole company that has time history works (the history lock does not block it): its workdays and history go with it', histB >= 1 && !raised
    && await n(`select (select count(*) from public.time_audit where company_id = $1) + (select count(*) from public.time_workdays where company_id = $1) n`, [B]) === 0, raised);

  // ═══ 11. the owner's own settings writes still work and are recorded (review 85-87) ═══
  const hist0 = await n(`select count(*)::int n from public.time_audit where entity in ('settings', 'target')`);
  const o1 = await as(A.u, `update public.time_settings set long_visit_hours = 7 where company_id = $1`, [A.cid]);
  const o2w = await as(A.u, `update public.time_property_targets set target_minutes = 50 where company_id = $1`, [A.cid]);
  const o3 = await as(A.u, `update public.time_person_settings set daily_alert_hours = 10 where person_id = $1`, [wH.pid]);
  const o4 = await as(A.u, `update public.time_project_estimates set labor_hours = 11 where company_id = $1`, [A.cid]);
  check('131 the owner can change the time settings, a job target, alert hours and a labor estimate directly', o1.ok && o2w.ok && o3.ok && o4.ok, [o1.msg, o2w.msg, o3.msg, o4.msg].join(' | '));
  check('132 ...and they really landed, and the settings and target changes are in the history', Number((await one(`select long_visit_hours h from public.time_settings where company_id = $1`, [A.cid])).h) === 7
    && (await one(`select target_minutes t from public.time_property_targets where project_id = $1`, [pA1])).t === 50
    && Number((await one(`select labor_hours h from public.time_project_estimates where project_id = $1`, [pA1])).h) === 11
    && await n(`select count(*)::int n from public.time_audit where entity in ('settings', 'target')`) >= hist0 + 2);

  // ═══ 12. the catalog: nothing exposed that should not be (review 80-84) ═══
  const cat = await all(`select p.proname, p.prosecdef, coalesce(p.proconfig::text, '') cfg, has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('authenticated', p.oid, 'execute') auth_x
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and (p.proname like 'time\\_%' or p.proname like '\\_time\\_%')`);
  const EXPECTED = ['time_accept_all_suggested_ends', 'time_accept_suggested_end', 'time_alert_resolve', 'time_approve_workday', 'time_break_end', 'time_break_start', 'time_claim_stale_end',
    'time_clock_in', 'time_clock_out', 'time_complete_visit', 'time_decide_skip', 'time_my_day', 'time_my_skip_requests', 'time_record_clock_in_location', 'time_reopen_workday',
    'time_request_skip', 'time_review_list', 'time_scan_alerts', 'time_set_hourly_rate', 'time_set_visit_billable', 'time_settle_no_hours', 'time_staff_add_break', 'time_staff_add_interval',
    'time_staff_add_workday', 'time_staff_edit_break', 'time_staff_edit_interval', 'time_staff_edit_workday', 'time_staff_void_interval', 'time_start_visit', 'time_trucks_for_clock_in', 'time_withdraw_skip'].sort();
  const callable = cat.filter((x) => x.auth_x).map((x) => x.proname).sort();
  check(`133 a signed-in user can run exactly the ${EXPECTED.length} intended time functions and no time helper; a signed-out visitor none of them`,
    JSON.stringify(callable) === JSON.stringify(EXPECTED) && cat.every((x) => !x.anon_x), JSON.stringify({ extra: callable.filter((x) => !EXPECTED.includes(x)), missing: EXPECTED.filter((x) => !callable.includes(x)), anon: cat.filter((x) => x.anon_x).map((x) => x.proname) }));
  check('134 every SECURITY DEFINER time function pins its search_path (no lookalike-object hijack)', cat.filter((x) => x.prosecdef).every((x) => /search_path=public/.test(x.cfg)),
    cat.filter((x) => x.prosecdef && !/search_path=public/.test(x.cfg)).map((x) => x.proname).join(','));
  const priv = await all(`select c.relname, has_table_privilege('anon', c.oid, 'select') a_s, has_table_privilege('anon', c.oid, 'insert') a_i, c.relrowsecurity rls
    from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' and c.relname like 'time\\_%'`);
  check(`135 every time table (${priv.length}) has row level security on and gives signed-out visitors no access at all`, priv.length === TABLES.length && priv.every((x) => x.rls && !x.a_s && !x.a_i),
    JSON.stringify(priv.filter((x) => !x.rls || x.a_s || x.a_i).concat(priv.length === TABLES.length ? [] : priv.map((x) => x.relname))));
  check('136 no view and no rule on another table reaches into the time records', (await all(`select viewname from pg_views where schemaname = 'public' and (definition ilike '%time\\_workdays%' or definition ilike '%time\\_intervals%' or definition ilike '%time\\_workday\\_rates%')`)).length === 0
    && (await all(`select 1 from pg_policies where schemaname = 'public' and tablename not like 'time\\_%' and (qual ilike '%time\\_workdays%' or qual ilike '%time\\_intervals%' or qual ilike '%time\\_audit%')`)).length === 0);
}
