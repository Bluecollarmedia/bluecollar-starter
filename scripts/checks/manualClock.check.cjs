// Clocking in and out is manual, from the Clock tab only; there are no automatic clock-in prompts or screens in the way.
// File-text checks; the database rules are proved by supabase/tests/setup/09_clock_rules.test.mjs.
// Not covered here (needs phones): how each dashboard looks, and a real clock-in from the Clock tab.
const fs = require('fs');
const read = (p) => fs.readFileSync(p, 'utf8');
let bad = 0;
let n = 0;
const check = (name, ok) => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}`); };
const card = read('src/components/time/WorkdayCard.tsx');
check('the dashboards\' Clock In card (gate) draws nothing, and "no work scheduled" never blocks the Clock tab', /if \(gate\) return null;/.test(card) && /const noWork = false;/.test(card));
const idx = read('app/(worker)/(tabs)/index.tsx');
check('the project Today never swaps the work for a Clock In screen', !/<ClockInScreen/.test(idx));
check('every "clock in first" hint points to the Clock tab', !/Clock In button is (at the top|on the Today screen)/.test(read('src/providers/WorkerProvider.tsx') + idx) && /Clock in first on the Clock tab/.test(idx));
const sql = require('./_sql.cjs').fn('_time_may_clock_in');   // in supabase/setup.sql
check('the database says yes to a clock-in with or without scheduled work', /_time_may_clock_in[\s\S]*select true/.test(sql));
process.exit(bad ? 1 : 0);
