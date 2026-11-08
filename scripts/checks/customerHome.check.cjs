// Run: node scripts/checks/customerHome.check.cjs <path to typescript package>
// Customer home: adapts to the data (one/many properties, many projects per property, active/completed), nothing invented.
const ts = require(process.argv[2] || 'typescript'); const fs = require('fs'); const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const names = { exports: {} }; new Function('module', 'exports', ts.transpileModule(read('src/lib/names.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(names, names.exports);
const m = { exports: {} }; new Function('module', 'exports', 'require', ts.transpileModule(read('src/lib/customerHome.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports, () => names.exports);
const h = m.exports;
let bad = 0; const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : ' — ' + d}`); };
const proj = (id, name, status, extra = {}) => ({ id, name, status, progress: 40, address: '1 Elm Dr', city: 'Your Town', state: 'ST', zip: '00000', ...extra });
const build = (o) => h.buildHomeItems({ projects: [], ...o });

check('1 nothing linked = nothing listed (no fake rows)', build({}).length === 0);
const same = build({ projects: [proj('a', 'Wyndham 2', 'active'), proj('b', 'Back Fence', 'active', { address: '1 elm drive' })] });
check('2 two projects at the SAME property (written differently) share one property key', same.length === 2 && new Set(same.map((i) => i.propertyKey)).size === 1 && h.propertyOptions(same).length === 0, JSON.stringify(same.map((i) => i.propertyKey)));
const two = build({ projects: [proj('a', 'A', 'active'), proj('b', 'B', 'completed', { address: '123 Main St', completedAt: '2026-10-19' })] });
const opts = h.propertyOptions(two);
check('3 two properties: a filter with one entry each; one property: no filter', opts.length === 2 && opts[0].label === '1 Elm Dr' && h.propertyOptions(build({ projects: [proj('a', 'A', 'active'), proj('c', 'C', 'active')] })).length === 0);
check('4 filtering keeps only that property; null shows everything', h.filterByProperty(two, opts[1].key).length === 1 && h.filterByProperty(two, null).length === 2);
const { active, completed } = h.splitHome(build({ projects: [proj('a', 'A', 'active'), proj('h', 'H', 'on_hold'), proj('c', 'C', 'completed', { completedAt: '2026-01-01' }), proj('d', 'D', 'completed', { completedAt: '2026-05-01' }), proj('q', 'Q', 'prospect'), proj('x', 'X', 'archived')] }));
check('5 active (incl. on hold) first; completed newest first; quotes and archived are not shown', active.map((i) => i.name).join() === 'A,H' && completed.map((i) => i.name).join() === 'D,C');
check('6 on-hold and completed cards show no percentage; active projects use the real progress value', build({ projects: [proj('a', 'A', 'active'), proj('h', 'H', 'on_hold'), proj('c', 'C', 'completed')] }).map((i) => i.progress).join() === '40,,');
const many = Array.from({ length: 5 }, (_, i) => ({ key: String(i) }));
check('7 completed preview is 3 with a View all that shows everything', h.completedToShow(many, false).length === 3 && h.completedToShow(many, true).length === 5 && h.COMPLETED_PREVIEW === 3);
check('8 type label and status words', same.every((i) => i.typeLabel === 'Project') && h.statusLabel(same[0]) === 'In progress' && h.statusLabel({ status: 'on_hold', kind: 'project' }) === 'On hold' && h.statusLabel({ status: 'completed', kind: 'project' }) === 'Completed');
const s = read('app/(customer)/(tabs)/index.tsx');
const ph = read('src/components/customerHome/PropertyHome.tsx');
check('9 screen: compact greeting, the property-first home, empty state, no project creation, a project opens its own page', /Welcome Back/.test(s) && /<PropertyHome/.test(s) && /emptyPortalText\(\)/.test(s) && /\/\(customer\)\/project\?id=/.test(ph) && !/Create|New Project/.test(s + ph));
check('10 Past work only when there are completed projects; the property chips only with 2+ properties', /past\.length > 0/.test(ph) && /groups\.length > 1/.test(ph));
check('11 a "Request a service" card on the home opens the request form (shown whether or not there are projects)', /<RequestServiceCard \/>/.test(s) && /router\.push\('\/\(customer\)\/request'/.test(s) && /t\('Request a service'\)/.test(s)
  && fs.existsSync(path.join(__dirname, '../../app/(customer)/request.tsx')) && /name="request"/.test(read('app/(customer)/_layout.tsx')));
console.log(bad ? `\n${bad} failed` : '\nall passed'); process.exit(bad ? 1 : 0);
