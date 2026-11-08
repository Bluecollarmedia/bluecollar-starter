// Run: node scripts/checks/rulebook.check.cjs
// Step 7: CLAUDE.md is the kit's rulebook. This check fails if one of the key rules (learned the hard way on the original app)
// goes missing from it. Simple text checks only: reword a rule freely, but keep its key words.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => (fs.existsSync(path.join(root, p)) ? fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n') : '');
let bad = 0;
let n = 0;
const check = (name, ok, detail = '') => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}${ok ? '' : '  - ' + detail}`); };

const md = read('CLAUDE.md');
check('CLAUDE.md exists and is not empty', md.length > 1000, 'missing or too short');

const RULES = [
  ['workers and customers join only through a private invite link', /ONLY through a private invite link/i],
  ['one company per database', /one company per database/i],
  ['email confirmation uses a 6-digit code', /6-digit code/i],
  ['Confirm email ON for every client, in order', /Confirm email[^\n]*ON for every client/i],
  ['auth redirect URL <scheme>://auth-callback', /<scheme>:\/\/auth-callback/],
  ['every Back button has a fallback (canGoBack ? back : replace)', /router\.canGoBack\(\)\s*\?\s*router\.back\(\)\s*:\s*router\.replace/],
  ['the root Slot gotcha (push inside the area Stack, legal-support pattern)', /root Slot gotcha/i],
  ['the legal-support pattern is named', /legal-support/],
  ['phones need two cold launches to show an OTA update', /TWO cold launches/i],
  ['EXPO_PUBLIC_ values come from the EAS environment', /EXPO_PUBLIC_[^\n]*EAS environment/i],
  ['release builds with missing values show "App not set up"', /App not set up/],
  ['the web site needs its own EXPO_PUBLIC_ copies', /web site[^\n]*own copies|own `?EXPO_PUBLIC_`? values/i],
  ['use the client business domain from day one', /business domain from day one/i],
  ['keep the App Store demo account until Apple approves', /demo account[^\n]*until Apple approves/i],
  ['one Apple push key per client (revoking breaks all apps)', /push key/i],
  ['revoking a shared push key breaks push for all apps', /revoking it breaks push for ALL/i],
  ['SQL only when the owner asks', /SQL only when the owner asks/i],
  ['Claude never runs SQL', /Claude never runs SQL/i],
  ['no builds / submits / updates unless the owner says so', /No builds, submits or OTA updates unless the owner says so/i],
  ['reports to the owner as short .txt files', /\.txt file/i],
  ['never commit keys', /Never commit keys/i],
  ['server secrets via supabase secrets set', /supabase secrets set/],
  ['deploy server functions from the repo with the CLI', /supabase functions deploy/],
  ['R2 is required, incl. R2_PRIVATE_BUCKET_NAME', /R2_PRIVATE_BUCKET_NAME/],
  ['everything client-specific lives in src/config/brand.js', /src\/config\/brand\.js/],
  ['w() wording helper', /`w\(/],
  ['colors only via the theme (plainLook)', /plainLook/],
  ['setup.sql is the single source of the database', /setup\.sql` is the single source/i],
  ['service types must match brand.js', /serviceTypes/],
  ['alerts with buttons use confirmAction / showMessage', /confirmAction[^\n]*showMessage/],
  ['no hooks after an early return', /hook after an early return/i],
  ['copy a picked file before uploading', /copyAsync/],
  ['npm run verify before merge', /npm run verify/],
  ['npx expo export to catch broken picture paths', /npx expo export/],
  ['fresh route types (delete .expo/types)', /\.expo\/types/],
  ['judge by exit codes', /EXIT CODES/i],
  ['each change on its own branch + pull request', /own branch \+ pull request/i],
  ['NEW CLIENT CHECKLIST section', /^## NEW CLIENT CHECKLIST/m],
  ["WHAT'S IN THE KIT section", /^## WHAT'S IN THE KIT/m],
  ['KNOWN ROUGH EDGES section', /^## KNOWN ROUGH EDGES/m],
];
for (const [name, re] of RULES) check(name, re.test(md), `not found: ${re}`);

// The four server functions that must keep the login check OFF are named.
for (const f of ['send-notification', 'notify-request', 'invite-signup', 'weather']) {
  check(`login-check-OFF function named: ${f}`, new RegExp('`' + f + '`').test(md), f);
}

// The checklist has its 7 numbered steps.
const list = (md.split(/^## NEW CLIENT CHECKLIST/m)[1] || '').split(/^## /m)[0];
const steps = (list.match(/^\d+\. /gm) || []).length;
check('NEW CLIENT CHECKLIST has 7 numbered steps', steps >= 7, `found ${steps}`);

// No secret-looking values, real emails or the original client's name in the rulebook (the repo is public).
check('no JWT-looking key in CLAUDE.md', !/eyJ[A-Za-z0-9_-]{20,}/.test(md));
check('no Brighton name in CLAUDE.md', !/brighton/i.test(md));
check('no gmail address in CLAUDE.md', !/@gmail\.com/i.test(md));

// The new-client playbook exists, CLAUDE.md points to it, and it keeps its key parts.
const playbookPath = 'docs/NEW-CLIENT-PLAYBOOK.md';
const playbook = read(playbookPath);
check('docs/NEW-CLIENT-PLAYBOOK.md exists and CLAUDE.md points to it', !!playbook && md.includes(playbookPath));
check('playbook has the interview, the everywhere map and the leftover sweep',
  /INTERVIEW THE OWNER/.test(playbook) && /PUT THE CLIENT EVERYWHERE/.test(playbook) && /LEFTOVER SWEEP/.test(playbook));
check('playbook lists the PDF logo copy (brandLogo.ts) and the database service list', /brandLogo\.ts/.test(playbook) && /submit_service_request/.test(playbook));
check('no Brighton name or gmail address in the playbook', !/brighton/i.test(playbook) && !/@gmail\.com/i.test(playbook));

// AGENTS.md points at the rulebook.
check('AGENTS.md points to CLAUDE.md', /CLAUDE\.md/.test(read('AGENTS.md')));

console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
