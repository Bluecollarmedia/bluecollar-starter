// Clock rules: the check-in distance (radius, GPS accuracy, Anywhere), clocking in with or without scheduled work, forgotten
// (stale) workdays, closing a workday by itself after the last job, the midnight rule, settling a day with no hours, clock-out
// ending open work and breaks, and the yard clock-in alerts. Scheduled work here is a project + an assignment.
import { freshDb } from '../helpers/setupDb.mjs';

export default async function run({ check }) {
  const { db, one, all, as, ownerWithCompany, member } = await freshDb();
  const A = await ownerWithCompany('owner@example.com', 'Company A');
  const cid = A.cid;
  const admin = await member(cid, 'admin@example.com', 'admin', 'Ada');
  // Breaks on (unpaid) and daily alert hours on, for the break and alert checks below.
  await db.query(`insert into public.time_settings (company_id, breaks_enabled, breaks_paid, overtime_alerts_enabled) values ($1, true, false, true)`, [cid]);

  const project = async (name, lat = null, lon = null, radius) => {
    const id = (await one(`insert into public.projects (company_id, name, status, latitude, longitude) values ($1, $2, 'active', $3, $4) returning id`, [cid, name, lat, lon])).id;
    if (radius !== undefined) {
      await db.query(`insert into public.project_settings (company_id, project_id, checkin_radius_meters) values ($1, $2, $3)
                      on conflict (project_id) do update set checkin_radius_meters = excluded.checkin_radius_meters`, [cid, id, radius]);
    }
    return id;
  };
  const job = await project('Driveway');
  const asg = async (pid, proj = job, sort = 1, status = 'scheduled') => (await one(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, status, sort_order) values ($1, $2, $3, current_date, $4, $5) returning id`, [cid, proj, pid, status, sort])).id;
  const clockIn = (u, date = 'current_date') => as(u, `select public.time_clock_in(${date}, null, gen_random_uuid()) x`);
  const clockOut = (u) => as(u, `select public.time_clock_out() x`);
  const myDay = (u) => as(u, `select public.time_my_day(current_date) x`);
  const startJob = (u, a, gps = null) => as(u, `select public.time_start_visit('assignment', $1, null, null, null, 'ok', $2::jsonb) x`, [a, gps]);
  const days = (pid) => all(`select * from public.time_workdays where person_id = $1 order by clock_in_at`, [pid]);
  const t = (x) => new Date(x).getTime();
  const near = (x, msAgo) => Math.abs(t(x) - (Date.now() - msAgo)) < 120000;
  const H = 3600000;
  // "N hours ago", but never before today's local midnight (so a day that should count as today is not caught by the midnight rule).
  const todayAgo = (h) => `greatest(now() - interval '${h} hours', (date_trunc('day', now() at time zone 'America/New_York') + interval '1 minute') at time zone 'America/New_York')`;

  // ── Check-in distance ──
  const ray = await member(cid, 'ray@example.com', 'worker', 'Ray');
  const LAT = 40.0; const LON = -74.0;                      // 0.001 degrees of latitude is about 111 m
  const pA = await project('A: 500 ft', LAT, LON, 152);
  const pB = await project('B: 1 mile', LAT, LON, 1609);
  const pC = await project('C: no saved distance', LAT, LON);
  const pD = await project('D: no coordinates', null, null, 152);
  const pAny = await project('E: Anywhere', LAT, LON, 0);
  const gps = (dLat, accuracy = 10) => JSON.stringify({ latitude: LAT + dLat, longitude: LON, accuracy });
  const ci = (p, g, u = ray.u, pid = ray.pid) => as(u, `insert into public.check_ins (company_id, person_id, project_id, gps) values ($1, $2, $3, $4::jsonb)`, [cid, pid, p, g]);
  const ws = (p, g) => as(ray.u, `insert into public.work_sessions (company_id, person_id, project_id, check_in_time, check_in_gps, status) values ($1, $2, $3, now(), $4::jsonb, 'active')`, [cid, ray.pid, p, g]);
  let r1; let r2;
  r1 = await ci(pA, gps(0.001)); r2 = await ws(pA, gps(0.001));
  check('1 a worker about 111 m from a job with a 500 ft (152 m) distance can check in (check-in and work session)', r1.ok && r2.ok, JSON.stringify([r1, r2]));
  r1 = await ci(pA, gps(0.003)); r2 = await ws(pA, gps(0.003));
  check('2 about 333 m away is refused with a clear message (check-in and work session)', !r1.ok && /too far from this project/.test(r1.msg) && !r2.ok && /too far/.test(r2.msg), JSON.stringify([r1, r2]));
  check('3 the phone\'s own error margin counts: 167 m away with 30 m accuracy is accepted, 178 m away with 5 m accuracy is not',
    (await ci(pA, gps(0.0015, 30))).ok && !(await ci(pA, gps(0.0016, 5))).ok);
  r1 = await ci(pA, gps(0.0005, 250));
  check('4 a GPS fix that vague (250 m) is refused even though it reads close', !r1.ok && /not accurate enough/.test(r1.msg), r1.msg);
  r1 = await ci(pA, null);
  check('5 no GPS fix at all is refused; so are a garbage location and (0, 0)', !r1.ok && /location is needed/.test(r1.msg)
    && !(await ci(pA, JSON.stringify({ latitude: 'abc', longitude: LON }))).ok
    && !(await ci(pA, JSON.stringify({ latitude: 0, longitude: 0, accuracy: 5 }))).ok, r1.msg);
  check('6 each job has its own distance: 1.1 km away is fine inside job B\'s 1 mile, while job A refuses the same spot',
    (await ci(pB, gps(0.01))).ok && !(await ci(pA, gps(0.01))).ok);
  check('7 no saved distance: the half-mile default applies (667 m is inside 805 m, 1 km is outside)',
    (await ci(pC, gps(0.006))).ok && !(await ci(pC, gps(0.009))).ok);
  check('8 a job with no saved coordinates can\'t be measured, so the check-in is not blocked', (await ci(pD, gps(0.5))).ok);
  r1 = await ci(pAny, gps(1.0));
  check('9 a job set to Anywhere (distance 0) lets a worker 111 km away check in', r1.ok, r1.msg);
  const nCi = (await one(`select count(*)::int n from public.check_ins`)).n;
  await ci(pA, gps(0.05));
  check('10 a refused check-in leaves no record behind', (await one(`select count(*)::int n from public.check_ins`)).n === nCi);
  r1 = await ci(pA, gps(0.05), A.u, A.pid);
  check('11 the owner is not limited by the distance (they check in or correct records without being on site)', r1.ok, r1.msg);
  const aRay = await asg(ray.pid, pA);
  await clockIn(ray.u);
  r1 = await startJob(ray.u, aRay, gps(0.05));
  check('12 starting a job from the time clock far from the job is refused too, and nothing is started',
    !r1.ok && /too far/.test(r1.msg) && (await one(`select status from public.assignments where id = $1`, [aRay])).status === 'scheduled'
    && (await one(`select count(*)::int n from public.time_intervals where person_id = $1`, [ray.pid])).n === 0, r1.msg);
  r1 = await startJob(ray.u, aRay, gps(0.0005));
  check('13 ... and at the job it starts', r1.ok && r1.v.current?.project_id === pA, JSON.stringify(r1).slice(0, 300));
  await clockOut(ray.u);

  // ── Clocking in with or without scheduled work ──
  const nia = await member(cid, 'nia@example.com', 'worker', 'Nia');
  r1 = await myDay(nia.u);
  check('14 a worker with nothing scheduled is told they can clock in', r1.ok && r1.v.can_clock_in === true, JSON.stringify(r1).slice(0, 200));
  r1 = await clockIn(nia.u);
  r2 = await clockOut(nia.u);
  const back = await clockIn(nia.u);
  check('15 they can clock in, clock out and clock back in (a second session the same day)', r1.ok && r1.v.days.length === 1 && r2.ok && r2.v.days[0].clock_out_at !== null
    && back.ok && back.v.days.length === 2 && back.v.days[1].clock_out_at === null, JSON.stringify([r1.msg, r2.msg, back.msg]));
  await clockOut(nia.u);
  r1 = await clockIn(nia.u, `current_date + 5`);
  check('16 a clock-in for a date days away is refused with a plain message', !r1.ok && /date doesn't look right/.test(r1.msg), r1.msg);
  r1 = await as(nia.u, `select public.time_start_visit('assignment', gen_random_uuid()) x`);
  check('17 without an open workday no job can be started', !r1.ok && /Clock in for the day first/.test(r1.msg), r1.msg);
  r1 = await clockIn(admin.u);
  check('18 an admin can clock in too', r1.ok && r1.v.days.length === 1, r1.msg);
  await clockOut(admin.u);
  const gone = await member(cid, 'gone@example.com', 'worker', 'Gus');
  await as(A.u, `select public.deactivate_member($1, true)`, [gone.pid]);
  await asg(gone.pid);
  r1 = await clockIn(gone.u);
  check('19 a deactivated worker cannot clock in, even with a job today, and nothing is recorded', !r1.ok
    && (await one(`select count(*)::int n from public.time_workdays where person_id = $1`, [gone.pid])).n === 0, r1.msg);
  const jo = await member(cid, 'jo@example.com', 'worker', 'Jo');
  const aJo = await asg(jo.pid);
  await clockIn(jo.u);
  await db.query(`delete from public.assignments where id = $1`, [aJo]);
  r1 = await myDay(jo.u);
  check('20 a worker already on the clock still sees the open day after their job was removed', r1.ok && r1.v.days.length === 1 && r1.v.days[0].clock_out_at === null, JSON.stringify(r1).slice(0, 300));
  r1 = await clockOut(jo.u);
  check('21 ... and can clock out (clock-out never needs work)', r1.ok && r1.v.days[0].clock_out_at !== null
    && (await one(`select count(*)::int n from public.time_workdays where person_id = $1 and clock_out_at is null`, [jo.pid])).n === 0, r1.msg);

  // ── Clock-out ends whatever is still open ──
  const ben = await member(cid, 'ben@example.com', 'worker', 'Ben');
  const aBen = await asg(ben.pid, job, 1, 'confirmed');
  await clockIn(ben.u);
  r1 = await startJob(ben.u, aBen);
  r2 = await clockOut(ben.u);
  check('22 clocking out while a job is still running works and closes the day', r1.ok && r2.ok && r2.v.days[0].clock_out_at !== null && r2.v.days[0].status === 'closed', JSON.stringify([r1.msg, r2.msg]));
  check('23 the running job is ended with the day: marked completed, a check-out written, no timer left open, nothing current',
    (await one(`select status from public.assignments where id = $1`, [aBen])).status === 'completed'
    && (await one(`select count(*)::int n from public.check_outs where assignment_id = $1`, [aBen])).n === 1
    && (await one(`select count(*)::int n from public.time_intervals where person_id = $1 and ended_at is null`, [ben.pid])).n === 0
    && (await myDay(ben.u)).v.current === null);
  await clockIn(ben.u);
  r1 = await as(ben.u, `select public.time_break_start() x`);
  r2 = await clockOut(ben.u);
  const benBreak = r2.ok && r2.v.days.flatMap((d) => d.breaks);
  check('24 clocking out with a break still running works and ends the break', r1.ok && r2.ok && benBreak.length === 1 && benBreak[0].ended_at !== null, JSON.stringify([r1.msg, r2.msg, benBreak]));

  // ── Forgotten (stale) clock sessions ──
  const cal = await member(cid, 'cal@example.com', 'worker', 'Cal');        // closed yesterday properly
  const fran = await member(cid, 'fran@example.com', 'worker', 'Fran');     // a few hours into today: not stale
  const fog = await member(cid, 'fog@example.com', 'worker', 'Fogg');       // forgot to clock out with a job timer still running
  const aFog = await asg(fog.pid);
  await db.query(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, clock_out_at, status) values ($1, $2, current_date - 1, now() - interval '30 hours', now() - interval '22 hours', 'closed')`, [cid, cal.pid]);
  r1 = await myDay(cal.u);
  check('25 yesterday\'s closed day is not shown as today\'s session', r1.ok && r1.v.days.length === 0, JSON.stringify(r1.v?.days));
  r1 = await clockIn(cal.u);
  check('26 the worker clocks in for today at once; yesterday\'s record is untouched', r1.ok && r1.v.days.length === 1 && !r1.v.days[0].clock_out_at
    && (await days(cal.pid)).length === 2 && (await days(cal.pid))[0].status === 'closed', r1.msg);
  await clockIn(fran.u);
  await db.query(`update public.time_workdays set clock_in_at = ${todayAgo(5)} where person_id = $1`, [fran.pid]);
  r1 = await myDay(fran.u);
  check('27 a day open since earlier today is current: not flagged, still running', r1.ok && r1.v.days.length === 1 && r1.v.days[0].status === 'active' && !r1.v.days[0].clock_out_at, JSON.stringify(r1.v?.days));
  await clockIn(fog.u);
  r1 = await startJob(fog.u, aFog);
  check('28 setup: the forgetful worker is timing a job', r1.ok, r1.msg);
  await db.query(`update public.time_workdays set clock_in_at = now() - interval '30 hours', work_date = current_date - 1 where person_id = $1`, [fog.pid]);
  await db.query(`update public.time_intervals set started_at = now() - interval '29 hours' where person_id = $1`, [fog.pid]);
  const before = (await days(fog.pid))[0];
  r1 = await myDay(fog.u);
  const flagged = (await days(fog.pid))[0];
  check('29 opening the app flags the old day as needs_review', flagged.status === 'needs_review' && !!flagged.flagged_at, JSON.stringify(flagged));
  check('30 its clock-in is untouched and its end is a zero-length placeholder (no invented time)', t(flagged.clock_in_at) === t(before.clock_in_at) && t(flagged.clock_out_at) === t(flagged.clock_in_at));
  check('31 the running job timer stopped at its own start (zero time), not at "now"', (await one(`select count(*)::int n from public.time_intervals where person_id = $1 and ended_at is null`, [fog.pid])).n === 0
    && (await one(`select (ended_at = started_at) z from public.time_intervals where person_id = $1`, [fog.pid])).z === true);
  check('32 the phone is told about it (one needs_review card), and no current job is reported', r1.ok && r1.v.days.some((d) => d.status === 'needs_review') && !r1.v.current, JSON.stringify(r1.v).slice(0, 300));
  check('33 the owner is notified and the history records the flag', (await one(`select count(*)::int n from public.app_notifications where recipient_id = $1 and linked_entity_id = $2 and title like 'Needs your OK: no clock-out%'`, [A.pid, flagged.id])).n === 1
    && (await one(`select count(*)::int n from public.time_audit where workday_id = $1 and action = 'flagged'`, [flagged.id])).n >= 2);
  r1 = await clockIn(fog.u);
  const fogRows = await days(fog.pid);
  check('34 today\'s clock-in works at once, as a separate row; the flagged day counts zero hours', r1.ok && fogRows.length === 2 && fogRows[1].status === 'active' && !fogRows[1].clock_out_at
    && (await one(`select public._time_net_ms($1)::int ms`, [flagged.id])).ms === 0, r1.msg);
  r1 = await clockOut(fog.u);
  check('35 clocking out closes today\'s day only and never touches the flagged one', r1.ok && (await days(fog.pid))[0].status === 'needs_review' && (await days(fog.pid))[1].status === 'closed', r1.msg);
  const stopped = (await one(`select (clock_in_at + interval '9 hours') x from public.time_workdays where id = $1`, [flagged.id])).x;
  r1 = await as(fog.u, `select public.time_claim_stale_end($1, $2::timestamptz, 'Left at 5') x`, [flagged.id, stopped]);
  const claimed = (await days(fog.pid))[0];
  check('36 the worker\'s answer (when they stopped, with a note) is saved but changes no hours', r1.ok && t(claimed.claimed_out_at) === t(stopped) && claimed.claim_note === 'Left at 5'
    && claimed.status === 'needs_review' && t(claimed.clock_out_at) === t(claimed.clock_in_at), r1.msg);
  r1 = await as(fog.u, `select public.time_claim_stale_end($1, now() + interval '1 hour', null) x`, [flagged.id]);
  r2 = await as(fog.u, `select public.time_claim_stale_end($1, $2::timestamptz - interval '1 hour', null) x`, [flagged.id, flagged.clock_in_at]);
  check('37 a stop time in the future, or before the clock-in, is refused', !r1.ok && /future/.test(r1.msg) && !r2.ok && /after you clocked in/.test(r2.msg), JSON.stringify([r1.msg, r2.msg]));
  check('38 nobody can answer for someone else\'s day', !(await as(cal.u, `select public.time_claim_stale_end($1, null, null) x`, [flagged.id])).ok);
  r1 = await as(fog.u, `select public.time_claim_stale_end($1, null, 'Not sure') x`, [flagged.id]);
  check('39 "I\'m not sure" is saved too', r1.ok && (await days(fog.pid))[0].claimed_out_at === null && (await days(fog.pid))[0].claim_note === 'Not sure', r1.msg);
  r1 = await as(A.u, `select public.time_approve_workday($1)`, [flagged.id]);
  check('40 a flagged day cannot be approved for payroll until it has a real end time', !r1.ok && /end time/.test(r1.msg), r1.msg);
  r1 = await as(A.u, `select public.time_staff_edit_workday($1, null, $2::timestamptz, 'Worker said they left at 5') x`, [flagged.id, stopped]);
  const settled = (await days(fog.pid))[0];
  check('41 the owner sets the real end time: it becomes a normal closed day, the original clock-in kept', r1.ok && settled.status === 'closed'
    && t(settled.clock_out_at) === t(stopped) && t(settled.clock_in_at) === t(before.clock_in_at), r1.msg);
  r1 = await as(fog.u, `select public.time_claim_stale_end($1, null, null) x`, [flagged.id]);
  check('42 a settled day can no longer be answered', !r1.ok && /settled/.test(r1.msg), r1.msg);
  r1 = await clockOut(fog.u);
  check('43 a repeated clock-out says "already closed" and still returns the day', r1.ok && r1.v.already_closed === true && r1.v.days.length >= 1, JSON.stringify(r1.v).slice(0, 200));

  // ── The workday closes by itself after the last job ──
  const ann = await member(cid, 'ann@example.com', 'worker', 'Ann');
  const bo = await member(cid, 'bo@example.com', 'worker', 'Bo');
  const idle = await member(cid, 'idle@example.com', 'worker', 'Ida');
  const job2 = await project('Patio');
  const job3 = await project('Fence');
  const ann1 = await asg(ann.pid, job, 1);
  const ann2 = await asg(ann.pid, job2, 2);
  const boJob = await asg(bo.pid);
  for (const p of [ann, bo, idle]) await clockIn(p.u);
  await as(bo.u, `select public.time_break_start() x`);
  await db.query(`update public.assignments set status = 'completed' where id = $1`, [ann1]);
  r1 = await myDay(ann.u);
  check('44 finishing the first of two jobs closes nothing; the phone says work is still open', (await days(ann.pid))[0].status === 'active' && r1.ok && r1.v.has_open_work === true, JSON.stringify(r1.v).slice(0, 200));
  await db.query(`update public.assignments set status = 'cancelled' where id = $1`, [ann2]);
  const annFirst = (await days(ann.pid))[0];
  check('45 finishing (or cancelling) the last job closes the day at that moment, written to the history', annFirst.status === 'closed' && !!annFirst.clock_out_at
    && (await one(`select count(*)::int n from public.time_audit where workday_id = $1 and action = 'auto_clock_out'`, [annFirst.id])).n === 1, JSON.stringify(annFirst));
  check('46 the phone now says nothing is open', (await myDay(ann.u)).v.has_open_work === false);
  await db.query(`update public.assignments set status = 'completed' where id = $1`, [boJob]);
  check('47 someone on a break is left clocked in when their last job is finished', (await days(bo.pid))[0].status === 'active' && !(await days(bo.pid))[0].clock_out_at);
  await as(bo.u, `select public.time_break_end() x`);
  check('48 when the break ends, that day closes too', (await days(bo.pid))[0].status === 'closed');
  r1 = await as(idle.u, `select public.time_break_start() x`);
  r2 = await as(idle.u, `select public.time_break_end() x`);
  check('49 someone with no work today stays clocked in (ending a break does not close their day)', r1.ok && r2.ok
    && (await one(`select count(*)::int n from public.time_breaks where person_id = $1 and ended_at is not null`, [idle.pid])).n === 1
    && !(await days(idle.pid))[0].clock_out_at, JSON.stringify([r1.msg, r2.msg]));
  await clockOut(idle.u);
  const ann3 = await asg(ann.pid, job3, 3);
  check('50 a job added later shows as open work again', (await myDay(ann.u)).v.has_open_work === true);
  r1 = await clockIn(ann.u);
  let annDays = await days(ann.pid);
  check('51 she can clock in again: a new session; the closed one is untouched', r1.ok && annDays.length === 2 && annDays[0].id === annFirst.id
    && t(annDays[0].clock_out_at) === t(annFirst.clock_out_at) && !annDays[1].clock_out_at, r1.msg);
  await db.query(`update public.assignments set status = 'completed' where id = $1`, [ann3]);
  annDays = await days(ann.pid);
  check('52 finishing that job closes the second session', !!annDays[1].clock_out_at && annDays[1].status === 'closed');
  const lan = await member(cid, 'lan@example.com', 'worker', 'Lan');
  const aLan = await asg(lan.pid);
  await clockIn(lan.u);
  r1 = await startJob(lan.u, aLan);
  r2 = r1.ok ? await as(lan.u, `select public.time_complete_visit($1) x`, [r1.v.current.visit_id]) : r1;
  check('53 completing her only job from the time clock closes her day', r2.ok && (await days(lan.pid))[0].status === 'closed' && !!(await days(lan.pid))[0].clock_out_at, r2.msg);

  // A forgotten day: zero hours, a suggested end time, one-tap accept.
  const fay = await member(cid, 'fay@example.com', 'worker', 'Fay');
  const gus = await member(cid, 'gus@example.com', 'worker', 'Gus');
  const aFay = await asg(fay.pid);
  await clockIn(fay.u);
  await startJob(fay.u, aFay);
  await clockIn(gus.u);
  await db.query(`update public.time_workdays set clock_in_at = now() - interval '15 hours' where person_id in ($1, $2)`, [fay.pid, gus.pid]);
  await db.query(`update public.time_intervals set started_at = now() - interval '14 hours' where person_id = $1`, [fay.pid]);
  await db.query(`update public.time_intervals set ended_at = now() - interval '6 hours' where person_id = $1`, [fay.pid]);
  check('54 a 15-hour-old day is not closed at "now" when its job timer ends', !(await days(fay.pid))[0].clock_out_at, JSON.stringify((await days(fay.pid))[0]));
  await myDay(fay.u);
  await myDay(gus.u);
  const fd = (await days(fay.pid))[0];
  const gd = (await days(gus.pid))[0];
  check('55 the open-too-long rule flags it at zero length instead', fd.status === 'needs_review' && t(fd.clock_out_at) === t(fd.clock_in_at) && gd.status === 'needs_review', JSON.stringify(fd));
  r1 = await as(fay.u, `select public.time_review_list() x`);
  check('56 a worker cannot read the owner\'s review list', !r1.ok && /Only the owner/.test(r1.msg), r1.msg);
  r1 = await as(A.u, `select public.time_review_list() x`);
  const fayRow = (r1.v ?? []).find((x) => x.person_id === fay.pid);
  const gusRow = (r1.v ?? []).find((x) => x.person_id === gus.pid);
  check('57 the owner sees both; the suggested end is the end of the last job timer', r1.ok && fayRow?.suggestion_source === 'last_visit' && near(fayRow.suggested_end_at, 6 * H), JSON.stringify(r1).slice(0, 400));
  check('58 a day with nothing finished has no suggestion', !!gusRow && gusRow.suggested_end_at === null, JSON.stringify(gusRow));
  check('59 a worker cannot accept a suggestion', !(await as(fay.u, `select public.time_accept_suggested_end($1)`, [fd.id])).ok);
  r1 = await as(A.u, `select public.time_accept_suggested_end($1)`, [gd.id]);
  check('60 accepting a day that has no suggestion says so', !r1.ok && /no suggested end time/i.test(r1.msg), r1.msg);
  r1 = await as(A.u, `select public.time_accept_suggested_end($1)`, [fd.id]);
  const fa = (await days(fay.pid))[0];
  check('61 one tap: the day is settled at the suggested time (waits for approval), with the reason in the history', r1.ok && fa.status === 'closed' && near(fa.clock_out_at, 6 * H)
    && (await one(`select count(*)::int n from public.time_audit where workday_id = $1 and reason = 'Accepted the suggested end time'`, [fd.id])).n >= 1, r1.msg + JSON.stringify(fa));
  r1 = await as(A.u, `select public.time_accept_suggested_end($1)`, [fd.id]);
  check('62 accepting twice is refused (already settled)', !r1.ok && /already settled/.test(r1.msg), r1.msg);
  await as(gus.u, `select public.time_claim_stale_end($1, $2::timestamptz + interval '8 hours', 'Done by 4') x`, [gd.id, gd.clock_in_at]);
  r1 = await as(A.u, `select public.time_accept_all_suggested_ends() x`);
  check('63 the worker\'s own answer becomes the suggestion, and accept-all settles every day that has one', r1.ok && r1.v.accepted === 1 && r1.v.left.length === 0
    && (await days(gus.pid))[0].status === 'closed', JSON.stringify(r1));

  // Daily alert hours add up every session of a date.
  const ott = await member(cid, 'ott@example.com', 'worker', 'Ott');
  await db.query(`insert into public.time_person_settings (person_id, company_id, daily_alert_hours) values ($1, $2, 8)`, [ott.pid, cid]);
  await db.query(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, clock_out_at, status) values
    ($1, $2, current_date, now() - interval '10 hours', now() - interval '5 hours', 'closed'), ($1, $2, current_date, now() - interval '4 hours', now(), 'closed')`, [cid, ott.pid]);
  r1 = await as(A.u, `select public.time_scan_alerts() x`);
  const ottFirst = (await days(ott.pid))[0].id;
  const ottAlerts = await all(`select kind, dedupe_key from public.time_alerts where person_id = $1`, [ott.pid]);
  check('64 two sessions of 5 h and 4 h on one date reach the 8-hour alert, filed under the first session', r1.ok && ottAlerts.some((a) => a.kind === 'overtime_reached' && a.dedupe_key === 'ot_reached:' + ottFirst), JSON.stringify(ottAlerts));
  await as(A.u, `select public.time_scan_alerts() x`);
  check('65 it fires only once', (await one(`select count(*)::int n from public.time_alerts where person_id = $1 and kind = 'overtime_reached'`, [ott.pid])).n === 1);

  // ── Close at midnight and settle with no hours ──
  const late = await member(cid, 'late@example.com', 'worker', 'Lyle');     // clocked in before local midnight, never clocked out
  const fresh = await member(cid, 'fresh@example.com', 'worker', 'Fern');   // clocked in today
  const late2 = await member(cid, 'late2@example.com', 'worker', 'Lou');
  const late3 = await member(cid, 'late3@example.com', 'worker', 'Lea');
  const lateIn = (await one(`select (date_trunc('day', now() at time zone 'America/New_York') - interval '1 hour') at time zone 'America/New_York' as x`)).x;
  const yday = `(now() at time zone 'America/New_York')::date - 1`;
  const lateDay = async (pid) => (await one(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at) values ($1, $2, ${yday}, $3) returning id`, [cid, pid, lateIn])).id;
  const L = await lateDay(late.pid);
  // Lyle finished a job from 23:10 to 23:30 before forgetting to clock out.
  const lateJob = await project('Late job');
  const lv = (await one(`insert into public.time_visits (company_id, source, project_id, visit_date, label) values ($1, 'project_day', $2, ${yday}, 'Late job') returning id`, [cid, lateJob])).id;
  await db.query(`insert into public.time_intervals (company_id, visit_id, workday_id, person_id, started_at, ended_at) values ($1, $2, $3, $4, $5::timestamptz + interval '10 minutes', $5::timestamptz + interval '30 minutes')`, [cid, lv, L, late.pid, lateIn]);
  await db.query(`insert into public.time_workdays (company_id, person_id, work_date) values ($1, $2, (now() at time zone 'America/New_York')::date)`, [cid, fresh.pid]);
  check('66 setup: the day started before midnight is still open', !(await one(`select clock_out_at from public.time_workdays where id = $1`, [L])).clock_out_at);
  r1 = await as(A.u, `select public.time_scan_alerts() x`);
  const Ld = await one(`select * from public.time_workdays where id = $1`, [L]);
  check('67 the owner\'s screens close it at zero hours and flag it; the history says midnight', r1.ok && Ld.status === 'needs_review' && t(Ld.clock_out_at) === t(Ld.clock_in_at)
    && (await one(`select count(*)::int n from public.time_audit where workday_id = $1 and entity = 'workday' and action = 'flagged' and reason like '%midnight%'`, [L])).n === 1, r1.msg + JSON.stringify(Ld));
  const Fd = (await days(fresh.pid))[0];
  check('68 a day started today is left alone', Fd.status === 'active' && !Fd.clock_out_at, JSON.stringify(Fd));
  const L2 = await lateDay(late2.pid);
  r1 = await as(A.u, `select public.time_review_list() x`);
  check('69 it is on the Needs your OK list, and the list itself flags another forgotten day first', r1.ok && r1.v.some((x) => x.workday_id === L) && r1.v.some((x) => x.workday_id === L2), JSON.stringify(r1).slice(0, 300));
  const L3 = await lateDay(late3.pid);
  r1 = await as(late3.u, `select public.time_my_day(null) x`);
  check('70 the worker opening the app flags it too', r1.ok && (await one(`select status from public.time_workdays where id = $1`, [L3])).status === 'needs_review', r1.msg);
  r1 = await as(A.u, `select public.time_accept_suggested_end($1)`, [L]);
  const Lset = await one(`select * from public.time_workdays where id = $1`, [L]);
  check('71 one tap settles a midnight-flagged day at the end of its last finished job', r1.ok && Lset.status === 'closed' && Math.abs(t(Lset.clock_out_at) - (t(lateIn) + 30 * 60000)) < 2000, r1.msg + JSON.stringify(Lset));
  check('72 a worker cannot settle a day with no hours', !(await as(late2.u, `select public.time_settle_no_hours($1)`, [L2])).ok);
  r1 = await as(A.u, `select public.time_settle_no_hours($1, 'Clocked in by mistake')`, [L2]);
  const L2d = await one(`select * from public.time_workdays where id = $1`, [L2]);
  check('73 the owner settles it with no hours: closed, zero length, zero paid time', r1.ok && L2d.status === 'closed' && t(L2d.clock_out_at) === t(L2d.clock_in_at)
    && (await one(`select public._time_net_ms($1)::int ms`, [L2])).ms === 0, r1.msg + JSON.stringify(L2d));
  r1 = await as(A.u, `select public.time_review_list() x`);
  check('74 it is off the list, and the history has it with the reason', r1.ok && !r1.v.some((x) => x.workday_id === L2)
    && (await one(`select count(*)::int n from public.time_audit where workday_id = $1 and action = 'settled_no_hours' and reason = 'Clocked in by mistake'`, [L2])).n === 1);
  r1 = await as(A.u, `select public.time_settle_no_hours($1)`, [L2]);
  check('75 settling it again is refused (already settled)', !r1.ok && /already settled/.test(r1.msg), r1.msg);

  // ── Yard clock-in alerts ──
  const yara = await member(cid, 'yara@example.com', 'worker', 'Yara');
  const yuri = await member(cid, 'yuri@example.com', 'worker', 'Yuri');
  const YLAT = 40.0960; const YLNG = -74.2170;
  const mkDay = async (pid, d) => (await one(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, clock_out_at, status) values ($1, $2, $3::date, ($3::date + time '08:00')::timestamptz, ($3::date + time '09:00')::timestamptz, 'closed') returning id`, [cid, pid, d])).id;
  const setYard = (radius = 152, on = true, mail = null, u = A.u) => as(u, `select public.owner_set_yard_alerts($1, $2, $3) x`, [radius, on, mail]);
  const rec = (d, lat, lng, u = yara.u) => as(u, `select public.time_record_clock_in_location($1, $2, $3, 10, null) x`, [d, lat, lng]);
  r1 = await as(A.u, `select public.owner_get_yard_alerts() x`);
  check('76 before anything is set: no yard, alerts off, default 500 ft radius', r1.ok && r1.v.yard_set === false && r1.v.alert_on === false && r1.v.radius_m === 152, JSON.stringify(r1));
  check('77 a worker cannot read or change the alert settings; a signed-out caller cannot read them', !(await setYard(150, true, null, yara.u)).ok
    && !(await as(yara.u, `select public.owner_get_yard_alerts() x`)).ok && !(await as(null, `select public.owner_get_yard_alerts() x`)).ok);
  check('78 a radius that is too small, or a bad alert email, is refused', !(await setYard(5)).ok && !(await setYard(152, true, 'not-an-email')).ok);
  await db.query(`update public.companies set yard_address = '111 Spruce St', yard_city = 'Lakewood', yard_state = 'NJ', yard_latitude = $2, yard_longitude = $3 where id = $1`, [cid, YLAT, YLNG]);
  r1 = await setYard(152, true, 'boss@example.com');
  check('79 the owner turns alerts on; the company\'s yard location shows with them', r1.ok && r1.v.yard_set === true && r1.v.alert_on === true && r1.v.alert_email === 'boss@example.com' && /Spruce/.test(r1.v.yard_address), JSON.stringify(r1));
  const d1 = await mkDay(yara.pid, '2025-12-08');
  r1 = await rec(d1, YLAT + 0.0003, YLNG);
  check('80 clocking in at the yard: recorded, inside, no alert needed', r1.ok && r1.v.recorded === true && r1.v.outside === false && r1.v.alert_needed === false, JSON.stringify(r1));
  r1 = await rec(d1, YLAT + 0.05, YLNG);
  check('81 a second record for the same workday does nothing', r1.ok && r1.v.recorded === false && r1.v.alert_needed === false, JSON.stringify(r1));
  r1 = await rec(await mkDay(yara.pid, '2025-12-09'), YLAT + 0.01, YLNG);
  check('82 about 1.1 km away: outside, and the owner should be alerted', r1.ok && r1.v.outside === true && r1.v.alert_needed === true && r1.v.distance_m > 1000 && r1.v.distance_m < 1200, JSON.stringify(r1));
  r1 = await as(yara.u, `select public.time_record_clock_in_location($1, null, null, null, 'location unavailable') x`, [await mkDay(yara.pid, '2025-12-10')]);
  check('83 no location could be read: the owner should still be alerted', r1.ok && r1.v.recorded === true && r1.v.alert_needed === true && r1.v.outside === null, JSON.stringify(r1));
  check('84 a worker cannot record a location for someone else\'s workday', !(await rec(await mkDay(yuri.pid, '2025-12-10'), YLAT, YLNG)).ok);
  await setYard(152, false);
  r1 = await rec(await mkDay(yara.pid, '2025-12-11'), YLAT + 0.01, YLNG);
  check('85 with alerts switched off nobody is alerted, even far away', r1.ok && r1.v.outside === true && r1.v.alert_needed === false, JSON.stringify(r1));
  await setYard(1000, true);
  r1 = await rec(await mkDay(yara.pid, '2025-12-12'), YLAT + 0.005, YLNG);
  check('86 the radius is the owner\'s choice: 550 m away is inside a 1000 m yard', r1.ok && r1.v.outside === false && r1.v.alert_needed === false, JSON.stringify(r1));
  await db.query(`update public.companies set yard_latitude = null, yard_longitude = null where id = $1`, [cid]);
  r1 = await rec(await mkDay(yara.pid, '2025-12-13'), YLAT + 0.5, YLNG);
  check('87 with no yard set nothing is flagged and nobody is alerted', r1.ok && r1.v.recorded === true && r1.v.yard_set === false && r1.v.alert_needed === false, JSON.stringify(r1));
  const direct = [];
  for (const [who, u] of [['signed out', null], ['owner', A.u], ['worker', yara.u]]) {
    for (const tbl of ['company_yard_alerts', 'time_clock_locations']) {
      if ((await as(u, `select count(*) x from public.${tbl}`)).ok || (await as(u, `delete from public.${tbl} returning 1 x`)).ok) direct.push(`${who}:${tbl}`);
    }
  }
  check('88 nobody (signed out, owner or worker) can read or delete the yard settings or clock-in locations directly', direct.length === 0, JSON.stringify(direct));
}
