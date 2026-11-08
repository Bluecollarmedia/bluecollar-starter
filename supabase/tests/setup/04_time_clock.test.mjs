// Time clock: clock in / job time / clock out, double taps, skip requests and alerts, owner corrections,
// and the workday date check in the company's time zone (B15).
import { freshDb } from '../helpers/setupDb.mjs';

export default async function run({ check }) {
  const { db, one, all, as, ownerWithCompany, extraCompany, member, signUp } = await freshDb();
  const A = await ownerWithCompany('owner@example.com', 'Company A');
  const w1 = await member(A.cid, 'w1@example.com', 'worker', 'Wes');
  const w2 = await member(A.cid, 'w2@example.com', 'worker', 'Wanda');
  const today = (await one(`select current_date::text d`)).d;
  const job = (await one(`insert into public.projects (company_id, name, status) values ($1, 'Driveway', 'active') returning id`, [A.cid])).id;
  const job2 = (await one(`insert into public.projects (company_id, name, status) values ($1, 'Patio', 'active') returning id`, [A.cid])).id;
  const asg = async (pid, project, sort = 1) => (await one(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, status, sort_order) values ($1, $2, $3, current_date, 'scheduled', $4) returning id`, [A.cid, project, pid, sort])).id;
  const a1 = await asg(w1.pid, job);
  const a2 = await asg(w2.pid, job2);

  // ── a normal day ──
  const in1 = await as(w1.u, `select public.time_clock_in(current_date) x`);
  check('1 a worker clocks in', in1.ok && in1.v.days.some((d) => d.clock_out_at === null), JSON.stringify(in1).slice(0, 300));
  const in2 = await as(w1.u, `select public.time_clock_in(current_date) x`);
  check('2 a second tap on Clock In changes nothing (same open workday)', in2.ok && in2.v.already_active === true
    && (await one(`select count(*)::int n from public.time_workdays where person_id = $1`, [w1.pid])).n === 1);
  check('3 a worker cannot write workday rows directly', !(await as(w1.u, `insert into public.time_workdays (company_id, person_id, work_date) values ($1, $2, current_date)`, [A.cid, w1.pid])).ok
    && !(await as(w1.u, `update public.time_workdays set clock_in_at = now() - interval '5 hours'`)).ok);
  const st = await as(w1.u, `select public.time_start_visit('assignment', $1) x`, [a1]);
  check('4 the worker starts the job (only scheduled jobs can be timed)', st.ok && st.v.current && st.v.current.project_id === job && st.v.current.source === 'project_day', JSON.stringify(st).slice(0, 300));
  check('4b any other kind of work is refused', !(await as(w1.u, `select public.time_start_visit('maintenance_stop', $1) x`, [a1])).ok);
  check('5 the job is checked in (assignment status, check-in row)', (await one(`select status from public.assignments where id = $1`, [a1])).status === 'checked_in'
    && (await one(`select count(*)::int n from public.check_ins where assignment_id = $1`, [a1])).n === 1);
  const done = await as(w1.u, `select public.time_complete_visit($1) x`, [st.v.current.visit_id]);
  check('6 the worker completes the job; a repeat tap is harmless', done.ok && (await as(w1.u, `select public.time_complete_visit($1) x`, [st.v.current.visit_id])).v.already_completed === true
    && (await one(`select status from public.assignments where id = $1`, [a1])).status === 'completed');
  const out = await as(w1.u, `select public.time_clock_out() x`);
  const wd = await one(`select * from public.time_workdays where person_id = $1`, [w1.pid]);
  check('7 the worker clocks out; the day is closed and waits for the owner', out.ok && wd.status === 'closed' && wd.clock_out_at !== null);
  check('8 a second Clock Out is harmless', (await as(w1.u, `select public.time_clock_out() x`)).v.already_closed === true);
  check('9 the owner approves the day; a worker cannot', !(await as(w1.u, `select public.time_approve_workday($1)`, [wd.id])).ok
    && (await as(A.u, `select public.time_approve_workday($1)`, [wd.id])).ok && (await one(`select status from public.time_workdays where id = $1`, [wd.id])).status === 'approved');
  const myDay = await as(w1.u, `select public.time_my_day(current_date) x`);
  check('10 the worker sees their own day through the app\'s function; workers cannot read the workday table itself (only the owner/admins can)',
    myDay.ok && myDay.v.days.length === 1 && (await as(w2.u, `select count(*)::int n from public.time_workdays`)).v === 0
    && (await as(A.u, `select count(*)::int n from public.time_workdays`)).v === 1, JSON.stringify(myDay).slice(0, 200));

  // ── skip request and alerts ──
  await as(w2.u, `select public.time_clock_in(current_date) x`);
  const sk = await as(w2.u, `select public.time_request_skip('assignment', $1, 'Customer not home') x`, [a2]);
  check('11 a worker asks to skip a job; the owner gets an alert and a notice', sk.ok
    && (await one(`select count(*)::int n from public.time_alerts where kind = 'skip_request' and person_id = $1`, [w2.pid])).n === 1
    && (await one(`select count(*)::int n from public.app_notifications where recipient_id = $1 and event_type = 'time_skip_request'`, [A.pid])).n === 1, JSON.stringify(sk));
  check('12 asking twice makes one request', (await as(w2.u, `select public.time_request_skip('assignment', $1, 'again') x`, [a2])).ok
    && (await one(`select count(*)::int n from public.time_skip_requests where assignment_id = $1`, [a2])).n === 1);
  const dec = await as(A.u, `select public.time_decide_skip($1, true, 'OK') x`, [sk.v.request_id]);
  check('13 the owner approves the skip: the job is cancelled; a worker cannot decide', dec.ok && dec.v.status === 'approved'
    && (await one(`select status from public.assignments where id = $1`, [a2])).status === 'cancelled');
  check('14 the owner can run the alert scan; a worker cannot', (await as(A.u, `select public.time_scan_alerts() x`)).ok && !(await as(w1.u, `select public.time_scan_alerts() x`)).ok);
  await as(w2.u, `select public.time_clock_out() x`);

  // ── B15: the workday date is checked in the company's time zone ──
  // 11:00 UTC on Jan 10 is 01:00 on Jan 11 in Kiritimati (UTC+14) and 00:00 on Jan 10 in Pago Pago (UTC-11).
  const coK = await extraCompany('East Co');
  const coP = await extraCompany('West Co');
  await db.query(`insert into public.time_settings (company_id, timezone) values ($1, 'Pacific/Kiritimati'), ($2, 'Pacific/Pago_Pago')`, [coK, coP]);
  const sane = async (cid, date) => { try { await db.query(`select public._time_sane_workday($1::date, '2026-01-10 11:00+00', null, $2)`, [date, cid]); return true; } catch { return false; } };
  check('15 B15: the same moment counts as Jan 11 in a company at UTC+14 (a Jan 12 workday is next to it) ...', await sane(coK, '2026-01-12'));
  check('16 ... and as Jan 10 at UTC-11 (a Jan 12 workday is too far): the company\'s time zone decides, not UTC', !(await sane(coP, '2026-01-12')) && await sane(coP, '2026-01-11'));
  check('17 a company with no time zone set uses America/New_York', (await one(`select public._time_tz($1) z`, [A.cid])).z === 'America/New_York');
  // End to end: the owner adds a forgotten day for 11:30 PM New York time (already the next day in UTC).
  const late = await as(A.u, `select public.time_staff_add_workday($1, '2026-01-05', '2026-01-05 23:30 America/New_York', '2026-01-06 01:30 America/New_York', 'Forgot to clock in') x`, [w2.pid]);
  check('18 the owner adds a late-evening workday by hand (with a reason); it is accepted for its own date', late.ok, JSON.stringify(late));
  const far = await as(A.u, `select public._time_sane_workday('2026-01-01', now(), null, $1)`, [A.cid]);
  check('19 the date helper is internal (the app cannot call it)', !far.ok);
  const wrong = await as(A.u, `select public.time_staff_add_workday($1, '2026-01-01', '2026-01-05 08:00 America/New_York', '2026-01-05 16:00 America/New_York', 'Typed the wrong date') x`, [w2.pid]);
  check('20 a workday whose clock-in is days away from its date is refused with a plain message', !wrong.ok && /not on the workday's date/.test(wrong.msg), wrong.msg);
  check('21 a worker cannot add workdays by hand', !(await as(w1.u, `select public.time_staff_add_workday($1, '2026-01-07', '2026-01-07 08:00 America/New_York', '2026-01-07 16:00 America/New_York', 'Adding my own day') x`, [w1.pid])).ok);
  const otherOwner = await signUp('ob@example.com', { first_name: 'O', last_name: 'B' });
  await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1, $2, 'owner', 'active')`, [coK, otherOwner.pid]);
  check('22 another company\'s owner sees none of this company\'s time records', (await as(otherOwner.u, `select count(*)::int n from public.time_workdays`)).v === 0
    && (await as(otherOwner.u, `select count(*)::int n from public.time_alerts`)).v === 0);
  void all;
}
