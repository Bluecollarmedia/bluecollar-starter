// Run: node scripts/checks/weatherButton.check.cjs <path to typescript package>
// The little weather button on the owner's and the customer's home, and the full forecast it opens inside their own area.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const has = (p) => fs.existsSync(path.join(root, p));
let bad = 0;
let n = 0;
const check = (name, ok, detail = '') => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}${ok ? '' : '  - ' + detail}`); };

const button = read('src/components/weather/WeatherButton.tsx');
check('1 the button is only there while the owner\'s Weather switch is on (never a dead button)', /usePublicWeatherSwitch\(false\)/.test(button) && /if \(!on\) return null/.test(button));
check('2 it opens the route it is given and springs when pressed', /router\.push\(to as any\)/.test(button) && /withSpring/.test(button));
const hook = read('src/hooks/useWeatherGlance.ts');
check('3 its picture and temperature come from the forecast saved on the phone, never from a request of its own', /readLastWeather/.test(hook) && !/loadWeather|functions\.invoke|fetch\(/.test(hook));

check('4 the owner dashboard, the customer home and the Snow dashboard each have the button at the top left', /<WeatherButton to="\/\(owner\)\/weather"/.test(read('app/(owner)/(tabs)/index.tsx')) && /<WeatherButton to="\/\(customer\)\/weather"/.test(read('app/(customer)/(tabs)/index.tsx')) && /<WeatherButton to="\/snow\/owner\/weather"/.test(read('src/components/snow/dashboard/SnowDashboardScreen.tsx')));
const areas = [['app/(owner)', '_layout.tsx'], ['app/(customer)', '_layout.tsx'], ['app/snow/owner', '_layout.tsx']];
check('5 each area has its own weather screen, registered as a full-screen slide-up inside that area (so nobody is moved out of it)', areas.every(([d, l]) => has(`${d}/weather.tsx`) && /name="weather" options=\{\{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' \}\}/.test(read(`${d}/${l}`))));
const route = read('app/(owner)/weather.tsx');
check('6 the screen fades its content in and shows the signed-in version of the forecast', /FadeIn/.test(route) && /<WeatherHomeScreen embedded \/>/.test(route));
const home = read('app/weather/(tabs)/index.tsx');
check('7 the signed-in forecast has Close in place of Sign In, and the storm outlook opens as a sheet, not a public route', /embedded \? \(/.test(home) && /router\.back\(\)/.test(home) && /embedded \? setOutlookOpen\(true\)/.test(home) && /presentationStyle="pageSheet"/.test(home));
const outlook = read('app/weather/(tabs)/outlook.tsx');
check('8 inside the sheet nothing sends the person to the public Weather routes', /embedded \? goBack\(\)/.test(outlook) && /embedded \? undefined/.test(outlook));
check('9 the public Weather route is unchanged: it still shows Sign In', /export default function WeatherHome\(\) \{\s*return <WeatherHomeScreen \/>;/.test(home) && /router\.push\('\/\(auth\)\/welcome' as any\)/.test(home));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
