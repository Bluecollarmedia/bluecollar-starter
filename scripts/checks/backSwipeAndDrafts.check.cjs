// Run: node scripts/checks/backSwipeAndDrafts.check.cjs
// (1) A form in a bottom sheet keeps what you typed if you swipe it down and open it again; it starts fresh only the first time, for a
//     different item, after a save, or when you leave the page (the sheet goes with the page).
// (2) The phone's back swipe steps back INSIDE a screen that shows a view within itself (a project's More sections, a history list)
//     instead of leaving the whole screen for the dashboard.
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

// ── useKeepDraft, run with a tiny stand-in for React's hooks ──
const refs = []; let idx = 0; let effects = [];
const fakeReact = { useRef: (v) => { if (!refs[idx]) refs[idx] = { current: v }; return refs[idx++]; }, useEffect: (f) => { effects.push(f); }, useCallback: (f) => f };
const m = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(read('src/hooks/useKeepDraft.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports, () => fakeReact);
let resets = 0;
let markSaved;
const render = (visible, key) => { idx = 0; effects = []; markSaved = m.exports.useKeepDraft(visible, key, () => { resets++; }); effects.forEach((f) => f()); };
render(false, 'new');
check('1 a sheet that has not been opened does nothing', resets === 0);
render(true, 'new');
check('2 the first time it opens it starts fresh', resets === 1);
render(false, 'new'); render(true, 'new');
check('3 swipe it down and open it again: what you typed is still there (not reset)', resets === 1);
render(false, 'new'); render(true, 'new');
check('4 and again', resets === 1);
markSaved(); render(false, 'new'); render(true, 'new');
check('5 after a save the next time starts fresh', resets === 2);
render(false, 'new'); render(true, 'other item');
check('6 opened for a different item it starts from that item', resets === 3);

// ── the sheets use it ──
const sheets = { 'src/components/materials/VendorSheet.tsx': /useKeepDraft\(visible, vendor\?\.id \?\? 'new'/, 'src/components/materials/MaterialSheet.tsx': /useKeepDraft\(visible, item\?\.id \?\? 'new'/, 'src/components/materials/PickupSheet.tsx': /useKeepDraft\(visible, 'pickup'/, 'src/components/materials/ReminderSheet.tsx': /useKeepDraft\(visible, 'reminder'/ };
check('7 the Vendor, Material, Pickup and Reminder sheets keep their draft, and a save clears it', Object.entries(sheets).every(([f, re]) => re.test(read(f)) && /markSaved\(\)/.test(read(f))));

// ── the back swipe ──
const hook = read('src/hooks/useBackStep.ts');
check('8 only a back gesture / back button is caught (signing out or switching area is never blocked)', /type !== 'POP' && type !== 'GO_BACK'\) return/.test(hook) && /addListener\('beforeRemove'/.test(hook));
check('9 while an inner view is open the back swipe closes it, and the screen\'s own arrow still really leaves', /e\.preventDefault\(\);\s*stepRef\.current\(\)/.test(hook) && /leaving\.current = true; router\.back\(\)/.test(hook));
const proj = read('app/(owner)/(tabs)/projects/[id].tsx');
check('10 a project steps back out of its More sections and Updates & Requests before it leaves', /useBackStep\(\s*\(activeSection === 'more' && moreSubSection != null\) \|\| \(activeSection === 'customer' && customerDrilldown\)/.test(proj) && /onPress=\{backStep\.leave\}/.test(proj));
check('11 the same for the Snow route history, one worker\'s notification settings, and the new-document steps', /useBackStep\(historyId != null/.test(read('src/components/snow/routes/MyRouteScreen.tsx')) && /useBackStep\(selectedWorker != null/.test(read('app/(owner)/(tabs)/more/notifications.tsx')) && /useBackStep\(quoteFor !== undefined/.test(read('app/(owner)/document-new.tsx')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
