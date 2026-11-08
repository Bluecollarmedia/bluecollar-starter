// Run: node scripts/checks/oneProfileEntry.check.cjs
// Every Settings / Account / More screen has ONE way into Edit Profile: tapping your name card. No separate
// "Your profile", photo, name, phone or Edit Profile rows, and no second shortcut elsewhere.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + d}`); };
const count = (s, re) => (s.match(re) || []).length;

const screens = {
  'customer Account': ['app/(customer)/(tabs)/account.tsx', /edit-profile/g],
  'owner Settings': ['app/(owner)/(tabs)/more/settings.tsx', /edit-profile/g],
  'worker Settings': ['app/(worker)/(tabs)/settings.tsx', /edit-profile/g],
  'Snow owner More': ['app/snow/owner/(tabs)/more.tsx', /edit-profile/g],
  'Snow worker Settings': ['src/components/snow/SnowWorkerSettings.tsx', /editProfile\b/g],
};
for (const [name, [file, re]] of Object.entries(screens)) {
  const s = read(file);
  // snow worker uses a local helper called twice if there were two rows; count the actual onPress uses
  const uses = name === 'Snow worker Settings' ? count(s, /onPress=\{editProfile\}/g) : count(s, re);
  check(`${name}: exactly one way into Edit Profile`, uses === 1, `found ${uses}`);
}
const banned = /title="(Edit profile & photo|Edit Profile & Photo|Your profile and photo|Add a profile photo|Change profile photo|Name|Phone)"|title=\{user\?\.avatarUrl \? 'Change profile photo'/i;
for (const f of Object.values(screens).map((x) => x[0])) check(`${f}: no separate profile / photo / name / phone rows`, !banned.test(read(f)));
check('owner dashboard avatar is display-only (no second shortcut to Edit Profile)', !/edit-profile/.test(read('app/(owner)/(tabs)/index.tsx')));
check('the Snow worker Settings has no "Your profile" group', !/title="Your profile"/.test(read('src/components/snow/SnowWorkerSettings.tsx')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
