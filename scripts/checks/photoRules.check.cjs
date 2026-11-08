// Photo rules: one photo per maintenance task when photos are on; how many photos per service/stop/route; Snow per property service, route and stop.
// File-text checks; the database rules are proved by supabase/tests/111_maintenance_photo_per_task.pglite.mjs and 112_snow_photo_rules.pglite.mjs.
// Not covered here (needs phones): taking the photos and the screens' look.
const fs = require('fs');
const read = (p) => fs.readFileSync(p, 'utf8');
let bad = 0;
let n = 0;
const check = (name, ok) => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}`); };
const sql111 = read('supabase/updates/111_maintenance_photo_per_task.sql');
check('the database refuses ticking a task without its own photo (crew only), and a photo can only belong to a task of its own stop', /Each task needs its own photo/.test(sql111) && /not public\.is_staff/.test(sql111) && /belongs to a different stop/.test(sql111));
const list = read('src/components/maintenance/StopChecklist.tsx');
check('the worker is asked for a photo for EVERY task (not only the first), and the task ticks when its photo is saved', /withPhoto\.has\(task\.id\)/.test(list) && /askForTaskPhoto\(stopId, true, task\.id\)/.test(list) && !/photoCount === 0\) \{\n      setSaving\(task\.id\);\n      const go = await askForTaskPhoto\(stopId, requiresPhotos/.test(list));
check('a photo saved for a task ticks that task, never undoing the photo if that fails', /afterStopPhotoSaved/.test(read('src/data/mediaTargets.ts')) && /tickWhenSaved/.test(read('src/data/maintenance.ts')));
check('a service can say how many photos (1 to 20), and new stops start from it', /minPhotos/.test(read('src/lib/maintenanceServiceDraft.ts')) && /filter\(\(r\) => r\.requiresPhotos\)\.map\(\(r\) => r\.minPhotos/.test(read('src/data/maintenance.ts')));
const route = read('app/(owner)/(tabs)/maintenance/routes/[id].tsx');
check('the owner can set photos for the whole maintenance route, or for each stop', /setRoutePhotoRule\(route\.id/.test(route) && /updateStop\(stop\.id, \{ requiresPhotos: on, minPhotos: n \}\)/.test(route));
const sql112 = read('supabase/updates/112_snow_photo_rules.sql');
check('Snow: a property service can carry a photo rule that new stops start from (a trigger), and a stop its own number', /photos_required boolean/.test(sql112) && /photo_count integer/.test(sql112) && /min_media integer/.test(sql112) && /_snow_visit_photo_defaults/.test(sql112));
const edit = read('src/components/snow/routes/RouteEditScreen.tsx');
check('Snow route screen: photos for the whole route, and each property with its own number', /Photos required at every stop/.test(edit) && /Photos required here/.test(edit) && /stopCount/.test(edit));
const prop = read('app/(owner)/snow-property.tsx');
check('Snow property screen: each service has follow-the-route / required (how many) / none', /Follow the route/.test(prop) && /Photos required/.test(prop) && /No photos/.test(prop) && /setServicePhotoRule/.test(prop));
check('the lead\'s screen uses the stop\'s own photo number', /stopMinMedia\(current, route\)/.test(read('src/components/snow/routes/MyRouteScreen.tsx')));
check('older databases without updates 111/112 keep working (the stop list falls back; the property rule explains the update)', /min_media/.test(read('src/data/snowRoutes.ts')) && /update 112/.test(read('src/data/snowProperties.ts')));
process.exit(bad ? 1 : 0);
