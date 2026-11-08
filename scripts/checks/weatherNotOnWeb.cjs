// The public Weather is phone-only: the website never routes anyone to it.
const fs = require('fs');
const read = (p) => fs.readFileSync(p, 'utf8');
let bad = 0; let n = 0;
const check = (name, ok) => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}`); };
check('the device flag is off on web', /Platform\.OS !== 'web'/.test(read('src/lib/weatherPlatform.ts')));
check('the entry route and the switch hook use the device flag', /WEATHER_ON_THIS_DEVICE/.test(read('app/index.tsx')) && /WEATHER_ON_THIS_DEVICE/.test(read('src/hooks/usePublicWeatherSwitch.ts')));
check('a weather address on the website redirects to the normal entry', /if \(!WEATHER_ON_THIS_DEVICE\) return <Redirect href="\/" \/>/.test(read('app/weather/_layout.tsx')));
check("the owner's storm write-up is not gated by it", !/WEATHER_ON_THIS_DEVICE/.test(read('app/(owner)/storm-outlook.tsx')));
process.exit(bad ? 1 : 0);
