// Run: node scripts/checks/clockInNeedsWork.check.cjs
// Wiring for update 67: the screens show an empty state instead of Clock In when there is no authorized work, and the test exists.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (n, ok) => { if (!ok) bad++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + n); };
const card = read('src/components/time/WorkdayCard.tsx');
const snow = read('src/components/snow/time/SnowTimeScreens.tsx');
const sql = read('supabase/updates/067_clock_in_needs_work.sql');
check('1 the workday card shows "No work scheduled today" and no Clock In button when canClockIn is false', /No work scheduled today/.test(card) && /!active && !noWork && \(!closedToday/.test(card));
check('2 the snow Time Clock always offers Clock In (no storm or route needed): clocking is manual', !/blocked = !open && !allowed/.test(snow) && /const blocked = false/.test(snow));
check('3 the database enforces both (maintenance/landscaping and snow), not just the screens', /_time_may_clock_in/.test(sql) && /_snow_may_clock_in/.test(sql) && /You have no work scheduled today/.test(sql) && /No active storm assignment/.test(sql));
check('4 the database test exists', fs.existsSync(path.join(__dirname, '../../supabase/tests/067_clock_in_needs_work.pglite.mjs')));
console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
