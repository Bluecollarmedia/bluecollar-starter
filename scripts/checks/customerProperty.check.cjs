// Run: node scripts/checks/customerProperty.check.cjs <path to typescript package>
// The property-first customer home: grouping, which tab opens first, seasons, visit stats and wording.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const compile = (src, req = () => ({})) => {
  const m = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', esModuleInterop: true } }).outputText)(m, m.exports, req);
  return m.exports;
};
const snowLib = compile(read('src/lib/customerSnow.ts'));
const lib = compile(read('src/lib/customerProperty.ts'), (name) => (name === './customerSnow' ? snowLib : {}));
let bad = 0;
let n = 0;
const check = (name, ok, detail = '') => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}${ok ? '' : '  - ' + detail}`); };

const item = (kind, id, name, key, status = 'active', extra = {}) => ({ key: `${kind}:${id}`, kind, typeLabel: kind, name, address: key ? `${key}, Springfield MA` : '', propertyKey: key, status, ...extra });
const snow = item('snow', 's1', 'Hillcrest Lane', '14 hillcrest ln');
const lawn = item('maintenance', 'm1', 'Hillcrest Lane', '14 hillcrest ln');
const proj = item('project', 'p1', 'Back Patio', '14 hillcrest ln');
const other = item('snow', 's2', 'Riverside Plaza', '410 river rd');
const done = item('project', 'p9', 'Old Wall', '14 hillcrest ln', 'completed', { completedAt: '2026-05-01' });

const groups = lib.groupProperties([snow, lawn, proj, other, done]);
check('1 same street is one property, a different street is another', groups.length === 2, JSON.stringify(groups.map((g) => g.key)));
const hill = groups.find((g) => g.key === '14 hillcrest ln');
check('2 the three kinds become tabs in a fixed order: Snow, Lawn, Project', hill.services.join() === 'snow,lawn,project');
check('3 a snow-only property has one tab only (so no switch is drawn)', groups.find((g) => g.key === '410 river rd').services.join() === 'snow');
check('4 a lawn or snow name names the property, not the project', hill.name === 'Hillcrest Lane');
check('5 only projects: one project names it, two projects use the street', lib.groupProperties([proj])[0].name === 'Back Patio' && lib.groupProperties([proj, item('project', 'p2', 'Fire Pit', '14 hillcrest ln')])[0].name === '14 hillcrest ln');
check('6 completed projects are never a property; they go to Past work, newest first', !groups.some((g) => g.items.includes(done)) && lib.pastWork([done, item('project', 'p8', 'Older', 'x', 'completed', { completedAt: '2025-01-01' })])[0].name === 'Old Wall');
check('7 an item with no address stays on its own', lib.groupProperties([item('project', 'a', 'A', ''), item('project', 'b', 'B', '')]).length === 2);

const statuses = [{ propertyId: 's1', state: 'on_site' }, { propertyId: 's2', state: 'scheduled' }];
check('8 a crew on site is "on_site", a crew assigned is "scheduled", otherwise "none"', lib.attentionOf(hill, statuses) === 'on_site' && lib.attentionOf(groups.find((g) => g.key === '410 river rd'), statuses) === 'scheduled' && lib.attentionOf(hill, []) === 'none');
check('9 a property whose only snow is in a storm is not "on site" because of another property', lib.attentionOf(hill, [{ propertyId: 's2', state: 'on_site' }]) === 'none');
check('10 sorted: crew on site, then waiting, then the rest by name', lib.sortGroups([groups[1], groups[0], lib.groupProperties([item('project', 'z', 'Zed', 'zed st')])[0]], statuses).map((g) => g.key).join() === '14 hillcrest ln,410 river rd,zed st', lib.sortGroups(groups, statuses).map((g) => g.key).join());
check('11 during a storm a snow property opens on Snow', lib.defaultService(hill, 'on_site') === 'snow' && lib.defaultService(hill, 'scheduled') === 'snow');
check('12 with no storm it opens on Lawn, then Project, then Snow', lib.defaultService(hill, 'none') === 'lawn' && lib.defaultService({ ...hill, services: ['snow', 'project'] }, 'none') === 'project' && lib.defaultService({ ...hill, services: ['snow'] }, 'none') === 'snow');
check('13 a storm does not force Snow on a property that has no snow', lib.defaultService({ ...hill, services: ['lawn'] }, 'on_site') === 'lawn');

// seasons: snow seasons start Oct 1, lawn is the calendar year
check('14 snow season: Oct 2026 and Jan 2027 are the same season, Sep 2026 is the one before', lib.seasonKey('2026-10-02T12:00:00', 'snow') === '2026' && lib.seasonKey('2027-01-14T12:00:00', 'snow') === '2026' && lib.seasonKey('2026-09-30T12:00:00', 'snow') === '2025');
check('15 lawn season is the calendar year', lib.seasonKey('2027-01-14T12:00:00', 'lawn') === '2027');
check('16 labels: 2026–27 for snow, 2026 for lawn', lib.seasonLabel('2026', 'snow') === '2026–27' && lib.seasonLabel('2026', 'lawn') === '2026');
const visits = [
  { id: 'a', completedAt: '2026-10-28T06:40:00', arrivedAt: '2026-10-28T06:05:00', photos: 5, title: 'Plowed' },
  { id: 'b', completedAt: '2027-01-14T18:10:00', photos: 2, title: 'Salted' },
  { id: 'c', completedAt: '2026-03-02T07:00:00', photos: 3, title: 'Plowed' },
];
check('17 seasons list newest first and always include the current one', lib.seasonsOf(visits, 'snow', new Date('2026-11-01T00:00:00')).join() === '2026,2025' && lib.seasonsOf([], 'snow', new Date('2026-11-01T00:00:00')).join() === '2026');
const st = lib.visitStats(visits, 'snow', '2026');
check('18 stats count that season only: 2 visits, 7 photos, newest as "last"', st.visits === 2 && st.photos === 7 && st.lastAt === '2027-01-14T18:10:00', JSON.stringify(st));
check('19 visits in a season are newest first', lib.visitsIn(visits, 'snow', '2026').map((v) => v.id).join() === 'b,a');
check('20 an empty season gives zeros and no "last"', lib.visitStats(visits, 'snow', '2030').visits === 0 && lib.visitStats(visits, 'snow', '2030').lastAt === undefined);
check('21 times: arrival and finish on the same day shows both', /Arrived 6:05 AM .* Left 6:40 AM/.test(lib.visitTimes(visits[0])), lib.visitTimes(visits[0]));
check('22 times: no arrival recorded shows only the finish', lib.visitTimes(visits[1]) === 'Finished 6:10 PM', lib.visitTimes(visits[1]));
check('23 times: an arrival after the finish (bad data) is ignored', lib.visitTimes({ arrivedAt: '2026-10-28T07:00:00', completedAt: '2026-10-28T06:40:00' }) === 'Finished 6:40 AM');
const now = new Date(2026, 9, 28, 9, 0);
check('24 next visit words: Today, Tomorrow, then weekday and date (Oct 30 2026 is a Friday)', lib.nextVisitLabel('2026-10-28', now) === 'Today' && lib.nextVisitLabel('2026-10-29', now) === 'Tomorrow' && lib.nextVisitLabel('2026-10-30', now) === 'Friday, Oct 30', lib.nextVisitLabel('2026-10-30', now));
check('25 words can be translated', lib.visitTimes(visits[1], (t) => `ES:${t}`) === 'ES:Finished {b}'.replace('{b}', '6:10 PM') || lib.visitTimes(visits[1], (t, v) => `ES:${t.replace('{b}', v.b)}`) === 'ES:Finished 6:10 PM');

// visits belonging to a property
const entries = [
  { visitId: 'v1', propertyId: 's1', propertyName: 'Hillcrest Lane', service: 'plowing', arrivedAt: '2026-10-28T06:05:00', completedAt: '2026-10-28T06:40:00', media: [{ id: 'm1', kind: 'photo' }, { id: 'm2', kind: 'video' }] },
  { visitId: 'v2', propertyId: 's2', propertyName: 'Riverside Plaza', service: 'salting', completedAt: '2026-10-28T07:00:00', media: [] },
  { visitId: 'v3', propertyId: ' hillcrest lane ', propertyName: ' hillcrest lane ', service: 'salting', completedAt: '2026-01-14T18:10:00', media: [{ id: 'm3', kind: 'photo' }] },
  { visitId: 'v4', propertyId: 's9', propertyName: 'HILLCREST LANE', service: 'salting', completedAt: '2026-01-15T18:10:00', media: [] },
];
const sv = lib.snowVisits(entries, hill);
check('26 snow visits for a property: matched by id, or by name only on an older database (no ids); a different property with the same name is left out', sv.map((v) => v.id).sort().join() === 'v1,v3', sv.map((v) => v.id).join());
check('27 a video is not counted as a photo; the title is the verb; the arrival time carries through', sv.find((v) => v.id === 'v1').photos === 1 && sv.find((v) => v.id === 'v1').title === 'Plowed' && sv.find((v) => v.id === 'v1').arrivedAt === '2026-10-28T06:05:00');
const lawnUp = [
  { stopId: 'l1', propertyId: 'm1', propertyName: 'Hillcrest Lane', arrivedAt: '2026-10-23T08:00:00', completedAt: '2026-10-23T09:00:00', services: 'Edging, Mowing', photos: [1, 2, 3] },
  { stopId: 'l2', propertyName: 'Hillcrest Lane', completedAt: '2026-10-16T09:00:00', photos: [] },
  { stopId: 'l3', propertyId: 'm9', propertyName: 'Other Place', completedAt: '2026-10-16T09:00:00', photos: [] },
];
const lv = lib.lawnVisits(lawnUp, hill);
check('28 lawn visits: by property id or (no id) by name; a visit with no services is called "Lawn visit"; photos are counted', lv.map((v) => v.id).sort().join() === 'l1,l2' && lv.find((v) => v.id === 'l1').photos === 3 && lv.find((v) => v.id === 'l2').title === 'Lawn visit', JSON.stringify(lv));
check('29 a property with no lawn has no lawn visits', lib.lawnVisits(lawnUp, groups.find((g) => g.key === '410 river rd')).length === 0);

console.log(bad ? `\n${bad} of ${n} FAILED` : `\nAll ${n} passed`);
process.exit(bad ? 1 : 0);
