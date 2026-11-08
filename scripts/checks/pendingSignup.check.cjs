// Run: node scripts/checks/pendingSignup.check.cjs
// Photo, birthday, hoodie and ID chosen at sign-up are not lost when the account waits for email confirmation.
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const compile = (src) => { const m = { exports: {} }; new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports, () => ({})); return m.exports; };
const lib = compile(read('src/lib/pendingSignup.ts'));
let bad = 0;
const check = (name, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + d}`); };

const all = { email: 'A@x.com', photoUri: 'file:///p.jpg', birthdayIso: '1990-01-01', hoodieSize: 'L', idUri: 'file:///id.jpg' };
check('1 anything chosen counts as pending; nothing does not', lib.hasPending(all) && lib.hasPending({ email: 'a', hoodieSize: 'M' }) && !lib.hasPending({ email: 'a' }) && !lib.hasPending(null));
check('2 the key ignores capitals and spaces in the email', lib.pendingKey(' A@X.com ') === lib.pendingKey('a@x.com'));
check('3 when everything saved, nothing is left', lib.remainingAfter(all, ['photo', 'birthday', 'details']) === null);
let left = lib.remainingAfter(all, ['birthday', 'details']);
check('4 a photo that failed stays for the next try, the rest are cleared', left && left.photoUri === 'file:///p.jpg' && !left.birthdayIso && !left.hoodieSize && !left.idUri, JSON.stringify(left));
left = lib.remainingAfter(all, ['photo', 'birthday']);
check('5 hoodie and ID stay together if they failed', left && left.hoodieSize === 'L' && left.idUri === 'file:///id.jpg' && !left.photoUri, JSON.stringify(left));
check('6 nothing saved keeps everything', JSON.stringify(lib.remainingAfter(all, [])) === JSON.stringify(all));

const invite = read('app/invite/[token].tsx');
const signup = read('app/(auth)/create-company.tsx');
const layout = read('app/_layout.tsx');
const inv = invite.slice(invite.indexOf('if (result.needsEmailConfirmation)'), invite.indexOf("router.replace('/(auth)/login')"));
check('7 the invite sign-up keeps photo, birthday, hoodie and ID when email confirmation is needed', /stashPendingSignup\(/.test(inv) && /photoUri/.test(inv) && /birthdayIso/.test(inv) && /hoodieSize/.test(inv) && /idUri/.test(inv));
check('8 the Create a Company screen keeps the photo when email confirmation is needed', /stashPendingSignup\(\{ email: email\.trim\(\), photoUri \}\)/.test(signup));
check('9 the saved extras are applied once the person is signed in', /applyPendingSignup\(user\.email\)/.test(layout) && /appState === 'active' && isAuthenticated/.test(layout));
check('10 the worker invite shows birthday, hoodie size and ID', /WorkerExtrasFields/.test(invite) && /Birthday/.test(invite));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
