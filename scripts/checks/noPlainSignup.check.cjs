// Run: node scripts/checks/noPlainSignup.check.cjs
// There are three ways in: Sign In, Create a Company (only while no company exists, for the business owner), and a private link (workers and customers). There is no Get started.
// There is no plain "Create an account" screen that would leave someone with a login and nothing attached.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };

const auth = fs.readdirSync(path.join(root, 'app/(auth)')).sort().join(',');
check('1 the sign-in group is welcome, login, create-company, forgot-password, verify-email (and its layout): no plain signup screen', !fs.existsSync(path.join(root, 'app/(auth)/signup.tsx')) && auth === '_layout.tsx,create-company.tsx,forgot-password.tsx,login.tsx,verify-email.tsx,welcome.tsx', auth);
const login = read('app/(auth)/login.tsx');
check('2 the sign-in screen has no Get started button and no longer sends anyone to a plain "Create your account" or says "Invited by email?"', !/auth\)\/signup/.test(login) && !/Invited by email/.test(login) && !/Get started/.test(login));
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) files.push(p); } };
walk('app'); walk('src');
const stale = files.filter((f) => /\(auth\)\/signup|Invited by your company\? Use the email|Use the email they invited/.test(fs.readFileSync(path.join(root, f), 'utf8')));
check('3 nothing in the app points to the removed screen or says to "use the email they invited"', stale.length === 0, stale.join(', '));
const welcome = read('app/(auth)/welcome.tsx');
check('4 the welcome screen offers Sign In, Create a Company only while no company exists, and tells workers and customers to open their private link', /Sign In/.test(welcome) && /canCreateCompany && \(/.test(welcome) && /Create a Company/.test(welcome) && /Open the private link your employer texted you/.test(welcome));
check('5 workers and customers still create their login from their private link page', /signUp\(/.test(read('app/invite/[token].tsx')) && /inviteToken/.test(read('app/invite/[token].tsx')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
