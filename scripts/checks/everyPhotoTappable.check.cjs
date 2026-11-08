// Run: node scripts/checks/everyPhotoTappable.check.cjs
// Anywhere there is a picture you can tap it open (and swipe to the next), the owner can always delete it, and a worker can delete a photo
// they uploaded by mistake.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const issue = read('app/(owner)/issue-detail.tsx');
check('8 a problem report\'s photos swipe, and each can be deleted', /<PhotoPager/.test(issue) && /removeIssuePhoto\(issue\.id, ph\.id\)/.test(issue) && /export function removeIssuePhoto/.test(read('src/data/issues.ts')));
const proj = read('app/(owner)/(tabs)/projects/[id].tsx');
check('9 the project photo viewer swipes through all the project\'s photos (it showed only one)', /photos\.findIndex\(\(ph\) => ph\.id === reviewPhoto\.id\)/.test(proj) && /onIndexChange=\{\(i\) => \{ if \(photos\[i\]\) openPhotoReview\(photos\[i\]\); \}\}/.test(proj));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
