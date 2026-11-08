// Run: node scripts/checks/navigation.check.cjs
// Guards a navigation bug found on a real phone: Back from Privacy/Terms/Support went to the Dashboard (the root layout rebuilt the
// navigator for public pages).
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };

const layout = read('app/_layout.tsx');
check('1 the root layout never returns a bare <Slot /> for public pages (that rebuilt the navigator)', !/if \(isPublicPage\) \{\s*return <Slot \/>;/.test(layout));
check('2 the same tree is returned for public and normal pages: <Slot /> then optional overlays (the welcome) and the dialog host for the website (always there)', /<>\s*<Slot \/>\s*\{isPublicPage \? null : <SignInWelcome \/>\}\s*<WebDialogHost \/>\s*<\/>/.test(layout));
check('3 the splash still shows for normal pages while loading, but not for public pages', /!isPublicPage && \(isLoading \|\| !splashDone\)/.test(layout));
check('4c profile photos no longer use the built-in crop screen', !/allowsEditing: true/.test(read('src/components/account/EditProfileScreen.tsx')) && !/allowsEditing: true/.test(read('app/invite/[token].tsx')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
