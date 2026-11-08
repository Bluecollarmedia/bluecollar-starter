// Run: node scripts/checks/accountAccess.check.cjs
// Wiring for account access (account / admin / deactivation / closure): the screens call the database functions, there is ONE join entry,
// and supabase/setup.sql and its database test hold the rules. (The behavior itself is proved by supabase/tests/setup/10_team.test.mjs.)
const fs = require('fs');
const path = require('path');
const SETUP_SQL = require('./_sql.cjs').setup;   // supabase/setup.sql, the one file that builds the database
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let bad = 0;
const check = (n, ok) => { if (!ok) bad++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + n); };
const sql = SETUP_SQL;
const join = read('app/invite/[token].tsx');
const team = read('app/(owner)/(tabs)/more/team-access.tsx');
const hook = read('src/hooks/useTeamAccess.ts');
const closeRow = read('src/components/account/DeleteCompanyRow.tsx');

check('1 setup.sql defines deactivate_member and its database test exists', fs.existsSync(path.join(root, 'supabase/tests/setup/10_team.test.mjs')) && /create or replace function public\.deactivate_member/.test(sql));
check('3 the private invite page signs people up with the link only: no code lookup, no join request', /inviteToken/.test(join) && /invite_lookup/.test(join) && !/lookupAnyCode|join_with_code|request_join/.test(join));
check('4 the Team access screen uses plainly named actions (the leader role is shown by its label from the settings file, e.g. "Make manager")', ['Deactivate worker', 'Reactivate', 'title={`Make ${leader}`}', 'title={`Remove ${leader}`}', 'const leader = leaderWord();'].every((t) => team.includes(t)));
check('5 deactivation shows warnings and needs a confirmation', /acknowledge/.test(hook) && /I have read this/.test(team));
check('6 only the owner sees Make admin / Remove admin and Admin powers', /isOwner \? \(/.test(team) && /set_admin_permissions/.test(hook));
check('7 closing the company shows what is still going on and blocks while people are clocked in', /company_closure_preview/.test(closeRow) && /stillGoing\.length > 0/.test(closeRow));
check('8 setup.sql enforces the protections in the database (team guard trigger, permission helper, deactivation trigger)', /create trigger company_members_guard BEFORE INSERT OR DELETE OR UPDATE ON public\.company_members FOR EACH ROW EXECUTE FUNCTION public\._company_members_guard\(\)/.test(sql) && /create or replace function public\.admin_can\(/.test(sql) && /ON public\.company_members FOR EACH ROW EXECUTE FUNCTION public\._member_deactivated\(\)/.test(sql));
console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
