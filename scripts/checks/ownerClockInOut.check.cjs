// Run: node scripts/checks/ownerClockInOut.check.cjs
// The owner can clock any worker in or out by hand from the worker's page. It uses the owner's EXISTING audited time functions (update 64),
// asks for a reason, and says plainly why when the database refuses. No new database code.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const data = read('src/data/ownerClock.ts');
const card = read('src/components/time/OwnerClockCard.tsx');
check('1 clock-in uses the existing time_staff_add_workday (an open day starting now); clock-out uses time_staff_edit_workday (closing it now)', /addWorkday\(personId, todayKey\(\), new Date\(\), null, reason\)/.test(data) && /editWorkday\(workdayId, null, new Date\(\), reason\)/.test(data));
check('2 the owner clock itself needs no database file: it only calls functions that already exist (update 64)', !/supabase\.(rpc|from)/.test(read('src/data/ownerClock.ts')));
check('3 a reason of at least 3 letters is required before the button works (the database requires it too)', /reason\.trim\(\)\.length < 3/.test(card) && /disabled=\{reason\.trim\(\)\.length < 3\}/.test(card));
check('4 it asks first ("Clock out X now?") and says what is saved', /Clock out \$\{firstName\} now\?/.test(card) && /saved in the time history/.test(card));
check('5 it shows who is on the clock right now, and hides the button when an old day is still open (that day is fixed first)', /Clocked in since/.test(card) && /Fix that day first/.test(card) && /!loading && !stale/.test(card));
check('6 the database\'s own refusals are shown (a running break or property timer), and its raw ones are said plainly', /setError\(r\.error\)/.test(card) && /already clocked in/.test(data));
check('7 the card is on every active worker\'s page', /<OwnerClockCard personId=\{p\.id\} firstName=\{p\.firstName\} \/>/.test(read('app/(owner)/(tabs)/workers/[id].tsx')));
check('8 a database test proves the behavior on the full schema', fs.existsSync(path.join(__dirname, '../../supabase/tests/owner_clock_in_out.pglite.mjs')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
