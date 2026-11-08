// Run: node scripts/checks/emailCodeConfirm.check.cjs
// A new owner confirms their email by typing the code from the email into the app, not by tapping a link that has to
// bounce through a browser back into the app. Reached right after Create a Company and from Sign In when not confirmed yet.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  - ' + d : ''}`); };

const data = read('src/data/emailCode.ts');
const screen = read('app/(auth)/verify-email.tsx');
const create = read('app/(auth)/create-company.tsx');
const login = read('app/(auth)/login.tsx');
const es = read('src/i18n/es.ts');

check('1 the code is checked with Supabase as a sign-up confirmation', /verifyOtp\(\{ email: email\.trim\(\), token, type: 'signup' \}\)/.test(data));
check('2 a new code can be sent', /auth\.resend\(\{ type: 'signup', email: email\.trim\(\) \}\)/.test(data));
check('3 only digits are kept, so spaces or dashes from the email do not matter', /replace\(\/\\D\/g, ''\)/.test(data));
check('4 Supabase\'s "email not confirmed" answer is recognised by its code and its message', /email_not_confirmed/.test(data) && /email not confirmed/i.test(data));
check('5 Create a Company goes to the code screen when confirmation is needed (no more "open the link" pop-up)', /if \(result\.needsEmailConfirmation\) \{[\s\S]{0,400}verify-email[\s\S]{0,80}from: 'signup'/.test(create) && !/We sent a confirmation link/.test(create));
check('6 Sign In sends an unconfirmed person to the code screen with their email filled in', /isEmailNotConfirmed\(err\)[\s\S]{0,200}verify-email[\s\S]{0,80}from: 'login'/.test(login));
check('7 the code field offers the code from Mail (one-time code autofill) and a number pad', /textContentType="oneTimeCode"/.test(screen) && /keyboardType="number-pad"/.test(screen));
check('8 "Send a new code" waits a minute between emails', /RESEND_WAIT_SECONDS = 60/.test(screen) && /disabled=\{wait > 0\}/.test(screen));
const phrases = [...screen.matchAll(/t\('([^']+)'/g)].map((m) => m[1]).concat([...data.matchAll(/error: '([^']+)'/g)].map((m) => m[1]));
const missing = phrases.filter((p) => !es.includes(`'${p}':`));
check(`9 every phrase on the screen (${phrases.length}) has Spanish`, missing.length === 0, missing.join(' | '));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
