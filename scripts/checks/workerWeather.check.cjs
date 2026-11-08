// Run: node scripts/checks/workerWeather.check.cjs <path to typescript package>
// The little weather button on every worker home (project, maintenance, Snow) opens the full forecast, in the worker's own area.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
let n = 0;
const check = (name, ok, detail = '') => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}${ok ? '' : '  - ' + detail}`); };

const home = read('app/(worker)/(tabs)/index.tsx');
const maint = read('app/(worker)/maintenance/index.tsx');
const route = read('src/components/snow/routes/MyRouteScreen.tsx');
check('1 the project worker home has the weather button, pointing at the worker forecast', /<WeatherButton to="\/\(worker\)\/weather"/.test(home));
check('2 the button sits beside the avatar on the right, so the "On Site" pill on the left is never covered', /weatherWrap: \{ position: 'absolute', right:/.test(home));
check('3 the maintenance worker home has it too, at the top left of the picture', /<WeatherButton to="\/\(worker\)\/weather"/.test(maint) && /weatherWrap: \{ position: 'absolute', left:/.test(maint) && /useSafeAreaInsets/.test(maint));
check('4 the Snow worker Route tab has it, and leaves no empty gap when Weather is switched off', /<WeatherButton to="\/snow\/worker\/weather"/.test(route) && /weatherOn && !pastOnly \? </.test(route));
for (const [file, layout] of [['app/(worker)/weather.tsx', 'app/(worker)/_layout.tsx'], ['app/snow/worker/weather.tsx', 'app/snow/worker/_layout.tsx']]) {
  const w = read(file);
  const l = read(layout);
  check(`5 ${file} shows the full forecast (the signed-in version) and the layout slides it up`, /<WeatherHomeScreen embedded \/>/.test(w) && /name="weather" options=\{\{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' \}\}/.test(l));
}
check('6 owners and customers still have theirs', /WeatherButton to="\/\(customer\)\/weather"/.test(read('app/(customer)/(tabs)/index.tsx')) && /WeatherButton to="\/\(owner\)\/weather"/.test(read('app/(owner)/(tabs)/index.tsx')));

console.log(bad ? `\n${bad} of ${n} FAILED` : `\nAll ${n} passed`);
process.exit(bad ? 1 : 0);
