// Run: node scripts/checks/snowCombinedRoutes.check.cjs <path to typescript package>
// One snow route that does several services together (plowing + salting): how visits group into one stop, and that the owner and
// lead screens, the data layer and the database update are wired for it.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(read('src/lib/snowStopGroups.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const g = m.exports;
let bad = 0;
const check = (n, ok, detail) => { if (!ok) bad++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (ok ? '' : ' - ' + (detail || ''))); };

const v = (id, prop, service, status = 'pending') => ({ id, propertyId: prop, service, status });
const stops = [v('1', 'A', 'plowing'), v('2', 'A', 'salting'), v('3', 'B', 'plowing'), v('4', 'C', 'plowing'), v('5', 'C', 'salting')];
const groups = g.groupStops(stops);
check('1 the plowing and salting visits at one property are one stop', groups.length === 3 && groups[0].map((x) => x.id).join() === '1,2' && groups[1].length === 1 && groups[2].map((x) => x.id).join() === '4,5', JSON.stringify(groups.map((x) => x.map((y) => y.id))));
const repeat = g.groupStops([v('1', 'A', 'plowing'), v('2', 'A', 'plowing')]);
check('2 two plowing passes at the same property stay two stops', repeat.length === 2);
check('3 flattening puts the visits back in order', g.flattenGroups([groups[2], groups[0]]).map((x) => x.id).join() === '4,5,1,2');
check('4 a stop is closed only when every visit in it is done or skipped', g.isGroupClosed([v('1', 'A', 'plowing', 'completed'), v('2', 'A', 'salting', 'skipped')]) && !g.isGroupClosed([v('1', 'A', 'plowing', 'completed'), v('2', 'A', 'salting', 'arrived')]));
check('5 stop status: not started, in progress, completed', g.groupStatus([v('1', 'A', 'plowing'), v('2', 'A', 'salting')]) === 'pending' && g.groupStatus([v('1', 'A', 'plowing', 'completed'), v('2', 'A', 'salting', 'arrived')]) === 'arrived' && g.groupStatus([v('1', 'A', 'plowing', 'completed'), v('2', 'A', 'salting', 'completed')]) === 'completed');
check('6 the label reads "Plowing + Salting"', g.servicesText(['plowing', 'salting'], (s) => s[0].toUpperCase() + s.slice(1)) === 'Plowing + Salting');
check('7 a property gets a visit for each of the route\'s services it offers, and only those', g.servicesToAdd(['plowing', 'salting'], ['plowing'], 'plowing').join() === 'plowing' && g.servicesToAdd(['plowing', 'salting'], ['salting', 'plowing'], 'plowing').join() === 'plowing,salting' && g.servicesToAdd(['plowing', 'salting'], ['shoveling'], 'plowing').length === 0 && g.servicesToAdd(['plowing'], undefined, 'plowing').join() === 'plowing');
const a = { personId: 'a' }, b = { personId: 'b' }, c = { personId: 'c' };
check('8 only people who can do every service can lead or crew the route', g.peopleWhoDoAll([[a, b], [b, c]]).map((x) => x.personId).join() === 'b' && g.peopleWhoDoAll([]).length === 0);

const edit = read('src/components/snow/routes/RouteEditScreen.tsx');
check('9 the owner editor shows one row per property, moves and removes a whole stop, and adds one visit per service',
  /groupStops\(route\.stops\)/.test(edit) && /flattenGroups/.test(edit) && /servicesToAdd\(route\.services/.test(edit) && /loadLeadsForServices\(r\.data\.services\)/.test(edit));
const mine = read('src/components/snow/routes/MyRouteScreen.tsx');
check('10 the lead starts and finishes every visit at a property together, photos go on the first visit, the note on the first',
  /arriveGroup\(currentGroup\)/.test(mine) && /finishGroup\(currentGroup\)/.test(mine) && /finishStop\(v\.id, first \? note : undefined\)/.test(mine) && /stopNeedsPhotos\(current, route\)/.test(mine) && /addCompletionMedia\(route\.companyId, current\.id/.test(mine));
const storm = read('src/components/snow/storms/StormDetailScreen.tsx');
check('11 a storm with several services makes ONE route for all of them (older databases fall back to one per service)',
  /createRoute\(st\.id, \{ name: st\.name, service: services\[0\], services,/.test(storm) && /one route per service/.test(storm));
const data = read('src/data/snowRoutes.ts');
check('12 the data layer reads services tolerantly (no update 61 yet) and adds a visit per service',
  /select\(`\$\{routeCols\}, services`\)/.test(data) && /build\(`\$\{base\}, services`\)/.test(data) && /\.\.\.\(service \? \{ service \} : \{\}\)/.test(data));
const sql = read('supabase/updates/061_snow_combined_routes.sql');
check('13 the database update lets a lead start the second service at the same property and requires a lead for every service',
  /property_id <> v\.property_id/.test(sql) && /snow_person_has_service\(s\.company_id, r\.lead_person_id, sv\)/.test(sql) && fs.existsSync(path.join(__dirname, '../../supabase/tests/061_snow_combined_routes.pglite.mjs')));
console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
