// Run: node scripts/checks/snowAutoAccess.check.cjs <path to typescript package>
// Snow Mode for every worker with no sign-up: the routing (Snow Mode on = Snow Mode, no switch for workers) and the wiring (the database part is in the 062 test).
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const load = (rel) => { const m = { exports: {} }; new Function('module', 'exports', 'require', ts.transpileModule(read(rel), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports, () => ({})); return m.exports; };
let bad = 0;
const check = (n, ok, detail) => { if (!ok) bad++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (ok ? '' : ' - ' + (detail || ''))); };

const both = { snow: true, landscaping: true };

// the routing, with the real shellFor from the hook file (its imports stubbed)
const src = read('src/hooks/useModeAccess.ts').replace(/^import .*$/gm, '');
const m2 = { exports: {} };
new Function('module', 'exports', 'db', 'useDb', 'updateRow', 'supabase', 'isSupabaseConfigured', 'useCallback', 'useEffect', 'useState',
  ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText)(m2, m2.exports, {}, () => {}, () => {}, {}, false, (f) => f, () => {}, () => []);
const { shellFor } = m2.exports;
check('1 a worker with snow access goes to Snow Mode when the owner turns it on (no sign-up) and stays there: there is no switch to step out of it',
  shellFor('worker', 'snow', both) === 'snow' && shellFor('worker', 'landscaping', both) === 'landscaping' && shellFor('worker', 'snow', { snow: true, landscaping: false }) === 'snow');
check('2 a worker the owner removed from snow (no snow access) gets the "Snow Mode is on" screen and no way in', shellFor('worker', 'snow', { snow: false, landscaping: true }) === 'snow_notice');
check('3 owners, admins and customers are unchanged', shellFor('owner', 'snow', both) === 'snow' && shellFor('owner', 'landscaping', both) === 'landscaping' && shellFor('customer', 'snow', both) === 'landscaping');

const layout = read('app/_layout.tsx');
check('4 the sun / snowflake switch is gone for workers: no component, no saved choice, no reserved strip at the top', !fs.existsSync(path.join(__dirname, '../../src/components/snow/WorkerModeToggle.tsx')) && !fs.existsSync(path.join(__dirname, '../../src/hooks/useWorkerModeChoice.ts')) && !/WorkerModeToggle|WORKER_TOGGLE_BAND|shiftedInsets/.test(layout));
const sql = read('supabase/updates/062_snow_auto_enroll_workers.sql');
const sql66 = fs.readFileSync(path.join(__dirname, '../../supabase/updates/066_account_access_hardening.sql'), 'utf8');
check('5 snow access is explicit: update 66 switches off the automatic grants of update 62 (both triggers do nothing), and the test proves nobody is added automatically',
  /_snow_mode_enroll_trigger\(\)\s+returns trigger[\s\S]*?begin\s+return null;/.test(sql66) && /_snow_member_enroll_trigger\(\)\s+returns trigger[\s\S]*?begin\s+return null;/.test(sql66)
  && /puts NOBODY on the snow team/.test(fs.readFileSync(path.join(__dirname, '../../supabase/tests/062_snow_auto_enroll_workers.pglite.mjs'), 'utf8')));
console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
