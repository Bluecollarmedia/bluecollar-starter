// Run: node scripts/checks/snowStormDelete.check.cjs <path to typescript package>
// Delete a storm for good: the wording, and how the app talks to the database (FAKE supabase), including a database
// that has not had update 50 yet.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const compile = (src, req) => {
  const m = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', esModuleInterop: true } }).outputText)(m, m.exports, req);
  return m.exports;
};

const lib = compile(read('src/lib/snowStormDelete.ts'), () => ({}));
let calls = [];
let rpcResult = { data: null, error: null };
let tableResult = () => ({ data: null, error: null, count: 0 });
const builder = (table) => {
  const op = { table, steps: [] };
  const b = new Proxy({}, { get(_t, prop) { if (prop === 'then') return (res, rej) => { calls.push(op); return Promise.resolve(tableResult(op)).then(res, rej); }; return (...a) => { op.steps.push([String(prop), a]); return b; }; } });
  return b;
};
const fakeSupabase = { rpc: async (fn, args) => { calls.push({ rpc: fn, args }); return rpcResult; }, from: (t) => builder(t) };
const storms = compile(read('src/data/snowStorms.ts'), (n) => {
  if (n === '@/lib/supabase') return { supabase: fakeSupabase, isSupabaseConfigured: true };
  if (n === '@/lib/ids') return { uuid: () => 'u' };
  if (n === '@/lib/snowServices') return { defaultStormNameFor: () => 'x' };
  if (n === '@/lib/snowStormDelete') return lib;
  if (n === '@/lib/storageSweep') return { sweepStorageSoon: () => {} };
  return {};
});
const { deleteStormForGood, loadStormCounts } = storms;

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };

(async () => {
  const c = { routes: 2, stops: 14, completedStops: 9, media: 12 };
  check('1 wording uses the real counts', /2 routes and 14 stops \(9 completed\)/.test(lib.whatWillGo(c)) && /12 completion photos and videos/.test(lib.whatWillGo(c)), lib.whatWillGo(c));
  check('2 singular wording and an empty storm', /1 route and 1 stop\./.test(lib.whatWillGo({ routes: 1, stops: 1, completedStops: 0, media: 0 })) && lib.whatWillGo({ routes: 0, stops: 0, completedStops: 0, media: 0 }) === 'It has no routes or stops.');
  const d = lib.deleteConfirmation('First Big Storm', 'dispatched', c);
  check('3 the question says what will go, that it is permanent, and that hours and the log stay', /Delete First Big Storm for good\?/.test(d.title) && /still active/.test(d.message) && /can't be undone/.test(d.message) && /Hours people clocked stay/.test(d.message) && /Activity log keeps a note/.test(d.message) && d.confirm === 'Delete storm', d.message);
  check('4 a draft and an ended storm are described correctly', /never dispatched/.test(lib.deleteConfirmation('X', 'draft', c).message) && /an ended storm/.test(lib.deleteConfirmation('X', 'ended', c).message));
  check('5 a storm with no finished work does not talk about customers losing photos', !/Customers can no longer see photos/.test(lib.deleteConfirmation('X', 'draft', { routes: 1, stops: 2, completedStops: 0, media: 0 }).message));

  // after update 50
  calls = []; rpcResult = { data: { routes: 2, stops: 14 }, error: null };
  let r = await deleteStormForGood('s1', 'dispatched');
  check('6 deleting any storm calls snow_delete_storm and reports what went', r.ok && calls[0].rpc === 'snow_delete_storm' && calls[0].args.p_storm_id === 's1' && r.data.routes === 2 && r.data.stops === 14, JSON.stringify(calls));
  rpcResult = { data: null, error: { message: 'Storm not found.' } };
  r = await deleteStormForGood('s1', 'ended');
  check('7 a refusal from the database is shown as it is', !r.ok && r.error === 'Storm not found.');

  // before update 50
  rpcResult = { data: null, error: { message: 'Could not find the function public.snow_delete_storm(p_storm_id) in the schema cache' } };
  calls = [];
  r = await deleteStormForGood('s1', 'dispatched');
  check('8 before update 50, a dispatched storm gives a clear message and nothing is deleted', !r.ok && /update 50/.test(r.error) && calls.every((x) => x.rpc), JSON.stringify(calls.map((x) => x.rpc || x.table)));
  calls = []; tableResult = () => ({ error: null });
  r = await deleteStormForGood('s1', 'draft');
  check('9 before update 50, a draft is still deleted the old way', r.ok && calls.some((x) => x.table === 'snow_storms' && x.steps.some((s) => s[0] === 'delete')), JSON.stringify(calls.map((x) => x.rpc || x.table)));

  // counts
  calls = [];
  tableResult = (op) => ({ count: { snow_routes: 2, snow_visits: op.steps.some((s) => s[0] === 'eq' && s[1][0] === 'status') ? 9 : 14, snow_completion_media: 12 }[op.table], error: null });
  const counts = await loadStormCounts('s1');
  check('10 counts: routes, stops, completed stops, photo records', counts.ok && counts.data.routes === 2 && counts.data.stops === 14 && counts.data.completedStops === 9 && counts.data.media === 12, JSON.stringify(counts));
  tableResult = (op) => (op.table === 'snow_completion_media' ? { count: null, error: { message: 'relation does not exist' } } : { count: 1, error: null });
  const counts2 = await loadStormCounts('s1');
  check('11 if the photo table is not there, counts still work (0 photos)', counts2.ok && counts2.data.media === 0);

  // wiring
  const settings = read('app/snow/owner/(tabs)/more.tsx');
  const screen = read('src/components/snow/storms/ManageStormsScreen.tsx');
  check('12 Snow More has a Manage storms row that opens the screen', /title="Manage storms"/.test(settings) && /manage-storms/.test(settings) && /manage-storms/.test(read('app/snow/owner/_layout.tsx')) && fs.existsSync(path.join(__dirname, '../../app/snow/owner/manage-storms.tsx')));
  check('13 the screen lists every storm and has NO delete (renaming only, by the owner choice)', /loadStorms\(\)/.test(screen) && !/deleteStormForGood|Delete \$\{s\.name\}|trash-2/.test(screen));
  check('14 it is not on the dashboard', !/Manage storms|manage-storms/.test(read('src/components/snow/dashboard/SnowDashboardScreen.tsx')));
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
