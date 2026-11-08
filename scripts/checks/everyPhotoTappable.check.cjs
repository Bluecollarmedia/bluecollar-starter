// Run: node scripts/checks/everyPhotoTappable.check.cjs
// Anywhere there is a picture you can tap it open (and swipe to the next), the owner can always delete it, and a worker can delete a photo
// they uploaded by mistake.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const sp = read('src/components/maintenance/StopPhotos.tsx');
check('5 maintenance stop photos open full screen, and the owner can always delete (a worker only until the stop is finished)', /<PhotoPager/.test(sp) && /staff \|\| \(!locked && p\.uploadedBy === db\.personId\)/.test(sp));
check('6 the owner\'s route review: stop photos open and can be deleted', /<PhotoPager/.test(read('app/(owner)/(tabs)/maintenance/routes/[id].tsx')) && /removeStopPhoto\(ph\.id\)/.test(read('app/(owner)/(tabs)/maintenance/routes/[id].tsx')));
check('7 the customer\'s maintenance update photos open full screen', /<PhotoPager/.test(read('src/components/maintenance/CustomerMaintenanceUpdatesScreen.tsx')));
const issue = read('app/(owner)/issue-detail.tsx');
check('8 a problem report\'s photos swipe, and each can be deleted', /<PhotoPager/.test(issue) && /removeIssuePhoto\(issue\.id, ph\.id\)/.test(issue) && /export function removeIssuePhoto/.test(read('src/data/issues.ts')));
const proj = read('app/(owner)/(tabs)/projects/[id].tsx');
check('9 the project photo viewer swipes through all the project\'s photos (it showed only one)', /photos\.findIndex\(\(ph\) => ph\.id === reviewPhoto\.id\)/.test(proj) && /onIndexChange=\{\(i\) => \{ if \(photos\[i\]\) openPhotoReview\(photos\[i\]\); \}\}/.test(proj));
const pager = read('src/components/media/PhotoPager.tsx');
check('10 the viewer can show private (signed) photos', /useFileAddress\(photo\.url, photo\.key\)/.test(pager));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
