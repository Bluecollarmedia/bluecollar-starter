// Run: node scripts/checks/crewClockOutPrompt.check.cjs
// When the last Maintenance stop is finished, the crew leader is ASKED "Clock out the whole crew now? / Not yet". Nothing clocks out by itself.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const screen = read('app/(worker)/maintenance/index.tsx');
const card = read('src/components/maintenance/CrewClockOutCard.tsx');
const data = read('src/data/timeTracking.ts');
const sql = read('supabase/updates/091_clock_out_whole_crew.sql');
const finish = read('src/data/maintenanceFinish.ts');

check('1 the question and both answers are on the card', /Clock out the whole crew now\?/.test(card) && /NOT YET/.test(card) && /CLOCK OUT CREW/.test(card));
check('2 it shows only when every stop is done, the workday clock is on, and the viewer is the leader (or owner/admin)', /allDone && timeOn && leader && route \? <CrewClockOutCard routeId=\{route\.id\} \/>/.test(screen));
check('3 "Not yet" does nothing but keep a smaller button for later', /setStage\('later'\)/.test(card) && /stage === 'later' \? (?:t\()?'CLOCK OUT THE WHOLE CREW'/.test(card));
check('4 nothing clocks out by itself: finishing a stop never calls the crew clock-out', !/clockOutCrew|maintenance_clock_out_crew/.test(finish) && (screen.match(/clockOutCrew/g) || []).length === 0);
check('5 the phone asks the database function and refreshes the clocks after', /rpc\('maintenance_clock_out_crew', \{ p_route: routeId \}\)/.test(data) && /emitTimeChanged\(\);\n?\r?\n?\s*const d = /.test(data));
check('6 the database allows only the route leader or staff', /public\.is_staff\(r\.company_id\) or r\.lead_person_id = me/.test(sql));
check('7 and only after every stop is finished', /s\.status in \('pending', 'arrived'\)/.test(sql) && /Finish every stop first/.test(sql));
check('8 and it never forces anyone off a property timer or a break', /still working at a property/.test(sql) && /'on a break'/.test(sql));
check('9 a day left open too long is flagged for review, never closed with an invented time', /_time_flag_stale\(m\.person_id, r\.company_id\)/.test(sql));
check('10 every closing is written to the history', /'crew_clock_out'/.test(sql));
check('11 the leader reads who is out and who could not be', /Not clocked out:/.test(read('src/lib/maintenanceLeader.ts')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
