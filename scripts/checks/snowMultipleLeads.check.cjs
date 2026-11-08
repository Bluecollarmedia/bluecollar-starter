// A Snow route can have any number of crew leads. File-text checks; the database rules are proved by supabase/tests/110_snow_multiple_leads.pglite.mjs.
// Not covered here (needs a phone): how the lead picker looks and works.
const fs = require('fs');
const read = (p) => fs.readFileSync(p, 'utf8');
let bad = 0;
let n = 0;
const check = (name, ok) => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}`); };
const sql = read('supabase/updates/110_snow_multiple_leads.sql');
check('every lead goes through the ONE lead check, which says yes for the first lead and any extra lead', /function public\.snow_is_route_lead[\s\S]*snow_route_extra_leads/.test(sql));
check('only owner/admin set the leads, and nobody writes the extra-leads table directly', /snow_set_route_leads[\s\S]*is_staff\(r\.company_id\)/.test(sql) && /revoke all on public\.snow_route_extra_leads from anon, authenticated/.test(sql));
check('a lead is never also crew (guard, crew setter and lead setter all enforce it)', /already leads this route/.test(sql) && /delete from public\.snow_route_crew where route_id = r\.id and person_id = any \(wanted\)/.test(sql));
check('the first-lead column is kept, so older screens and templates keep working', /lead_person_id/.test(sql) && /_snow_route_lead_leaves_extra_leads/.test(sql));
const ed = read('src/components/snow/routes/RouteEditScreen.tsx');
check('the route editor lets the owner pick one or more leads (tap to add or remove)', /Select one or more crew leads/.test(ed) && /setRouteLeads\(route\.id, toggleLead\(leadIds, personId\)\)/.test(ed) && /Any number can lead/.test(ed));
const crew = read('src/lib/snowCrew.ts');
check('the team list shows every lead first, then the crew', /export function routeTeamMulti/.test(crew) && /export function toggleLead/.test(crew));
check('older databases without update 110 get a clear message instead of a crash', /database update 110/.test(read('src/data/snowRoutes.ts')));
process.exit(bad ? 1 : 0);
