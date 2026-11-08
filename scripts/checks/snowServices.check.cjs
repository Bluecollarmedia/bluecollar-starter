// Run: node scripts/checks/snowServices.check.cjs <path to typescript package>
// Logic checks for multi-service storms in the app (src/lib/snowServices.ts).
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../src/lib/snowServices.ts'), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(src, { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const { stormServices, servicesLabel, toggleService, defaultStormNameFor } = m.exports;

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };
const L = { plowing: 'Plowing', shoveling: 'Shoveling', salting: 'Salting' };
const label = (s) => L[s];

check('1 an old storm (no list) is treated as its single service', stormServices({ service: 'plowing' }).join() === 'plowing');
check('2 a storm with an empty list falls back to the single service', stormServices({ service: 'salting', services: [] }).join() === 'salting');
check('3 a multi-service storm uses its list in order', stormServices({ service: 'plowing', services: ['plowing', 'shoveling'] }).join() === 'plowing,shoveling');

check('4 label for one service', servicesLabel(['plowing'], label) === 'Plowing');
check('5 label for two services', servicesLabel(['plowing', 'shoveling'], label) === 'Plowing + Shoveling');
check('6 label for three services', servicesLabel(['plowing', 'shoveling', 'salting'], label) === 'Plowing, Shoveling + Salting');
check('7 label for none is empty', servicesLabel([], label) === '');

check('8 toggling adds at the end and removes again', toggleService(['plowing'], 'salting').join() === 'plowing,salting' && toggleService(['plowing', 'salting'], 'plowing').join() === 'salting');


// (the per-service route helpers left with the old storm-services section)
// const counts = routesPerService(['plowing', 'shoveling'], [{ service: 'plowing' }, { service: 'plowing' }, { service: 'shoveling' }]);

const day = new Date('2026-01-12T12:00:00');
check('16 default name is the same "Storm" name whatever the service', defaultStormNameFor(['plowing'], label, day) === 'Jan 12 Storm' && defaultStormNameFor(['shoveling'], label, day) === 'Jan 12 Storm');
check('17 default name for several services', defaultStormNameFor(['plowing', 'shoveling'], label, day) === 'Jan 12 Storm');

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
