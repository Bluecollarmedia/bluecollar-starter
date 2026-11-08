// Run: node scripts/checks/laborReports.check.cjs <path to typescript package>
// Owner reports (src/lib/laborReports.ts): day rows, weekly summary, visit history (elapsed vs crew labor), multi-day project totals,
// billable split, estimate comparison and the CSV exports, all built from the same stored records.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const cache = {};
function load(rel) {
  if (cache[rel]) return cache[rel];
  const m = { exports: {} };
  cache[rel] = m.exports;
  const req = (n) => (n === './timeCalc' ? load('src/lib/timeCalc.ts') : {});
  new Function('module', 'exports', 'require', ts.transpileModule(read(rel), { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText)(m, m.exports, req);
  return (cache[rel] = m.exports);
}
const r = load('src/lib/laborReports.ts');
const c = load('src/lib/timeCalc.ts');
let bad = 0;
const check = (n, ok, detail) => { if (!ok) bad++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (ok ? '' : ' - ' + (detail || ''))); };
const H = 3600000;
const at = (d, h, mi = 0) => `2026-10-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00.000Z`;
const names = { a: 'Ann Adams', b: 'Ben Brown' };

// Monday 19th: Ann 7:30-16:00 with a 30 min unpaid lunch, two visits. Ben 8:00-12:00, one visit sharing Chase with Ann.
const snap = {
  names,
  workdays: [
    { id: 'wa', personId: 'a', workDate: '2026-10-19', clockInAt: at(19, 7, 30), clockOutAt: at(19, 16), status: 'closed', hourlyRate: 20 },
    { id: 'wb', personId: 'b', workDate: '2026-10-19', clockInAt: at(19, 8), clockOutAt: at(19, 12), status: 'approved', hourlyRate: 30 },
  ],
  breaks: [{ id: 'k1', workdayId: 'wa', startedAt: at(19, 12), endedAt: at(19, 12, 30), paid: false }],
  visits: [
    { id: 'v1', label: 'Chase', status: 'completed', billable: true, visitDate: '2026-10-19', source: 'maintenance_stop', targetMinutes: 120 },
    { id: 'v2', label: 'Focus', status: 'completed', billable: false, visitDate: '2026-10-19', source: 'maintenance_stop' },
  ],
  intervals: [
    { id: 'i1', visitId: 'v1', workdayId: 'wa', personId: 'a', startedAt: at(19, 8, 15), endedAt: at(19, 10, 15), status: 'completed', billable: true, hourlyRate: 20 },
    { id: 'i2', visitId: 'v1', workdayId: 'wb', personId: 'b', startedAt: at(19, 8, 15), endedAt: at(19, 10, 15), status: 'completed', billable: true, hourlyRate: 30 },
    { id: 'i3', visitId: 'v2', workdayId: 'wa', personId: 'a', startedAt: at(19, 10, 35), endedAt: at(19, 11, 35), status: 'completed', billable: false, hourlyRate: 20 },
  ],
};
const now = Date.parse(at(20, 9));
const rows = r.dayRows(snap, now);
const ann = rows.find((x) => x.workday.personId === 'a');
check('1 a day row: gross 8.5, unpaid break deducted, net 8.0; property labor kept separate (3 h)', ann.summary.grossMs === 8.5 * H && ann.summary.netMs === 8 * H && ann.propertyLaborMs === 3 * H && ann.state === 'ready');
check('2 payable cost = net hours x the rate saved with the day (8 x 20 = 160)', ann.payableCost === 160);
check('3 the approved day shows as approved', rows.find((x) => x.workday.personId === 'b').state === 'approved');

const vr = r.visitRows(snap.visits, snap.intervals, names, now);
const chase = vr.find((x) => x.visit.label === 'Chase');
check('4 Chase: 2-hour visit, 4 crew labor-hours, each employee listed with their own cost (Ann 40, Ben 60)', chase.elapsedMs === 2 * H && chase.laborMs === 4 * H && chase.employees.length === 2 && chase.laborCost === 100
  && chase.employees.find((e) => e.name === 'Ann Adams').cost === 40 && chase.employees.find((e) => e.name === 'Ben Brown').cost === 60, JSON.stringify(chase.employees));
const focus = vr.find((x) => x.visit.label === 'Focus');
check('5 a non-billable visit keeps its labor but lands in the non-billable cost, not the billable cost', focus.laborMs === H && focus.billableCost === 0 && focus.nonBillableCost === 20 && chase.billableCost === 100);

const week = r.weekRows(snap, '2026-10-19', () => ({ enabled: true, weeklyThresholdHours: 5, multiplier: 1.5 }), now);
const annW = week.find((x) => x.personId === 'a');
check('6 the weekly summary: net 8 h with a 5 h threshold = 5 regular + 3 overtime; cost 5 x 20 + 3 x 20 x 1.5 = 190; basis stated',
  annW.week.netMs === 8 * H && annW.week.regularMs === 5 * H && annW.week.overtimeMs === 3 * H && annW.payCost === 190 && /over 5/.test(annW.week.basis));
check('7 a day in another week is not in this week', r.weekRows({ ...snap, workdays: [{ ...snap.workdays[0], workDate: '2026-10-26' }] }, '2026-10-19', undefined, now).length === 0);

// Multi-day project: Mon 5, Tue 6.5, Wed 3 crew labor-hours (as in the brief)
const pv = [
  { id: 'p1', label: 'Patio', status: 'completed', billable: true, visitDate: '2026-10-19', source: 'project_day', projectId: 'P' },
  { id: 'p2', label: 'Patio', status: 'completed', billable: true, visitDate: '2026-10-20', source: 'project_day', projectId: 'P' },
  { id: 'p3', label: 'Patio', status: 'completed', billable: false, visitDate: '2026-10-21', source: 'project_day', projectId: 'P' },
];
const iv = [
  { id: 'a1', visitId: 'p1', workdayId: 'x', personId: 'a', startedAt: at(19, 8), endedAt: at(19, 10, 30), status: 'completed', billable: true, hourlyRate: 20 },
  { id: 'a2', visitId: 'p1', workdayId: 'y', personId: 'b', startedAt: at(19, 8), endedAt: at(19, 10, 30), status: 'completed', billable: true, hourlyRate: 30 },
  { id: 'a3', visitId: 'p2', workdayId: 'x', personId: 'a', startedAt: at(20, 8), endedAt: at(20, 11, 15), status: 'completed', billable: true, hourlyRate: 20 },
  { id: 'a4', visitId: 'p2', workdayId: 'y', personId: 'b', startedAt: at(20, 8), endedAt: at(20, 11, 15), status: 'completed', billable: true, hourlyRate: 30 },
  { id: 'a5', visitId: 'p3', workdayId: 'x', personId: 'a', startedAt: at(21, 8), endedAt: at(21, 11), status: 'completed', billable: false, hourlyRate: 20 },
  { id: 'a6', visitId: 'p3', workdayId: 'x', personId: 'a', startedAt: at(21, 12), endedAt: at(21, 12, 30), status: 'void', billable: false, hourlyRate: 20 },
];
const prow = r.visitRows(pv, iv, names, now);
const pt = r.projectTotals(prow, iv, names, now);
check('8 a 3-day project keeps three visits and totals 14.5 crew labor-hours (5.0 + 6.5 + 3.0), voided time excluded', pt.visits === 3 && pt.laborMs === 14.5 * H, String(pt.laborMs / H));
check('9 billable and non-billable are split (11.5 h billable, 3 h non-billable); labor by employee adds up to the total',
  pt.billableLaborMs === 11.5 * H && pt.nonBillableLaborMs === 3 * H && pt.byEmployee.reduce((t, e) => t + e.ms, 0) === pt.laborMs);
check('10 total labor cost = sum of each interval x its own saved rate (Ann 8.75 h x 20 + Ben 5.75 h x 30 = 347.50)', pt.cost === 347.5, String(pt.cost));
check('11 first and last visit dates', pt.firstDate === '2026-10-19' && pt.lastDate === '2026-10-21');
const est = r.estimateComparison(pt.laborMs, 12);
check('12 estimate vs actual in the same unit: 12 h estimated, 14.5 h actual = 2.5 h over; no estimate = no comparison', est.over && est.diffHours === 2.5 && r.estimateComparison(pt.laborMs, null) === null);

const dayCsv = r.dailyCsv(rows);
check('13 the daily CSV has the right columns, ISO times and numeric hours', dayCsv.startsWith('﻿Employee,Work date,Clock in (UTC),Clock out (UTC),Gross workday hours,Recorded break hours,Break hours deducted,Net payable hours,Property labor hours,Hourly rate,Payable cost (straight time),Status,Approved at (UTC),Needs review\r\n')
  && dayCsv.includes('Ann Adams,2026-10-19,2026-10-19T07:30:00.000Z,2026-10-19T16:00:00.000Z,8.50,0.50,0.50,8.00,3.00,20.00,160.00,ready'), dayCsv.split('\r\n')[1]);
const wkCsv = r.weeklyCsv(week);
check('14 the weekly CSV carries regular, overtime, basis and cost', wkCsv.includes('Regular hours') && wkCsv.includes('5.00,3.00,Overtime = net payable hours over 5 in the week at 1.5x'.replace(' in the week at', ' in the week, at')) || /5\.00,3\.00,"?Overtime = net payable hours over 5/.test(wkCsv), wkCsv.split('\r\n')[1]);
const vCsv = r.visitsCsv(vr);
check('15 the visit CSV keeps elapsed hours and crew labor hours in separate columns', vCsv.includes('Elapsed visit hours,Crew labor hours') && vCsv.includes('Chase,2026-10-19,completed,true') && /,2\.00,4\.00,120,/.test(vCsv), vCsv.split('\r\n')[1]);

const mixSnap = { workdays: [
  { id: 'm1', personId: 'c', workDate: '2026-10-19', clockInAt: at(19, 8), clockOutAt: at(19, 16), status: 'closed', hourlyRate: 20 },
  { id: 'm2', personId: 'c', workDate: '2026-10-20', clockInAt: at(20, 8), clockOutAt: at(20, 16), status: 'closed', hourlyRate: 30 }], breaks: [], visits: [], intervals: [], names: { c: 'Cy Cole' } };
const mixW = r.weekRows(mixSnap, '2026-10-19', undefined, now)[0];
check('16 a raise in the middle of the week: each day is priced at its own saved rate (8 x 20 + 8 x 30 = 400, not 16 x 30 = 480) and the row says the rate changed',
  mixW.payCost === 400 && mixW.rateChanged === true && mixW.rate === 30, JSON.stringify(mixW.payCost));
const blankSnap = { ...mixSnap, workdays: [mixSnap.workdays[0], { ...mixSnap.workdays[1], hourlyRate: null }] };
check('17 a day recorded before any rate existed makes the week cost "no rate" (null) instead of pricing it at another day\'s rate', r.weekRows(blankSnap, '2026-10-19', undefined, now)[0].payCost === null);
console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
