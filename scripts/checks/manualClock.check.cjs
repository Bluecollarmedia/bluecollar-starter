// Clocking in and out is manual, from the Clock tab only; there are no automatic clock-in prompts or screens in the way.
// File-text checks; the database rules are proved by supabase/tests/109_clock_in_any_time.pglite.mjs.
// Not covered here (needs phones): how each dashboard looks, and a real clock-in from the Clock tab.
const fs = require('fs');
const read = (p) => fs.readFileSync(p, 'utf8');
let bad = 0;
let n = 0;
const check = (name, ok) => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}`); };
const card = read('src/components/time/WorkdayCard.tsx');
check('the dashboards\' Clock In card (gate) draws nothing, and "no work scheduled" never blocks the Clock tab', /if \(gate\) return null;/.test(card) && /const noWork = false;/.test(card));
const today = read('src/components/today/WorkerToday.tsx');
check('a worker who is not clocked in still sees their route on Today (no Clock-In-only screen)', !/return <ClockInScreen/.test(today.replace(/export function ClockInScreen[\s\S]*?\n}\n/, '')));
const idx = read('app/(worker)/(tabs)/index.tsx');
check('the project Today never swaps the work for a Clock In screen', !/<ClockInScreen/.test(idx) && !/import \{ WorkerToday, ClockInScreen \}/.test(idx));
const maint = read('app/(worker)/maintenance/index.tsx');
check('the maintenance dashboard has no Clock In card', !/Ready to start your day/.test(maint) && !/Clock In appears when the owner puts you on a route/.test(maint));
const snow = read('src/components/snow/time/SnowClockGate.tsx');
check('the Snow Route tab always shows the route and never clocks anyone in or out', /<MyRouteScreen/.test(snow) && !/clockInNow|clockOut/.test(snow));
check('every "clock in first" hint points to the Clock tab', !/Clock In button is (at the top|on the Today screen)/.test(read('src/providers/WorkerProvider.tsx') + idx + read('app/(worker)/maintenance-stop/[id].tsx')) && /Clock in first on the Clock tab/.test(idx));
const sql = read('supabase/updates/109_clock_in_any_time.sql');
check('the database says yes to a clock-in with or without scheduled work, for landscaping, maintenance and Snow', /_time_may_clock_in[\s\S]*select true/.test(sql) && /_snow_may_clock_in[\s\S]*select true/.test(sql));
process.exit(bad ? 1 : 0);
