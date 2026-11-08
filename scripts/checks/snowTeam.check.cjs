// Run: node scripts/checks/snowTeam.check.cjs <path to typescript package>
// Logic checks for the Snow Team screen helpers (src/lib/snowTeam.ts): one list of every worker with their snow services.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const src = read('src/lib/snowTeam.ts');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(src, { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const { snowTeamRows, filterSnowTeam, servicesSummary } = m.exports;

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };
const mem = (personId, role, status, last = 'Z', first = 'A') => ({ personId, role, status, person: { firstName: first, lastName: last, email: `${first}@x.test` } });

const members = [
  mem('w1', 'worker', 'active', 'Young', 'Will'),
  mem('w2', 'worker', 'active', 'Adams', 'Amy'),
  mem('w3', 'worker', 'active', 'Brown', 'Bo'),   // on snow: plowing + salting
  mem('w4', 'worker', 'active', 'Cole', 'Cy'),    // snow access was removed
  mem('w5', 'worker', 'inactive', 'Dane', 'Di'),  // deactivated landscaping worker
  mem('o1', 'owner', 'active', 'Boss', 'Olive'),
  mem('c1', 'customer', 'active', 'Cust', 'Cy'),
  { personId: 'w6', role: 'worker', status: 'active' }, // no person record loaded
  mem('w2', 'worker', 'active', 'Adams', 'Amy'),  // duplicate row
];
const snow = [
  { personId: 'w3', status: 'active', services: ['plowing', 'salting'] },
  { personId: 'w4', status: 'revoked', services: ['plowing'] },
  { personId: 's1', status: 'active', services: ['shoveling'], firstName: 'Sam', lastName: 'Snowonly' },
];
const rows = snowTeamRows(members, snow);
const ids = rows.map((r) => r.personId).join(',');
check('1 every active worker is listed once, sorted by name, plus snow-only people; owners, customers, deactivated and unloaded rows are not', ids === 'w2,w3,w4,s1,w1', ids);
check('2 a worker with snow access shows their services; removed or never-added shows none', rows.find((r) => r.personId === 'w3').services.join() === 'plowing,salting' && rows.find((r) => r.personId === 'w4').services.length === 0 && rows.find((r) => r.personId === 'w1').services.length === 0);
check('3 a snow-only person is marked as not on the landscaping team', rows.find((r) => r.personId === 's1').landscaping === false && rows.find((r) => r.personId === 'w1').landscaping === true);
check('4 the filters: on snow, no snow, and search by name', filterSnowTeam(rows, '', 'snow').map((r) => r.personId).join() === 'w3,s1' && filterSnowTeam(rows, '', 'none').length === 3 && filterSnowTeam(rows, 'bo', 'all').map((r) => r.personId).join() === 'w3');
const label = (s) => s[0].toUpperCase() + s.slice(1);
const ALL = ['plowing', 'shoveling', 'salting'];
check('5 the summary says All services, the chosen ones, or No snow', servicesSummary(ALL, ALL, label) === 'All services' && servicesSummary(['salting', 'plowing'], ALL, label) === 'Plowing, Salting' && servicesSummary([], ALL, label) === 'No snow');

const screen = read('app/(owner)/(tabs)/more/snow-team.tsx');
check('6 the screen has Add Worker, search, All / On snow / No snow, and All services / No snow quick buttons; no codes or requests', /worker-new/.test(screen) && /Search workers/.test(screen) && /On snow/.test(screen) && /All services/.test(screen) && /No snow/.test(screen) && !/regenerateCode|disableCode|Snow signup code|REQUESTS/.test(screen));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
