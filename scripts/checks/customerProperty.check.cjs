// Run: node scripts/checks/customerProperty.check.cjs <path to typescript package>
// The property-first customer home: grouping, which tab opens first, years, visit stats and wording.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const compile = (src, req = () => ({})) => {
  const m = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', esModuleInterop: true } }).outputText)(m, m.exports, req);
  return m.exports;
};
const lib = compile(read('src/lib/customerProperty.ts'));
let bad = 0;
let n = 0;
const check = (name, ok, detail = '') => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}${ok ? '' : '  - ' + detail}`); };

const item = (kind, id, name, key, status = 'active', extra = {}) => ({ key: `${kind}:${id}`, kind, typeLabel: kind, name, address: key ? `${key}, Springfield MA` : '', propertyKey: key, status, ...extra });
const lawn = item('maintenance', 'm1', 'Hillcrest Lane', '14 hillcrest ln');
const proj = item('project', 'p1', 'Back Patio', '14 hillcrest ln');
const other = item('maintenance', 'm2', 'Riverside Plaza', '410 river rd');
const done = item('project', 'p9', 'Old Wall', '14 hillcrest ln', 'completed', { completedAt: '2026-05-01' });

const groups = lib.groupProperties([lawn, proj, other, done]);
check('1 same street is one property, a different street is another', groups.length === 2, JSON.stringify(groups.map((g) => g.key)));
const hill = groups.find((g) => g.key === '14 hillcrest ln');
check('2 the two kinds become tabs in a fixed order: Lawn, Project', hill.services.join() === 'lawn,project');
check('3 a lawn-only property has one tab only (so no switch is drawn)', groups.find((g) => g.key === '410 river rd').services.join() === 'lawn');
check('4 a lawn name names the property, not the project', hill.name === 'Hillcrest Lane');
check('5 only projects: one project names it, two projects use the street', lib.groupProperties([proj])[0].name === 'Back Patio' && lib.groupProperties([proj, item('project', 'p2', 'Fire Pit', '14 hillcrest ln')])[0].name === '14 hillcrest ln');
check('6 completed projects are never a property; they go to Past work, newest first', !groups.some((g) => g.items.includes(done)) && lib.pastWork([done, item('project', 'p8', 'Older', 'x', 'completed', { completedAt: '2025-01-01' })])[0].name === 'Old Wall');
check('7 an item with no address stays on its own', lib.groupProperties([item('project', 'a', 'A', ''), item('project', 'b', 'B', '')]).length === 2);
check('8 sorted by name', lib.sortGroups([lib.groupProperties([item('project', 'z', 'Zed', 'zed st')])[0], groups[1], groups[0]]).map((g) => g.name).join() === 'Hillcrest Lane,Riverside Plaza,Zed');
check('9 a property opens on Lawn, then Project', lib.defaultService(hill) === 'lawn' && lib.defaultService({ ...hill, services: ['project'] }) === 'project');

// years: a lawn season is the calendar year
check('10 the season is the calendar year', lib.seasonKey('2027-01-14T12:00:00') === '2027' && lib.seasonKey('2026-12-31T12:00:00') === '2026' && lib.seasonLabel('2026') === '2026');
const visits = [
  { id: 'a', completedAt: '2026-10-28T06:40:00', arrivedAt: '2026-10-28T06:05:00', photos: 5, title: 'Mowing' },
  { id: 'b', completedAt: '2026-11-14T18:10:00', photos: 2, title: 'Cleanup' },
  { id: 'c', completedAt: '2025-03-02T07:00:00', photos: 3, title: 'Mowing' },
];
check('11 years list newest first and always include the current one', lib.seasonsOf(visits, new Date('2026-11-01T00:00:00')).join() === '2026,2025' && lib.seasonsOf([], new Date('2026-11-01T00:00:00')).join() === '2026');
const st = lib.visitStats(visits, '2026');
check('12 stats count that year only: 2 visits, 7 photos, newest as "last"', st.visits === 2 && st.photos === 7 && st.lastAt === '2026-11-14T18:10:00', JSON.stringify(st));
check('13 visits in a year are newest first', lib.visitsIn(visits, '2026').map((v) => v.id).join() === 'b,a');
check('14 an empty year gives zeros and no "last"', lib.visitStats(visits, '2030').visits === 0 && lib.visitStats(visits, '2030').lastAt === undefined);
check('15 times: arrival and finish on the same day shows both', /Arrived 6:05 AM .* Left 6:40 AM/.test(lib.visitTimes(visits[0])), lib.visitTimes(visits[0]));
check('16 times: no arrival recorded shows only the finish', lib.visitTimes(visits[1]) === 'Finished 6:10 PM', lib.visitTimes(visits[1]));
check('17 times: an arrival after the finish (bad data) is ignored', lib.visitTimes({ arrivedAt: '2026-10-28T07:00:00', completedAt: '2026-10-28T06:40:00' }) === 'Finished 6:40 AM');
const now = new Date(2026, 9, 28, 9, 0);
check('18 next visit words: Today, Tomorrow, then weekday and date (Oct 30 2026 is a Friday)', lib.nextVisitLabel('2026-10-28', now) === 'Today' && lib.nextVisitLabel('2026-10-29', now) === 'Tomorrow' && lib.nextVisitLabel('2026-10-30', now) === 'Friday, Oct 30', lib.nextVisitLabel('2026-10-30', now));
check('19 words can be translated', lib.visitTimes(visits[1], (t, v) => `ES:${t.replace('{b}', v.b)}`) === 'ES:Finished 6:10 PM');

// visits belonging to a property
const lawnUp = [
  { stopId: 'l1', propertyId: 'm1', propertyName: 'Hillcrest Lane', arrivedAt: '2026-10-23T08:00:00', completedAt: '2026-10-23T09:00:00', services: 'Edging, Mowing', photos: [1, 2, 3] },
  { stopId: 'l2', propertyName: 'Hillcrest Lane', completedAt: '2026-10-16T09:00:00', photos: [] },
  { stopId: 'l3', propertyId: 'm9', propertyName: 'Other Place', completedAt: '2026-10-16T09:00:00', photos: [] },
];
const lv = lib.lawnVisits(lawnUp, hill);
check('20 lawn visits: by property id or (no id) by name; a visit with no services is called "Lawn visit"; photos are counted', lv.map((v) => v.id).sort().join() === 'l1,l2' && lv.find((v) => v.id === 'l1').photos === 3 && lv.find((v) => v.id === 'l2').title === 'Lawn visit', JSON.stringify(lv));
check('21 a property with only projects has no lawn visits', lib.lawnVisits(lawnUp, lib.groupProperties([item('project', 'q', 'Q', 'q st')])[0]).length === 0);

console.log(bad ? `\n${bad} of ${n} FAILED` : `\nAll ${n} passed`);
process.exit(bad ? 1 : 0);
