// Run: node scripts/checks/clockInNeedsWork.check.cjs
// Wiring for the clock-in gate: the screens show an empty state instead of Clock In when the database says the person may not clock in,
// the database (supabase/setup.sql) decides it in one place, and the test exists.
const fs = require('fs');
const path = require('path');
const sql = require('./_sql.cjs');   // supabase/setup.sql, the one file that builds the database
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (n, ok) => { if (!ok) bad++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + n); };
const card = read('src/components/time/WorkdayCard.tsx');
check('1 the workday card shows "No work scheduled today" and no Clock In button when canClockIn is false', /No work scheduled today/.test(card) && /!active && !noWork && \(!closedToday/.test(card));
check('2 the database enforces it, not just the screens: clock-in and the day answer both ask _time_may_clock_in (today it allows clocking in any time)',
  sql.hasFn('_time_may_clock_in') && /if not public\._time_may_clock_in\(me, cid, d\) then\s+raise exception 'You have no work scheduled today/.test(sql.fn('time_clock_in'))
  && /'can_clock_in', public\._time_may_clock_in\(/.test(sql.setup));
check('3 the database test exists', fs.existsSync(path.join(__dirname, '../../supabase/tests/setup/09_clock_rules.test.mjs')));
console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
