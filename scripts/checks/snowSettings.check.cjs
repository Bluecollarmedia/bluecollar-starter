// Run: node scripts/checks/snowSettings.check.cjs <path to typescript package>
// How the app reads and saves the Snow Settings rule (src/data/snowSettings.ts) with a FAKE database.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../src/data/snowSettings.ts'), 'utf8');

let selectResult, updateResult, last;
const fake = {
  from: () => {
    const api = {
      select: () => api,
      eq: () => api,
      update: (patch) => { last = { patch }; return api; },
      maybeSingle: async () => selectResult,
      then: (res) => res(updateResult),
    };
    return api;
  },
};
const m = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', esModuleInterop: true } }).outputText)(m, m.exports, (n) => {
  if (n === '@/lib/supabase') return { supabase: fake, isSupabaseConfigured: true };
  return {};
});
const { loadSnowRules, setRequireArrival, ARRIVAL_OFF_WARNING } = m.exports;

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };

(async () => {
  selectResult = { data: { require_arrival_before_completion: false }, error: null };
  let r = await loadSnowRules('co');
  check('1 reads the saved rule (off)', r.ok && r.data.requireArrival === false);
  selectResult = { data: { require_arrival_before_completion: true }, error: null };
  check('2 reads the saved rule (on)', (await loadSnowRules('co')).data.requireArrival === true);
  selectResult = { data: null, error: null };
  check('3 no settings row means ON, like the database', (await loadSnowRules('co')).data.requireArrival === true);
  selectResult = { data: null, error: { message: 'permission denied' } };
  r = await loadSnowRules('co');
  check('4 a read error is reported', !r.ok && /permission denied/.test(r.error));

  updateResult = { data: [{ company_id: 'co' }], error: null };
  r = await setRequireArrival('co', false);
  check('5 saving sends the one column and succeeds when the row changed', r.ok && last.patch.require_arrival_before_completion === false && Object.keys(last.patch).length === 1);
  updateResult = { data: [], error: null };
  r = await setRequireArrival('co', false);
  check('6 an update that changed no row (not an owner/admin) is an ERROR, not a silent success', !r.ok && /owner or an admin/.test(r.error));
  updateResult = { data: null, error: { message: 'boom' } };
  r = await setRequireArrival('co', true);
  check('7 a database error is reported', !r.ok && r.error === 'boom');
  check('8 turning the rule off comes with a clear warning about what it affects', /I'm Here/.test(ARRIVAL_OFF_WARNING) && /arrival/i.test(ARRIVAL_OFF_WARNING) && /customer/i.test(ARRIVAL_OFF_WARNING));
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
