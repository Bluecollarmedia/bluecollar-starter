// Run: node scripts/checks/timeCalc.check.cjs <path to typescript package>
// The shared time / labor / cost definitions (src/lib/timeCalc.ts): gross vs net, breaks counted once, crew labor vs visit length, overtime,
// timeline honesty, averages, targets and CSV.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(read('src/lib/timeCalc.ts'), { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText)(m, m.exports);
const t = m.exports;
let bad = 0;
const check = (n, ok, detail) => { if (!ok) bad++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (ok ? '' : ' - ' + (detail || ''))); };
const at = (h, mi = 0) => `2026-10-19T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00.000Z`;
const H = 3600000;

const day = { id: 'w', personId: 'p', workDate: '2026-10-19', clockInAt: at(7, 30), clockOutAt: at(16, 0), status: 'closed' };
check('1 gross workday = clock-out minus clock-in (8.5 h)', t.grossMs(day) === 8.5 * H && t.hoursText(t.grossMs(day)) === '8.50');
const open = { ...day, clockOutAt: null };
check('2 an open day counts up to now, never an invented end', t.grossMs(open, Date.parse(at(9, 30))) === 2 * H);

const unpaid = { startedAt: at(12, 0), endedAt: at(12, 30), paid: false };
const paid = { startedAt: at(10, 0), endedAt: at(10, 15), paid: true };
check('3 an unpaid break is deducted; a paid break is not; nothing is deducted for breaks not recorded',
  t.netMs(day, [unpaid]) === 8 * H && t.netMs(day, [paid]) === 8.5 * H && t.netMs(day, []) === 8.5 * H);
check('4 overlapping breaks are counted once (no double deduction)',
  t.deductedBreakMs(day, [unpaid, { startedAt: at(12, 15), endedAt: at(12, 45), paid: false }]) === 0.75 * H && t.recordedBreakMs(day, [unpaid, paid]) === 0.75 * H);
check('5 a break running outside the day is clipped to the day', t.recordedBreakMs(day, [{ startedAt: at(6, 0), endedAt: at(8, 0), paid: false }]) === 0.5 * H);

const a = { id: 'a', visitId: 'v', workdayId: 'w', personId: 'p1', startedAt: at(8, 0), endedAt: at(10, 0), status: 'completed', billable: true, hourlyRate: 20 };
const b = { ...a, id: 'b', personId: 'p2', hourlyRate: 25 };
check('6 two employees working 2 hours = 4 crew labor-hours but a 2-hour visit', t.crewLaborMs([a, b]) === 4 * H && t.visitElapsedMs([a, b]) === 2 * H);
const late = { ...b, startedAt: at(9, 0) };
check('7 an employee who arrives later is counted for the time they actually worked', t.crewLaborMs([a, late]) === 3 * H && t.visitElapsedMs([a, late]) === 2 * H);
check('8 voided intervals count for nothing', t.crewLaborMs([a, { ...b, status: 'void' }]) === 2 * H && t.visitElapsedMs([{ ...a, status: 'void' }]) === null);
check('9 a visit still being worked has no final elapsed time', t.visitElapsedMs([a, { ...b, endedAt: null }]) === null);
check('10 labor cost uses the rate saved with each interval; none saved = no guess', t.intervalCost(a) === 40 && t.intervalCost(b) === 50 && t.intervalCost({ ...a, hourlyRate: null }) === null);

check('11 the daily alert status: under, approaching (90%), reached with hours past',
  t.dailyAlertStatus(6 * H, 8).level === 'under' && t.dailyAlertStatus(7.3 * H, 8).level === 'approaching' && t.dailyAlertStatus(8.5 * H, 8).level === 'reached' && t.dailyAlertStatus(8.5 * H, 8).overMs === 0.5 * H && t.dailyAlertStatus(9 * H, null).level === 'under');
check('12 weeks start on Monday', t.weekStartKey('2026-10-19') === '2026-10-19' && t.weekStartKey('2026-10-25') === '2026-10-19' && t.weekStartKey('2026-10-18') === '2026-10-12');
const days = [1, 2, 3, 4, 5, 6].map((n) => ({ workdayId: String(n), workDate: `2026-10-${18 + n}`, grossMs: 8 * H, recordedBreakMs: 0, deductedBreakMs: 0, netMs: 8 * H, status: 'approved', open: false }));
const wk = t.summarizeWeek('2026-10-19', days, { enabled: true, weeklyThresholdHours: 40, multiplier: 1.5 });
check('13 weekly summary: 48 net hours = 40 regular + 8 overtime, with the basis spelled out', wk.regularMs === 40 * H && wk.overtimeMs === 8 * H && /over 40/.test(wk.basis) && wk.approved === true);
check('14 overtime off = all regular', t.summarizeWeek('x', days, { enabled: false, weeklyThresholdHours: 40, multiplier: 1.5 }).overtimeMs === 0);
check('15 week pay = regular at the rate + overtime at rate x multiplier (20 x 40 + 20 x 1.5 x 8 = 1040)', t.weekPayCost(wk, 20, 1.5) === 1040 && t.weekPayCost(wk, null) === null);

const iv1 = { id: 'i1', visitId: 'v1', workdayId: 'w', personId: 'p', startedAt: at(8, 15), endedAt: at(11, 15), status: 'completed', billable: true, label: 'Chase' };
const iv2 = { id: 'i2', visitId: 'v2', workdayId: 'w', personId: 'p', startedAt: at(11, 35), endedAt: at(13, 0), status: 'completed', billable: true, label: 'Focus' };
const tl = t.buildTimeline(day, [unpaid], [iv1, iv2]);
check('16 timeline: clock-in, yard time, Chase, gap, Focus, break, gap, clock-out; gaps are "between visits", never "travel"',
  tl[0].kind === 'clock_in' && tl[1].label === 'Before the first visit' && tl[1].ms === 0.75 * H && tl[2].label === 'Chase' && tl[3].label === 'Between visits' && tl[3].ms === 20 * 60000
  && tl.some((e) => e.kind === 'break') && tl[tl.length - 1].kind === 'clock_out' && !tl.some((e) => /travel/i.test(e.label)), JSON.stringify(tl.map((e) => e.label)));
check('17 timeline of an open day ends at an open visit, not a made-up clock-out', (() => { const x = t.buildTimeline(open, [], [{ ...iv2, endedAt: null }], Date.parse(at(12, 0))); return x[x.length - 1].kind === 'open'; })());

check('18 problems: an open day for too long, an interval still running after clock-out, overlapping visits',
  t.dayProblems(open, [], Date.parse(at(23, 59))).some((p) => p.kind === 'no_clock_out')
  && t.dayProblems(day, [{ ...iv1, endedAt: null }]).some((p) => p.kind === 'open_interval_after_close')
  && t.dayProblems(day, [iv1, { ...iv2, startedAt: at(10, 0) }]).some((p) => p.kind === 'overlap')
  && t.dayProblems(day, [iv1, iv2]).length === 0);
check('19 review state: in progress, needs correction, ready, approved, needs approval again',
  t.reviewState(open, []) === 'in_progress' && t.reviewState(day, [{ kind: 'overlap', message: '' }]) === 'needs_correction' && t.reviewState(day, []) === 'ready'
  && t.reviewState({ ...day, status: 'approved' }, []) === 'approved' && t.reviewState({ ...day, status: 'reopened' }, []) === 'reapproval');

const recs = [
  { visitId: '1', status: 'completed', billable: true, elapsedMs: 4 * H, laborMs: 8 * H },
  { visitId: '2', status: 'completed', billable: true, elapsedMs: 2 * H, laborMs: 4 * H },
  { visitId: '3', status: 'completed', billable: false, elapsedMs: 3 * H, laborMs: 6 * H },
  { visitId: '4', status: 'in_progress', billable: true, elapsedMs: null, laborMs: 1 * H },
  { visitId: '5', status: 'void', billable: true, elapsedMs: 9 * H, laborMs: 9 * H },
];
const hs = t.visitHistoryStats(recs);
check('20 the average counts completed visits only (not in-progress, voided or skipped), elapsed and labor kept apart', hs.count === 3 && hs.averageElapsedMs === 3 * H && hs.averageLaborMs === 6 * H && hs.totalLaborMs === 18 * H);
check('21 billable-only average leaves out non-billable visits', t.visitHistoryStats(recs, true).count === 2 && t.visitHistoryStats(recs, true).averageElapsedMs === 3 * H);
const cmp = t.compareToTarget(2.5833333 * H, 120);
check('22 actual vs target in the same unit: 35 minutes over', cmp.over && Math.round(cmp.diffMs / 60000) === 35 && t.compareToTarget(H, null) === null);

const csv = t.toCsv([{ n: 'Ann, "A" Smith', h: 8.5, f: '=SUM(A1)', ok: true, e: null }], [
  { header: 'Name', value: (r) => r.n }, { header: 'Hours', value: (r) => r.h }, { header: 'Note', value: (r) => r.f }, { header: 'OK', value: (r) => r.ok }, { header: 'Empty', value: (r) => r.e }]);
check('23 CSV: byte-order mark, CRLF, quoted commas and quotes, numbers unquoted, formulas neutralised', csv.startsWith('﻿Name,Hours,Note,OK,Empty\r\n') && csv.includes('"Ann, ""A"" Smith",8.5,\'=SUM(A1),true,') && csv.endsWith('\r\n'), JSON.stringify(csv));
check('24 durations read well', t.durationText(3 * H + 5 * 60000) === '3h 05m' && t.durationText(45 * 60000) === '45m' && t.clockText(H + 5 * 60000 + 9000) === '1:05:09');

// ── weekly cost: each day at its own saved rate ──
const mixedDays = [
  { workDate: '2026-10-19', clockInAt: '2026-10-19T08:00:00Z', netMs: 8 * H, rate: 20 },
  { workDate: '2026-10-20', clockInAt: '2026-10-20T08:00:00Z', netMs: 8 * H, rate: 20 },
  { workDate: '2026-10-21', clockInAt: '2026-10-21T08:00:00Z', netMs: 8 * H, rate: 25 },
  { workDate: '2026-10-22', clockInAt: '2026-10-22T08:00:00Z', netMs: 8 * H, rate: 25 },
  { workDate: '2026-10-23', clockInAt: '2026-10-23T08:00:00Z', netMs: 8 * H, rate: 25 },
  { workDate: '2026-10-24', clockInAt: '2026-10-24T08:00:00Z', netMs: 8 * H, rate: 25 },
];
const std = { enabled: true, weeklyThresholdHours: 40, multiplier: 1.5 };
check('25 weekly cost prices each day at its own saved rate: 16 h at 20 + 24 h at 25 = 920, plus the 41st-48th hours as overtime at 25 x 1.5 = 300 (one latest rate would say 1300)',
  t.weekPayCostByDay(mixedDays, std) === 1220 && t.weekPayCostByDay(mixedDays.slice().reverse(), std) === 1220, String(t.weekPayCostByDay(mixedDays, std)));
check('26 a day with time but no saved rate makes the week cost unknown (null), never a guess; a day with no time is ignored',
  t.weekPayCostByDay([{ ...mixedDays[0], rate: null }], std) === null && t.weekPayCostByDay([{ ...mixedDays[0], netMs: 0, rate: null }, mixedDays[1]], std) === 160);
check('27 overtime off: every hour is straight time at that day\'s rate (16 x 20 + 32 x 25 = 1120)', t.weekPayCostByDay(mixedDays, { ...std, enabled: false }) === 1120);
check('28 it agrees with the single-rate formula when every day has the same rate', t.weekPayCostByDay(mixedDays.map((d) => ({ ...d, rate: 20 })), std) === t.weekPayCost(t.summarizeWeek('2026-10-19', mixedDays.map((d, i) => ({ workdayId: String(i), workDate: d.workDate, grossMs: d.netMs, recordedBreakMs: 0, deductedBreakMs: 0, netMs: d.netMs, status: 'closed', open: false })), std), 20, 1.5));
console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
