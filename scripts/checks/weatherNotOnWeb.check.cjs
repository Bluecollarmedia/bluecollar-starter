// Run: node scripts/checks/weatherNotOnWeb.check.cjs
// The public Weather is phone-only: the website never routes anyone to it.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0; let n = 0;
const check = (name, ok) => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}`); };
check('the device flag is off on web', /Platform\.OS !== 'web'/.test(read('src/lib/weatherPlatform.ts')));
check('the entry route and the switch hook use the device flag', /WEATHER_ON_THIS_DEVICE/.test(read('app/index.tsx')) && /WEATHER_ON_THIS_DEVICE/.test(read('src/hooks/usePublicWeatherSwitch.ts')));
check('a weather address on the website (or with the visitor area switched off in the settings file) redirects to the normal entry', /if \(!WEATHER_ON_THIS_DEVICE \|\| !PUBLIC_AREA_IN_APP\) return <Redirect href="\/" \/>;/.test(read('app/weather/_layout.tsx')));
console.log(bad ? `\n${bad} of ${n} FAILED` : `\nAll ${n} passed`);
process.exit(bad ? 1 : 0);
