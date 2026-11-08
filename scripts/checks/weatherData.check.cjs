// Run: node scripts/checks/weatherData.check.cjs [path to typescript package]
// Brighton Weather, Phase 2: the weather data converter (supabase/functions/weather/index.ts, the pure part above its marker line).
//   Real samples: scripts/fixtures/nws/* are real NWS responses for Lakewood captured on 2026-10-26 (trimmed). They contain NO snow (it is
//   October), so snowfall maths is ALSO tested with clearly labelled SYNTHETIC blocks (invented numbers, used only inside this test, never shown
//   to anyone). These tests run the converter in Node; the Deno wrapper that fetches NWS is not run here.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const fixture = (n) => JSON.parse(read(`scripts/fixtures/nws/${n}.json`));

const src = read('supabase/functions/weather/index.ts');
const marker = src.indexOf('// ───────────────────────────── Deno edge function below');
const pure = src.slice(0, marker);
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(pure, { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText)(m, m.exports);
const { TOWNS, iconFor, parseValidTime, localDate, snowByLocalDay, normalizeAlerts, normalizeForecast, gridPerHour, windMphOf } = m.exports;

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };
const NY = 'America/New_York';
const NOW = Date.parse('2026-10-26T20:30:00Z'); // 4:30 PM Eastern on the day the samples were captured

// ── towns ──
const keys = Object.keys(TOWNS);
check('1 exactly the eight towns, in the agreed names', JSON.stringify(keys) === JSON.stringify(['lakewood', 'jackson', 'howell', 'toms-river', 'brick', 'manchester', 'freehold', 'point-pleasant']));
check('2 every town has a verified point (4-decimal coordinates), a grid, a forecast zone and the Eastern time zone', keys.every((k) => { const t = TOWNS[k]; const dec = (n) => (String(n).split('.')[1] ?? '').length <= 4; return t.office === 'PHI' && /^NJZ\d{3}$/.test(t.zone) && t.gridX > 0 && t.gridY > 0 && dec(t.lat) && dec(t.lon) && t.lat > 39.9 && t.lat < 40.3 && t.lon < -74 && t.lon > -74.5 && t.tz === NY; }));
check('2b Point Pleasant keeps its own forecast zone (NJZ026), not the county-wide one', TOWNS['point-pleasant'].zone === 'NJZ026' && TOWNS.lakewood.zone === 'NJZ020' && TOWNS.howell.zone === 'NJZ013');

// ── pieces ──
const icons = [['Sunny', true, 'sun'], ['Clear', false, 'moon'], ['Partly Cloudy', true, 'partly'], ['Partly Cloudy', false, 'partlynight'], ['Mostly Clear', false, 'moon'], ['Mostly Clear', true, 'partly'], ['Mostly Sunny', true, 'partly'], ['Mostly Cloudy', true, 'cloud'], ['Overcast', false, 'cloud'], ['Light Snow', true, 'snow'], ['Heavy Snow', true, 'heavysnow'], ['Blizzard', true, 'heavysnow'], ['Chance Rain Showers', true, 'rain'], ['Light Drizzle', true, 'drizzle'], ['Freezing Drizzle', true, 'drizzle'], ['Heavy Rain', true, 'heavyrain'], ['Rain And Snow', true, 'sleet'], ['Wintry Mix', true, 'sleet'], ['Hail', true, 'hail'], ['Patchy Fog', false, 'fog'], ['Areas Of Haze', true, 'haze'], ['Smoke', true, 'smoke'], ['Blowing Dust', true, 'dust'], ['Windy', true, 'wind'], ['Sunny and Breezy', true, 'sun'], ['Slight Chance Thunderstorms', true, 'storm'], ['Freezing Rain', true, 'sleet'], ['', true, 'cloud']];
check('3 weather words map to the right picture', icons.every(([t, d, want]) => iconFor(t, d) === want), JSON.stringify(icons.filter(([t, d, want]) => iconFor(t, d) !== want)));
const p1 = parseValidTime('2026-10-26T14:00:00+00:00/PT4H'); const p2 = parseValidTime('2026-10-26T14:00:00+00:00/P5DT22H'); const p3 = parseValidTime('2026-10-26T14:00:00+00:00/PT30M');
check('4 NWS time spans are read (PT4H, P5DT22H, PT30M); junk is refused', p1.end - p1.start === 4 * 3600000 && p2.end - p2.start === (5 * 24 + 22) * 3600000 && p3.end - p3.start === 1800000 && parseValidTime('nonsense') === null && parseValidTime('2026-10-26T14:00:00Z/PT0H') === null);
check('5 local dates follow Eastern time, including the daylight-saving change on Nov 1 2026', localDate(Date.parse('2026-11-01T03:30:00Z'), NY) === '2026-10-31' && localDate(Date.parse('2026-11-01T05:30:00Z'), NY) === '2026-11-01' && localDate(Date.parse('2026-12-10T04:59:00Z'), NY) === '2026-12-09' && localDate(Date.parse('2026-12-10T05:00:00Z'), NY) === '2026-12-10');

// ── snowfall maths: SYNTHETIC numbers, labelled ──
const day0 = Date.parse('2026-12-10T05:00:00Z'); // midnight Eastern on Dec 10 2026
const synth = [
  { validTime: '2026-12-10T05:00:00+00:00/PT6H', value: 25.4 },   // SYNTHETIC: 1.0 in over 00-06
  { validTime: '2026-12-10T11:00:00+00:00/PT6H', value: 50.8 },   // SYNTHETIC: 2.0 in over 06-12
  { validTime: '2026-12-10T17:00:00+00:00/PT12H', value: 0 },      // SYNTHETIC: a real zero over 12-24
  { validTime: '2026-12-11T05:00:00+00:00/PT6H', value: null },    // SYNTHETIC: a block with no number
  { validTime: '2026-12-11T11:00:00+00:00/PT12H', value: 12.7 },   // SYNTHETIC: 0.5 in over 06-18 only
];
let s = snowByLocalDay(synth, 'wmoUnit:mm', day0, day0 + 3 * 24 * 3600000, NY);
check('6 SYNTHETIC: blocks are added up per local day in inches (1 + 2 + 0 = 3.0)', s['2026-12-10'] === 3);
check('7 a day whose forecast has a block with no number is "unavailable" (null), never 0', s['2026-12-11'] === null, JSON.stringify(s));
check('8 a day only partly covered by blocks is "unavailable" (null)', s['2026-12-12'] === null);
const zero = snowByLocalDay([{ validTime: '2026-12-10T05:00:00+00:00/PT24H', value: 0 }], 'wmoUnit:mm', day0, day0 + 24 * 3600000, NY);
check('9 a real zero stays 0 (it is not unavailable)', zero['2026-12-10'] === 0);
check('10 unknown units or no blocks at all give null for every day', Object.values(snowByLocalDay(synth, 'wmoUnit:weird', day0, day0 + 86400000, NY)).every((v) => v === null) && Object.values(snowByLocalDay(undefined, 'wmoUnit:mm', day0, day0 + 86400000, NY)).every((v) => v === null));
s = snowByLocalDay([{ validTime: '2026-12-10T05:00:00+00:00/PT24H', value: 25.4 }], 'wmoUnit:mm', day0 + 12 * 3600000, day0 + 24 * 3600000, NY);
check('11 "today" counts only the hours still ahead (a 1 in block over 24 h leaves 0.5 in for the second half)', s['2026-12-10'] === 0.5);
check('11b centimeters convert too (2.54 cm = 1 in)', snowByLocalDay([{ validTime: '2026-12-10T05:00:00+00:00/PT24H', value: 2.54 }], 'wmoUnit:cm', day0, day0 + 86400000, NY)['2026-12-10'] === 1);

// ── real Lakewood samples ──
const forecast = fixture('lakewood-forecast'); const hourly = fixture('lakewood-hourly'); const grid = fixture('lakewood-grid');
const alertsNJ = fixture('alerts-nj'); const alertsZone = fixture('alerts-zone-empty');
const out = normalizeForecast({ townKey: 'lakewood', forecast, hourly, grid, alerts: alertsZone, now: NOW });
check('12 REAL: the answer names the town and the source', out.town === 'lakewood' && out.townName === 'Lakewood' && out.source === 'National Weather Service' && out.fetchedAt === NOW);
check('13 REAL: "now" is the hour we are in (4 PM), with a real temperature and the agency\'s own words', out.current && typeof out.current.tempF === 'number' && out.current.text === hourly.properties.periods[0].shortForecast && out.hourly[0].time === hourly.properties.periods[0].startTime, JSON.stringify(out.current));
check('14 REAL: every hour NWS gave from now on (the whole fixture), in order', out.hourly.length === hourly.properties.periods.length - 0 + 0 && out.hourly.length >= 20 && out.hourly.every((h, i) => i === 0 || Date.parse(h.time) > Date.parse(out.hourly[i - 1].time)));
check('15 REAL: up to 7 distinct days, today first', out.daily.length >= 5 && out.daily.length <= 7 && new Set(out.daily.map((d) => d.date)).size === out.daily.length && out.daily[0].date === '2026-10-26', JSON.stringify(out.daily.map((d) => d.date)));
check('16 REAL: highs and lows come from the day and night periods', out.daily[1].highF === forecast.properties.periods.find((p, i) => p.isDaytime && localDate(Date.parse(p.startTime), NY) === out.daily[1].date).temperature && typeof out.daily[1].lowF === 'number');
check('17 REAL: the header high/low is today\'s', out.today.highF === out.daily[0].highF && out.today.lowF === out.daily[0].lowF);
check('18 REAL: today has snowfall data covering the rest of the day, and it is a real 0 (not null)', out.daily[0].snowIn === 0, String(out.daily[0].snowIn));
const unavailable = out.daily.filter((d) => d.snowIn === null).length;
check('19 REAL: days beyond what the raw grid covers are "unavailable" (null), never 0', unavailable >= 1 && out.daily.filter((d) => d.snowIn === 0).length >= 1, JSON.stringify(out.daily.map((d) => [d.date, d.snowIn])));
check('20 REAL: no alerts in the real empty zone answer', out.alerts.length === 0);

// ── alerts ──
const feat = alertsNJ.features.map((f) => f.properties);
const early = Date.parse('2026-10-26T11:00:00Z'); // 7 AM Eastern: the advisories were still in force
const live = normalizeAlerts(alertsNJ, early);
check('21 REAL: a cancelled alert is not shown, the in-force ones are', live.length >= 1 && !live.some((a) => /cancelled/i.test(a.headline)) && feat.some((p) => p.messageType === 'Cancel'));
check('22 REAL: the agency\'s headline and name pass through untouched', live.every((a) => feat.some((p) => p.headline === a.headline && p.senderName === a.sender)) && live[0].sender === 'NWS Mount Holly NJ');
check('23 REAL: alerts that have expired are dropped', normalizeAlerts(alertsNJ, NOW).length === 0);
const mixed = { features: [{ properties: { status: 'Actual', messageType: 'Alert', severity: 'Minor', event: 'A', headline: 'a', expires: '2026-12-01T00:00:00Z' } }, { properties: { status: 'Actual', messageType: 'Alert', severity: 'Severe', event: 'B', headline: 'b', expires: '2026-12-01T00:00:00Z' } }, { properties: { status: 'Test', messageType: 'Alert', severity: 'Extreme', event: 'T', headline: 't', expires: '2026-12-01T00:00:00Z' } }] };
const sorted = normalizeAlerts(mixed, Date.parse('2026-11-30T00:00:00Z'));
check('24 SYNTHETIC: most severe first, and test alerts are dropped', sorted.map((a) => a.event).join() === 'B,A');

// ── missing data never turns into numbers ──
const empty = normalizeForecast({ townKey: 'lakewood', forecast: undefined, hourly: undefined, grid: undefined, alerts: undefined, now: NOW });
check('25 no data at all: no current, no hours, no days, no alerts, no made-up numbers', empty.current === null && empty.hourly.length === 0 && empty.daily.length === 0 && empty.alerts.length === 0 && empty.today.highF === null && empty.today.lowF === null);
const noGrid = normalizeForecast({ townKey: 'lakewood', forecast, hourly, grid: undefined, alerts: undefined, now: NOW });
check('26 forecast without the raw grid: every snowfall figure is "unavailable" (null)', noGrid.daily.length > 0 && noGrid.daily.every((d) => d.snowIn === null));
const celsius = normalizeForecast({ townKey: 'lakewood', forecast: { properties: { periods: [] } }, hourly: { properties: { periods: [{ startTime: '2026-10-26T16:00:00-04:00', endTime: '2026-10-26T17:00:00-04:00', isDaytime: true, temperature: 20, temperatureUnit: 'C', shortForecast: 'Sunny' }] } }, grid: undefined, alerts: undefined, now: NOW });
check('27 a temperature given in Celsius is converted (20 C = 68 F)', celsius.current.tempF === 68);

// ── Phase 2b: the full hourly list and the extra figures ──
const first = out.hourly[0]; const rawFirst = hourly.properties.periods[0];
check('40 REAL: each hour carries wind, humidity and dew point exactly as NWS gave them (dew point in F)', first.windMph === windMphOf(rawFirst.windSpeed) && first.windDir === rawFirst.windDirection && first.humidityPct === rawFirst.relativeHumidity.value && first.dewF === Math.round(rawFirst.dewpoint.value * 9 / 5 + 32), JSON.stringify(first));
check('41 REAL: the fixture grid has no feels-like, gust or cloud series, so those are null (unavailable), never 0', out.hourly.every((h) => h.feelsF === null && h.gustMph === null && h.cloudPct === null));
check('42 wind text: "7 mph" -> 7, "5 to 10 mph" -> 10, junk -> null', windMphOf('7 mph') === 7 && windMphOf('5 to 10 mph') === 10 && windMphOf('') === null && windMphOf(undefined) === null);
const syn = (v) => ({ properties: { apparentTemperature: { uom: 'wmoUnit:degC', values: [{ validTime: '2026-10-26T20:00:00+00:00/PT2H', value: 10 }] }, windGust: { uom: 'wmoUnit:km_h-1', values: [{ validTime: '2026-10-26T20:00:00+00:00/PT2H', value: 16.09344 }] }, quantitativePrecipitation: { uom: 'wmoUnit:mm', values: [{ validTime: '2026-10-26T20:00:00+00:00/PT2H', value: 5.08 }] }, skyCover: { uom: 'wmoUnit:percent', values: [{ validTime: '2026-10-26T20:00:00+00:00/PT3H', value: 40 }] }, ...v } });
const sOut = normalizeForecast({ townKey: 'lakewood', forecast, hourly, grid: syn(), alerts: undefined, now: NOW });
const h0 = sOut.hourly[0]; const h2 = sOut.hourly[2];
check('43 SYNTHETIC grid blocks: feels-like 10 C = 50 F, a 16.09 km/h gust = 10 mph, 5.08 mm over 2 hours = 0.1 in an hour, cloud 40% (block covers 3 hours)', h0.feelsF === 50 && h0.gustMph === 10 && h0.precipIn === 0.1 && h0.cloudPct === 40 && sOut.hourly[1].cloudPct === 40 && sOut.hourly[1].precipIn === null && h2.precipIn === null && h2.feelsF === null, JSON.stringify([h0, h2]));
check('44 an unknown unit gives no number (null), never a guess', normalizeForecast({ townKey: 'lakewood', forecast, hourly, grid: syn({ windGust: { uom: 'wmoUnit:furlong', values: [{ validTime: '2026-10-26T20:00:00+00:00/PT1H', value: 5 }] } }), alerts: undefined, now: NOW }).hourly[0].gustMph === null);
const gph = gridPerHour([{ validTime: '2026-10-26T20:00:00+00:00/PT2H', value: 4 }, { validTime: '2026-10-26T22:00:00+00:00/PT1H', value: null }], 'amount', (v) => v);
check('45 a real 0 stays 0, a null block gives no hour', gridPerHour([{ validTime: '2026-10-26T20:00:00+00:00/PT1H', value: 0 }], 'level', (v) => v).get(Date.parse('2026-10-26T20:00:00Z')) === 0 && gph.get(Date.parse('2026-10-26T20:00:00Z')) === 2 && !gph.has(Date.parse('2026-10-26T22:00:00Z')));

// ── after midnight, yesterday's evening is not a day to list ──
const AFTER_MIDNIGHT = Date.parse('2026-10-27T05:00:00Z'); // 1 AM Eastern on the 27th
const late = normalizeForecast({ townKey: 'lakewood', forecast, hourly, grid, alerts: alertsZone, now: AFTER_MIDNIGHT });
check('46 REAL: at 1 AM the day list starts with today (the 27th), not with the 26th whose forecast is already over', late.daily.length > 0 && late.daily[0].date === '2026-10-27' && late.daily.every((d) => d.date >= '2026-10-27'), JSON.stringify(late.daily.map((d) => d.date)));

// ── any US place: the function, the answer's time zone and the search list ──
const chicago = { name: 'Chicago', lat: 41.85, lon: -87.65, office: 'LOT', gridX: 75, gridY: 72, zone: 'ILZ013', tz: 'America/Chicago' };
const chi = normalizeForecast({ townKey: 'p:41.850,-87.650', town: chicago, displayName: 'Chicago', forecast, hourly, grid, alerts: undefined, now: NOW });
check('47 a place that is not one of the eight is shown by the name it was asked for, with its own time zone in the answer; the eight keep theirs', chi.townName === 'Chicago' && chi.tz === 'America/Chicago' && out.tz === 'America/New_York' && chi.town === 'p:41.850,-87.650', JSON.stringify([chi.townName, chi.tz]));
check('48 the function only ever takes a name from a person as plain text (letters, numbers and a few marks, 60 characters)', /cleanName = \(v: unknown\): string => String\(v \?\? ''\)\.replace\(\/\[\^\\p\{L\}\\p\{N\} \.,'’-\]\/gu, ''\)\.trim\(\)\.slice\(0, 60\)/.test(src));
check('49 a place\'s forecast grid is remembered for a day, and the answer caches are capped, so a flood of different places cannot grow memory without limit', /RESOLVE_TTL_MS = 24 \* 60 \* 60 \* 1000/.test(src) && /MEMORY_MAX = 300/.test(src) && /memory\.size > MEMORY_MAX/.test(src) && /resolved\.size > MEMORY_MAX/.test(src));

// ── the edge wrapper (file text only: it is not run here) ──
const wrap = src.slice(marker);
check('28 the wrapper checks the owner\'s Weather switch BEFORE any request to NWS (including looking a point up), and answers 403 when it is off', wrap.indexOf('weatherIsOn()', wrap.indexOf('serve(')) > -1 && wrap.indexOf('weatherIsOn()', wrap.indexOf('serve(')) < wrap.indexOf('resolvePoint(la, lo', wrap.indexOf('serve(')) && wrap.indexOf('weatherIsOn()', wrap.indexOf('serve(')) < wrap.indexOf('nws(`${grid}', wrap.indexOf('serve(')) && /if \(!on\) return json\(403/.test(wrap));
check('29 if the switch cannot be read it serves nothing (503), never data', /if \(on === null\) return json\(503/.test(wrap));
check('30 it answers for the eight known towns and for any US point (rounded, inside US bounds, looked up from NWS /points), refuses anything else with 400, identifies itself to NWS, and falls back to the last good answer marked stale', /return json\(400, \{ error: 'town' \}\)/.test(wrap) && /return json\(400, \{ error: 'place' \}\)/.test(wrap) && /return json\(404, \{ error: 'place' \}\)/.test(wrap) && /\/points\//.test(wrap) && /User-Agent/.test(wrap) && /stale: true/.test(wrap));
check('31 it is one self-contained file (no relative imports)', !/from '\.{1,2}\//.test(src));

// ── the app side (file text only) ──
const townsBlock = (() => { const t = read('src/lib/weatherTowns.ts'); return t.slice(t.indexOf('export const WEATHER_TOWNS'), t.indexOf('] as const')); })();
const appTowns = [...townsBlock.matchAll(/key: '([a-z-]+)', name: '([^']+)'/g)].map((x) => [x[1], x[2]]);
check('32 the app\'s town list is the same eight towns, with the same keys and names, as the data function', JSON.stringify(appTowns.map((x) => x[0])) === JSON.stringify(keys) && appTowns.every(([k, n]) => TOWNS[k].name === n), JSON.stringify(appTowns));
const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const weatherFiles = [...walk('app/weather'), 'src/data/weather.ts', 'src/hooks/useWeather.ts', ...walk('src/components/weather')].filter((f) => /\.(ts|tsx)$/.test(f));
check('33 the Weather screens never talk to NWS or any weather provider themselves: only the data function', weatherFiles.every((f) => !/api\.weather\.gov|weatherapi|open-meteo|visualcrossing|weatherkit/i.test(read(f))) && /functions\.invoke\('weather'/.test(read('src/data/weather.ts')));
check('34 no device-location permission is requested anywhere in the Weather screens', weatherFiles.every((f) => !/expo-location|requestForegroundPermissions|geolocation/i.test(read(f))));
check('35 snow is only mentioned on a day when snow is expected (a trace or more); a day with none, or with no figure, says nothing about snow, and a missing figure is never turned into 0', /if \(k === 'trace'\) return/.test(read('app/weather/(tabs)/index.tsx')) && /if \(k === 'amount'\) return/.test(read('app/weather/(tabs)/index.tsx')) && !/Snow: unavailable|Snow: none/.test(read('app/weather/(tabs)/index.tsx')) && /return null;/.test(read('app/weather/(tabs)/index.tsx')));
check('36 the Sign In buttons open the app\'s existing welcome screen (nothing is redrawn)', (read('app/weather/(tabs)/index.tsx').match(/router\.push\('\/\(auth\)\/welcome' as any\)/g) ?? []).length === 1 && /router\.push\('\/\(auth\)\/welcome' as any\)/.test(read('app/weather/(tabs)/account.tsx')));
check('37 the Weather area re-asks the owner\'s switch every 60 seconds while it is open', /setInterval\(\(\) => \{ void weatherSwitch\.refresh\(\); \}, 60_000\)/.test(read('app/weather/_layout.tsx')));
check('38 a refusal from the data function ("disabled") makes the app re-ask the switch at once', /reason === 'disabled'/.test(read('src/hooks/useWeather.ts')) && /weatherSwitch\.refresh\(\)/.test(read('src/hooks/useWeather.ts')));
check('39 the owner\'s on/off row asks before turning Weather on or off', /confirmAction\('Turn on Brighton Weather\?'/.test(read('src/hooks/usePublicWeatherRow.ts')) && /confirmAction\('Turn off Brighton Weather\?'/.test(read('src/hooks/usePublicWeatherRow.ts')));

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
