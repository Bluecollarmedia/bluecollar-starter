// Run: node scripts/checks/snowPhotoViewerDelete.check.cjs
// On Snow photo review a thumbnail can be tapped: it opens full screen, swipe left/right for the stop's other photos, and the owner can
// Approve / Hide / Withdraw / Delete from there. Delete removes the photo for good (update 96).
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };
const pager = read('src/components/media/PhotoPager.tsx');
const review = read('src/components/snow/review/SnowReviewScreens.tsx');
const data = read('src/data/snowMediaReview.ts');
check('1 the viewer swipes between photos (paged horizontal list) and closes', /pagingEnabled/.test(pager) && /horizontal/.test(pager) && /accessibilityLabel="Close"/.test(pager));
check('2 it opens on the photo that was tapped and shows 3 / 5', /startId/.test(pager) && /\/ \{photos\.length\}/.test(pager));
check('3 after a delete it moves on, and closes itself when none are left', /photos\.length === 0\) onClose\(\)/.test(pager));
check('4 each review thumbnail is tappable and opens the viewer', /accessibilityLabel="Open photo"/.test(review) && /setViewing\(\{ visitId: s\.visitId, mediaId: m\.id \}\)/.test(review) && /<PhotoPager photos=\{viewPhotos\}/.test(review));
check('5 the viewer offers Approve / Hide, Withdraw (once sent) and Delete (always)', /key: 'approve'/.test(review) && /key: 'hide'/.test(review) && /key: 'withdraw'/.test(review) && /key: 'delete'[^}]*destructive: true/.test(review));
check('6 Delete asks first, then calls the database function', /Delete this photo\?/.test(review) && /deleteMedia\(m\.id\)/.test(review) && /rpc\('snow_delete_media'/.test(data));
const sql = read('supabase/updates/096_delete_snow_photo.sql');
check('7 only the owner or an admin can delete, using the same purge allowance as deleting a storm, and it is logged', /is_staff\(m\.company_id\)/.test(sql) && /set_config\('snow\.purge', 'on', true\)/.test(sql) && /'media\.deleted'/.test(sql));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
