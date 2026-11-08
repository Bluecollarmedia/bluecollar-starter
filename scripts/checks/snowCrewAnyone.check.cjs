// Run: node scripts/checks/snowCrewAnyone.check.cjs
// A Snow route crew can be picked from EVERYONE on the team. Someone not on the snow team yet is given Snow access (every service) at the
// moment they are added, then put on the route. (The owner chose this: "yes, give access".)
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };
const data = read('src/data/snowRoutes.ts');
const screen = read('src/components/snow/routes/RouteEditScreen.tsx');

check('1 the crew list is every active worker, admin and owner', /export async function loadSnowCrewPool/.test(data) && /\.in\('role', \['worker', 'admin', 'owner'\]\)\.eq\('status', 'active'\)/.test(data));
check('2 the screen loads that list and offers it for the crew', /loadSnowCrewPool\(\)/.test(screen) && /crewChoices\(pool\.length \? pool : leads, route\.leadPersonId/.test(screen));
check('3 someone not on the snow team is given Snow access (all three services) before they are put on the route', /add && !leads\.some\(\(l\) => l\.personId === personId\)/.test(screen) && /grantSnowAccessForRoute\(personId\)/.test(screen) && /p_services: \['plowing', 'shoveling', 'salting'\]/.test(data));
check('4 if the access could not be given, they are NOT added and the owner is told', /if \(!granted\.ok\) \{ setBusy\(false\); return showMessage\("Couldn't add them", granted\.error\); \}/.test(screen));
check('5 the list says who will get Snow access, so it is never a surprise', /Gets Snow access when added/.test(screen));
check('6 people already on the snow team (and owners/admins) are added exactly as before', /onSnowTeam\.has\(l\.personId\) \? null/.test(screen));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
