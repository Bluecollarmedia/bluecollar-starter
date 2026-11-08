// Run: node scripts/checks/sheetsSwipeClose.check.cjs
// Every bottom sheet closes with a swipe down; a sheet that opens while another is still sliding away waits for it (two native modals at once
// froze the app, for example "New Vendor" inside "Vendor & Pickup"); the quote/invoice editor can be swiped away too, saving first.
// Checked from the source; the feel of the swipe can only be judged on a phone.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const sheet = read('src/components/ui/BottomSheetModal.tsx');
const doc = read('app/(owner)/document-edit.tsx');
const layout = read('app/(owner)/_layout.tsx');

check('1 the shared bottom sheet has a downward pan that follows the finger', /Gesture\.Pan\(\)/.test(sheet) && /activeOffsetY\(14\)/.test(sheet) && /drag\.value = Math\.max\(0, e\.translationY\)/.test(sheet));
check('2 a long pull or a quick flick closes it; otherwise it springs back', /drag\.value > closeDistance \|\| e\.velocityY > closeVelocity\) runOnJS\(onRequestClose\)\(\)/.test(sheet) && /withSpring\(0/.test(sheet));
check('3 sideways and upward drags are not taken, and it is off on the website (text selection)', /failOffsetX\(\[-28, 28\]\)/.test(sheet) && /failOffsetY\(-14\)/.test(sheet) && /enabled\(Platform\.OS !== 'web'\)/.test(sheet));
check('4 the gesture works inside the modal (its own gesture root)', /<GestureHandlerRootView style=\{styles\.fill\}>/.test(sheet) && /<GestureDetector gesture=\{pan\}>/.test(sheet));
check('5 the dimmed backdrop fades as the sheet is pulled', /1 - \(drag\.value \+ \(pull\?\.value \?\? 0\)\) \/ \(height \* 0\.8\)/.test(sheet));
check('6 a sheet opening while another is still sliding away waits (never two at once)', /const closing = new Set<symbol>\(\)/.test(sheet) && /closing\.add\(id\)/.test(sheet) && /waiting\.add\(listener\)/.test(sheet) && /WAIT_LIMIT_MS/.test(sheet));
check('7 it can never get stuck waiting', /setTimeout\(\(\) => \{ cleanup\(\); open\(\); \}, WAIT_LIMIT_MS\)/.test(sheet) && /closing\.delete\(id\)/.test(sheet));
check('8 "New Vendor" from "Vendor & Pickup" still goes through those shared sheets', /onNewVendor=\{\(\) => \{ setAfterVendor\('pickup'\); setSheet\('vendor'\); \}\}/.test(read('src/components/materials/ProjectMaterials.tsx')) && /BottomSheetModal/.test(read('src/components/materials/FormSheet.tsx')));
check('9 the quote/invoice editor can be swiped down (the screen no longer turns the gesture off)', !/document-edit"[^\n]*gestureEnabled: false/.test(layout));
check('10 and a swipe saves the draft first, or is stopped when something is invalid', /addListener\('beforeRemove'/.test(doc) && /if \(leaveRef\.current\(\)\) leaving\.current = true; else e\.preventDefault\(\)/.test(doc));
check('11 the X and the swipe share one rule (save, or drop an untouched new draft)', /const leaveOk = \(\): boolean/.test(doc) && /if \(leaveOk\(\)\) \{ leaving\.current = true; router\.back\(\); \}/.test(doc));
check('X the Details sheet: pulling the page past its top moves the WHOLE sheet with the finger (pull -> BottomSheetModal translateY) while the content is held still (no stretch, no gap); letting go past 60 closes, otherwise it springs back', /pull\.value = Math\.max\(0, -y\)/.test(read('src/components/weather/WeatherDetails.tsx')) && /translateY: Math\.min\(0, scrollY\.value\)/.test(read('src/components/weather/WeatherDetails.tsx')) && /pull=\{pull\}/.test(read('src/components/weather/WeatherDetails.tsx')) && /onEndDrag: \(e\) => \{ if \(e\.contentOffset\.y < -PULL_TO_CLOSE\) runOnJS\(onClose\)\(\); \}/.test(read('src/components/weather/WeatherDetails.tsx')) && /drag\.value \+ \(pull\?\.value \?\? 0\)/.test(read('src/components/ui/BottomSheetModal.tsx')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
