// Run: node scripts/checks/snowDashboardActive.check.cjs <path to typescript package>
// The Snow dashboard shows only storms running right now, one "X out of N stops complete" for all routes together, no finished
// routes, no ended-storm lines, and the owner can name a storm (Snow > More > Manage storms).
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

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const NOW = new Date('2026-10-27T14:00:00Z');
let vid = 0;
const visits = (routeId, stormId, statuses) => statuses.map((status, i) => ({ id: `v${++vid}`, stormId, routeId, propertyId: `p${vid}`, propertyName: `Prop ${vid}`, position: i, status }));
const storm = (id, status) => ({ id, name: `Storm ${id}`, service: 'plowing', status, reopenedCount: 0, createdAt: '2026-10-27T00:00:00Z' });
const route = (id, stormId, position) => ({ id, stormId, service: 'plowing', name: `Route ${position + 1}`, position, mediaRequired: false, minMedia: 0 });
const build = (storms, routes, vs) => dash.buildSnowDashboard({ storms, routes, visits: vs, mediaCountByVisit: {}, pendingSkips: [], mediaToReview: null, openShifts: null, nameOf: () => undefined, now: NOW }).storms;

const rs = [route('r1', 'a', 0), route('r2', 'a', 1), route('r3', 'a', 2), route('r4', 'd', 0)];
const vs = [
  ...visits('r1', 'a', Array(10).fill('pending')),
  ...visits('r2', 'a', [...Array(2).fill('completed'), ...Array(8).fill('pending')]),
  ...visits('r3', 'a', Array(20).fill('pending')),
  ...visits('r4', 'd', Array(5).fill('pending')),
];
const all = build([storm('a', 'dispatched'), storm('d', 'draft')], rs, vs);
const running = view.runningStorms(all);
check('1 a draft (not dispatched) storm is not on the dashboard', running.length === 1 && running[0].id === 'a');
check('2 one bar across all routes together: "2 out of 40 stops complete"', view.stopsCompleteLabel(running[0]) === '2 out of 40 stops complete', view.stopsCompleteLabel(running[0]));
check('3 a skipped stop counts as done in that line', view.stopsCompleteLabel({ completed: 2, skipped: 1, total: 40 }) === '3 out of 40 stops complete');
check('4 no stops yet is a plain note, never NaN', view.stopsCompleteLabel({ completed: 0, skipped: 0, total: 0 }) === 'No stops yet');
check('5 all three routes are listed while they have work left', view.openCrewRows(running[0]).length === 3);

const done = build([storm('a', 'dispatched')], rs.slice(0, 3), [
  ...visits('r1', 'a', Array(10).fill('completed')),
  ...visits('r2', 'a', [...Array(2).fill('completed'), ...Array(8).fill('pending')]),
  ...visits('r3', 'a', [...Array(19).fill('completed'), 'skipped']),
]);
check('6 a route whose last stop is done comes off the list the moment it finishes', view.openCrewRows(done[0]).map((r) => r.id).join() === 'r2', view.openCrewRows(done[0]).map((r) => r.id).join());
check('7 the one total still counts every route, finished or not', view.stopsCompleteLabel(done[0]) === '32 out of 40 stops complete', view.stopsCompleteLabel(done[0]));
check('8 a storm that has ended is not running (the dashboard never loads it)', view.runningStorms([{ ...all[0], status: 'ended' }]).length === 0 && /neq\('status', 'ended'\)/.test(read('src/hooks/useSnowDashboard.ts')));

const screen = read('src/components/snow/dashboard/SnowDashboardScreen.tsx');
check('9 the screen uses the running storms only, the one total line, and no ended-storm note', /runningStorms\(storms\)/.test(screen) && /stopsCompleteLabel\(storm\)/.test(screen) && !/EndedStormNote|Other storms|completed, \$\{/.test(screen));
check('10 the other-storm card also hides finished routes', /r\.remaining > 0/.test(screen));

const data = read('src/data/snowStorms.ts');
check('11 renaming a storm updates only its name, trimmed, and refuses an empty name', /update\(\{ name: clean \}\)/.test(data) && /if \(!clean\) return fail/.test(data));
const manage = read('src/components/snow/storms/ManageStormsScreen.tsx');
check('12 Manage storms lets the owner tap a name to rename it', /renameStorm\(s\.id, draft\)/.test(manage) && /Rename \$\{s\.name\}/.test(manage));
check('13 Snow More says Manage storms is where a storm is named', /Name a storm: this is the title on your dashboard/.test(read('app/snow/owner/(tabs)/more.tsx')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
