// Run: node scripts/checks/photosOpenEverywhere2.check.cjs
// The last photo places open full screen too: the customer's project photos (grid, timeline, recent activity), the owner's project activity
// thumbnails, a truck's photo, and a worker's task completion photo.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };
const cust = read('app/(customer)/project.tsx');
check('1 customer: shared photo grid opens and swipes through all shared photos', /photos: sharedPhotos\.map/.test(cust) && /<PhotoPager/.test(cust));
check('2 customer: timeline and recent-activity photos open', (cust.match(/setViewing\(\{ photos: \[\{ id: (e|event)\.photoUrl!/g) || []).length === 2);
check('3 owner project activity thumbnail opens the photo', /onPress=\{\(\) => openPhotoReview\(linkedPhoto\)\}/.test(read('app/(owner)/(tabs)/projects/[id].tsx')));
const truck = read('app/(owner)/(tabs)/more/trucks/[id].tsx');
check('4 a truck photo opens full screen', /setViewPhoto\(true\)/.test(truck) && /<PhotoPager/.test(truck));
const task = read('app/(worker)/task/[id].tsx');
check('5 a worker task completion photo opens full screen', /setViewCompletionPhoto\(true\)/.test(task) && /<PhotoPager/.test(task));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
