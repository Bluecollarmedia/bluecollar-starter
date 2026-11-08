// Run: node scripts/checks/legalBackToSettings.check.cjs
// Legal & Support: every Settings screen has ONE "Legal & Support" row that opens a page listing Privacy Policy, Terms of Use and Help &
// Support, all opened INSIDE the person's own area so Back returns to Settings (never the home screen). Signed-out screens and sign-up
// forms show the documents as a pop-up. Also: profile cards keep their avatar off the card's edge.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };

(async () => {
  const m = await import(pathToFileURL(path.join(root, 'src', 'lib', 'legalPaths.ts')).href);
  check('1 each area has its own Legal & Support page: owner, worker, customer and Snow', m.legalHubPath('(owner)') === '/(owner)/legal-support' && m.legalHubPath('(worker)') === '/(worker)/legal-support' && m.legalHubPath('(customer)') === '/(customer)/legal-support' && m.legalHubPath('snow') === '/snow/legal-support' && m.legalHubPath(undefined) === '/legal');
  check('2 the page lists Privacy Policy, Terms of Use and Help & Support, in that order', m.LEGAL_ROWS.map((r) => r.title).join('|') === 'Privacy Policy|Terms of Use|Help & Support');
  check('3 a document address is the area\'s page plus the document', m.legalDocPath('/(customer)/legal-support', 'privacy') === '/(customer)/legal-support/privacy' && m.isLegalSlug('terms') && !m.isLegalSlug('nope'));

  for (const [area, hub] of [['app/(owner)', '/(owner)/legal-support'], ['app/(worker)', '/(worker)/legal-support'], ['app/(customer)', '/(customer)/legal-support'], ['app/snow', '/snow/legal-support']]) {
    const idx = exists(`${area}/legal-support/index.tsx`) ? read(`${area}/legal-support/index.tsx`) : '';
    const doc = exists(`${area}/legal-support/[slug].tsx`) ? read(`${area}/legal-support/[slug].tsx`) : '';
    check(`4 ${area} has the Legal & Support page and its documents, inside the area`, idx.includes(`basePath="${hub}"`) && /LegalDocRoute/.test(doc), hub);
  }

  const section = read('src/components/legal/LegalSection.tsx');
  check('5 the shared Settings row is ONE row, titled Legal & Support, and opens the hub of the area the person is in (not the public page)', /title=\{t\('Legal & Support'\)\}/.test(section) && /legalHubPath\(segments\[0\]\)/.test(section) && !/'\/legal\/(privacy|terms|support)'/.test(section) && (section.match(/<ListRow/g) || []).length === 1);

  // No signed-in screen opens the public pages (which would throw the screen away and send Back to the home screen).
  const walk = (d, out = []) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (/\.tsx$/.test(e.name)) out.push(p); } return out; };
  const files = [...walk('app'), ...walk('src')].filter((f) => !/legalPaths|LegalHubScreen|LegalDocRoute|LegalModal|[\\/]legal[\\/]/.test(f.replace(/\\/g, '/')) || /LegalSection|TermsAgreement/.test(f));
  const pushing = files.filter((f) => /router\.(push|replace)\(['"`]\/legal\//.test(fs.readFileSync(path.join(root, f), 'utf8')));
  check('6 nothing in the app navigates to the public /legal pages (the one way that sends Back to the home screen)', pushing.length === 0, pushing.join(', '));

  const terms = read('src/components/legal/TermsAgreement.tsx');
  const welcome = read('app/(auth)/welcome.tsx');
  check('7 the Terms / Privacy links in a sign-up form open as a pop-up, so a half-filled form is not lost', /<LegalModal slug=\{reading\}/.test(terms) && !/useRouter/.test(terms));
  check('8 the welcome screen\'s Privacy / Terms / Support links open as a pop-up over it', /<LegalModal slug=\{reading\}/.test(welcome) && /setReading\('privacy'\)/.test(welcome) && /setReading\('terms'\)/.test(welcome) && /setReading\('support'\)/.test(welcome));
  check('9 the pop-up\'s Back closes it (and the page\'s own Back still goes back one screen)', /onClose\) \{ onClose\(\); return; \}/.test(read('src/components/legal/LegalScreen.tsx')) && /router\.back\(\)/.test(read('src/components/legal/LegalScreen.tsx')));
  check('10 the public /legal pages stay (they are the web address for the App Store privacy policy field) including a public hub', exists('app/legal/privacy.tsx') && exists('app/legal/terms.tsx') && exists('app/legal/support.tsx') && exists('app/legal/index.tsx'));

  const layout = read('app/_layout.tsx');
  check('11 the Snow Legal & Support pages are treated as part of the Snow area (the sign-in redirect does not bounce them)', /const inLegal = s1 === 'legal-support'/.test(layout) && /s1 === role \|\| inLegal/.test(layout) && /s1 === 'notice' \|\| inLegal/.test(layout));

  const acct = read('app/(customer)/(tabs)/account.tsx');
  check('12 the customer Account profile card keeps its avatar and arrow off the card\'s edges (side padding like every other row)', /paddingVertical: spacing\.md, paddingHorizontal: spacing\.md/.test(acct));
  // Every other card that leads with an avatar already has side padding: guard the ones audited.
  const padded = [
    ['app/(owner)/(tabs)/more/settings.tsx', /hero: \{[^}]*padding: spacing\.lg/s],
    ['app/(worker)/(tabs)/settings.tsx', /profileCard: \{[^}]*padding: spacing\.lg/s],
    ['src/components/snow/SnowWorkerSettings.tsx', /profile: \{[^}]*padding: spacing\.lg/s],
    ['app/snow/owner/(tabs)/more.tsx', /row: \{[^}]*paddingHorizontal: spacing\.lg/s],
    ['app/(owner)/customers/[id].tsx', /profileCard: \{[^}]*padding: spacing\.md/s],
    ['app/(owner)/(tabs)/workers/[id].tsx', /profileCard: \{[^}]*padding: spacing\.md/s],
    ['app/(owner)/(tabs)/workers/index.tsx', /workerCard: \{[^}]*padding: spacing\.md/s],
    ['app/(owner)/customers/index.tsx', /customerCard: \{[^}]*padding: spacing\.md/s],
    ['app/(owner)/(tabs)/more/accounts.tsx', /card: \{[^}]*padding: spacing\.lg/s],
    ['app/(owner)/(tabs)/more/team-access.tsx', /card: \{[^}]*padding: spacing\.lg/s],
  ];
  const unpadded = padded.filter(([f, re]) => !re.test(read(f))).map(([f]) => f);
  check('13 every other profile / person card keeps side padding around its avatar', unpadded.length === 0, unpadded.join(', '));
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
