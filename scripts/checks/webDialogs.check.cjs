// Run: node scripts/checks/webDialogs.check.cjs
// On the website Alert.alert did nothing and the browser's confirm() can be blocked, so storm buttons (End storm, Dispatch, Delete) and
// every other confirmation looked dead. Now the website draws its own dialog and every confirmation goes through it.
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${d}/${e.name}`] : []);
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

// ── the dialog module itself, run with a fake "website" ──
const RN = { Platform: { OS: 'web' }, Alert: { alert: () => 'nothing happens' } };
const m = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(read('src/lib/webDialog.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports, () => RN);
const { showWebDialog, answerWebDialog, subscribeDialogs, installWebAlert } = m.exports;
let seen = [];
subscribeDialogs((q) => { seen = q; });
let ran = '';
showWebDialog('End storm?', 'This ends it.', [{ text: 'Cancel', style: 'cancel', onPress: () => { ran += 'cancel'; } }, { text: 'End storm', style: 'destructive', onPress: () => { ran += 'end'; } }]);
check('1 a dialog opens with its title, message and buttons', seen.length === 1 && seen[0].title === 'End storm?' && seen[0].buttons.length === 2);
answerWebDialog(seen[0].buttons[1]);
check('2 tapping a button closes the dialog and runs that button\'s action', seen.length === 0 && ran === 'end');
showWebDialog('Heads up', 'Something happened.');
check('3 a plain message gets a single OK', seen.length === 1 && seen[0].buttons.length === 1 && seen[0].buttons[0].text === 'OK');
answerWebDialog(seen[0].buttons[0]);
showWebDialog('First'); showWebDialog('Second');
check('4 dialogs wait their turn, one at a time', seen.length === 2 && seen[0].title === 'First');
answerWebDialog(seen[0].buttons[0]); answerWebDialog(seen[0].buttons[0]);
installWebAlert();
RN.Alert.alert('Delete?', 'Gone for good.', [{ text: 'Delete', onPress: () => { ran += '+deleted'; } }]);
check('5 on the website Alert.alert now opens the dialog (it used to do nothing)', seen.length === 1 && seen[0].title === 'Delete?');
answerWebDialog(seen[0].buttons[0]);
check('6 and its buttons work', /\+deleted$/.test(ran));
const phone = { exports: {} };
const PHONE = { Platform: { OS: 'ios' }, Alert: { alert: () => 'system' } };
new Function('module', 'exports', 'require', ts.transpileModule(read('src/lib/webDialog.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(phone, phone.exports, () => PHONE);
phone.exports.installWebAlert();
check('7 on a phone the system alert is left alone', PHONE.Alert.alert() === 'system');

// ── wiring ──
const sheet = read('src/components/financials/ActionSheet.tsx');
check('8 confirmAction and showMessage use the app dialog on the website', /export function confirmAction[\s\S]{0,400}showWebDialog\(title, message, \[/.test(sheet) && /export function showMessage[\s\S]{0,200}showWebDialog\(title, message\)/.test(sheet));
const layout = read('app/_layout.tsx');
check('9 the dialog is installed once at startup and drawn at the root', /installWebAlert\(\);/.test(layout) && /<WebDialogHost \/>/.test(layout));
const offenders = [...walk('src'), ...walk('app')].filter((f) => !/webDialog\.ts$|ActionSheet\.tsx$/.test(f) && /window\.confirm|confirm\?: \(m: string\) => boolean/.test(read(f)));
check('10 no screen calls the browser\'s own confirm() any more', offenders.length === 0, offenders.join(', '));
const storm = read('src/components/snow/storms/StormDetailScreen.tsx');
check('11 End storm, Dispatch, Reopen and Delete all go through confirmAction', (storm.match(/confirmAction\(/g) || []).length >= 4);
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
