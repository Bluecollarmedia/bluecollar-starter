// Run: node scripts/checks/snowCrewPush.check.cjs
// The crew hears about a storm (SQL 82): the sender names the route as the tap target, and a tap opens the right place for a
// worker in the snow shell and for an owner.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const fn = read('supabase/functions/send-snow-notification/index.ts');
check('1 a crew notice carries the ROUTE as its tap target', /n\.category === 'employee' \? 'snow_route'/.test(fn) && /n\.category === 'employee' \? n\.route_id/.test(fn));
const push = read('src/hooks/usePushNotifications.ts');
check('2 a worker who taps a crew notice opens the snow shell (My Route)', /type === 'snow_route'\) return '\/snow\/worker'/.test(push));
check('3 pushes are handled while the app is in the snow shell (not only the landscaping screens)', /segments\[0\] === 'snow'/.test(push));
check('4 an owner who is also on a route opens the snow dashboard', /'snow_visit' \|\| type === 'snow_route'\) return '\/snow\/owner'/.test(read('src/lib/notificationTarget.ts')));
const sql = read('supabase/updates/082_snow_crew_push.sql');
check('5 the database tells the lead and crew on dispatch, and mid-storm when a lead or crew member is assigned', /_snow_storm_dispatched_notify/.test(sql) && /_snow_route_lead_notify/.test(sql) && /_snow_route_crew_notify/.test(sql) && /snow_storms_dispatched_notify/.test(sql));
check('6 each notice is made once per person (dedupe key), and a reopened storm gets a fresh one', /reopened_count/.test(sql) && /on conflict \(dedupe_key\) do nothing/.test(sql));
check('7 the DB test exists', fs.existsSync(path.join(__dirname, '../../supabase/tests/082_snow_crew_push.pglite.mjs')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
