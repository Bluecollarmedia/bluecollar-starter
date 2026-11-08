// Run: node scripts/checks/snowMyRoute.check.cjs <path to typescript package>
// Logic checks for which Snow routes count as current work (src/lib/snowMyRoute.ts).
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../src/lib/snowMyRoute.ts'), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(src, { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const { splitMyRoutes, pickActiveRoute } = m.exports;

let bad = 0;
const check = (name, ok) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const r = (id, stormStatus) => ({ id, stormStatus });

let s = splitMyRoutes([r('a', 'dispatched'), r('b', 'ended'), r('c', 'draft'), r('d', 'dispatched')]);
check('1 only dispatched storms are active', s.active.map((x) => x.id).join() === 'a,d');
check('2 ended storms are history', s.history.map((x) => x.id).join() === 'b');
check('3 a draft storm is neither active nor history', ![...s.active, ...s.history].some((x) => x.id === 'c'));
check('4 first active route is picked by default', pickActiveRoute(s.active, null) === 'a');
check('5 a chosen active route is kept', pickActiveRoute(s.active, 'd') === 'd');
check('6 a chosen route that is no longer active falls back to the first active one', pickActiveRoute(s.active, 'b') === 'a');
s = splitMyRoutes([r('b', 'ended'), r('e', 'ended')]);
check('7 only ended storms: nothing is current (never falls back to an ended storm)', pickActiveRoute(s.active, null) === null && s.history.length === 2);
check('8 no routes at all: nothing current', pickActiveRoute(splitMyRoutes([]).active, 'x') === null);
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
