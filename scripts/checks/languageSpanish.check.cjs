// Run: node scripts/checks/languageSpanish.check.cjs
// English / Spanish: English by default; a switch on the welcome, sign-in, forgot-password, invite (worker / customer sign-up) and company
// setup screens (before anyone signs up) and one quiet row in every Settings screen; text without a Spanish version stays English.
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${d}/${e.name}`] : []);
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const mod = (rel, fakes) => { const m = { exports: {} }; new Function('module', 'exports', 'require', ts.transpileModule(read(rel), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports, (n) => fakes[n]); return m.exports; };
const parts = ['es', 'es.worker', 'es.maintenance', 'es.snow', 'es.customer', 'es.weather'].map((n) => mod(`src/i18n/${n}.ts`, {}));
const ES = Object.assign({}, ...parts.map((p) => Object.values(p)[0]).reverse());
const i18n = mod('src/i18n/index.ts', { react: { useMemo: (f) => f(), useSyncExternalStore: () => 'en' }, '@react-native-async-storage/async-storage': { getItem: async () => null, setItem: async () => {} }, './dictionary': { DICTIONARY: ES } });
const { translate, getLanguage } = i18n;

check('1 English is the default', getLanguage() === 'en' && translate('en', 'Sign In') === 'Sign In');
check('2 Spanish gives the Spanish text', translate('es', 'Sign In') === 'Iniciar sesión' && translate('es', 'Welcome') === 'Bienvenido');
check('3 text with no Spanish yet stays in English (never blank, never a key)', translate('es', 'A screen nobody translated') === 'A screen nobody translated');
check('4 values are filled in, in either language', translate('es', 'Step {n} of 3', { n: 2 }) === 'Paso 2 de 3' && translate('en', 'Step {n} of 3', { n: 2 }) === 'Step 2 of 3' && translate('es', 'Join {company}', { company: 'Brighton' }) === 'Únete a Brighton');

// every phrase used in the code has a Spanish version
const used = new Set();
const call = new RegExp("\\b(?:t|tr)\\((\"(?:[^\"\\\\]|\\\\.)+\"|'(?:[^'\\\\]|\\\\.)+')", 'g');
for (const f of [...walk('app'), ...walk('src')]) {
  if (/i18n[\\/](index|es)\.ts$/.test(f)) continue;
  const src = read(f);
  for (const m of src.matchAll(call)) {
    let lit = m[1].slice(1, -1);
    lit = lit.split('\\n').join('\n').split("\\'").join("'").split('\\"').join('"');
    used.add(lit);
  }
}
const missing = [...used].filter((k) => !(k in ES) && k !== 'Hello {name}');
check(`5 every phrase the screens translate (${used.size}) has a Spanish version`, missing.length === 0, missing.slice(0, 5).join(' | '));
const badVars = Object.entries(ES).filter(([k, v]) => (k.match(/\{\w+\}/g) || []).sort().join() !== (v.match(/\{\w+\}/g) || []).sort().join());
check('6 every Spanish text keeps the same {values} as its English', badVars.length === 0, badVars.map(([k]) => k).slice(0, 3).join(' | '));

// where the switch is
const has = (f, re) => re.test(read(f));
check('7 the switch is on the welcome, sign-in, forgot-password, invite and company-setup screens', ['app/(auth)/welcome.tsx', 'app/(auth)/login.tsx', 'app/(auth)/forgot-password.tsx', 'app/invite/[token].tsx', 'app/(auth)/create-company.tsx'].every((f) => has(f, /<LanguageSwitch \/>/)));
check('8 and one Settings row for every role (worker + maintenance, owner, customer, Snow worker, Snow owner, Snow notice)', ['app/(worker)/(tabs)/settings.tsx', 'app/(owner)/(tabs)/more/settings.tsx', 'app/(customer)/(tabs)/account.tsx', 'src/components/snow/SnowWorkerSettings.tsx', 'app/snow/owner/(tabs)/more.tsx', 'app/snow/notice.tsx'].every((f) => has(f, /<LanguageRow \/>/)));
check('9 the tab bars are translated (worker, maintenance, owner, customer, Snow)', ['app/(worker)/(tabs)/_layout.tsx', 'app/(worker)/maintenance/_layout.tsx', 'app/(owner)/(tabs)/_layout.tsx', 'app/(customer)/(tabs)/_layout.tsx'].every((f) => /Trigger\.Label>\{t\('/.test(read(f)) && /title: t\('/.test(read(f))) && /tx\(t\.title\)/.test(read('src/components/snow/SnowTabs.tsx')));
check('10 the choice is kept on the phone and read at startup', /brighton\.language/.test(read('src/i18n/index.ts')) && /loadLanguage\(\);/.test(read('src/i18n/index.ts')) && /AsyncStorage\.setItem\(STORAGE_KEY, next\)/.test(read('src/i18n/index.ts')));
check('11 the website\'s dialogs are translated too', /t\(current\.title\)/.test(read('src/components/ui/WebDialogHost.tsx')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
