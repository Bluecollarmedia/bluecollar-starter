// File-text checks for: "I'm here" updating the screen at once, Complete project instead of "I'm leaving", clocking out ending open work,
// and the owner's notes showing everywhere. The database rules are proved by supabase/tests/108_clock_out_ends_open_work.pglite.mjs.
// Not covered here (needs a phone): how the screens look and the check-in actually moving the screen on a real device.
const fs = require('fs');
const read = (p) => fs.readFileSync(p, 'utf8');
let bad = 0;
let n = 0;
const check = (name, ok) => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}`); };

const wp = read('src/providers/WorkerProvider.tsx');
check('after "I\'m here" and after finishing, the jobs are reloaded (an empty refresh reloaded nothing)', !/refreshStore\(\);/.test(wp) && (wp.match(/refreshStore\(\.\.\.JOB_TABLES\)/g) || []).length === 2 && /JOB_TABLES: TableName\[\] = \['assignments', 'check_ins', 'check_outs', 'work_sessions'\]/.test(wp));
const today = read('app/(worker)/(tabs)/index.tsx');
check('the button on a finished-looking project says Complete project, not "I\'m leaving"', /COMPLETE PROJECT/.test(today) && !/I'M LEAVING/.test(today) && /Complete this project\?/.test(today));
check('it says clocking out for the day happens on the Clock tab, and finishing does not clock out', /clock out for the day on the Clock tab/.test(today) && /You stay clocked in until you clock out/.test(today));
const hook = read('src/hooks/useMyWorkday.ts');
check('after clocking out the jobs are reloaded', /refreshStore\('assignments', 'check_ins', 'check_outs', 'work_sessions'\)/.test(hook));
const card = read('src/components/time/WorkdayCard.tsx');
check('the clock-out confirmation says it also ends the project time', /Clocking out also ends your time at/.test(card) && !/Complete the property you are at before clocking out/.test(card));
const sql = read('supabase/updates/108_clock_out_ends_open_work.sql');
check('clock-out no longer refuses for an open project or a running break; it ends them', !/raise exception 'You are still working/.test(sql) && !/break is still running/.test(sql) && /update public\.time_breaks set ended_at = now\(\)/.test(sql) && /status = 'completed'/.test(sql));
check('a route stop is never marked finished by clocking out (its required tasks and photos are not skipped)', /v\.source = 'project_day'/.test(sql) && !/maintenance_finish_stop/.test(sql.replace(/--.*$/gm, '')));
const proj = read('app/(owner)/(tabs)/projects/[id].tsx');
check('the project Overview shows the owner\'s My Notes next to the Internal Notes, with a way into all of them', /useOwnerNotes\(id\)/.test(proj) && /MY NOTES ·/.test(proj) && /setMoreSubSection\('notes'\)/.test(proj));
const pn = read('src/components/projects/ProjectPrivateNotes.tsx');
check('My Notes shows the Overview\'s project notes too, and lets the owner edit them', /internalNotes\?: string/.test(pn) && /Project Notes \(Overview\)/.test(pn) && /onEditInternalNotes/.test(proj));
process.exit(bad ? 1 : 0);
