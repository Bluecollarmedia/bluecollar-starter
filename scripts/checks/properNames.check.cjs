// Run: node scripts/checks/properNames.check.cjs <path to typescript package>
// Names show with a capital at the start of each word, and "Welcome Back" has a capital B.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(read('src/lib/names.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const n = m.exports;
let bad = 0;
const check = (name, ok, d) => { if (!ok) bad++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (ok ? '' : ' - ' + (d || ''))); };

check('1 lowercase names get capitals: zisha -> Zisha, eli semah -> Eli Semah', n.properName('zisha') === 'Zisha' && n.properName('eli semah') === 'Eli Semah' && n.properName('wyndham 2') === 'Wyndham 2');
check('2 after hyphens and apostrophes too: mary-jane -> Mary-Jane, o\'brien -> O\'Brien', n.properName('mary-jane') === 'Mary-Jane' && n.properName("o'brien") === "O'Brien");
check('2b a possessive keeps its small s (David s Home) while a name like D-apostrophe-Angelo is still capitalised', n.properName("david's home") === "David's Home" && n.properName("mary's") === "Mary's" && n.properName("d'angelo") === "D'Angelo" && n.properName("205 cathy ln") === '205 Cathy Ln');
check('3 nothing else is changed: McDonald, DeAngelo, HOA and digits stay as typed', n.properName('McDonald') === 'McDonald' && n.properName('DeAngelo') === 'DeAngelo' && n.properName('Oak Ridge HOA Entrance') === 'Oak Ridge HOA Entrance' && n.properName('111 spruce st') === '111 Spruce St');
check('4 empty and missing names are safe', n.properName('') === '' && n.properName(undefined) === '' && n.properName(null) === '' && n.fullName('zisha', '') === 'Zisha' && n.fullName('eli', 'semah') === 'Eli Semah');

const store = read('src/data/store.ts');
check('5 every person everywhere (lists, schedules, messages, quotes) and every project name is capitalised at the source',
  /firstName: properName\(p\.firstName \?\? ''\)/.test(store) && /lastName: properName\(p\.lastName \?\? ''\)/.test(store) && /name: properName\(p\.name\)/.test(store));
check('6 the signed-in person\'s own name (greetings, profile) is capitalised', /firstName: properName\(p\.first_name \?\? ''\)/.test(read('src/providers/AuthProvider.tsx')));
check('7 "Welcome Back" has a capital B on the customer home, sign-in and the welcome animation, with the name capitalised',
  /\{t\('Welcome Back'\)\}<\/Text>/.test(read('app/(customer)/(tabs)/index.tsx')) && /Welcome Back/.test(read('app/(auth)/login.tsx')) && /\{t\('Welcome Back'\)\}\{greetName/.test(read('src/components/branding/WelcomeOverlay.tsx')) && /properName\(greetName\)/.test(read('src/components/branding/WelcomeOverlay.tsx')));
check('8 the customer home capitalises property names too', (read('src/lib/customerHome.ts').match(/properName\(/g) || []).length >= 3);
console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
