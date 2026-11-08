// Run: node scripts/checks/placesAutocomplete.check.cjs [path to typescript package]
// Address suggestions (src/lib/placesAutocomplete.ts): Google's answers become our address fields, the feature is OFF without a
// key (forms behave as before), and the shared address fields use it.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const m = { exports: {} };
const fakeRequire = (id) => (id === '@/lib/config' ? { config: { googlePlacesKey: '' } } : id === 'react-native' ? { Platform: { OS: 'ios' } } : id === 'expo-constants' ? { default: { expoConfig: {} } } : {});
new Function('module', 'exports', 'require', ts.transpileModule(read('src/lib/placesAutocomplete.ts'), { compilerOptions: { module: 'commonjs', esModuleInterop: true } }).outputText)(m, m.exports, fakeRequire);
const { parseSuggestions, parsePlace, fetchSuggestions, fetchPlace, placesEnabled, newSessionToken } = m.exports;

const sug = parseSuggestions({ suggestions: [
  { placePrediction: { placeId: 'p1', text: { text: '205 Cathy Ln, Lakewood, NJ, USA' }, structuredFormat: { mainText: { text: '205 Cathy Ln' }, secondaryText: { text: 'Lakewood, NJ, USA' } } } },
  { queryPrediction: { text: { text: 'not a place' } } },
  { placePrediction: { text: { text: 'no id' } } },
] });
check('1 suggestions become rows (street big, town small); entries that are not places are dropped', sug.length === 1 && sug[0].placeId === 'p1' && sug[0].main === '205 Cathy Ln' && sug[0].secondary === 'Lakewood, NJ, USA', JSON.stringify(sug));
check('2 an empty or odd answer is just no suggestions (never an error)', parseSuggestions(null).length === 0 && parseSuggestions({}).length === 0 && parseSuggestions({ suggestions: 'x' }).length === 0);

const place = parsePlace({
  addressComponents: [
    { longText: '205', shortText: '205', types: ['street_number'] },
    { longText: 'Cathy Lane', shortText: 'Cathy Ln', types: ['route'] },
    { longText: 'Lakewood', shortText: 'Lakewood', types: ['locality', 'political'] },
    { longText: 'New Jersey', shortText: 'NJ', types: ['administrative_area_level_1', 'political'] },
    { longText: '08701', shortText: '08701', types: ['postal_code'] },
  ],
  location: { latitude: 40.0967, longitude: -74.2174 },
});
check('3 a picked place fills all four fields the way the app writes them (street, city, NJ, 5-digit ZIP) and the exact map spot',
  place.address === '205 Cathy Ln' && place.city === 'Lakewood' && place.state === 'NJ' && place.zip === '08701' && place.latitude === 40.0967 && place.longitude === -74.2174, JSON.stringify(place));
const apt = parsePlace({ addressComponents: [
  { longText: '12', types: ['street_number'] }, { longText: 'Oak Street', shortText: 'Oak St', types: ['route'] }, { longText: '3B', types: ['subpremise'] },
  { longText: 'Toms River', types: ['postal_town'] }, { shortText: 'NJ', types: ['administrative_area_level_1'] }, { longText: '08753-1234', types: ['postal_code'] },
] });
check('4 an apartment keeps its unit, a town named postal_town works, and a ZIP+4 is cut to 5 digits', apt.address === '12 Oak St #3B' && apt.city === 'Toms River' && apt.zip === '08753', JSON.stringify(apt));
check('5 a place with no street (a town, a business with no address) is refused rather than filling nonsense', parsePlace({ addressComponents: [{ longText: 'Lakewood', types: ['locality'] }] }) === null && parsePlace(null) === null);

check('6 WITHOUT a key the feature is off: no suggestions, no lookups, no network (forms behave exactly as before)', placesEnabled === false);
(async () => {
  let called = false;
  global.fetch = () => { called = true; return Promise.reject(new Error('should not be called')); };
  const a = await fetchSuggestions('205 Cathy', 'tok');
  const b = await fetchPlace('p1', 'tok');
  check('7 off means off: nothing is fetched even when asked', a.length === 0 && b === null && called === false);
  check('8 session tokens are unique per typing session', newSessionToken() !== newSessionToken() && newSessionToken().length >= 24);

  const fields = read('src/components/ui/AddressFields.tsx');
  const sugUi = read('src/components/ui/StreetSuggestions.tsx');
  check('9 the shared address fields show the suggestions under the street and one pick fills the four fields and the map check', /<StreetSuggestions/.test(fields) && /handlePicked/.test(fields) && /onCheckChange\(place\.latitude/.test(fields));
  check('10 the suggestion list waits for a pause in typing, and draws nothing when off', /setTimeout\(async/.test(sugUi) && /, 300\)/.test(sugUi) && /!placesEnabled \|\| rows\.length === 0\) return null/.test(sugUi));
  check('11 the key comes from the environment only (never written into the code), and the example env explains it', /EXPO_PUBLIC_GOOGLE_PLACES_KEY/.test(read('src/lib/config.ts')) && /EXPO_PUBLIC_GOOGLE_PLACES_KEY/.test(read('.env.example')) && !/AIza[0-9A-Za-z_-]{30,}/.test(read('src/lib/placesAutocomplete.ts')));
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
