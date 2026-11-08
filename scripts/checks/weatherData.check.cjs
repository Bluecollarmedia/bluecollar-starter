// Run: node scripts/checks/weatherData.check.cjs [path to typescript package]
// Weather, Phase 2: the weather data converter (supabase/functions/weather/index.ts, the pure part above its marker line).
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
const { iconFor, parseValidTime, localDate, snowByLocalDay, normalizeAlerts, normalizeForecast, gridPerHour, windMphOf, parsePoint, pointKey, placeFromPoints } = m.exports;

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };
const NY = 'America/New_York';
const NOW = Date.parse('2026-10-26T20:30:00Z'); // 4:30 PM Eastern on the day the samples were captured

// ── the place: the point the app sends, looked up with NWS /points (the function keeps NO town list) ──
const points = fixture('lakewood-points');
const LKW = placeFromPoints(points, 40.077, -74.199, 'Lakewood');
check('1 the NWS /points answer gives the forecast grid, the alert zone and the place\'s own time zone', LKW && LKW.office === 'PHI' && LKW.gridX === 82 && LKW.gridY === 89 && LKW.zone === 'NJZ020' && LKW.tz === NY && LKW.name === 'Lakewood', JSON.stringify(LKW));
check('2 a /points answer without a grid (a place NWS does not forecast) gives no place', placeFromPoints({ properties: { gridId: null } }, 1, 1, 'x') === null && placeFromPoints(undefined, 1, 1, 'x') === null);
const pp = (lat, lon) => parsePoint({ lat, lon });
check('2b the point is checked: real numbers only, rounded to 3 decimals, inside the NWS area (lower 48, Alaska, Hawaii, Puerto Rico); anything else is refused',
  JSON.stringify(pp(40.07714, -74.19851)) === JSON.stringify({ lat: 40.077, lon: -74.199 }) && !!pp(61.2181, -149.9003) && !!pp(21.3069, -157.8583) && !!pp(18.4655, -66.1057)
  && pp(51.5, -0.12) === null && pp(19.43, -99.13) === null && pp(45.4, -60) === null && pp('40', '-74') === null && pp(null, null) === null && pp(NaN, -74) === null
  && parsePoint(null) === null && parsePoint({ town: 'lakewood' }) === null && pointKey(40.077, -74.199) === '40.077,-74.199');

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
const out = normalizeForecast({ townKey: 'lakewood', town: LKW, forecast, hourly, grid, alerts: alertsZone, now: NOW });
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
const empty = normalizeForecast({ townKey: 'lakewood', town: LKW, forecast: undefined, hourly: undefined, grid: undefined, alerts: undefined, now: NOW });
check('25 no data at all: no current, no hours, no days, no alerts, no made-up numbers', empty.current === null && empty.hourly.length === 0 && empty.daily.length === 0 && empty.alerts.length === 0 && empty.today.highF === null && empty.today.lowF === null);
const noGrid = normalizeForecast({ townKey: 'lakewood', town: LKW, forecast, hourly, grid: undefined, alerts: undefined, now: NOW });
check('26 forecast without the raw grid: every snowfall figure is "unavailable" (null)', noGrid.daily.length > 0 && noGrid.daily.every((d) => d.snowIn === null));
const celsius = normalizeForecast({ townKey: 'lakewood', town: LKW, forecast: { properties: { periods: [] } }, hourly: { properties: { periods: [{ startTime: '2026-10-26T16:00:00-04:00', endTime: '2026-10-26T17:00:00-04:00', isDaytime: true, temperature: 20, temperatureUnit: 'C', shortForecast: 'Sunny' }] } }, grid: undefined, alerts: undefined, now: NOW });
check('27 a temperature given in Celsius is converted (20 C = 68 F)', celsius.current.tempF === 68);

// ── Phase 2b: the full hourly list and the extra figures ──
const first = out.hourly[0]; const rawFirst = hourly.properties.periods[0];
check('40 REAL: each hour carries wind, humidity and dew point exactly as NWS gave them (dew point in F)', first.windMph === windMphOf(rawFirst.windSpeed) && first.windDir === rawFirst.windDirection && first.humidityPct === rawFirst.relativeHumidity.value && first.dewF === Math.round(rawFirst.dewpoint.value * 9 / 5 + 32), JSON.stringify(first));
check('41 REAL: the fixture grid has no feels-like, gust or cloud series, so those are null (unavailable), never 0', out.hourly.every((h) => h.feelsF === null && h.gustMph === null && h.cloudPct === null));
check('42 wind text: "7 mph" -> 7, "5 to 10 mph" -> 10, junk -> null', windMphOf('7 mph') === 7 && windMphOf('5 to 10 mph') === 10 && windMphOf('') === null && windMphOf(undefined) === null);
const syn = (v) => ({ properties: { apparentTemperature: { uom: 'wmoUnit:degC', values: [{ validTime: '2026-10-26T20:00:00+00:00/PT2H', value: 10 }] }, windGust: { uom: 'wmoUnit:km_h-1', values: [{ validTime: '2026-10-26T20:00:00+00:00/PT2H', value: 16.09344 }] }, quantitativePrecipitation: { uom: 'wmoUnit:mm', values: [{ validTime: '2026-10-26T20:00:00+00:00/PT2H', value: 5.08 }] }, skyCover: { uom: 'wmoUnit:percent', values: [{ validTime: '2026-10-26T20:00:00+00:00/PT3H', value: 40 }] }, ...v } });
const sOut = normalizeForecast({ townKey: 'lakewood', town: LKW, forecast, hourly, grid: syn(), alerts: undefined, now: NOW });
const h0 = sOut.hourly[0]; const h2 = sOut.hourly[2];
check('43 SYNTHETIC grid blocks: feels-like 10 C = 50 F, a 16.09 km/h gust = 10 mph, 5.08 mm over 2 hours = 0.1 in an hour, cloud 40% (block covers 3 hours)', h0.feelsF === 50 && h0.gustMph === 10 && h0.precipIn === 0.1 && h0.cloudPct === 40 && sOut.hourly[1].cloudPct === 40 && sOut.hourly[1].precipIn === null && h2.precipIn === null && h2.feelsF === null, JSON.stringify([h0, h2]));
check('44 an unknown unit gives no number (null), never a guess', normalizeForecast({ townKey: 'lakewood', town: LKW, forecast, hourly, grid: syn({ windGust: { uom: 'wmoUnit:furlong', values: [{ validTime: '2026-10-26T20:00:00+00:00/PT1H', value: 5 }] } }), alerts: undefined, now: NOW }).hourly[0].gustMph === null);
const gph = gridPerHour([{ validTime: '2026-10-26T20:00:00+00:00/PT2H', value: 4 }, { validTime: '2026-10-26T22:00:00+00:00/PT1H', value: null }], 'amount', (v) => v);
check('45 a real 0 stays 0, a null block gives no hour', gridPerHour([{ validTime: '2026-10-26T20:00:00+00:00/PT1H', value: 0 }], 'level', (v) => v).get(Date.parse('2026-10-26T20:00:00Z')) === 0 && gph.get(Date.parse('2026-10-26T20:00:00Z')) === 2 && !gph.has(Date.parse('2026-10-26T22:00:00Z')));

// ── after midnight, yesterday's evening is not a day to list ──
const AFTER_MIDNIGHT = Date.parse('2026-10-27T05:00:00Z'); // 1 AM Eastern on the 27th
const late = normalizeForecast({ townKey: 'lakewood', town: LKW, forecast, hourly, grid, alerts: alertsZone, now: AFTER_MIDNIGHT });
check('46 REAL: at 1 AM the day list starts with today (the 27th), not with the 26th whose forecast is already over', late.daily.length > 0 && late.daily[0].date === '2026-10-27' && late.daily.every((d) => d.date >= '2026-10-27'), JSON.stringify(late.daily.map((d) => d.date)));

// ── any US place: the function, the answer's time zone and the search list ──
const chicago = { name: 'Chicago', lat: 41.85, lon: -87.65, office: 'LOT', gridX: 75, gridY: 72, zone: 'ILZ013', tz: 'America/Chicago' };
const chi = normalizeForecast({ townKey: 'p:41.850,-87.650', town: chicago, displayName: 'Chicago', forecast, hourly, grid, alerts: undefined, now: NOW });
check('47 every place is shown by the name it was asked for, with its own time zone in the answer', chi.townName === 'Chicago' && chi.tz === 'America/Chicago' && out.tz === 'America/New_York' && chi.town === 'p:41.850,-87.650', JSON.stringify([chi.townName, chi.tz]));
check('48 the function only ever takes a name from a person as plain text (letters, numbers and a few marks, 60 characters)', /cleanName = \(v: unknown\): string => String\(v \?\? ''\)\.replace\(\/\[\^\\p\{L\}\\p\{N\} \.,'’-\]\/gu, ''\)\.trim\(\)\.slice\(0, 60\)/.test(src));
check('49 a place\'s forecast grid is remembered for a day, and the answer caches are capped, so a flood of different places cannot grow memory without limit', /RESOLVE_TTL_MS = 24 \* 60 \* 60 \* 1000/.test(src) && /MEMORY_MAX = 300/.test(src) && /memory\.size >= MEMORY_MAX/.test(src) && /cache\.size >= MEMORY_MAX/.test(src));

// ── the whole lookup flow, with NWS faked by the saved real answers (mock fetch) ──
const { resolvePoint, forecastFor } = m.exports;
const FIX = { [`/points/${pointKey(40.077, -74.198)}`]: points, '/gridpoints/PHI/82,89/forecast': forecast, '/gridpoints/PHI/82,89/forecast/hourly': hourly, '/gridpoints/PHI/82,89': grid, '/alerts/active?zone=NJZ020': alertsZone };
const asked = [];
const fakeNws = async (p) => { asked.push(p); if (!(p in FIX)) throw new Error(`NWS 404 ${p}`); return JSON.parse(JSON.stringify(FIX[p])); };
const flow = (async () => {
  const cache = new Map();
  const pt = parsePoint({ lat: 40.0771, lon: -74.1985 });
  const t1 = await resolvePoint(fakeNws, cache, pt.lat, pt.lon, 'Lakewood', NOW);
  const t2 = await resolvePoint(fakeNws, cache, pt.lat, pt.lon, 'Lakewood', NOW + 3600000);
  const pointAsks = asked.filter((p) => p.startsWith('/points/')).length;
  const t3 = await resolvePoint(fakeNws, cache, pt.lat, pt.lon, 'Lakewood', NOW + 25 * 3600000);
  check('50 MOCK FETCH: the app\'s point is looked up with NWS /points/{lat},{lon} and the grid is kept: a second ask within a day does not call NWS again; after a day it does',
    t1 && t1.office === 'PHI' && t1.gridX === 82 && t1.zone === 'NJZ020' && t2 && t2.gridY === 89 && pointAsks === 1 && asked[0] === '/points/40.077,-74.198' && t3 && asked.filter((p) => p.startsWith('/points/')).length === 2, JSON.stringify(asked));
  const none = await resolvePoint(fakeNws, cache, 47.6, -122.3, 'Nowhere', NOW);
  check('51 MOCK FETCH: a point NWS cannot answer for gives no place (the function then answers 404), and is not remembered as a failure', none === null && !cache.has('47.600,-122.300'));
  const ans = await forecastFor(fakeNws, t1, 'Lakewood', NOW);
  check('52 MOCK FETCH: the forecast is then read from that grid (forecast, hourly, raw grid, alerts for its zone) and shaped as before, with the place\'s time zone from /points',
    ans.townName === 'Lakewood' && ans.tz === NY && ans.hourly.length === out.hourly.length && JSON.stringify(ans.daily) === JSON.stringify(out.daily) && ans.alerts.length === 0
    && ['/gridpoints/PHI/82,89/forecast', '/gridpoints/PHI/82,89/forecast/hourly', '/gridpoints/PHI/82,89', '/alerts/active?zone=NJZ020'].every((p) => asked.includes(p)));
})();

// ── ONE town list: the settings file. The function holds none. ──
// Comments are dropped (a line comment only where // starts a line or follows a space, so web addresses stay).
const srcNoComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
check('53 the weather function contains NO hard-coded town list (no TOWNS, no town names, forecast zones or grid squares typed in) and accepts no town key',
  !/\bTOWNS\b/.test(src) && !/Lakewood|Toms River|Point Pleasant|Jackson|Howell|NJZ\d{3}|gridX: \d|office: '[A-Z]{3}'/.test(srcNoComments) && !/body\.town|body\?\.town/.test(src));
check('53b the settings file (src/config/brand.js, weather.defaultPlace + nearbyTowns) is the only town list: every town has a real US point the function accepts',
  [require('./_brand.cjs').brand.weather.defaultPlace, ...require('./_brand.cjs').brand.weather.nearbyTowns].every((t) => !!parsePoint({ lat: t.lat, lon: t.lon })) && !/nearbyTowns|TOWNS/.test(srcNoComments));

// ── the edge wrapper (file text only: it is not run here) ──
const wrap = src.slice(marker);
const at = (s) => wrap.indexOf(s, wrap.indexOf('serve('));
check('28 the wrapper checks who may ask (signed in, or the owner\'s public visitor area switch for signed-out visitors) BEFORE any request to NWS (including looking a point up), and answers 403 when refused', at('weatherIsOn(req)') > -1 && at('weatherIsOn(req)') < at('resolvePoint(nws') && at('weatherIsOn(req)') < at('forecastFor(nws') && /if \(!on\) return json\(403/.test(wrap));
check('28b signed-in people get weather without the public switch (their own sign-in token is checked with Supabase Auth; the public key alone is not a sign-in), and WEATHER_ENABLED=false refuses everyone', /async function isSignedIn\(req: Request\)/.test(wrap) && /token === ANON_KEY\) return false/.test(wrap) && /auth\.getUser\(token\)/.test(wrap) && /if \(await isSignedIn\(req\)\) return true;/.test(wrap) && /WEATHER_ENABLED/.test(wrap) && wrap.indexOf("WEATHER_ENABLED") < wrap.indexOf('if (await isSignedIn(req)) return true;'));
check('29 if the switch cannot be read it serves nothing (503), never data', /if \(on === null\) return json\(503/.test(wrap));
check('30 it answers for the point the app sends (checked by parsePoint, looked up from NWS /points), refuses anything else with 400, identifies itself to NWS, and falls back to the last good answer marked stale', /const point = parsePoint\(body\);/.test(wrap) && /if \(!point\) return json\(400, \{ error: 'place' \}\)/.test(wrap) && /return json\(404, \{ error: 'place' \}\)/.test(wrap) && /\/points\//.test(src) && /User-Agent/.test(wrap) && /stale: true/.test(wrap));
check('31 it is one self-contained file (no relative imports)', !/from '\.{1,2}\//.test(src));

// ── the app side (file text only) ──
// The app's nearby towns come from the settings file (src/config/brand.js, weather.nearbyTowns); weatherTowns.ts reads them from there.
const { brand } = require('./_brand.cjs');
check('32 the app asks for every place by its map point (lat/lon from the settings file or the place picked), never by a town key the function would have to know',
  /const body = \{ lat: place\.lat, lon: place\.lon, name: place\.name, state: place\.state \};/.test(read('src/data/weather.ts')) && !/town: place\.key, \.\.\.point|isBuiltInKey/.test(read('src/data/weather.ts')));
check('32b the app reads its towns and first place from the settings file, and the first place is a real US point', /WEATHER_TOWNS: readonly Place\[\] = brand\.weather\.nearbyTowns/.test(read('src/lib/weatherTowns.ts')) && /DEFAULT_PLACE: Place = brand\.weather\.defaultPlace/.test(read('src/lib/weatherTowns.ts')) && brand.weather.defaultPlace.lat > 17 && brand.weather.defaultPlace.lat < 72 && brand.weather.defaultPlace.lon > -180 && brand.weather.defaultPlace.lon < -60);
const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const weatherFiles = [...walk('app/weather'), 'src/data/weather.ts', 'src/hooks/useWeather.ts', ...walk('src/components/weather')].filter((f) => /\.(ts|tsx)$/.test(f));
check('33 the Weather screens never talk to NWS or any weather provider themselves: only the data function', weatherFiles.every((f) => !/api\.weather\.gov|weatherapi|open-meteo|visualcrossing|weatherkit/i.test(read(f))) && /functions\.invoke\('weather'/.test(read('src/data/weather.ts')));
check('34 no device-location permission is requested anywhere in the Weather screens', weatherFiles.every((f) => !/expo-location|requestForegroundPermissions|geolocation/i.test(read(f))));
check('35 snow is only mentioned on a day when snow is expected (a trace or more); a day with none, or with no figure, says nothing about snow, and a missing figure is never turned into 0', /if \(k === 'trace'\) return/.test(read('app/weather/(tabs)/index.tsx')) && /if \(k === 'amount'\) return/.test(read('app/weather/(tabs)/index.tsx')) && !/Snow: unavailable|Snow: none/.test(read('app/weather/(tabs)/index.tsx')) && /return null;/.test(read('app/weather/(tabs)/index.tsx')));
check('36 the Sign In buttons open the app\'s existing welcome screen (nothing is redrawn)', (read('app/weather/(tabs)/index.tsx').match(/router\.push\('\/\(auth\)\/welcome' as any\)/g) ?? []).length === 1 && /router\.push\('\/\(auth\)\/welcome' as any\)/.test(read('app/weather/(tabs)/account.tsx')));
check('37 the Weather area re-asks the owner\'s switch every 60 seconds while it is open', /setInterval\(\(\) => \{ void weatherSwitch\.refresh\(\); \}, 60_000\)/.test(read('app/weather/_layout.tsx')));
check('38 a refusal from the data function ("disabled") makes the app re-ask the switch at once', /reason === 'disabled'/.test(read('src/hooks/useWeather.ts')) && /weatherSwitch\.refresh\(\)/.test(read('src/hooks/useWeather.ts')));
check('39 the owner\'s on/off row asks before turning Weather on or off', /confirmAction\('Turn on Public Weather\?'/.test(read('src/hooks/usePublicWeatherRow.ts')) && /confirmAction\('Turn off Public Weather\?'/.test(read('src/hooks/usePublicWeatherRow.ts')));

flow.catch((e) => check('50-52 the mock-fetch flow ran to the end', false, e && e.stack)).then(() => {
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
});
