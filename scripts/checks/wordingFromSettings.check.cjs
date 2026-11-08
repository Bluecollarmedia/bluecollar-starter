// Run: node scripts/checks/wordingFromSettings.check.cjs [<path to typescript package>]
// The words people see come from the settings file (src/config/brand.js wording). The app's text is written with Job / Job site /
// Crew; w() (src/config/brand.ts) and the translation function t() / tr() (src/i18n) swap in the client's words when shown.
// This runs the REAL brand.ts and i18n code with a made-up settings file (place: 'Lot', job: 'Project'...) and checks that the
// shown text changes, in English and in Spanish, and that it stays exactly as written with the default words.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const { brand } = require('./_brand.cjs');

const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const compile = (rel, req) => {
  const m = { exports: {} };
  const out = ts.transpileModule(read(rel), { compilerOptions: { module: 'commonjs', target: 'es2020', esModuleInterop: true } }).outputText;
  new Function('module', 'exports', 'require', out)(m, m.exports, req);
  return m.exports;
};

/** brand.ts running on a settings file with these wording changes. */
const brandWith = (wording) => {
  const fake = JSON.parse(JSON.stringify(brand));
  Object.assign(fake.wording, wording);
  return compile('src/config/brand.ts', (n) => (n === './brand.js' ? fake : require(n)));
};

/** src/i18n (translate) running on that brand.ts, with the real Spanish dictionary. */
const i18nWith = (brandMod) => {
  const dictReq = (n) => compile(`src/i18n/${n.replace('./', '')}.ts`, () => ({}));
  const dictionary = compile('src/i18n/dictionary.ts', dictReq);
  const stubs = {
    react: { useMemo: (f) => f(), useSyncExternalStore: () => 'en' },
    '@react-native-async-storage/async-storage': { default: { getItem: async () => null, setItem: async () => {} }, getItem: async () => null, setItem: async () => {} },
    './dictionary': dictionary,
    '@/config/brand': brandMod,
  };
  return compile('src/i18n/index.ts', (n) => { if (n in stubs) return stubs[n]; throw new Error(`unexpected require ${n}`); });
};

const def = brandWith({});
const lot = brandWith({
  job: 'Project', jobs: 'Projects', place: 'Lot', places: 'Lots', crew: 'Team', crews: 'Teams',
  es: { job: 'Proyecto', jobs: 'Proyectos', place: 'Lote', places: 'Lotes', crew: 'Grupo', crews: 'Grupos' },
});
const onlyJob = brandWith({ job: 'Install', jobs: 'Installs' });

const SAMPLES = ['New Job', 'Add a job site', 'No job sites yet', 'JOB NOTES', 'Assign your crew to a job', "This job's team", 'Job Site History', '{n} jobs'];

// ── the helper itself ──
check('1 with the default words nothing changes (w returns the text exactly as written)', SAMPLES.every((s) => def.w(s) === s), SAMPLES.filter((s) => def.w(s) !== s).join(', '));
check('2 w() reads the settings file: place "Lot" turns "Add a job site" into "Add a lot", "No job sites yet" into "No lots yet"',
  lot.w('Add a job site') === 'Add a lot' && lot.w('No job sites yet') === 'No lots yet', `${lot.w('Add a job site')} / ${lot.w('No job sites yet')}`);
check('3 job "Project": "New Job" -> "New Project", "JOB NOTES" -> "PROJECT NOTES", "This job\'s team" -> "This project\'s team"',
  lot.w('New Job') === 'New Project' && lot.w('JOB NOTES') === 'PROJECT NOTES' && lot.w("This job's team") === "This project's team", `${lot.w('New Job')} / ${lot.w('JOB NOTES')}`);
check('4 "a" / "an" follow the new word ("a job" -> "an install") and title case stays title case ("Job Site History" -> "Lot History")',
  onlyJob.w('Assign a job') === 'Assign an install' && onlyJob.w('An apple a job') === 'An apple an install' && lot.w('Job Site History') === 'Lot History', `${onlyJob.w('Assign a job')} / ${lot.w('Job Site History')}`);
check('5 a changed job word does not break "job site" when the place word is unchanged ("Add a job site" stays)',
  onlyJob.w('Add a job site') === 'Add a job site' && onlyJob.w('Open this job at the job site') === 'Open this install at the job site', onlyJob.w('Open this job at the job site'));
check('6 crews follow the settings too ("Assign your crew to a job" -> "Assign your team to a project")', lot.w('Assign your crew to a job') === 'Assign your team to a project', lot.w('Assign your crew to a job'));

// ── the translation function (every t() / tr() on every screen) ──
const iDef = i18nWith(def);
const iLot = i18nWith(lot);
const dict = compile('src/i18n/dictionary.ts', (n) => compile(`src/i18n/${n.replace('./', '')}.ts`, () => ({}))).DICTIONARY;
check('7 t() in English shows the settings words, and {values} are never changed ("{n} jobs" with n = "Job Lot" keeps the value)',
  iLot.translate('en', 'My Jobs') === 'My Projects' && iLot.translate('en', '{name} jobs', { name: 'Job Lot' }) === 'Job Lot projects' && iDef.translate('en', 'My Jobs') === 'My Jobs'
  && iLot.translate('en', 'You are near {job}', { job: 'Smith job' }) === 'You are near Smith job',
  `${iLot.translate('en', 'My Jobs')} / ${iLot.translate('en', '{name} jobs', { name: 'Job Lot' })}`);
check('8 t() in Spanish still finds the sentence (keys are the default English) and then shows the Spanish settings words',
  dict['My Jobs'] === 'Mis trabajos' && iDef.translate('es', 'My Jobs') === 'Mis trabajos' && iLot.translate('es', 'My Jobs') === 'Mis proyectos',
  `${iDef.translate('es', 'My Jobs')} / ${iLot.translate('es', 'My Jobs')}`);
const placeKey = Object.keys(dict).find((k) => /\bjob site\b/i.test(k) && /sitio de trabajo/i.test(dict[k]));
check('9 a Spanish job-site sentence swaps "sitio de trabajo" whole (not "sitio de proyecto")', !!placeKey && /\blote\b/i.test(iLot.translate('es', placeKey)) && !/proyecto/i.test(iLot.translate('es', placeKey)),
  placeKey ? iLot.translate('es', placeKey) : 'no Spanish job-site sentence found');
const workKey = Object.keys(dict).find((k) => /\bwork\b/i.test(k) && !/\bjobs?\b/i.test(k) && /\btrabajo\b/i.test(dict[k]));
check('10 Spanish "trabajo" meaning work (not a job) is left alone', !!workKey && iLot.translate('es', workKey) === dict[workKey], workKey ? iLot.translate('es', workKey) : 'none found');

// ── the Spanish dictionary uses the same default words, so the swap finds them ──
const esPlace = Object.entries(dict).filter(([k]) => /\bjob sites?\b/i.test(k));
const badPlace = esPlace.filter(([, v]) => !/\bsitios? de trabajo\b/i.test(v));
check('11 every Spanish sentence for a "job site" text says "sitio(s) de trabajo"', esPlace.length > 5 && badPlace.length === 0, badPlace.slice(0, 8).map(([k, v]) => `${k} = ${v}`).join(' | '));
const esJob = Object.entries(dict).filter(([k]) => /\bjobs?\b/i.test(k.replace(/\{\w+\}/g, '').replace(/\bjob sites?\b/gi, '')));
const badJob = esJob.filter(([, v]) => !/\btrabajos?\b/i.test(v.replace(/\bsitios? de trabajo\b/gi, '')));
check('12 every Spanish sentence for a "job" text says "trabajo(s)"', esJob.length > 10 && badJob.length === 0, badJob.slice(0, 8).map(([k, v]) => `${k} = ${v}`).join(' | '));
const leftover = Object.entries(dict).filter(([, v]) => /\b(proyectos?|propiedad(es)?|obras?)\b/i.test(v.replace(/\bmano de obra\b/gi, '')));
check('13 no Spanish text still says "proyecto", "propiedad" or "obra" (a job site; "mano de obra" = labor is fine)', leftover.length === 0, leftover.slice(0, 8).map(([k, v]) => `${k} = ${v}`).join(' | '));

// ── wiring ──
const i18nSrc = read('src/i18n/index.ts');
check('14 translate() runs w() on English and wEs() on Spanish, after the dictionary lookup', /wEs\(es, text\)/.test(i18nSrc) && /:\s*w\(text\)/.test(i18nSrc));
check('15 brand.js has the Spanish words (wording.es) for all six nouns', ['job', 'jobs', 'place', 'places', 'crew', 'crews'].every((k) => typeof brand.wording.es?.[k] === 'string' && brand.wording.es[k].trim()));

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
