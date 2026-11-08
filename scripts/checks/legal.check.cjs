// Run: node scripts/checks/legal.check.cjs <path to typescript package>
// Checks the legal pages for what Apple looks for, and that the web copies match the app text.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(read('src/legal/legalContent.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const { BUSINESS, PRIVACY, TERMS, SUPPORT } = m.exports;
const text = (d) => [d.intro, ...d.sections.flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.bullets ?? [])])].join('\n');
const all = [PRIVACY, TERMS, SUPPORT].map(text).join('\n');

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };

check('1 business facts are right', BUSINESS.name === 'Brighton Lawn and Landscape' && BUSINESS.addressLines.join(' ') === '111 Spruce Street Lakewood, New Jersey 08701' && BUSINESS.phone === '848-226-0090' && BUSINESS.website === 'https://app.brightonlawn.com');
check('2 contact details appear in privacy, terms and support', [PRIVACY, TERMS, SUPPORT].every((d) => text(d).includes(BUSINESS.email) || d.slug === 'support' ? text(d).includes(BUSINESS.email) || d.slug !== 'support' : false) && text(PRIVACY).includes(BUSINESS.phone) && text(TERMS).includes(BUSINESS.phone) && text(SUPPORT).includes(BUSINESS.phone));
check('3 privacy: says how to delete the account and the company, and how to revoke permission', /Delete Account/.test(text(PRIVACY)) && /Delete Company/.test(text(PRIVACY)) && /turn them off in your phone/.test(text(PRIVACY)));
check('4 privacy: names every data type the app really collects', ['name, email', 'phone', 'birthday', 'photo', 'Messages', 'precise location', 'push notification token', 'pay rates', 'IP address'].every((k) => text(PRIVACY).toLowerCase().includes(k.toLowerCase())), 'missing a data type');
check('5 privacy: says no selling, no ads, no tracking', /do not sell/i.test(text(PRIVACY)) && /advertis/i.test(text(PRIVACY)) && /do not track/i.test(text(PRIVACY)));
check('6 privacy: lists the service providers the app really uses', ['Supabase', 'Cloudflare', 'Expo', 'Resend', 'Netlify'].every((k) => text(PRIVACY).includes(k)));
check('7 terms: objectionable content ban, reporting, removal, zero tolerance (Apple 1.2)', /objectionable/i.test(text(TERMS)) && /Report/.test(text(TERMS)) && /remove/i.test(text(TERMS)) && /zero tolerance/i.test(text(TERMS)));
check('8 terms: Apple clause and governing law', /third-party beneficiaries/.test(text(TERMS)) && /New Jersey/.test(text(TERMS)));
check('9 support: email, phone, report, delete account', /Report/.test(text(SUPPORT)) && /Delete Account/.test(text(SUPPORT)));
check('10 no unfinished placeholders', !/TODO|TBD|lorem|\[[A-Za-z ]+\]|XXX|example\.com/i.test(all));
check('11 the three in-app screens exist', ['privacy', 'terms', 'support'].every((s) => fs.existsSync(path.join(root, `app/legal/${s}.tsx`))));
check('12 legal routes are public in the root layout', /\['approve', 'invite', 'legal', 'reset-password', 'auth-callback'\]/.test(read('app/_layout.tsx')));
check('13 sign-up screens (including the private invite page) require agreeing to the terms', ['app/(auth)/create-company.tsx', 'app/invite/[token].tsx'].every((f) => /TERMS_REQUIRED_MESSAGE/.test(read(f)) && /<TermsAgreement/.test(read(f))));
check('14 every settings screen has the ONE Legal & Support row (which opens the page listing the three documents)', ['app/(worker)/(tabs)/settings.tsx', 'app/(customer)/(tabs)/account.tsx', 'app/(owner)/(tabs)/more/settings.tsx'].every((f) => /<LegalSection \/>/.test(read(f))) && ['privacy', 'terms', 'support'].every((x) => read('src/lib/legalPaths.ts').includes("slug: '" + x + "'")));
check('15 Delete Account is reachable in every role', ['app/(worker)/(tabs)/settings.tsx', 'app/(customer)/(tabs)/account.tsx', 'app/(owner)/(tabs)/more/settings.tsx'].every((f) => /<DeleteAccountRow \/>/.test(read(f))));
let webOk = true, webMsg = '';
try { execFileSync('node', [path.join(root, 'scripts/build-legal-pages.cjs'), process.argv[2] || 'typescript', '--check'], { stdio: 'pipe' }); } catch (e) { webOk = false; webMsg = String(e.stdout || e.message); }
check('16 the public web pages match the app text (run scripts/build-legal-pages.cjs to refresh)', webOk, webMsg);
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
