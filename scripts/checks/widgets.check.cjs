// Run: node scripts/checks/widgets.check.cjs [path to typescript package]
// The Brighton Forecast widgets. UNIT tests run the real data builder (src/lib/widgetData.ts) in Node; STATIC checks read file text.
// Not covered here (needs a real iPhone with a new build): how the widgets actually look, the gallery, refresh timing, the lock screen.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const cache = {};
const load = (p) => {
  if (cache[p]) return cache[p];
  const m = { exports: {} };
  cache[p] = m.exports;
  const req = (id) => (id.startsWith('@/') ? load(id.replace('@/', 'src/') + '.ts') : require(id));
  new Function('module', 'exports', 'require', ts.transpileModule(read(p), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports, req);
  cache[p] = m.exports;
  return m.exports;
};
let bad = 0;
let n = 0;
const check = (name, ok, detail = '') => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}${ok ? '' : '  - ' + detail}`); };
const { buildWidgetEntries, WIDGET_HOURS } = load('src/lib/widgetData.ts');

const T0 = Date.parse('2026-12-08T15:00:00Z'); // 10 AM Eastern
const hour = (i, o = {}) => ({ time: new Date(T0 + i * 3_600_000).toISOString(), tempF: 40 + i, popPct: 10, icon: 'sun', feelsF: 38, windMph: 5, windDir: 'N', gustMph: null, humidityPct: 50, dewF: 30, precipIn: 0, cloudPct: 10, uvIndex: 3, ...o });
const hours = (o) => Array.from({ length: 40 }, (_, i) => hour(i, o));
const payload = (o = {}) => ({
  town: 'lakewood', townName: 'Lakewood', fetchedAt: T0, updatedAt: null, tz: 'America/New_York',
  current: { tempF: 41, text: 'Mostly Sunny', icon: 'sun', isDaytime: true }, today: { highF: 61, lowF: 38 },
  hourly: hours(), daily: [], alerts: [], source: 'x', ...o,
});
const NOW = T0 + 20 * 60_000; // 10:20 AM
const first = (p) => buildWidgetEntries(p, NOW, null)[0].props;

const e = buildWidgetEntries(payload(), NOW, null);
check('one entry per coming hour (24), the first one is for right now', e.length === WIDGET_HOURS && e[0].date.getTime() === NOW);
check('later entries start on the hour', e[1].date.getTime() === T0 + 3_600_000 && e[2].date.getTime() === T0 + 2 * 3_600_000);
check('the first entry uses the current conditions; later ones use that hour', e[0].props.temp === '41°' && e[0].props.condition === 'Mostly Sunny' && e[1].props.temp === '41°' && e[2].props.temp === '42°' && e[2].props.condition === 'Sunny', JSON.stringify([e[1].props.temp, e[2].props.temp, e[2].props.condition]));
check('the strip starts with "Now" then the next odd hours (+1, +3, +5, +7), five entries', e[0].props.hours.length === 5 && e[0].props.hours[0].label === 'Now' && e[0].props.hours[1].temp === '41°' && e[0].props.hours[2].temp === '43°' && e[0].props.hours[4].temp === '47°', JSON.stringify(e[0].props.hours));
check('high and low are shown together', e[0].props.highLow === 'H 61°  L 38°');
check('a clear forecast says no rain is expected; a wet one gives the chance', e[0].props.rain === 'No rain expected' && first(payload({ hourly: hours({ popPct: 70 }) })).rain === 'Rain chance 70%');
check('no rain figure at all gives no rain line (never an invented "no rain")', first(payload({ hourly: hours({ popPct: null }) })).rain === '');
check('UV is shown only when there is a figure of 1 or more', e[0].props.uv === 'UV 3' && first(payload({ hourly: hours({ uvIndex: 0 }) })).uv === '' && first(payload({ hourly: hours({ uvIndex: null }) })).uv === '');
check('a missing temperature is an en dash, never 0', first(payload({ current: { tempF: null, text: '', icon: 'sun', isDaytime: true }, hourly: hours({ tempF: null }) })).temp === '–');
check('missing high and low show nothing rather than 0', first(payload({ today: { highF: null, lowF: null } })).highLow === '');

check('a posted storm outlook never appears on the widgets (the owner does not want it there)', !('storm' in first(payload())) && !/STORM OUTLOOK|\.storm/.test(read('src/widgets/BrightonWeather.tsx')) && !/storm/i.test(read('src/data/widgetSync.ts').replace(/\/\*[\s\S]*?\*\//g, '')));

const bare = buildWidgetEntries(payload({ hourly: [] }), NOW, null);
check('with no hourly forecast there is one honest entry from the current conditions', bare.length === 1 && bare[0].props.temp === '41°' && bare[0].props.hours.length === 0);
check('every entry carries the place; the gauge only appears when low and high make sense', e.every((x) => x.props.place === 'Lakewood') && !!e[0].props.gauge && e[0].props.gauge.low === 38 && first(payload({ today: { highF: 40, lowF: 40 } })).gauge === null);

// ── static ──
const w = read('src/widgets/BrightonWeather.tsx');
check('the widget declares the widget directive and every approved size', w.includes("'widget';") && ['systemSmall', 'accessoryCircular', 'accessoryRectangular', 'accessoryInline'].every((f) => w.includes(f)) && w.includes('BRIGHTON FORECAST'));
check('tapping any widget opens the weather screen', w.includes('brighton-lawn://weather'));
const sync = read('src/data/widgetSync.ts');
check('syncing does nothing off the iPhone and never throws (older builds without widgets just skip it)', sync.includes("Platform.OS !== 'ios'") && /try \{[\s\S]*require\('expo-widgets'\)[\s\S]*\} catch/.test(sync));
check('the weather screen feeds the widgets', read('app/weather/(tabs)/index.tsx').includes('syncWidgets(data)'));
const hook = read('src/hooks/useWidgetSync.ts');
check('the widgets are fed in the background for everyone, signed in or not (mounted in the root layout, not in the weather screen)', /useWidgetSync\(\);/.test(read('app/_layout.tsx')) && /loadWeather\(place\)/.test(hook) && /readLastWeather/.test(hook) && !/useAuth|isAuthenticated/.test(hook));
const app = JSON.parse(read('app.json'));
const plug = app.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-widgets');
check('app.json sets up the widget with an app group and the five sizes', !!plug && plug[1].groupIdentifier === 'group.com.brightonlawn.app' && plug[1].widgets[0].name === 'BrightonWeather' && plug[1].widgets[0].ios.supportedFamilies.length === 5);
process.exit(bad ? 1 : 0);
