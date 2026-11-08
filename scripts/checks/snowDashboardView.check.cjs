// Run: node scripts/checks/snowDashboardView.check.cjs <path to typescript package>
// Checks the Snow dashboard's numbers using the app's REAL overview builder (src/data/snowDashboard.ts) with plain data:
// completed + skipped + remaining must equal the total, cancelled routes are left out, no division by zero, no double counting.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const compile = (src, req) => {
  const m = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', esModuleInterop: true } }).outputText)(m, m.exports, req);
  return m.exports;
};
const dash = compile(read('src/data/snowDashboard.ts'), () => ({}));
const view = compile(read('src/lib/snowDashboardView.ts'), (n) => (n === '@/data/snowDashboard' ? dash : {}));

const NOW = new Date('2026-10-19T14:00:00Z');
const people = { p1: 'David Lee', p2: 'Michael Ross', p3: 'Aaron Katz' };
let vid = 0;
const visits = (routeId, stormId, statuses) => statuses.map((status, i) => ({ id: `v${++vid}`, stormId, routeId, propertyId: `pr${vid}`, propertyName: `Prop ${vid}`, position: i, status, arrivedAt: undefined, completedAt: undefined }));
const times = (n, s) => Array(n).fill(s);
const storm = (id, name, status, extra = {}) => ({ id, name, service: 'plowing', status, dispatchedAt: status === 'dispatched' ? '2026-10-19T13:44:00Z' : undefined, reopenedCount: 0, createdAt: `2026-10-1${id.length}T00:00:00Z`, ...extra });
const route = (id, stormId, name, position, lead, extra = {}) => ({ id, stormId, service: 'plowing', name, position, leadPersonId: lead, mediaRequired: false, minMedia: 0, cancelledAt: undefined, ...extra });
const build = (storms, routes, vs) => dash.buildSnowDashboard({ storms, routes, visits: vs, mediaCountByVisit: {}, pendingSkips: [], mediaToReview: null, openShifts: null, nameOf: (id) => people[id], now: NOW }).storms;

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };

// ── no storm, helper basics
check('1 no storms: nothing is active, nothing to show', view.pickActiveStorm([]) === undefined && view.otherStorms([], undefined).length === 0);
check('2 percentages are safe: zero stops is 0%, never NaN or above 100', view.percentOf(0, 0) === 0 && view.percentOf(3, 0) === 0 && view.percentOf(1, 3) === 33 && view.percentOf(2, 3) === 67 && view.percentOf(5, 4) === 100 && view.percentOf(0, 5) === 0);
check('3 initials: Route 1 -> R1, Crew 4 -> C4, two words -> two letters, empty -> ?', view.crewInitials('Route 1') === 'R1' && view.crewInitials('Crew 4') === 'C4' && view.crewInitials('North Lot') === 'NL' && view.crewInitials('Alpha') === 'A' && view.crewInitials('  ') === '?');

// ── four crews working at once (5/8, 4/7, 3/8, 0/7)
{
  const s = storm('s1', 'First Big Storm', 'dispatched');
  const rs = [route('r1', 's1', 'Route 1', 0, 'p1'), route('r2', 's1', 'Route 2', 1, 'p2'), route('r3', 's1', 'Route 3', 2, 'p3'), route('r4', 's1', 'Route 4', 3, undefined)];
  vid = 0;
  const vs = [
    ...visits('r1', 's1', [...times(5, 'completed'), ...times(2, 'pending'), 'arrived']),
    ...visits('r2', 's1', [...times(4, 'completed'), ...times(3, 'pending')]),
    ...visits('r3', 's1', [...times(3, 'completed'), ...times(5, 'pending')]),
    ...visits('r4', 's1', times(7, 'pending')),
  ];
  const [ov] = build([s], rs, vs);
  const h = view.stormHeadline(ov);
  check('4 overall: 12 completed, 18 remaining, 30 total, 40%, 4 routes', h.completed === 12 && h.remaining === 18 && h.total === 30 && h.percent === 40 && h.routeCount === 4, JSON.stringify(h));
  check('5 completed + skipped + remaining always equals the total', h.completed + h.skipped + h.remaining === h.total);
  check('6 the summary reads "12 of 30 stops completed across 4 routes"', h.summary === '12 of 30 stops completed across 4 routes', h.summary);
  check('7 badge and state: Active and In Progress', h.badgeLabel === 'Active' && h.stateLabel === 'In Progress');
  const rows = view.crewRows(ov);
  check('8 each crew uses only its own route: 5/8 63%, 4/7 57%, 3/8 38%, 0/7 0%', rows.map((r) => `${r.completed}/${r.total} ${r.percent}%`).join(' | ') === '5/8 63% | 4/7 57% | 3/8 38% | 0/7 0%', rows.map((r) => `${r.completed}/${r.total} ${r.percent}%`).join(' | '));
  check('9 crew statuses: three In Progress, one Not Started (a crew on site counts as in progress)', rows.map((r) => r.statusLabel).join(',') === 'In Progress,In Progress,In Progress,Not Started', rows.map((r) => r.statusLabel).join(','));
  check('10 leads show their real names; a route with nobody assigned gets a neutral label', rows[0].leadLabel === 'Lead: David Lee' && rows[2].leadLabel === 'Lead: Aaron Katz' && rows[3].leadLabel === 'No lead assigned');
  check('11 the overall total equals the sum of the listed crews', rows.reduce((n, r) => n + r.total, 0) === h.total && rows.reduce((n, r) => n + r.completed, 0) === h.completed);
  check('12 the dispatched time is shown', /^Dispatched Oct 19 · /.test(view.dispatchedLabel(ov.dispatchedAt, true)) && view.dispatchedLabel(undefined, false) === 'Not dispatched yet' && view.dispatchedLabel(undefined, true) === 'Dispatched');
}

// ── skipped stops
{
  const s = storm('s2', 'Salt run', 'dispatched');
  const rs = [route('r5', 's2', 'Route 1', 0, 'p1'), route('r6', 's2', 'Route 2', 1, 'p2')];
  vid = 100;
  const vs = [...visits('r5', 's2', ['completed', 'completed', 'skipped', 'skipped', 'pending']), ...visits('r6', 's2', ['completed', 'pending'])];
  const [ov] = build([s], rs, vs);
  const h = view.stormHeadline(ov);
  check('13 skipped stops are counted and shown: 3 completed + 2 skipped + 2 remaining = 7', h.completed === 3 && h.skipped === 2 && h.remaining === 2 && h.total === 7 && h.completed + h.skipped + h.remaining === h.total, JSON.stringify(h));
  check('14 the summary mentions the skipped stops, and the percentage counts closed-out stops (5 of 7 = 71%)', /, 2 skipped$/.test(h.summary) && h.percent === 71, h.summary + ' ' + h.percent);
}

// ── all done / not started / empty
{
  const s = storm('s3', 'Done storm', 'dispatched');
  const rs = [route('r7', 's3', 'Route 1', 0, 'p1'), route('r8', 's3', 'Route 2', 1, 'p2'), route('r9', 's3', 'Route 3', 2, 'p3')];
  vid = 200;
  const vs = [...visits('r7', 's3', times(3, 'completed')), ...visits('r8', 's3', times(2, 'completed'))];
  const [ov] = build([s], rs, vs);
  const rows = view.crewRows(ov);
  check('15 a finished crew shows Completed; a crew with no stops shows "No stops" and 0% (no division by zero)', rows[0].status === 'completed' && rows[0].percent === 100 && rows[2].status === 'empty' && rows[2].percent === 0 && Number.isFinite(rows[2].percent));
  check('16 every crew done: the storm reads Completed at 100%', view.stormHeadline(ov).stateLabel === 'Completed' && view.stormHeadline(ov).percent === 100);
}
{
  const s = storm('s4', 'Quiet storm', 'dispatched');
  const [ov] = build([s], [route('r10', 's4', 'Route 1', 0, 'p1')], visits('r10', 's4', times(4, 'pending')));
  const h = view.stormHeadline(ov);
  check('17 dispatched but nothing done: Not Started at 0%', h.stateLabel === 'Not Started' && h.percent === 0 && h.summary === '0 of 4 stops completed across 1 route', h.summary);
  const [none] = build([storm('s5', 'No routes', 'dispatched')], [], []);
  const h2 = view.stormHeadline(none);
  check('18 a storm with no routes or stops: safe numbers and a plain note', h2.total === 0 && h2.percent === 0 && h2.summary === 'No routes yet' && view.crewRows(none).length === 0);
}

// ── draft, cancelled routes, several storms
{
  const draft = storm('s6', 'Planned storm', 'draft');
  const [ov] = build([draft], [route('r11', 's6', 'Route 1', 0, undefined)], visits('r11', 's6', times(5, 'pending')));
  const h = view.stormHeadline(ov);
  check('19 a storm that is not dispatched is Planned (not "Active"), and its crews are Planned', h.badgeLabel === 'Planned' && h.stateLabel === 'Planned' && view.crewRows(ov)[0].status === 'planned' && view.dispatchedLabel(ov.dispatchedAt, false) === 'Not dispatched yet');
}
{
  const s = storm('s7', 'Cancel test', 'dispatched');
  const rs = [route('r12', 's7', 'Route 1', 0, 'p1'), route('r13', 's7', 'Route 2', 1, 'p2', { cancelledAt: '2026-10-19T12:00:00Z' })];
  vid = 300;
  const vs = [...visits('r12', 's7', ['completed', 'pending']), ...visits('r13', 's7', times(6, 'pending'))];
  const [ov] = build([s], rs, vs);
  const h = view.stormHeadline(ov);
  check('20 a cancelled route is not counted in the totals and not listed as a crew', h.total === 2 && h.routeCount === 1 && h.cancelledRoutes === 1 && view.crewRows(ov).length === 1 && h.completed + h.remaining === h.total, JSON.stringify(h));
}
{
  const dispatched = storm('sd', 'Live', 'dispatched');
  const draft = storm('sdraft', 'Next', 'draft');
  vid = 400;
  const all = build([draft, dispatched], [route('ra', 'sd', 'Route 1', 0, 'p1'), route('rb', 'sdraft', 'Route 1', 0, 'p1')], [...visits('ra', 'sd', ['completed']), ...visits('rb', 'sdraft', ['pending'])]);
  const active = view.pickActiveStorm(all);
  check('21 with several storms, the dispatched one is the active storm and the draft is listed below it', active.id === 'sd' && view.otherStorms(all, active).map((x) => x.id).join() === 'sdraft');
  const onlyDraft = build([draft], [], []);
  check('22 with only a draft, that draft is shown', view.pickActiveStorm(onlyDraft).id === 'sdraft');
}

// ── multiple services and duplicates
{
  const s = storm('s8', 'Big one', 'dispatched', { services: ['plowing', 'salting'] });
  const [ov] = build([s], [], []);
  check('23 a multi-service storm keeps its list of services for the card', JSON.stringify(ov.services) === JSON.stringify(['plowing', 'salting']));
  const rows = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'a', n: 3 }];
  check('24 a stop returned twice is collapsed to one (never double counted)', view.uniqueById(rows).length === 2 && view.uniqueById(rows)[0].n === 1);
  vid = 500;
  const base = visits('rx', 'sx', ['completed', 'pending']);
  const doubled = view.uniqueById([...base, ...base]);
  const [ov2] = build([storm('sx', 'Dup', 'dispatched')], [route('rx', 'sx', 'Route 1', 0, 'p1')], doubled);
  check('25 two distinct service visits at one property still count as two stops', ov2.total === 2);
  const twoServices = [{ ...base[0], id: 'svcA', propertyId: 'same' }, { ...base[1], id: 'svcB', propertyId: 'same' }];
  const [ov3] = build([storm('sx', 'Dup', 'dispatched')], [route('rx', 'sx', 'Route 1', 0, 'p1')], view.uniqueById(twoServices));
  check('26 (same property, two different visits) = 2 stops', ov3.total === 2);
}

// ── wiring of the screen (set after the screen is written)
const screen = read('src/components/snow/dashboard/SnowDashboardScreen.tsx');
check('27 the screen uses the existing route/storm links (snowDashboardHref) for crew rows, View all and storms', /snowDashboardHref\(\{ kind: 'route'/.test(screen) && /snowDashboardHref\(\{ kind: 'storm'/.test(screen));
check('28 needs-attention and the existing storm-plan action are still on the screen', /Needs attention/.test(screen) && /storm-new/.test(screen) && /snowDashboardHref\(item\.target\)/.test(screen));
check('29 the screen has a loading, an unavailable and an error state', /state\.kind === 'loading'/.test(screen) && /state\.kind === 'unavailable'/.test(screen) && /state\.kind === 'error'/.test(screen));
check('30 no fake data: no hard-coded storm name or crew names from the mock-up', !/First Big Storm|Crew 1|Lead: David|Joshua|Aaron/.test(screen));
const crewRow = screen.slice(screen.indexOf('function CrewRowView'), screen.indexOf('function OtherStormCard'));
const heroCard = screen.slice(screen.indexOf('function ActiveStormCard'), screen.indexOf('function CrewsSection'));
const crewsSection = screen.slice(screen.indexOf('function CrewsSection'), screen.indexOf('function CrewRowView'));
check('31 on the active storm the crew rows and the storm card are read-only: the one way in is "View all" under Crews', !/Pressable/.test(crewRow) && !/Pressable/.test(heroCard) && !/onOpenRoute/.test(crewsSection) && /View all/.test(crewsSection));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
