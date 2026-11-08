// Run: node scripts/checks/snowExisting.check.cjs <path to typescript package>
// Logic checks for "add an existing customer to Snow" (src/lib/snowExisting.ts).
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../src/lib/snowExisting.ts'), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(src, { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const { normalizeAddress, knownPlacesFor } = m.exports;

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };
const mem = (personId, role, status, last, first = 'A') => ({ personId, role, status, person: { firstName: first, lastName: last } });


check('3 the same street written two ways matches', normalizeAddress('205 Kathy Ln.') === normalizeAddress('205 kathy lane'));
check('4 directions and avenue abbreviations match', normalizeAddress('12 N Main Ave') === normalizeAddress('12 north main avenue'));
check('5 an empty address normalizes to nothing', normalizeAddress('  ') === '' && normalizeAddress(undefined) === '');

const projects = [
  { id: 'p1', name: 'Beach House', customerId: 'c1', address: '205 Kathy Lane', city: 'Lakewood', state: 'NJ', zip: '08701', status: 'active' },
  { id: 'p2', name: 'Old Job', customerId: 'c1', address: '9 Elm St', status: 'archived' },
  { id: 'p3', name: 'Other Customer', customerId: 'c2', address: '5 Oak St' },
  { id: 'p4', name: 'Claimed', customerClaimedBy: 'c1', address: '77 Pine Rd', status: 'active' },
];
const maint = [
  { id: 'm1', name: 'Kathy Lane lawn', customerId: 'c1', address: '205 Kathy Ln', isActive: true },
  { id: 'm2', name: 'Second home', customerId: 'c1', address: '300 Bay Ave', isActive: true },
  { id: 'm3', name: 'Off', customerId: 'c1', address: '1 Off St', isActive: false },
];
const places = knownPlacesFor('c1', projects, maint);
check('6 lists the customer\'s own project and maintenance addresses', places.map((p) => p.address).join('|') === '205 Kathy Lane|77 Pine Rd|300 Bay Ave', places.map((p) => p.address).join('|'));
check('7 the same address on a project and a maintenance property is listed once (project wins)', places.filter((p) => normalizeAddress(p.address) === normalizeAddress('205 Kathy Lane')).length === 1 && places[0].source === 'project');
check('8 archived projects, inactive properties and other customers\' places are left out', !places.some((p) => ['9 Elm St', '1 Off St', '5 Oak St'].includes(p.address)));

const snow = [{ id: 's1', name: 'Kathy Res', address: '205 Kathy Lane', zip: '08701' }, { id: 's2', name: 'Elm', address: '9 Elm Street', zip: '' }];

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
