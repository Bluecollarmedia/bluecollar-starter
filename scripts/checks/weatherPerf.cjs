// Performance guards for the weather area: shared requests, kept-alive tabs, bounded caches, memoised chart.
const fs = require('fs');
const read = (p) => fs.readFileSync(p, 'utf8');
let n = 0; let bad = 0;
const check = (name, ok) => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}`); };

const shared = read('src/lib/sharedRequest.ts');
check('one request per key at a time (shareInFlight)', /export function shareInFlight/.test(shared));
check('weather, switch and storm reads share in-flight requests',
  /shareInFlight\(`weather:/.test(read('src/data/weather.ts')) && /shareInFlight\('weather\.switch'/.test(read('src/data/publicWeather.ts')) && /shareInFlight\('storm\.current'/.test(read('src/data/stormOutlook.ts')));
check('the weather screens are kept-alive tabs, not a Slot', /<Tabs/.test(read('app/weather/_layout.tsx')) && !/<Slot/.test(read('app/weather/_layout.tsx')));
check('the home screen no longer re-renders every 30 s', !/setNow\(Date\.now\(\)\), 30_000/.test(read('app/weather/(tabs)/index.tsx')) && /function useToday/.test(read('app/weather/(tabs)/index.tsx')));
const d = read('src/components/weather/WeatherDetails.tsx');
check('the chart is built once per metric/day (memoised) and tiles follow deferred', /buildChart/.test(d) && /useDeferredValue/.test(d));
check('saved forecasts are bounded to 12 places', /FORECAST_CACHE_MAX = 12/.test(read('src/data/weather.ts')));
check('the place search is deferred and the town list warmed', /useDeferredValue/.test(read('src/components/weather/PlacePicker.tsx')) && /runAfterInteractions/.test(read('src/components/weather/PlacePicker.tsx')));
console.log(bad ? 'FAILED' : 'all passed');
process.exit(bad ? 1 : 0);
