// Run: node scripts/checks/workerSeesAssignedWork.check.cjs
// Being put on a job or a route is what gives a worker access to it, whatever areas they are set to work in. A Maintenance worker the owner
// assigned to a project used to see only "Route complete", because the layout sent every Maintenance worker away from project screens.
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const m = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(read('src/lib/workerAreas.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports, () => ({}));
const { hasOpenProjectWork, workerLanding, mayOpenMaintenance, worksOnMaintenance, worksOnLandscaping } = m.exports;

const today = '2026-10-23';
const asg = (over) => ({ personId: 'w1', scheduledDate: today, status: 'scheduled', ...over });

// ── a project job the owner assigned shows up, whatever the worker's areas ──
check('1 a project assigned for today counts as work', hasOpenProjectWork([asg()], 'w1', today));
check('2 a project assigned for a future day counts too', hasOpenProjectWork([asg({ scheduledDate: '2026-10-25' })], 'w1', today));
check('3 finished, cancelled or handed-over jobs do not count', !hasOpenProjectWork([asg({ status: 'completed' }), asg({ status: 'cancelled' }), asg({ status: 'reassigned' })], 'w1', today));
check('4 yesterday\'s job does not count', !hasOpenProjectWork([asg({ scheduledDate: '2026-10-22' })], 'w1', today));
check('5 someone else\'s job does not count', !hasOpenProjectWork([asg({ personId: 'w2' })], 'w1', today) && !hasOpenProjectWork([asg()], undefined, today));

// ── which home they land on ──
check('6 a Maintenance-only worker with no project lands on the Maintenance home', workerLanding({ maintenance: true, landscaping: false, hasProjectWork: false }) === 'maintenance');
check('7 the SAME worker lands on the main home the moment a project is assigned', workerLanding({ maintenance: true, landscaping: false, hasProjectWork: true }) === 'landscaping');
check('8 a worker who works both areas is no longer locked into Maintenance', workerLanding({ maintenance: true, landscaping: true, hasProjectWork: false }) === 'landscaping');
check('9 a landscaping worker lands on the main home', workerLanding({ maintenance: false, landscaping: true, hasProjectWork: false }) === 'landscaping');

// ── a route reaches anyone put on it ──
check('10 a worker put on a route can open the route screens even if Maintenance is not one of their areas', mayOpenMaintenance({ maintenance: false, onRoute: true }) && mayOpenMaintenance({ maintenance: true, onRoute: false }) && !mayOpenMaintenance({ maintenance: false, onRoute: false }));
check('11 older rows still work: workerType "maintenance" means Maintenance only', worksOnMaintenance({ workerType: 'maintenance' }) && !worksOnLandscaping({ workerType: 'maintenance' }));

// ── the screens use the rule ──
const layout = read('app/(worker)/_layout.tsx');
check('12 the worker layout no longer blocks project screens (tabs, job, task, day) for Maintenance workers', !/LANDSCAPING_ONLY/.test(layout) && /landing === 'maintenance' && screen === '\(tabs\)'/.test(layout));
check('13 route screens are open to anyone with a route or the Maintenance area', /!maintenanceAccess && MAINTENANCE_ONLY\.includes\(screen\)/.test(layout));
check('14 the main home links to the route and the Maintenance home links back to the projects', /onRoute \?\s*\(\s*<OtherWorkCard/.test(read('app/(worker)/(tabs)/index.tsx')) && /projectWork \?\s*\(\s*<OtherWorkCard/.test(read('app/(worker)/maintenance/index.tsx')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
