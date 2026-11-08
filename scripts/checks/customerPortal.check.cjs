// Run: node scripts/checks/customerPortal.check.cjs <path to typescript package>
// Logic checks for what a customer's portal shows (src/lib/customerPortal.ts).
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../src/lib/customerPortal.ts'), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(src, { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const { portalSections, emptyPortalText } = m.exports;

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };
const s = (projects, maintenance) => portalSections({ projects, maintenance });

let r = s(2, 0);
check('1 landscaping-only customer: projects shown, no Maintenance', r.showProjects && !r.showMaintenance && !r.showEmpty);
r = s(0, 1);
check('2 maintenance-only customer: Maintenance shown, and NOT the "no projects" empty state', r.showMaintenance && !r.showProjects && !r.showEmpty);
r = s(3, 1);
check('3 a customer with both sees both (neither hides the other)', r.showProjects && r.showMaintenance && !r.showEmpty);
r = s(0, 0);
check('4 nothing linked: only the empty state', r.showEmpty && !r.showProjects && !r.showMaintenance);
const t = emptyPortalText();
check('5 the empty text does not say "no projects" (the customer may only be a maintenance customer)', !/no projects/i.test(t.title + t.description) && /maintenance/i.test(t.description));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
