// Run: node scripts/checks/customerProperty.check.cjs <path to typescript package>
// The property-first customer home: projects grouped by property, names, sorting and Past work.
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

const item = (id, name, key, status = 'active', extra = {}) => ({ key: `project:${id}`, kind: 'project', typeLabel: 'Project', name, address: key ? `${key}, Springfield MA` : '', propertyKey: key, status, ...extra });
const patio = item('p1', 'Back Patio', '14 hillcrest ln');
const pit = item('p2', 'Fire Pit', '14 hillcrest ln');
const other = item('p3', 'Riverside Plaza', '410 river rd');
const done = item('p9', 'Old Wall', '14 hillcrest ln', 'completed', { completedAt: '2026-05-01' });

const groups = lib.groupProperties([patio, pit, other, done]);
check('1 same street is one property, a different street is another', groups.length === 2, JSON.stringify(groups.map((g) => g.key)));
const hill = groups.find((g) => g.key === '14 hillcrest ln');
check('2 a property lists every project still going there', hill.items.map((i) => i.name).join() === 'Back Patio,Fire Pit');
check('3 one project names the property, two projects use the street', lib.groupProperties([patio])[0].name === 'Back Patio' && hill.name === '14 hillcrest ln');
check('4 completed projects are never a property; they go to Past work, newest first', !groups.some((g) => g.items.includes(done)) && lib.pastWork([done, item('p8', 'Older', 'x', 'completed', { completedAt: '2025-01-01' })])[0].name === 'Old Wall');
check('5 an item with no address stays on its own', lib.groupProperties([item('a', 'A', ''), item('b', 'B', '')]).length === 2);
check('6 sorted by name', lib.sortGroups([lib.groupProperties([item('z', 'Zed', 'zed st')])[0], groups[1], groups[0]]).map((g) => g.name).join() === '14 hillcrest ln,Riverside Plaza,Zed');
check('7 the property keeps its full address for the screen', hill.address === '14 hillcrest ln, Springfield MA');

console.log(bad ? `\n${bad} of ${n} FAILED` : `\nAll ${n} passed`);
process.exit(bad ? 1 : 0);
