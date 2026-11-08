// Run: node scripts/checks/scheduleSheetFlow.check.cjs
// Scheduling a worker is ONE screen: Workers first with the whole list right there (no "Select Workers" second sheet), no project question when
// opened from inside a project, Full Day by default, no Repeat for projects, and the date strip taps are labelled buttons.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };
const s = read('app/(owner)/schedule-create.tsx');
const proj = read('app/(owner)/(tabs)/projects/[id].tsx');

check('1 Workers is the first section on the screen (above Project, Date and Time)', s.indexOf('title="Workers"') > 0 && s.indexOf('title="Workers"') < s.indexOf('title="Project"') && s.indexOf('title="Workers"') < s.indexOf('title="Date"'));
check('2 the worker list is inline: no second "Select Workers" sheet and no Add Workers button', !/title="Select Workers"/.test(s) && !/setShowWorkerSheet/.test(s) && !/Add Workers/.test(s));
check('3 every worker row is on the screen itself, with the same availability rules as before', /\{!isMove \? \(\s*<View>\s*\{activeWorkers\.map\(w => \{/.test(s) && /existingOnJob\(w\.personId, projectId, date\)/.test(s) && /Select Anyway/.test(s));
check('4 opened from inside a project, the Project question is not asked (the id is bound in the background)', /const projectKnown = !isMove && !!params\.projectId/.test(s) && /\{projectKnown \? null : \(\s*<Section\s*icon="home"\s*title="Project"/.test(s) && /useState\(params\.projectId \?\? ''\)/.test(s));
check('5 from a generic Schedule button (no project given) the Project question is still asked', /projectKnown \? null : \(/.test(s) && /title="Project"/.test(s));
check('6 Time starts on Full Day', /const \[isFullDay, setIsFullDay\] = useState\(true\)/.test(s));
check('7 Repeat is not offered for projects and one-off jobs', /const ALLOW_REPEAT = false/.test(s) && /\{ALLOW_REPEAT \? \(\s*<Section icon="repeat" title="Repeat">/.test(s));
check('8 the date cards on the project Schedule tab are labelled buttons that select the day', /accessibilityRole="button"\s*accessibilityState=\{\{ selected: isSelected \}\}/.test(proj) && /setScheduleDate\(dateStr\)/.test(proj));
check('9 Schedule Worker passes the selected day to the sheet', /schedule-create\?projectId=\$\{p\.id\}&date=\$\{scheduleDate\}/.test(proj) && /useState\(params\.date \?\? today\)/.test(s));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
