// Run: node scripts/checks/noCodesLeft.check.cjs
// The owner removed join codes, requests and several screens. This fails if any of it comes back into the app's code or wording.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'src'))];
const hits = (re) => files.filter((f) => re.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(root, f));

const codeWords = /team code|snow code|signup code|join_with_code|lookup_team_code|lookup_any_code|lookup_snow_code|request_snow_access|approve_join_request|approve_snow_access|approve a new join request|join a team|Pending Requests|\bjoin request/i;
const codeHits = hits(codeWords).filter((f) => !/snowActivity\.ts$/.test(f)); // old activity-log rows keep their historic label
check('1 no join/team/snow codes, requests or "Join a Team" anywhere in the app code or wording', codeHits.length === 0, codeHits.join(', '));

check('2 the old code and request screens are gone', ['app/(auth)/join-team.tsx', 'app/(auth)/customer-access.tsx', 'app/(onboarding)/pending-approval.tsx', 'app/(onboarding)/declined.tsx',
  'app/(owner)/(tabs)/more/pending-requests.tsx', 'app/(owner)/(tabs)/more/join-settings.tsx', 'app/(worker)/snow-access.tsx'].every((f) => !fs.existsSync(path.join(root, f))));
check('3 there is no second route screen', !fs.existsSync(path.join(root, 'app/snow/owner/route')));

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const storm = read('src/components/snow/storms/StormDetailScreen.tsx');
check('4 the storm screen has no History section and no stats card on a draft', !/>History</.test(storm) && /storm\.status !== 'draft'/.test(storm));
const dash = read('src/components/snow/dashboard/SnowDashboardScreen.tsx');
check('5 the dashboard has no empty "Needs attention", no "clocked in now" line, and "View all routes" once', !/Nothing is waiting/.test(dash) && !/clocked in now/.test(dash) && (dash.match(/View all routes/g) || []).length <= 2 && !/See the full route list/.test(dash));
const prop = read('app/(owner)/snow-property.tsx');
check('6 the Snow property screen has no customer-notification card and no "Other contacts"', !/NOTIFICATIONS/.test(prop) && !/OTHER CONTACTS/.test(prop) && !/Add Contact/.test(prop) && !/OwnerPropertyNotifications/.test(prop));
const setup = read('src/hooks/useCompanySetup.ts');
check('7 the setup checklist talks about invite links, not a team code', /private link/.test(setup) && !/team code/i.test(setup));
{
  const fs2 = require('fs'), path2 = require('path');
  const rd = (f) => fs2.readFileSync(path2.join(__dirname, '../..', f), 'utf8');
  const acc = rd('app/(owner)/(tabs)/more/accounts.tsx') + rd('src/hooks/useAccounts.ts');
  check('N1 nothing waits for approval: Accounts has no "Waiting" or "Declined" status (a link makes someone active the moment they use it)', !/label: 'Waiting'|label: 'Declined'|key: 'pending'|key: 'declined'|request_status === /.test(acc) && /type AccountStatus = 'active' \| 'removed' \| 'not_joined'/.test(acc));
}
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
