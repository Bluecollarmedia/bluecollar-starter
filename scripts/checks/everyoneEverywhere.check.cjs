// Run: node scripts/checks/everyoneEverywhere.check.cjs
// One shared directory: every worker can be put on a route, every property is on the Snow tab, and a customer joins the app ONCE
// (a project never asks for its own "Set Up Access"). Checked from the source, not on a phone.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const maint = read('src/data/maintenance.ts');
const routeNew = read('app/(owner)/route-new.tsx');
const snow = read('src/components/snow/properties/SnowPropertiesScreen.tsx');
const project = read('app/(owner)/(tabs)/projects/[id].tsx');
const picker = read('src/components/customers/CustomerPicker.tsx');

check('1 every active worker can be picked for a route (Maintenance workers listed first, nobody hidden)', /export function routeCandidates\(\)[\s\S]{0,400}m\.role === 'worker' && m\.status === 'active' && m\.person[\s\S]{0,300}Number\(b\.maintenance\) - Number\(a\.maintenance\)/.test(maint));
check('2 putting a worker on a route turns Maintenance on for them first (keeping their other areas)', /ensureMaintenanceArea[\s\S]{0,500}setWorkerAreas\(pid, \{ landscaping: worksOnLandscaping\(m\), maintenance: true \}\)/.test(maint) && /createRouteWithCrew[\s\S]{0,300}ensureMaintenanceArea\(\[/.test(maint));
check('3 the new-route screen lists everyone and saves with createRouteWithCrew', /routeCandidates\(\)/.test(routeNew) && /await createRouteWithCrew\(/.test(routeNew) && /role="checkbox"|accessibilityRole="checkbox"/.test(routeNew));
check('4 the new-route screen no longer limits the crew to maintenance workers', !/crewMembers\.length === 0 \? \(\s*<InlineNotice\s*icon="users"\s*tone="warning"\s*text="No approved maintenance workers/.test(routeNew));
check('5 the Snow Properties tab also lists every property that is not on Snow yet', /NOT ON SNOW YET/.test(snow) && /allProperties\s*\.filter\(\(p\) => !onSnow\.has\(p\.id\)\)/.test(snow));
check('6 and one tap turns Snow on for it, then opens it', /enableSnowForProperty\(propertyId\)/.test(snow) && /open\(res\.snowPropertyId\)/.test(snow));
check('7 search covers both lists', /const shownOthers = q \? others\.filter\(matches\)/.test(snow) && /all\.length \+ others\.length > 6/.test(snow));
check('8 a project never shows "Set Up Access": it follows the customer\'s own login', !/Set Up Access/.test(project) && /function customerHasApp\(personId\?: string\)/.test(project) && /'Connected' : 'Waiting'/.test(project));
check('9 a customer with a login is Connected on every project without any per-project step', /access\?\.claimedBy \|\| hasApp/.test(project));
check('10 the one-time invite stays on the customer (not per job)', /CustomerInviteCard personId=\{p\.customer\.id\}/.test(project));
check('11 customer pickers list every customer (no area or module filter)', /m\.role === 'customer' && m\.status !== 'inactive' && m\.person/.test(picker) && !/worksOn|snow/i.test(picker.slice(picker.indexOf('.filter'), picker.indexOf('.filter') + 200)));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
