// Run: node scripts/checks/activityClear.check.cjs <path to typescript package>
// Clearing activity logs: the period maths, the wording, how the app talks to the database (FAKE supabase), and the wiring.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const compile = (src, req) => {
  const m = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', esModuleInterop: true } }).outputText)(m, m.exports, req);
  return m.exports;
};
const lib = compile(read('src/lib/logClear.ts'), () => ({}));
let calls = [];
let rpcResult = { data: { count: 3 }, error: null };
const data = compile(read('src/data/activityClear.ts'), (n) => {
  if (n === '@/lib/supabase') return { supabase: { rpc: async (fn, args) => { calls.push({ fn, args }); return rpcResult; } }, isSupabaseConfigured: true };
  if (n === '@/lib/logClear') return lib;
  return {};
});

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };
const NOW = new Date(2026, 9, 19, 14, 30);   // Oct 19 2026, 2:30 PM local
const L = (y, m, d) => new Date(y, m, d).toISOString();

check('1 today = midnight to midnight, in local time', JSON.stringify(lib.scopeRange({ kind: 'today' }, NOW)) === JSON.stringify({ from: L(2026, 9, 19), to: L(2026, 9, 20) }));
check('2 yesterday = the day before', JSON.stringify(lib.scopeRange({ kind: 'yesterday' }, NOW)) === JSON.stringify({ from: L(2026, 9, 18), to: L(2026, 9, 19) }));
check('3 older than 30 days = everything before the day 30 days ago', JSON.stringify(lib.scopeRange({ kind: 'older30' }, NOW)) === JSON.stringify({ from: null, to: L(2026, 8, 19) }), JSON.stringify(lib.scopeRange({ kind: 'older30' }, NOW)));
check('4 a whole year = Jan 1 to the next Jan 1', JSON.stringify(lib.scopeRange({ kind: 'year', year: 2025 }, NOW)) === JSON.stringify({ from: L(2025, 0, 1), to: L(2026, 0, 1) }));
check('5 all time has no limits', JSON.stringify(lib.scopeRange({ kind: 'all' }, NOW)) === JSON.stringify({ from: null, to: null }));
check('6 month ends and new year are right (day before Mar 1; Jan 1)', lib.scopeRange({ kind: 'yesterday' }, new Date(2027, 2, 1, 9)).from === L(2027, 1, 28) && lib.scopeRange({ kind: 'today' }, new Date(2027, 0, 1, 9)).to === L(2027, 0, 2));
const choices = lib.scopeChoices([2025, 2026, 2025]);
check('7 choices: today, yesterday, older than 30 days, one per year (newest first, no repeats), all time last', choices.map(lib.scopeLabel).join(' | ') === 'Today | Yesterday | Older than 30 days | All of 2026 | All of 2025 | All time', choices.map(lib.scopeLabel).join(' | '));
let c = lib.clearConfirmation({ kind: 'today' }, 'archive', 124);
check('8 archive question: says it is kept and a note is added', c.title === 'Move 124 entries to history?' && /stay saved under Archived/.test(c.message) && c.confirm === 'Move to history', JSON.stringify(c));
c = lib.clearConfirmation({ kind: 'all' }, 'delete', 1);
check('9 delete question: permanent, names the period, singular', c.title === 'Delete 1 entry for good?' && /can't be undone/.test(c.message) && /All time/.test(c.message) && c.confirm === 'Delete for good', JSON.stringify(c));
c = lib.clearConfirmation({ kind: 'year', year: 2025 }, 'restore', 5);
check('10 restore question', c.title === 'Restore 5 entries?' && /go back into the log/.test(c.message));
c = lib.clearConfirmation({ kind: 'today' }, 'delete', 0);
check('11 nothing to clear: says so, no scary question', 'nothing' in c && /No entries for today/.test(c.nothing) && 'nothing' in lib.clearConfirmation({ kind: 'today' }, 'restore', 0));
check('12 for a project the wording says "activity" and does not promise a note', !/short note/.test(lib.clearConfirmation({ kind: 'today' }, 'delete', 2, 'activity').message) && /from the activity/.test(lib.clearConfirmation({ kind: 'today' }, 'delete', 2, 'activity').message));

(async () => {
  const range = { from: L(2026, 9, 19), to: L(2026, 9, 20) };
  let r = await data.previewSnowClear(range, 'archive');
  check('13 the preview asks the database for a dry run and returns the count', r.ok && r.data === 3 && calls[0].fn === 'snow_clear_activity' && calls[0].args.p_dry_run === true && calls[0].args.p_mode === 'archive' && calls[0].args.p_from === range.from, JSON.stringify(calls));
  calls = [];
  r = await data.runSnowClear(range, 'delete');
  check('14 the real run sends the mode and period and no dry-run flag', r.ok && calls[0].args.p_mode === 'delete' && !('p_dry_run' in calls[0].args), JSON.stringify(calls));
  rpcResult = { data: null, error: { message: 'Could not find the function public.snow_clear_activity in the schema cache' } };
  r = await data.runSnowClear(range, 'archive');
  check('15 before update 51 a clear message says what is missing', !r.ok && /update 51/.test(r.error), JSON.stringify(r));
  rpcResult = { data: null, error: { message: 'Only the owner or an admin can clear the activity log.' } };
  r = await data.runSnowClear(range, 'archive');
  check('16 a refusal from the database is shown as it is', !r.ok && /owner or an admin/.test(r.error));
  rpcResult = { data: [{ year: 2026 }, { year: 2025 }], error: null };
  check('17 the years list', JSON.stringify(await data.loadSnowLogYears()) === '[2026,2025]');
  rpcResult = { data: null, error: { message: 'nope' } };
  check('18 if the years list fails it is just empty', (await data.loadSnowLogYears()).length === 0);
  calls = []; rpcResult = { data: { count: 2 }, error: null };
  r = await data.runProjectClear('p1', range);
  check('19 clearing a project\'s activity sends the project and period', r.ok && r.data === 2 && calls[0].fn === 'clear_project_activity' && calls[0].args.p_project_id === 'p1', JSON.stringify(calls));

  // wiring
  const hook = read('src/hooks/useSnowActivity.ts');
  const screen = read('app/(owner)/snow-activity.tsx');
  const proj = read('app/(owner)/(tabs)/projects/[id].tsx');
  check('20 the feed only sends p_archived when the Archived view is on (the normal view keeps working before update 51)', /\.\.\.\(f\.archived \? \{ p_archived: true \} : \{\}\)/.test(hook));
  check('21 Snow Activity: a Clear button, an Archived switch, and the sheet (archive/delete, or restore/delete when viewing archived)', /accessibilityLabel="Clear or archive the log"/.test(screen) && /accessibilityLabel="Show archived entries"/.test(screen) && /<ClearLogSheet/.test(screen) && /\['restore', 'delete'\] : \['archive', 'delete'\]/.test(screen));
  check('22 the project Activity Log has a Clear button that can only delete', /accessibilityLabel="Clear this project's activity"/.test(proj) && /modes=\{\['delete'\]\}/.test(proj));
  check('23 both screens say it worked and reload', /onDone=\{\(msg\) => \{ setClearedNote\(msg\); reload\(\); \}\}/.test(screen) && /refreshStore\('project_history'\)/.test(proj));
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
