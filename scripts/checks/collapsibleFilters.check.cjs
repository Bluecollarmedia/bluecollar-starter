// Run: node scripts/checks/collapsibleFilters.check.cjs
// Several rows of filter chips on screen at once are folded into one "Filters" button that opens on tap.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const c = read('src/components/ui/CollapsibleFilters.tsx');
check('1 the shared filters start folded (one button), show a count when any are on, open on tap and offer Clear', /startOpen = false/.test(c) && /Filters · \$\{active\.length\}/.test(c) && /setOpen\(!open\)/.test(c) && /Clear/.test(c));
check('2 a group on its "nothing chosen" option is not counted as a filter', /g\.selected !== defaultOf\(g\)/.test(c));
const acc = read('app/(owner)/(tabs)/more/accounts.tsx');
check('3 Accounts has ONE Filters button instead of three rows of chips (Role, Status, Sort)', /<CollapsibleFilters/.test(acc) && !/<FilterChips/.test(acc) && /key: 'role'/.test(acc) && /key: 'status'/.test(acc) && /key: 'sort'/.test(acc));
const hrs = read('src/components/snow/time/SnowTimeScreens.tsx');
check('4 Snow hours has ONE Filters button instead of three rows (Dates, Storm, Worker); the default week is not counted as a filter', /<CollapsibleFilters/.test(hrs) && !/<FilterChips/.test(hrs) && /defaultKey: 'this_week'/.test(hrs));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
