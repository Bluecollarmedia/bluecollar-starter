// Run: node scripts/checks/customerPortal.check.cjs <path to typescript package>
// Logic checks for what a customer's portal shows (src/lib/customerPortal.ts).
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../src/lib/customerPortal.ts'), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(src, { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const { portalSections, emptyPortalText, snowCardSubtitle } = m.exports;

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };
const s = (projects, maintenance, snow) => portalSections({ projects, maintenance, snow });

let r = s(2, 0, 0);
check('1 landscaping-only customer: projects shown, no Maintenance and no Snow', r.showProjects && !r.showMaintenance && !r.showSnow && !r.showEmpty);
r = s(0, 0, 1);
check('2 SNOW-ONLY customer: Snow shown, and NOT the "no projects" empty state', r.showSnow && !r.showProjects && !r.showEmpty);
r = s(0, 1, 0);
check('3 maintenance-only customer: Maintenance shown, no empty state', r.showMaintenance && !r.showEmpty && !r.showSnow);
r = s(3, 1, 2);
check('4 a customer with all three sees all three (neither hides the other)', r.showProjects && r.showMaintenance && r.showSnow && !r.showEmpty);
r = s(1, 0, 1);
check('5 landscaping + snow: both, no maintenance', r.showProjects && r.showSnow && !r.showMaintenance);
r = s(0, 0, 0);
check('6 nothing linked: only the empty state', r.showEmpty && !r.showProjects && !r.showMaintenance && !r.showSnow);
const t = emptyPortalText();
check('7 the empty text does not say "no projects" (the customer may only be a snow or maintenance customer)', !/no projects/i.test(t.title + t.description) && /snow/i.test(t.description) && /maintenance/i.test(t.description));
check('8 snow card subtitle with and without an address', snowCardSubtitle('12 Oak St') === '12 Oak St · Plowing, shoveling and salting updates' && snowCardSubtitle(undefined) === 'Plowing, shoveling and salting updates');
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
