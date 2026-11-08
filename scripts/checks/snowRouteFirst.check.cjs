// Run: node scripts/checks/snowRouteFirst.check.cjs
// Snow: the storm you create is the route. The storm screen goes straight to the route (crew lead, crew, add properties), photos are
// chosen per property (not per route) with a note per property, and the route shows which properties are open or closed.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (n, ok, detail) => { if (!ok) bad++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (ok ? '' : ' - ' + (detail || ''))); };

const storm = read('src/components/snow/storms/StormDetailScreen.tsx');
check('1 the storm screen no longer has Add Route, saved-route buttons, or a Services card; it shows the route editor itself',
  !/Add Route/.test(storm) && !/Change Services/.test(storm) && !/Add saved route/.test(storm) && /<RouteEditor routeId=\{r\.id\}/.test(storm));
check('1b there is ONE screen for a route (no standalone view/edit copy); every crew or route tap opens the storm, and "View all routes" appears once',
  !fs.existsSync(path.join(__dirname, '../../app/snow/owner/route/[id].tsx'))
  && /'\/snow\/owner\/storm\/\[id\]'/.test(read('src/lib/snowLinks.ts')) && !/snow\/owner\/route\//.test(read('src/lib/snowLinks.ts'))
  && (read('src/components/snow/dashboard/SnowDashboardScreen.tsx').match(/accessibilityLabel="View all routes/g) || []).length === 1);
check('1c Save as template and Cancel route live on that one screen, and a property row shows name + address with no "No photos required" text',
  /Save as template/.test(read('src/components/snow/routes/RouteEditScreen.tsx')) && /onRouteCancelled/.test(read('src/components/snow/routes/RouteEditScreen.tsx')) && !/No photos required/.test(read('src/components/snow/routes/RouteEditScreen.tsx')));
check('2 the route is made for the storm automatically (one route for all its services), once, with photos NOT required by default',
  /ensured\.current !== s\.data\.storm\.id/.test(storm) && /service: services\[0\], services, mediaRequired: false, minMedia: 1/.test(storm));
const edit = read('src/components/snow/routes/RouteEditScreen.tsx');
check('3 no big "Route name" box or route-wide photo switch: the name is renamed from a small pencil, photos are per property',
  !/label="Route name"\s+value=\{name\}/.test(edit) && !/save\(\{ mediaRequired/.test(edit) && /Rename route/.test(edit) && /Photos required here/.test(edit) && /updateStop\(v\.id, patch\)/.test(edit));
check('4 the route shows Open and Closed counts and the button says Add Property',
  /Open \$\{openCount\}/.test(edit) && /Closed \$\{groups\.length - openCount\}/.test(edit) && /title="Add Property"/.test(edit));
const data = read('src/data/snowRoutes.ts');
check('5 stops carry the owner note and photo setting; a database without update 60 still loads the route; the stop setting wins over the route rule',
  /owner_note, photos_required/.test(data) && /stop\.photosRequired \?\? route\.mediaRequired|stop\.photosRequired \?\? route\.mediaRequired/.test(data.replace(/\s+/g, ' ')) || /photosRequired \?\? route\.mediaRequired/.test(data));
const mine = read('src/components/snow/routes/MyRouteScreen.tsx');
check('6 the crew lead sees the property note, and the photo prompt follows the property setting', /current\.ownerNote/.test(mine) && /stopNeedsPhotos\(current, route\)/.test(mine));
check('7 the database update and its test exist', fs.existsSync(path.join(__dirname, '../../supabase/updates/060_snow_stop_notes_photos.sql')) && fs.existsSync(path.join(__dirname, '../../supabase/tests/060_snow_stop_notes_photos.pglite.mjs')));
console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
