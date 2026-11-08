// Run: node scripts/checks/workerSeesAssignedWork.check.cjs
// Being put on a job is what gives a worker access to it: any open assignment counts as work, and the worker area never sends a worker
// away from its screens.
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const m = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(read('src/lib/workerAreas.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports, () => ({}));
const { hasOpenProjectWork } = m.exports;

const today = '2026-10-23';
const asg = (over) => ({ personId: 'w1', scheduledDate: today, status: 'scheduled', ...over });

// ── a project job the owner assigned shows up, whatever the worker's areas ──
check('1 a project assigned for today counts as work', hasOpenProjectWork([asg()], 'w1', today));
check('2 a project assigned for a future day counts too', hasOpenProjectWork([asg({ scheduledDate: '2026-10-25' })], 'w1', today));
check('3 finished, cancelled or handed-over jobs do not count', !hasOpenProjectWork([asg({ status: 'completed' }), asg({ status: 'cancelled' }), asg({ status: 'reassigned' })], 'w1', today));
check('4 yesterday\'s job does not count', !hasOpenProjectWork([asg({ scheduledDate: '2026-10-22' })], 'w1', today));
check('5 someone else\'s job does not count', !hasOpenProjectWork([asg({ personId: 'w2' })], 'w1', today) && !hasOpenProjectWork([asg()], undefined, today));

// ── the screens use the rule ──
const layout = read('app/(worker)/_layout.tsx');
check('6 the worker layout never redirects a worker away from the project screens (tabs, job, task, day)', !/<Redirect/.test(layout) && /name="\(tabs\)"/.test(layout) && /name="job\/\[id\]"/.test(layout));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
