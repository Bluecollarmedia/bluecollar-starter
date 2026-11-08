// Run: node scripts/checks/scheduleDirect.check.cjs
// The Dashboard opens today's schedule as its own screen, so Back returns to the Dashboard (not More > Settings).
const fs = require('fs'); const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0; const check = (n, ok) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); };
check('1 the dashboard button opens /(owner)/schedule, not a screen inside the More tab', /router\.push\('\/\(owner\)\/schedule' as any\)/.test(read('app/(owner)/(tabs)/index.tsx')) && !/more\/schedule/.test(read('app/(owner)/(tabs)/index.tsx')));
check('2 the dashboard\'s schedule alert goes the same way', /route: '\/\(owner\)\/schedule'/.test(read('src/hooks/useOwnerDashboard.ts')));
check('3 the standalone screen reuses the same schedule screen and is registered on the owner stack', /export \{ default \} from '\.\/\(tabs\)\/more\/schedule'/.test(read('app/(owner)/schedule.tsx')) && /<Stack\.Screen name="schedule" \/>/.test(read('app/(owner)/_layout.tsx')));
check('4 its Back button is a plain back (returns to where it was opened)', /router\.back\(\)/.test(read('app/(owner)/(tabs)/more/schedule.tsx')));
check('5 More > Schedule still works', /go\('\/\(owner\)\/more\/schedule'\)/.test(read('app/(owner)/(tabs)/more/index.tsx')));
console.log(bad ? `\n${bad} failed` : '\nall passed'); process.exit(bad ? 1 : 0);
