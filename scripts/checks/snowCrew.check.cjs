// Run: node scripts/checks/snowCrew.check.cjs <path to typescript package>
// App-side checks for route crew (src/lib/snowCrew.ts and src/data/snowRoutes.ts) with a FAKE database:
// the app must work after update 41 AND keep working (lead only) before update 41 is run.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const compile = (src, req) => {
  const m = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', esModuleInterop: true } }).outputText)(m, m.exports, req);
  return m.exports;
};

const crewLib = compile(read('src/lib/snowCrew.ts'), () => ({}));
const { canWorkRoute, crewChoices, nextCrew, roleFor } = crewLib;

// ---- fake supabase ------------------------------------------------------------
let rpcHandler, tables, calls;
const builder = (table) => {
  const state = { table, filters: [] };
  const api = {
    select: () => api,
    is: () => api, neq: () => api, order: () => api,
    in: (col, vals) => { state.filters.push((r) => vals.includes(r[col])); return api; },
    eq: (col, val) => { state.filters.push((r) => r[col] === val); return api; },
    then: (res) => {
      calls.push({ table, filters: state.filters.length });
      const t = tables[table];
      if (t instanceof Error) return res({ data: null, error: { message: t.message } });
      return res({ data: (t ?? []).filter((r) => state.filters.every((f) => f(r))), error: null });
    },
  };
  return api;
};
const fakeSupabase = { rpc: async (fn, args) => { calls.push({ rpc: fn, args }); return rpcHandler(fn, args); }, from: builder };
const routes = compile(read('src/data/snowRoutes.ts'), (name) => {
  if (name === '@/lib/supabase') return { supabase: fakeSupabase, isSupabaseConfigured: true };
  if (name === '@/lib/snowCrew') return crewLib;
  if (name === '@/lib/snowMedia') return {};
  if (name === '@/lib/ids') return { uuid: () => 'u' };
  return {};
});
const { loadMyRoutes, setRouteCrew, loadRouteCrew } = routes;

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };
const missing = (sig) => ({ data: null, error: { message: `Could not find the function public.${sig} in the schema cache` } });
const routeRow = (id, status) => ({ id, name: `R-${id}`, service: 'plowing', created_at: '2026-01-01', snow_storms: { name: 'Storm', status } });

(async () => {
  // pure helpers
  check('1 a lead (or unknown role) can work the route; crew cannot', canWorkRoute('lead') && canWorkRoute(undefined) && !canWorkRoute('crew'));
  const people = [{ personId: 'a', name: 'Zed' }, { personId: 'b', name: 'Amy' }, { personId: 'lead', name: 'Lee' }, { personId: 'c', name: 'Cy' }, { personId: 'b', name: 'Amy' }];
  check('2 crew choices leave out the lead, existing crew and repeats, sorted by name', crewChoices(people, 'lead', ['c']).map((p) => p.personId).join() === 'b,a');
  check('3 next crew adds once and removes cleanly', nextCrew(['a'], 'b', true).join() === 'a,b' && nextCrew(['a', 'b'], 'b', true).join() === 'a,b' && nextCrew(['a', 'b'], 'a', false).join() === 'b');
  check('5 without update 41 every route counts as lead (only leads could see routes then)', roleFor(null, 'x') === 'lead' && roleFor(new Map([['x', 'crew']]), 'x') === 'crew' && roleFor(new Map(), 'x') === 'lead');

  // after update 41
  calls = []; tables = { snow_routes: [routeRow('r1', 'dispatched'), routeRow('r2', 'dispatched'), routeRow('r3', 'ended'), routeRow('other', 'dispatched')] };
  rpcHandler = () => ({ data: [{ route_id: 'r1', role: 'lead' }, { route_id: 'r2', role: 'crew' }, { route_id: 'r3', role: 'crew' }], error: null });
  let r = await loadMyRoutes();
  check('6 with update 41: my routes come with my role, and only the routes the database says are mine', r.ok && r.data.map((x) => `${x.id}:${x.role}`).join() === 'r1:lead,r2:crew,r3:crew', JSON.stringify(r));
  rpcHandler = () => ({ data: [], error: null });
  calls = []; r = await loadMyRoutes();
  check('7 with update 41 and no routes: empty, and the routes table is not even asked', r.ok && r.data.length === 0 && !calls.some((c) => c.table === 'snow_routes'));

  // before update 41
  rpcHandler = () => missing('snow_my_routes()');
  r = await loadMyRoutes();
  check('8 before update 41: falls back to the old way and every route is mine as lead', r.ok && r.data.length === 4 && r.data.every((x) => x.role === 'lead'), JSON.stringify(r));
  rpcHandler = () => ({ data: null, error: { message: 'JWT expired' } });
  r = await loadMyRoutes();
  check('9 any other error is reported, not hidden by the fallback', !r.ok && /JWT expired|load your routes/.test(r.error));

  // owner: set crew
  calls = []; rpcHandler = () => ({ data: { changed: true, crew: ['a', 'b'] }, error: null });
  let s = await setRouteCrew('r1', ['a', 'b']);
  check('10 setting crew sends the whole list and returns the new crew', s.ok && s.data.join() === 'a,b' && calls[0].rpc === 'snow_set_route_crew' && calls[0].args.p_person_ids.join() === 'a,b' && calls[0].args.p_route_id === 'r1');
  rpcHandler = () => missing('snow_set_route_crew(p_person_ids, p_route_id)');
  s = await setRouteCrew('r1', ['a']);
  check('11 before update 41: a clear message and nothing else happens', !s.ok && /update 41/.test(s.error));
  rpcHandler = () => ({ data: null, error: { message: "Amy isn't on the snow team for plowing." } });
  s = await setRouteCrew('r1', ['a']);
  check('12 the database\'s own reason is shown (service, lead, cancelled…)', !s.ok && /isn't on the snow team/.test(s.error), JSON.stringify(s));

  // loading crew
  tables = { snow_route_crew: [{ route_id: 'r1', person_id: 'a', created_at: '1' }, { route_id: 'r2', person_id: 'b', created_at: '2' }], people: [{ id: 'a', first_name: 'Amy', last_name: 'Ames' }] };
  let c = await loadRouteCrew('r1');
  check('13 loads one route\'s crew with names', c.ok && c.data.length === 1 && c.data[0].name === 'Amy Ames', JSON.stringify(c));
  tables = { snow_route_crew: new Error('relation "public.snow_route_crew" does not exist') };
  c = await loadRouteCrew('r1');
  check('14 before update 41 the crew list is simply empty (no error shown)', c.ok && c.data.length === 0);

  const team = crewLib.routeTeam('b', 'Bea', [{ personId: 'a', name: 'Amy' }, { personId: 'b', name: 'Bea' }]);
  check('15 the team is the lead first, then the crew, with no repeats; the lead is always one of the team', team.length === 2 && team[0].lead && team[0].personId === 'b' && !team[1].lead);
  check('16 choosing a new lead keeps the old lead on the route as crew and takes the new one off the crew list', JSON.stringify(crewLib.crewAfterLeadChange(['a', 'c'], 'b', 'a')) === JSON.stringify(['c', 'b']) && JSON.stringify(crewLib.crewAfterLeadChange(['a'], undefined, 'a')) === '[]');
  check('18 a draft explains what is missing before it can go out', crewLib.dispatchGaps([{ stops: 0 }]).join('|') === 'Choose a crew lead|Add at least one property' && crewLib.dispatchGaps([{ leadPersonId: 'a', stops: 2 }]).length === 0);

  // Promoting a crew member to lead: they stay on the route (shown first, labelled Lead), the old lead stays as crew.
  const after = crewLib.crewAfterLeadChange(['bo', 'cy'], 'al', 'bo');
  const teamAfter = crewLib.routeTeam('bo', 'Bo', after.map((id) => ({ personId: id, name: id })));
  check('19 making a crew member the lead keeps them on the route and keeps the old lead as crew', teamAfter.map((m) => m.personId).join() === 'bo,cy,al' && teamAfter[0].lead === true && teamAfter.filter((m) => m.lead).length === 1, JSON.stringify(teamAfter));
  check('20 the crew row labels who the lead is', /m\.lead \? <Text[^>]*>Lead<\/Text>/.test(read('src/components/snow/routes/RouteEditScreen.tsx')));

  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
