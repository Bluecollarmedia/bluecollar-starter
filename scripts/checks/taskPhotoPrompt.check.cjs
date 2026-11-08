// Run: node scripts/checks/taskPhotoPrompt.check.cjs
// Ticking a maintenance checklist task offers a photo (optional) or insists on one (required).
const fs = require('fs'); const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const list = read('src/components/maintenance/StopChecklist.tsx'), pick = read('src/lib/stopPhotoPicker.ts'), screen = read('app/(worker)/maintenance-stop/[id].tsx'), photos = read('src/components/maintenance/StopPhotos.tsx');
let bad = 0; const check = (n, ok) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); };
check('1 ticking (not unticking) a task with no photos asks first', /!(?:t|task)\.completedAt && photoCount === 0/.test(list) && /askForTaskPhoto\(stopId, (?:requiresPhotos|false)\)/.test(list) && /if \(!go\) return;/.test(list));
check('2 required: "Please add a photo first", no way to tick without a photo', /Please add a photo first/.test(pick) && /\(await add\('camera'\)\) \|\| !required/.test(pick) && /text: (?:tr\()?'Cancel'\)?[\s\S]*resolve\(false\)/.test(pick));
check('3 optional: add or skip, task ticks either way', /Add a photo\?/.test(pick) && /text: (?:tr\()?'Skip'\)?[\s\S]*resolve\(true\)/.test(pick));
check('4 the screen passes the stop, requirement and photo count', /stopId=\{stop\.id\} requiresPhotos=\{stop\.requiresPhotos\} photoCount=\{stop\.photos\.length\}/.test(screen));
check('5 Photos section uses the shared picker; Finish rule untouched', /pickStopPhotos\(stopId, source\)/.test(photos) && /stop\.minPhotos/.test(read('src/data/maintenance.ts')));
console.log(bad ? `\n${bad} failed` : '\nall passed'); process.exit(bad ? 1 : 0);
