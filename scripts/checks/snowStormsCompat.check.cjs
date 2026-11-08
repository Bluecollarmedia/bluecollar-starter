// Run: node scripts/checks/snowStormsCompat.check.cjs <path to typescript package>
// Checks how the app talks to the database for multi-service storms, with a FAKE supabase:
// it must work after update 40 AND keep working (one service per storm) before update 40 is run.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const compile = (src, req) => {
  const m = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', esModuleInterop: true } }).outputText)(m, m.exports, req);
  return m.exports;
};

let calls = [];
let handler = () => ({ data: null, error: { message: 'unset' } });
const fakeSupabase = { rpc: async (fn, args) => { calls.push({ fn, args }); return handler(fn, args); } };
const services = compile(read('src/lib/snowServices.ts'), () => ({}));
const storms = compile(read('src/data/snowStorms.ts'), (name) => {
  if (name === '@/lib/supabase') return { supabase: fakeSupabase, isSupabaseConfigured: true };
  if (name === '@/lib/ids') return { uuid: () => 'uuid-1' };
  if (name === '@/lib/snowServices') return services;
  return {};
});
const { createStorm, loadEligibleProperties } = storms;

const stormResult = { storm: { id: 's1', name: 'X', service: 'plowing', services: ['plowing', 'shoveling'], status: 'draft', created_at: 'x', updated_at: 'x', reopened_count: 0 }, changed: true, summary: { routes: 0, visits: 0, completed: 0, skipped: 0, arrived: 0, pending: 0, pending_skip_requests: 0 } };
const missing = (sig) => ({ data: null, error: { message: `Could not find the function public.${sig} in the schema cache` } });

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };

(async () => {
  // after update 40
  calls = []; handler = () => ({ data: stormResult, error: null });
  let r = await createStorm({ name: 'X', services: ['plowing', 'shoveling'], requestId: 'rq' });
  check('1 with update 40: one call, sends the whole list and the request id', r.ok && calls.length === 1 && calls[0].args.p_services.join() === 'plowing,shoveling' && calls[0].args.p_client_request_id === 'rq' && !('p_service' in calls[0].args), JSON.stringify(calls));

  // before update 40
  calls = [];
  handler = (fn, args) => ('p_services' in args ? missing('snow_create_storm(p_client_request_id, p_name, p_notes, p_services)') : { data: stormResult, error: null });
  r = await createStorm({ name: 'X', services: ['plowing'], requestId: 'rq' });
  check('2 before update 40, one service: retries the old way and succeeds', r.ok && calls.length === 2 && calls[1].args.p_service === 'plowing' && !('p_services' in calls[1].args), JSON.stringify(calls));

  calls = [];
  r = await createStorm({ name: 'X', services: ['plowing', 'shoveling'], requestId: 'rq' });
  check('3 before update 40, several services: a clear message, no second call, nothing created', !r.ok && /update 40/.test(r.error) && calls.length === 1, JSON.stringify({ r, calls }));

  calls = []; handler = () => ({ data: null, error: { message: 'Only the owner or an admin can create a storm.' } });
  r = await createStorm({ name: 'X', services: ['plowing'], requestId: 'rq' });
  check('4 any other error is passed through unchanged (no silent retry)', !r.ok && r.error === 'Only the owner or an admin can create a storm.' && calls.length === 1);

  calls = [];
  r = await createStorm({ name: 'X', services: [], requestId: 'rq' });
  check('5 no services is refused before asking the database', !r.ok && calls.length === 0);

  calls = []; handler = () => ({ data: stormResult, error: null });
  calls = []; handler = () => missing('snow_set_storm_services(p_services, p_storm_id)');

  calls = []; handler = () => ({ data: [{ property_id: 'p1', name: 'A', address: 'x', services: ['shoveling'] }], error: null });
  let e = await loadEligibleProperties('s1', 'shoveling');
  check('8 with update 40: asks for properties of the route\'s service', e.ok && calls.length === 1 && calls[0].args.p_service === 'shoveling' && e.data[0].services.join() === 'shoveling');
  calls = [];
  handler = (fn, args) => ('p_service' in args ? missing('snow_storm_eligible_properties(p_service, p_storm_id)') : { data: [{ property_id: 'p2', name: 'B', address: 'y' }], error: null });
  e = await loadEligibleProperties('s1', 'plowing');
  check('9 before update 40: falls back to the old call (a storm has one service then)', e.ok && calls.length === 2 && !('p_service' in calls[1].args) && e.data[0].name === 'B');
  calls = []; handler = () => ({ data: [], error: null });
  e = await loadEligibleProperties('s1');
  check('10 without a service it behaves exactly as before', e.ok && calls.length === 1 && Object.keys(calls[0].args).join() === 'p_storm_id');

  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
