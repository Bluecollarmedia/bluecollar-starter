// Run: node scripts/checks/signupPhotoCamera.check.cjs
// Every "create your account" profile photo offers Take Photo as well as Choose from Library.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };

const invite = read('app/invite/[token].tsx');
const signup = read('src/components/account/SignupPhotoPicker.tsx');
check('1 the main sign-up photo offers Take Photo and Choose from Library', /Take Photo/.test(signup) && /Choose from Library/.test(signup) && /pick\('camera'\)/.test(signup));
check('2 the invite sign-up photo offers Take Photo and Choose from Library', /Take Photo/.test(invite) && /Choose from Library/.test(invite) && /pick\('camera'\)/.test(invite));
check('3 the invite photo no longer opens the library directly from the photo circle', !/onPress=\{\(\) => photo\.pick\('library'\)\}/.test(invite) && /onPress=\{choosePhoto\}/.test(invite));
check('4 both wait for the sheet to close before opening the picker', /PICKER_AFTER_SHEET_MS/.test(invite) && /PICKER_AFTER_SHEET_MS/.test(signup));
check('5 the invite photo can be removed', /Remove Photo/.test(invite));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
