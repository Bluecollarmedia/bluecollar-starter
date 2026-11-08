// Run: node scripts/checks/profilePhoto.check.cjs
// Profile photo picking: opened after the sheet closes, no library permission wall, errors are shown, every profile screen uses it.
const fs = require('fs'); const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const lib = read('src/lib/profilePhoto.ts'), edit = read('src/components/account/EditProfileScreen.tsx'), join = read('app/invite/[token].tsx');
let bad = 0; const check = (n, ok) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); };
check('1 waits for the sheet to close before opening the picker', /PICKER_AFTER_SHEET_MS = \d{3,}/.test(lib) && /afterSheetMs: PICKER_AFTER_SHEET_MS/.test(edit) && /await sleep\(opts\.afterSheetMs\)/.test(lib));
check('2 library choice does not ask for photo-library permission', !/requestMediaLibraryPermissionsAsync/.test(lib + edit + join));
check('3 camera permission is asked and explained', /requestCameraPermissionsAsync/.test(lib) && /Camera access is needed/.test(lib));
check('4 nothing throws out of the helper (try/catch returns an error result)', /catch \(err\)[\s\S]*status: 'error'/.test(lib));
check('5 the picked picture is still cut to a square', /squareAvatarUri\(a\.uri, a\.width, a\.height\)/.test(lib));
check('6 Edit Profile shows errors from picking; sign-up shows them too', /useProfilePhoto\(setAvatarUrl, setPermissionError\)/.test(edit) && /useProfilePhoto\(setPhotoUri, setError\)/.test(join));
check('7 no screen calls the picker directly any more (they all go through the crop flow)', !/launch(Camera|ImageLibrary)Async/.test(edit + join) && !/chooseProfilePhoto\(/.test(edit + join));
check('8 all five Edit Profile entry points use the shared screen', ['app/(customer)/edit-profile.tsx', 'app/(owner)/edit-profile.tsx', 'app/(worker)/edit-profile.tsx', 'app/snow/owner/edit-profile.tsx', 'app/snow/worker/edit-profile.tsx'].every((f) => /EditProfileScreen/.test(read(f))));
console.log(bad ? `\n${bad} failed` : '\nall passed'); process.exit(bad ? 1 : 0);
