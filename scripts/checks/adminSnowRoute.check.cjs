// Run: node scripts/checks/adminSnowRoute.check.cjs
// An ADMIN who leads (or crews) a dispatched Snow route works it like a worker: a "Your route" card on the Snow dashboard opens the worker
// Snow screens (route, stops, time clock), with a way back. Nothing changes for owners or real workers. The database already lets owners and
// admins work Snow (snow_is_active / snow_has_service accept staff), so this needs no SQL.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };
const card = read('src/components/snow/dashboard/AdminSnowRouteCard.tsx');
const dash = read('src/components/snow/dashboard/SnowDashboardScreen.tsx');
const root = read('app/_layout.tsx');
const wl = read('app/snow/worker/_layout.tsx');
const pill = read('src/components/admin/AdminBackPill.tsx');
const state = read('src/lib/adminSnowWork.ts');
const sql = read('supabase/updates/020_snow_access.sql');

check('1 only a real admin sees the card (the real role, not the login role)', /db\.role === 'admin'/.test(card) && /if \(!isAdmin\) return;/.test(card));
check('2 it lists the routes the admin leads or crews in a storm that is under way (dispatched)', /loadMyRoutes\(\)/.test(card) && /x\.stormStatus === 'dispatched'/.test(card) && /if \(!isAdmin \|\| !routes\.length\) return null/.test(card));
check('3 "Open my route" opens the worker Snow screens and tells the app the admin may stay there', /setAdminWorksSnow\(true\); router\.push\('\/snow\/worker' as any\)/.test(card));
check('4 the routing allows an admin in the worker Snow area only after that, and only for admins', /db\.role === 'admin' && adminOnSnowRoute && s1 === 'worker'/.test(root) && /useAdminWorksSnow\(\)/.test(root) && /export function setAdminWorksSnow/.test(state));
check('5 the Snow dashboard shows the card', /<AdminSnowRouteCard \/>/.test(dash));
check('6 the worker Snow screens give an admin a way back to the Snow admin view', /<AdminBackPill to="\/snow\/owner" onBack=\{\(\) => setAdminWorksSnow\(false\)\} \/>/.test(wl) && /db\.role !== 'admin'\) return null/.test(pill));
check('7 the database already accepts admins for Snow work (no SQL needed)', /snow_is_active[\s\S]{0,200}public\.is_staff\(cid\) or exists/.test(sql) && /snow_has_service[\s\S]{0,200}public\.is_staff\(cid\) or exists/.test(sql));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
