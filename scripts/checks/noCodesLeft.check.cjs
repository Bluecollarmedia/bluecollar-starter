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

const codeWords = /team code|signup code|join_with_code|lookup_team_code|lookup_any_code|approve_join_request|approve a new join request|join a team|Pending Requests|\bjoin request/i;
const codeHits = hits(codeWords);
check('1 no join/team codes, requests or "Join a Team" anywhere in the app code or wording', codeHits.length === 0, codeHits.join(', '));

check('2 the old code and request screens are gone', ['app/(auth)/join-team.tsx', 'app/(auth)/customer-access.tsx', 'app/(onboarding)/pending-approval.tsx', 'app/(onboarding)/declined.tsx',
  'app/(owner)/(tabs)/more/pending-requests.tsx', 'app/(owner)/(tabs)/more/join-settings.tsx'].every((f) => !fs.existsSync(path.join(root, f))));

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
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
