// Run: node scripts/checks/accountAccess.check.cjs
// Wiring for update 66 (account / admin / deactivation / closure): the screens call the database functions, there is ONE join entry,
// and the migration and its database test exist. (The behavior itself is proved by supabase/tests/066_account_access.pglite.mjs.)
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let bad = 0;
const check = (n, ok) => { if (!ok) bad++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + n); };
const sql = read('supabase/updates/066_account_access_hardening.sql');
const join = read('app/invite/[token].tsx');
const welcome = read('app/(auth)/welcome.tsx');
const setup = read('app/(onboarding)/setup.tsx');
const team = read('app/(owner)/(tabs)/more/team-access.tsx');
const hook = read('src/hooks/useTeamAccess.ts');
const closeRow = read('src/components/account/DeleteCompanyRow.tsx');

check('1 the migration and its database test exist', fs.existsSync(path.join(root, 'supabase/tests/066_account_access.pglite.mjs')) && /create or replace function public\.deactivate_member/.test(sql));
check('2 sign-up has ONE joining entry: no separate Snow card on the welcome or setup screens', !/Join the Snow Team/.test(welcome) && !/Join the Snow Team/.test(setup) && !/kind=snow/.test(welcome + setup));
check('3 the private invite page signs people up with the link only: no code lookup, no join request', /inviteToken/.test(join) && /invite_lookup/.test(join) && !/lookupAnyCode|join_with_code|request_join/.test(join));
check('4 the Team access screen uses four different, plainly named actions', ['Remove landscaping access', 'Remove snow access', 'Deactivate worker', 'Reactivate'].every((t) => team.includes(t)));
check('5 deactivation shows warnings and needs a confirmation; reactivation needs a chosen mode', /acknowledge/.test(hook) && /Choose landscaping access, snow access, or both/.test(team));
check('6 only the owner sees Make admin / Remove admin and Admin powers', /isOwner \? \(/.test(team) && /set_admin_permissions/.test(hook));
check('7 closing the company shows what is still going on and blocks while people are clocked in', /company_closure_preview/.test(closeRow) && /stillGoing\.length > 0/.test(closeRow));
check('8 the migration enforces the protections in the database (guards, permission helper, live membership checks)', /_company_members_guard/.test(sql) && /_join_requests_guard/.test(sql) && /admin_can/.test(sql) && /_member_deactivated/.test(sql));
console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
