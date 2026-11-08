// Run: node scripts/checks/maintenanceSetVisits.check.cjs <path to typescript package>
// "A set number of visits this season" for a maintenance service: the even spreading, what is due next, and the wiring.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const cache = {};
function load(rel) {
  if (cache[rel]) return cache[rel];
  const m = { exports: {} };
  cache[rel] = m.exports;
  const req = (name) => (name === './recurrence' ? load('src/lib/recurrence.ts') : name === './ids' ? load('src/lib/ids.ts') : name === './serviceDates' ? load('src/lib/serviceDates.ts') : {});
  new Function('module', 'exports', 'require', ts.transpileModule(read(rel), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports, req);
  return (cache[rel] = m.exports);
}
const sd = load('src/lib/serviceDates.ts');
const ms = load('src/lib/maintenanceSchedule.ts');
let bad = 0;
const check = (n, ok, detail) => { if (!ok) bad++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (ok ? '' : ' - ' + (detail || ''))); };

const six = sd.spreadDates('2026-07-19', '2026-10-19', 6);
check('1 six visits across July 19 to October 19 start on the first day, end on the last, and are evenly spaced', six.length === 6 && six[0] === '2026-07-19' && six[5] === '2026-10-19' && six.join() === '2026-07-19,2026-08-06,2026-08-25,2026-09-12,2026-10-01,2026-10-19', six.join());
check('2 one visit lands on the first day; two land on the first and last', sd.spreadDates('2026-07-19', '2026-10-19', 1).join() === '2026-07-19' && sd.spreadDates('2026-07-19', '2026-10-19', 2).join() === '2026-07-19,2026-10-19');
check('3 ten visits are ten different days in order', (() => { const t = sd.spreadDates('2026-04-01', '2026-11-30', 10); return t.length === 10 && t.every((k, i) => i === 0 || k > t[i - 1]); })());
check('4 bad input gives no dates, never a guess (missing, backwards, zero, too many, not a real date)', sd.spreadDates(undefined, '2026-10-19', 5).length === 0 && sd.spreadDates('2026-10-19', '2026-07-19', 5).length === 0 && sd.spreadDates('2026-07-19', '2026-10-19', 0).length === 0 && sd.spreadDates('2026-07-19', '2026-10-19', 400).length === 0 && sd.spreadDates('2026-02-31', '2026-10-19', 3).length === 0);
check('5 more visits than days in the span never books two on one day', (() => { const t = sd.spreadDates('2026-07-19', '2026-07-21', 8); return t.length === 3 && t.join() === '2026-07-19,2026-07-20,2026-07-21'; })());
check('6 saved dates are cleaned: no repeats, no junk, oldest first', sd.cleanDates(['2026-09-01', '2026-08-01', '2026-09-01', 'nope', 5, '2026-13-40']).join() === '2026-08-01,2026-09-01');

const rule = { id: 'r1', isActive: true, frequency: 'fixed_dates', scheduledDates: six, seasonQuantity: 6, priorCompletedCount: 0 };
const contract = { status: 'active' };
const due = (onDate, history = [], over = {}) => ms.serviceDue({ ...rule, ...over }, contract, { isActive: true }, history, { onDate });
const doneOn = (d) => ({ completed: true, completedAt: d + 'T15:00:00' });
check('7 before the first date the first visit is upcoming; on the day it is due; after it, overdue by the days late',
  due('2026-07-10').status === 'upcoming' && due('2026-07-10').dueDate === '2026-07-19' && due('2026-07-19').status === 'due' && due('2026-07-22').status === 'overdue' && due('2026-07-22').daysOverdue === 3);
check('8 after a visit is done the next saved date is the one that is due', due('2026-07-25', [doneOn('2026-07-19')]).dueDate === '2026-08-06' && due('2026-07-25', [doneOn('2026-07-19')]).status === 'upcoming');
check('9 visits done before the app tracked them count toward the dates', due('2026-07-25', [], { priorCompletedCount: 2 }).dueDate === '2026-08-25');
check('10 when every set visit is done the service is done for the season, with none remaining', (() => { const r = due('2026-10-25', six.map(doneOn)); return r.status === 'done_for_season' && r.remainingCount === 0; })());
check('11 a set-visits service with no dates says "not set" instead of guessing', due('2026-07-25', [], { scheduledDates: [] }).status === 'not_configured');
check('12 the label reads well', ms.frequencyLabel(rule) === '6 visits · Jul 19, Aug 6, Aug 25 +3 more' && ms.frequencyLabel({ frequency: 'fixed_dates', scheduledDates: [] }) === 'Visit dates not set', ms.frequencyLabel(rule));
check('13 the older kinds still work: every 14 days from the first service', (() => { const r = ms.serviceDue({ id: 'r2', isActive: true, frequency: 'every_n_days', intervalDays: 14, startsOn: '2026-07-19', priorCompletedCount: 0 }, contract, { isActive: true }, [], { onDate: '2026-07-19' }); return r.status === 'due'; })());

const editor = read('app/(owner)/maintenance-property-edit.tsx');
const addScreen = read('app/(owner)/maintenance-service-add.tsx');
const draftLib = read('src/lib/maintenanceServiceDraft.ts');
check('14 the Add Service screen offers "Set number of visits", spreads from the season dates, and lets any single date be changed, added or removed',
  /key: 'fixed_dates', label: 'Set number of visits'/.test(draftLib) && /spreadForDraft\(next, seasonStart, seasonEnd\)/.test(addScreen) && /Add a date/.test(addScreen) && /Remove visit/.test(addScreen));
check('15 saving keeps the exact dates and sets the count from them', /scheduledDates/.test(draftLib) && /seasonQuantity: String\(dates\.length\)/.test(addScreen));
const data = read('src/data/maintenance.ts');
check('16 saving refuses a set-visits service with no dates, and the store carries the dates', /Add at least one visit date/.test(data) && /'scheduledDates'/.test(read('src/data/store.ts')) && fs.existsSync(path.join(__dirname, '../../supabase/updates/059_maintenance_set_visits.sql')));
console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
