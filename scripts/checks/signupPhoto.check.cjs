// Run: node scripts/checks/signupPhoto.check.cjs
// Every "create your account" screen offers an optional profile photo, saved right after the account exists.
const fs = require('fs'); const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0; const check = (n, ok) => { if (!ok) bad++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + n); };
const screens = ['app/(auth)/create-company.tsx'];
check('1 the create-a-company screen shows the picker (customers and workers get theirs on their private link page)', screens.every((f) => /<SignupPhotoPicker /.test(read(f))));
check('2 the join-team screen already has its own photo step', /useProfilePhoto\(/.test(read('app/invite/[token].tsx')));
check('3 the photo is saved only after the account exists, and a failure never undoes the account', screens.every((f) => { const s = read(f); return /saveSignupPhoto\(photoUri\)/.test(s) && /if \(photoUri && !result\.needsEmailConfirmation\)/.test(s) && /wasn't saved/.test(s); }));
const pk = read('src/components/account/SignupPhotoPicker.tsx');
check('4 the picker uses the shared safe picker (waits for the sheet, shows errors) and offers Take / Choose / Remove', /photo\.pick\(source, \{ afterSheetMs: PICKER_AFTER_SHEET_MS \}\)/.test(pk) && /Take Photo/.test(pk) && /Choose from Library/.test(pk) && /Remove Photo/.test(pk));
const sv = read('src/data/signupPhoto.ts');
check('5 saved into the person\'s own avatar folder and profile', /avatars\/\$\{personId\}/.test(sv) && /update\(\{ avatar_url: url \}\)\.eq\('id', personId\)/.test(sv));
console.log(bad ? '\n' + bad + ' failed' : '\nall passed'); process.exit(bad ? 1 : 0);
