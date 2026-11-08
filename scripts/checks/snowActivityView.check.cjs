// Run: node scripts/checks/snowActivityView.check.cjs <path to typescript package>
// Logic checks for the Snow Activity layout (src/lib/snowActivityView.ts): date ranges, grouping by day,
// folding repetitive runs, and which services an entry is about. Nothing here may hide a record.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../src/lib/snowActivityView.ts'), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(src, { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const { rangeStart, trimToRange, buildView, entryServices, servicesText, runSpan, isFoldable, dayKey } = m.exports;

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };
const at = (day, hh, mm = 0) => new Date(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`).toISOString();
let n = 0;
const ev = (action, day, hh, mm = 0, extra = {}) => ({ id: `e${++n}`, occurredAt: at(day, hh, mm), action, entityType: action.split('.')[0], stormId: 'S1', ...extra });

// ── date ranges ─────────────────────────────────────────────────────────────
const NOW = new Date('2026-02-10T15:30:00');
check('1 all time has no start', rangeStart('all', NOW) === undefined && rangeStart(undefined, NOW) === undefined);
check('2 today starts at local midnight', rangeStart('today', NOW) === at('2026-02-10', 0));
check('3 last 7 days starts 6 days before today (7 calendar days including today)', rangeStart('week', NOW) === at('2026-02-04', 0));
check('4 last 30 days starts 29 days before today', rangeStart('month', NOW) === at('2026-01-12', 0));
const page = [ev('visit.arrived', '2026-02-10', 9), ev('visit.arrived', '2026-02-05', 9), ev('visit.arrived', '2026-02-01', 9)];
let t = trimToRange(page, rangeStart('week', NOW));
check('5 a page is trimmed to the range and reports that the start was reached', t.rows.length === 2 && t.reachedStart === true);
t = trimToRange(page.slice(0, 2), rangeStart('week', NOW));
check('6 a page entirely inside the range keeps everything and keeps paging', t.rows.length === 2 && t.reachedStart === false);
check('7 all time never trims', trimToRange(page, undefined).rows.length === 3);

// ── grouping by day ─────────────────────────────────────────────────────────
const list = [
  ev('storm.dispatched', '2026-02-10', 11),
  ev('visit.completed', '2026-02-10', 10, 30), ev('visit.completed', '2026-02-10', 10, 20), ev('visit.completed', '2026-02-10', 10, 10),
  ev('visit.arrived', '2026-02-10', 10, 5),
  ev('visit.completed', '2026-02-09', 15), ev('visit.completed', '2026-02-09', 14),
  ev('storm.created', '2026-02-09', 9),
];
let view = buildView(list, { group: true, fold: false });
check('8 grouping adds one header per day, newest day first', view.filter((v) => v.type === 'day').map((v) => v.day).join() === '2026-02-10,2026-02-09');
check('9 with folding off every entry is listed on its own', view.filter((v) => v.type === 'event').length === list.length);

// ── folding ──────────────────────────────────────────────────────────────────
view = buildView(list, { group: true, fold: true });
const runs = view.filter((v) => v.type === 'run');
check('10 three similar entries in a row become one expandable run', runs.length === 1 && runs[0].action === 'visit.completed' && runs[0].entries.length === 3);
const shown = view.reduce((c, v) => c + (v.type === 'event' ? 1 : v.type === 'run' ? v.entries.length : 0), 0);
check('11 nothing is hidden: every entry appears once, alone or inside a run', shown === list.length);
check('12 two in a row stay as separate entries (the 9th: two completions)', view.filter((v) => v.type === 'event' && v.entry.action === 'visit.completed').length === 2);
check('13 important events are never folded (storm.dispatched / storm.created stay on their own rows)', view.filter((v) => v.type === 'event' && v.entry.action.startsWith('storm.')).length === 2);
const important = ['storm.created', 'storm.ended', 'route.cancelled', 'route_crew.created', 'route.lead_changed', 'staff.created', 'skip.created', 'media.withdrawn'];
check('14 the foldable list contains only routine actions', important.every((a) => !isFoldable(a)) && isFoldable('visit.arrived') && isFoldable('shift.clocked_in'));
const many = [ev('storm.dispatched', '2026-02-10', 12), ev('storm.ended', '2026-02-10', 11), ev('storm.reopened', '2026-02-10', 10), ev('storm.dispatched', '2026-02-10', 9)];
check('15 even a long run of storm events is never folded', buildView(many, { group: true, fold: true }).every((v) => v.type !== 'run'));
const mixed = [ev('visit.completed', '2026-02-10', 12), ev('visit.completed', '2026-02-10', 11, 30, { stormId: 'S2' }), ev('visit.completed', '2026-02-10', 11), ev('visit.completed', '2026-02-10', 10, 30)];
check('16 a run only joins entries from the same storm', buildView(mixed, { group: true, fold: true }).every((v) => v.type !== 'run'));
const acrossDays = [ev('visit.completed', '2026-02-10', 0, 10), ev('visit.completed', '2026-02-09', 23, 50), ev('visit.completed', '2026-02-09', 23, 40)];
check('17 with day grouping a run does not cross midnight', buildView(acrossDays, { group: true, fold: true }).every((v) => v.type !== 'run'));
check('18 without day grouping, a run can (it is one continuous list)', buildView(acrossDays, { group: false, fold: true }).some((v) => v.type === 'run'));
check('19 an empty log is an empty view', buildView([], { group: true, fold: true }).length === 0);

// ── services ─────────────────────────────────────────────────────────────────
const L = { plowing: 'Plowing', shoveling: 'Shoveling', salting: 'Salting' };
check('20 a route/stop entry shows its one service', entryServices({ service: 'shoveling' }).join() === 'shoveling');
check('21 a multi-service storm entry shows ALL its services, read from the note', entryServices({ note: 'Services: plowing, shoveling, salting' }).join() === 'plowing,shoveling,salting');
check('22 ...or from the recorded list when there is no note', entryServices({ after: { services: ['plowing', 'salting'] } }).join() === 'plowing,salting');
check('23 an entry with no service says nothing', entryServices({}).length === 0);
check('24 the text reads plainly', servicesText(['plowing'], (k) => L[k]) === 'Plowing' && servicesText(['plowing', 'shoveling'], (k) => L[k]) === 'Plowing + Shoveling' && servicesText(['plowing', 'shoveling', 'salting'], (k) => L[k]) === 'Plowing, Shoveling + Salting');
const time = (iso) => iso.slice(11, 16);
check('25 a run\'s span goes from its earliest to its latest entry', runSpan(runs[0].entries, time) === `${time(runs[0].entries[2].occurredAt)} – ${time(runs[0].entries[0].occurredAt)}`);
const snapshot = JSON.stringify(list);
buildView(list, { group: true, fold: true });
check('26 the view never changes the entries it is given', JSON.stringify(list) === snapshot);
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
