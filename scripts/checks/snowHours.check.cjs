// Run: node scripts/checks/snowHours.check.cjs <path to typescript package>
// Logic checks for the owner Snow hours screen (src/lib/snowHours.ts).
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../src/lib/snowHours.ts'), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(src, { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const { filterShifts, groupByWorkerDay, isShortShift, shiftMs, dayKeyOf, weekStartDay, addDays, countUntaggedDuring } = m.exports;

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };

// Local-time timestamps so the day grouping is the same in any time zone.
const at = (day, hh, mm = 0) => new Date(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`).toISOString();
const NOW = new Date('2026-02-10T12:00:00').getTime();
let n = 0;
const shift = (personId, day, inH, outH, extra = {}, inM = 0, outM = 0) => ({
  id: `s${++n}`, personId, clockInAt: at(day, inH, inM), clockOutAt: outH == null ? undefined : at(day, outH, outM), corrected: false, ...extra,
});

const shifts = [
  shift('ann', '2026-02-09', 6, 10),            // 4h
  shift('ann', '2026-02-09', 13, 15),           // 2h, same day (separate legit shift)
  shift('ann', '2026-02-08', 7, 9),             // 2h
  shift('bob', '2026-02-09', 6, 8),             // 2h
  shift('bob', '2026-02-09', 9, 9, {}, 0, 2),   // 2 minutes: short, accidental-looking
  shift('bob', '2026-02-10', 8, null),          // still clocked in (open)
  shift('cy', '2026-02-09', 9, 9, { corrected: true }, 0, 1), // 1 minute but already corrected
];
const before = JSON.stringify(shifts);

check('1 short shift is flagged (finished, under 5 min, not corrected)', isShortShift(shifts[4]));
check('2 normal shift is not flagged', !isShortShift(shifts[0]));
check('3 an open shift is never flagged', !isShortShift(shifts[5]));
check('4 an owner-corrected short shift is not flagged again', !isShortShift(shifts[6]));
check('5 a 4 minute shift is flagged but 5 minutes is not', isShortShift(shift('x', '2026-02-09', 9, 9, {}, 0, 4)) && !isShortShift(shift('x', '2026-02-09', 9, 9, {}, 0, 5)));

check('6 worker filter keeps only that worker', filterShifts(shifts, { personId: 'ann' }, NOW).length === 3);
const day = filterShifts(shifts, { fromDay: '2026-02-09', toDay: '2026-02-09' }, NOW);
check('7 date filter is inclusive and by day started', day.length === 5, `got ${day.length}`);
check('8 date filter excludes days outside the range', filterShifts(shifts, { fromDay: '2026-02-10', toDay: '2026-02-10' }, NOW).length === 1);

const win = filterShifts(shifts, { window: { start: at('2026-02-09', 8, 30), end: at('2026-02-09', 12) } }, NOW);
check('9 storm window keeps shifts that overlap it (ann 6-10 overlaps, bob 6-8 does not)',
  win.some((s) => s.personId === 'ann' && s.clockInAt === at('2026-02-09', 6)) && !win.some((s) => s.personId === 'bob' && s.clockOutAt === at('2026-02-09', 8)), JSON.stringify(win.map((s) => s.id)));
const openWin = filterShifts(shifts, { window: { start: at('2026-02-10', 7) } }, NOW);
check('10 a storm still going counts an open shift', openWin.some((s) => !s.clockOutAt));
check('11 needs-review filter keeps only the flagged shift', filterShifts(shifts, { onlyNeedsReview: true }, NOW).length === 1);

const groups = groupByWorkerDay(shifts, (id) => id.toUpperCase(), NOW);
const ann = groups.find((g) => g.personId === 'ann');
check('12 grouped by worker, most hours first', groups[0].personId === 'ann');
check('13 worker total adds all their shifts (ann = 8h)', Math.round(ann.ms / 3_600_000) === 8);
check('14 days newest first with their own totals (9th = 6h, 8th = 2h)', ann.days[0].dayKey === '2026-02-09' && Math.round(ann.days[0].ms / 3_600_000) === 6 && Math.round(ann.days[1].ms / 3_600_000) === 2);
check('15 two shifts on one day stay two shifts (not merged), in time order', ann.days[0].shifts.length === 2 && ann.days[0].shifts[0].clockInAt < ann.days[0].shifts[1].clockInAt);
const bob = groups.find((g) => g.personId === 'bob');
check('16 the open shift counts up to now (bob: 2h + 2min + 4h on the 10th)', Math.round(bob.ms / 60_000) === 120 + 2 + 240);
check('17 review counts roll up to the day and the worker', bob.needsReview === 1 && bob.days.find((d) => d.dayKey === '2026-02-09').needsReview === 1);
check('18 recorded times are never changed by filtering or grouping', JSON.stringify(shifts) === before);
check('19 weekStartDay is a Monday', new Date(`${weekStartDay(new Date('2026-02-11T10:00:00'))}T00:00:00`).getDay() === 1 && weekStartDay(new Date('2026-02-11T10:00:00')) === '2026-02-09');
check('20 addDays crosses month ends', addDays('2026-02-28', 1) === '2026-03-01' && addDays('2026-03-01', -1) === '2026-02-28');

// ── Storm tags (update 42) ──────────────────────────────────────────────────
const stormA = 'storm-A', stormB = 'storm-B';
const tagWin = { start: at('2026-02-09', 5), end: at('2026-02-09', 20) };
const tagged = [
  shift('ann', '2026-02-09', 6, 10, { stormId: stormA }),   // tagged to A
  shift('bob', '2026-02-09', 7, 9, { stormId: stormB }),    // tagged to B, overlaps A's window
  shift('cy', '2026-02-09', 8, 9),                          // untagged, inside the window
  shift('cy', '2026-02-12', 8, 9),                          // untagged, outside the window
  shift('dee', '2026-02-09', 11, 12, { stormId: stormA }),  // tagged to A
];
const beforeTags = JSON.stringify(tagged);
let tr = filterShifts(tagged, { stormId: stormA, window: tagWin }, NOW);
check('21 the storm filter shows only shifts TAGGED to that storm', tr.length === 2 && tr.every((x) => x.stormId === stormA), JSON.stringify(tr.map((x) => x.id)));
tr = filterShifts(tagged, { stormId: stormA, window: tagWin, includeUntagged: true }, NOW);
check('22 "include untagged" adds untagged shifts that overlapped the storm, and nothing else', tr.length === 3 && tr.filter((x) => !x.stormId).length === 1 && tr.find((x) => !x.stormId).personId === 'cy', JSON.stringify(tr.map((x) => [x.personId, x.stormId])));
check('23 a shift tagged to ANOTHER storm is never shown, even when the times overlap', !tr.some((x) => x.stormId === stormB));
check('24 untagged shifts outside the storm\'s time are not added', tr.every((x) => !(x.personId === 'cy' && new Date(x.clockInAt).getDate() === 12)));
check('25 the untagged count only counts overlapping untagged shifts', countUntaggedDuring(tagged, tagWin, undefined, NOW) === 1 && countUntaggedDuring(tagged, tagWin, 'ann', NOW) === 0 && countUntaggedDuring(tagged, tagWin, 'cy', NOW) === 1);
check('26 a storm with no tags at all shows nothing until untagged are included (old data stays visible on request)', filterShifts(shifts, { stormId: 'none', window: tagWin }, NOW).length === 0 && filterShifts(shifts, { stormId: 'none', window: tagWin, includeUntagged: true }, NOW).length > 0);
check('27 with a worker filter the tag filter still narrows to that worker', filterShifts(tagged, { stormId: stormA, personId: 'dee', window: tagWin }, NOW).length === 1);
check('28 recorded times and tags are never changed by filtering', JSON.stringify(tagged) === beforeTags);
check('29 without a storm, the old window filter works exactly as before', filterShifts(shifts, { window: { start: at('2026-02-09', 8, 30), end: at('2026-02-09', 12) } }, NOW).some((x) => x.personId === 'ann'));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
