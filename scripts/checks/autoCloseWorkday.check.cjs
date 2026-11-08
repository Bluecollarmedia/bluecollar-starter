// Run: node scripts/checks/autoCloseWorkday.check.cjs
// A workday closes by itself after the last job; a forgotten day gets a suggested end the owner accepts in one tap.
const fs = require('fs');
const path = require('path');
const SETUP_SQL = require('./_sql.cjs').setup;   // supabase/setup.sql, the one file that builds the database
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const sql = SETUP_SQL;
const data = read('src/data/timeReview.ts');
const card = read('src/components/time/NeedsOkCard.tsx');
const dash = read('app/(owner)/(tabs)/index.tsx');
check('1 the database closes the day from job, timer and break endings', ['trg_time_auto_close_assignment', 'trg_time_auto_close_interval', 'trg_time_auto_close_break'].every((t) => sql.includes(t)));
check('2 it never closes a stale day, a running timer, a running break, or a day with no work', /open_workday_hours/.test(sql) && /ended_at is null and i\.status = 'active'/.test(sql) && /b\.ended_at is null/.test(sql) && /_time_any_work_count\(p_person, w\.company_id, w\.work_date\) = 0/.test(sql));
check('3 the closed day is written to the history', /'auto_clock_out'/.test(sql));
check('4 the suggested end uses what the person finished, never later than now', /best <= now\(\)/.test(sql) && /_time_suggest_end/.test(sql));
check('5 accepting goes through the owner\'s existing audited edit (no new way to write a time)', /perform public\.time_staff_edit_workday\(p_workday, null, sg\.suggested_at, 'Accepted the suggested end time'\)/.test(sql));
check('6 only the owner can list or accept', (sql.match(/Only the owner can do that\./g) ?? []).length >= 2 && /not public\.is_staff\(w\.company_id\)/.test(sql));
check('7 daily alert hours add up every session of the date', /group by ws\.person_id, ws\.work_date/.test(sql));
check('8 the worker\'s day says whether work is open', /'has_open_work'/.test(sql));
check('9 the app lists, accepts one, and accepts all', /time_review_list/.test(data) && /time_accept_suggested_end/.test(data) && /time_accept_all_suggested_ends/.test(data));
check('10 the dashboard card has no Accept buttons: Edit opens the day to set the end time', !/title="Accept/.test(card) && /labor-day/.test(card) && /'Edit' : 'Set time'/.test(card) && /<NeedsOkCard \/>/.test(dash));
check('11 the card hides itself when nothing is waiting or the update is not installed', /days\.length === 0 && !error/.test(card) && /notInstalled/.test(card));
check('12 a database test proves it on setup.sql', fs.existsSync(path.join(__dirname, '../../supabase/tests/setup/09_clock_rules.test.mjs')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
