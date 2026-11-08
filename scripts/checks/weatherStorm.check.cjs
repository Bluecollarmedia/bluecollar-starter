// Run: node scripts/checks/weatherStorm.check.cjs [path to typescript package]
// Brighton Weather, Phase 3 and 4: the owner's storm outlooks (write, publish, update, end), the page visitors see, the card on the weather home
// and the storm history. The helper maths (src/lib/stormView.ts) is run here; the screens and the SQL are checked as file text, and the
// database rules themselves are proved by supabase/tests/104_storm_outlooks.pglite.mjs.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const load = (p) => { const m = { exports: {} }; new Function('module', 'exports', ts.transpileModule(read(p), { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText)(m, m.exports); return m.exports; };
const S = load('src/lib/stormView.ts');

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

// ── the helper maths ──
check('1 a snowfall estimate reads "3–6 in", or "4 in" when both are 4, and is null (so "Unavailable") when the owner is not sure; it is never turned into 0', S.snowRange({ snow_low: 3, snow_high: 6 }) === '3–6 in' && S.snowRange({ snow_low: 4, snow_high: 4 }) === '4 in' && S.snowRange({ snow_low: 1.5, snow_high: 3 }) === '1.5–3 in' && S.snowRange({ snow_low: null, snow_high: null }) === null && S.snowRange({ snow_low: 3, snow_high: null }) === null);
check('2 measured snowfall appears only when the owner entered it', S.actualSnow({ actual_snow: 8.5 }) === '8.5 in' && S.actualSnow({ actual_snow: null }) === null && S.actualSnow({ actual_snow: 0 }) === '0 in');
check('3 the owner\'s words are shown as written: Spanish only when the owner wrote a Spanish version, otherwise the English one; nothing is translated', S.messageFor({ message: 'Snow.', message_es: 'Nieve.' }, 'es').text === 'Nieve.' && S.messageFor({ message: 'Snow.', message_es: null }, 'es').text === 'Snow.' && S.messageFor({ message: 'Snow.', message_es: 'Nieve.' }, 'en').text === 'Snow.' && S.messageFor({ message: 'Snow.', message_es: null }, 'es').spanish === false);
check('4 an update is "original" (version 1), "update", or "final"', S.versionKind({ version_no: 1, is_final: false }) === 'original' && S.versionKind({ version_no: 3, is_final: false }) === 'update' && S.versionKind({ version_no: 3, is_final: true }) === 'final');
const eq = (dk, h, iso) => S.easternToIso(dk, h) === iso;
check('5 Eastern times turn into the right UTC moment in winter (EST) and summer (EDT), and across the daylight-saving changes', eq('2026-01-18', 14, '2026-01-18T19:00:00.000Z') && eq('2026-07-04', 14, '2026-07-04T18:00:00.000Z') && eq('2026-11-01', 12, '2026-11-01T17:00:00.000Z') && eq('2026-03-08', 12, '2026-03-08T16:00:00.000Z') && eq('2026-03-08', 1, '2026-03-08T06:00:00.000Z'), S.easternToIso('2026-11-01', 12));
check('6 and back again: a saved moment gives its Eastern day and hour', JSON.stringify(S.isoToEastern('2026-01-18T19:00:00.000Z')) === JSON.stringify({ dateKey: '2026-01-18', hour: 14 }) && JSON.stringify(S.isoToEastern('2026-07-04T03:30:00.000Z')) === JSON.stringify({ dateKey: '2026-07-03', hour: 23 }));
check('7 times read as "Tue 6 PM" in Eastern time, whatever the phone\'s own zone', /Tue.*6/.test(S.whenText('2026-10-27T22:00:00Z', 'en-US')) && S.whenText(null, 'en-US') === '' && S.whenText('junk', 'en-US') === '');
const good = { id: 'a', name: 'Tue snow', status: 'active', created_at: '2026-10-27T10:00:00Z', ended_at: null, version_count: 2, latest: { id: 'v', version_no: 2, headline: 'H', message: 'M', message_es: '  ', snow_low: '3.0', snow_high: '6.0', starts_at: null, ends_at: null, disclaimer: 'D', actual_snow: null, actual_source: ' ', is_final: false, published_at: '2026-10-27T11:00:00Z' } };
const n = S.normalizeStorm(good);
check('8 what the database returns is read safely: numbers that arrive as text become numbers, blank Spanish and blank sources become none, and junk is refused', n && n.latest.snow_low === 3 && n.latest.snow_high === 6 && n.latest.message_es === null && n.latest.actual_source === null && S.normalizeStorm(null) === null && S.normalizeStorm({ id: 'x' }) === null && S.normalizeStorm({ id: 'x', latest: { headline: 1 } }) === null && S.normalizeStorms('x').length === 0 && S.normalizeStorms([good, null, {}]).length === 1);
check('9 the standard disclaimer is the agreed wording', S.DEFAULT_DISCLAIMER === "Brighton's Storm Outlook. This is Brighton's own estimate, not an official weather forecast. Snowfall amounts and timing may change as conditions develop.");

// ── the data layer talks to the functions the SQL defines ──
const sql = read('supabase/updates/104_storm_outlooks.sql');
const data = read('src/data/stormOutlook.ts');
const rpcs = ['public_storm_current', 'public_storm_history', 'owner_storm_current', 'publish_storm_outlook', 'end_storm_outlook'];
check('10 every database function the app calls is defined in update 104', rpcs.every((f) => data.includes(`'${f}'`) && new RegExp(`create or replace function public\\.${f}\\(`).test(sql)));
check('11 update 104 locks published versions (a trigger blocks every change and delete), refuses a half range and unsourced actual snowfall, allows one active storm, and keeps both tables closed to direct access', /storm_versions_no_change/.test(sql) && /before update or delete/.test(sql) && /check \(\(snow_low is null\) = \(snow_high is null\)\)/.test(sql) && /actual_source is not null and char_length\(btrim\(actual_source\)\) >= 3/.test(sql) && /storm_outlooks_one_active/.test(sql) && /revoke all on public\.storm_outlooks from public, anon, authenticated/.test(sql) && /revoke all on public\.storm_outlook_versions from public, anon, authenticated/.test(sql) && /role = 'owner' and mm\.status = 'active'/.test(sql));
check('12 visitors read only while public Weather is on; the owner functions are for signed-in callers only', /public_weather_config\(\) ->> 'enabled'/.test(sql) && /grant execute on function public\.public_storm_current\(\) to anon, authenticated/.test(sql) && /revoke all on function public\.publish_storm_outlook\([^)]*\) from public, anon/.test(sql) && /grant execute on function public\.publish_storm_outlook\([^)]*\) to authenticated/.test(sql));
check('13 reading never breaks the weather screens: a failed or missing answer falls back to the last saved storm (or none)', /readSavedStorm/.test(data) && /fresh: false/.test(data) && /return \{ ok: false, message/.test(data));

// ── the screens ──
const page = read('src/components/weather/StormPage.tsx');
const card = read('src/components/weather/StormCard.tsx');
const home = read('app/weather/(tabs)/index.tsx');
const hist = read('app/weather/(tabs)/history.tsx');
const out = read('app/weather/(tabs)/outlook.tsx');
const edit = read('src/components/weather/StormOutlookEditor.tsx');
check('14 the storm page shows the owner\'s headline, message and disclaimer, says "Unavailable" when there is no estimate, and shows measured snowfall only with its source', /version\.headline/.test(page) && /msg\.text/.test(page) && /version\.disclaimer/.test(page) && /snow \?\? t\('Unavailable'\)/.test(page) && /actual \? \(/.test(page) && /Source: \{source\}/.test(page));
check('15 nothing is translated automatically: no translation service anywhere in the storm screens; a Spanish visitor sees the owner\'s Spanish only if it exists, with a note when it does not', !/googleapis|deepl|openai|translation ?api|translateText/i.test(page + card + hist + out + edit + data) && /Brighton's message is shown in English/.test(page));
check('16 the same saved update powers the home card, the outlook page and the history', /useCurrentStorm/.test(home) && /<StormCard storm=\{storm\}/.test(home) && /useCurrentStorm/.test(out) && /storm\.latest/.test(out) && /useStormHistory/.test(hist) && /storm\.latest/.test(card));
check('17 the home card shows only while a storm is published, and tapping it opens the outlook page', /storm\?\.latest \? \(/.test(home) && /router\.push\('\/weather\/outlook' as any\)/.test(home));
check('18 history lists every storm, opens one to read every update newest first (each marked locked, the original marked "never changed"), shows measured snowfall with its source', /storms\.map/.test(hist) && /open\.versions\.map/.test(hist) && /Published and locked/.test(hist) && /The original is never changed/.test(hist) && /Measured snowfall/.test(hist));
check('19 the outlook page has a Back button, Share, "See the forecast", and a way to all the updates; every button has a role, a label or text, and at least 44 points', /onBack/.test(page) && /t\('Share'\)/.test(page) && /See the forecast/.test(page) && /See all \{n\} updates/.test(page) && /minHeight: 44/.test(page) && /minHeight: 50/.test(page));
check('20 the owner\'s Publish asks first ("Publish to everyone?"), says an update cannot be changed afterward, and is refused with a plain reason when something is missing', /confirmAction\('Publish to everyone\?'/.test(edit) && /cannot be changed afterward/.test(edit) && /problems\.push\('Write a headline\.'\)/.test(edit) && /Say who or what measured the snowfall/.test(edit) && /built\.problems\.length/.test(edit));
check('21 the owner can preview exactly what visitors will see, add a Spanish version, say "not sure yet", set Eastern-time start and end, reset the disclaimer, post an update, post a final update that ends the storm, and end a storm', /See what visitors see/.test(edit) && /Add a Spanish version/.test(edit) && /I’m not sure yet/.test(edit) && /easternToIso/.test(edit) && /Reset to the standard wording/.test(edit) && /Post an update/.test(edit) && /This is the final update/.test(edit) && /End storm without an update/.test(edit) && /preview/.test(edit));
check('22 measured snowfall can only be entered on an update to a storm, and always with its source', /\{active \? \(\s*<>\s*\{label\('Measured snowfall'\)\}/.test(edit) && /Who or what measured it/.test(edit));
check('23 the owner screen is reached from Settings (landscaping) and from the Snow owner More tab, and both routes are registered', /storm-outlook/.test(read('app/(owner)/(tabs)/more/settings.tsx')) && /storm-outlook/.test(read('app/snow/owner/(tabs)/more.tsx')) && /name="storm-outlook"/.test(read('app/(owner)/_layout.tsx')) && /name="storm-outlook"/.test(read('app/snow/owner/_layout.tsx')) && fs.existsSync(path.join(root, 'app/(owner)/storm-outlook.tsx')) && fs.existsSync(path.join(root, 'app/snow/owner/storm-outlook.tsx')));
check('24 only the owner sees the entry points (the same owner-only test as the Weather switch), and the database refuses anyone else anyway', (read('app/(owner)/(tabs)/more/settings.tsx').match(/weatherRow\.canChange \? \(\s*<SettingsGroup title="Brighton Weather"/) !== null) && /weatherRow\.canChange \? <Row icon="cloud-snow"/.test(read('app/snow/owner/(tabs)/more.tsx')));
check('25 the weather area calls itself Brighton Forecast: BRIGHTON with FORECAST under it, and "Lawn" or "Landscape" appears nowhere in the weather screens', !/LANDSCAPE|Lawn|Landscape/.test(home + page + card + hist + out + read('app/weather/(tabs)/account.tsx') + read('app/weather/_layout.tsx')) && /FORECAST/.test(home) && /FORECAST/.test(page));
check('26 there are no haptics, glass or frost in the storm screens', !/haptics|GlassView|BlurView|backdrop/i.test(page + card + hist + out));
check('27 the Weather tab stays lit on the outlook page and tapping it goes home', /pathname\.startsWith\('\/weather\/outlook'\)/.test(read('src/components/weather/FloatingTabBar.tsx')));

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
