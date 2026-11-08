// Run: node scripts/checks/authLinks.check.cjs
// Email links (confirm email, reset password) open the app: the redirect, the parser and the landing screen.
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const compile = (src) => { const m = { exports: {} }; new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports, () => ({})); return m.exports; };
const { parseAuthLink, AUTH_CALLBACK_URL } = compile(read('src/lib/authLink.ts'));
let bad = 0;
const check = (name, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + d}`); };

const base = AUTH_CALLBACK_URL;
check('1 the callback address uses the app scheme from app.json', JSON.parse(read('app.json')).expo.scheme + '://auth-callback' === base);
let r = parseAuthLink(`${base}#access_token=AAA&refresh_token=RRR&expires_in=3600&token_type=bearer&type=recovery`);
check('2 a reset link gives the tokens and purpose "recovery"', r.kind === 'session' && r.purpose === 'recovery' && r.accessToken === 'AAA' && r.refreshToken === 'RRR', JSON.stringify(r));
r = parseAuthLink(`${base}#access_token=AAA&refresh_token=RRR&type=signup`);
check('3 a confirm-your-email link gives purpose "confirm"', r.kind === 'session' && r.purpose === 'confirm', JSON.stringify(r));
r = parseAuthLink(`${base}?access_token=AAA&refresh_token=RRR&type=recovery`);
check('4 tokens after "?" work too', r.kind === 'session' && r.purpose === 'recovery', JSON.stringify(r));
r = parseAuthLink(`${base}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
check('5 an expired link gives a plain sentence, no tokens', r.kind === 'error' && /expired or was already used/.test(r.message), JSON.stringify(r));
check('6 nothing, junk or no tokens is "none", never a throw', ['', null, undefined, base, `${base}#foo=bar`, 'not a url', `${base}#access_token=AAA`].every((u) => parseAuthLink(u).kind === 'none'));

const reset = read('src/data/passwordReset.ts');
const prov = read('src/providers/AuthProvider.tsx');
check('7 in the app, Forgot password redirects back into the app; the web keeps its page', /Platform\.OS !== 'web' \? \{ redirectTo: AUTH_CALLBACK_URL \}/.test(reset) && /resetRedirectUrl\(config\.webUrl\)/.test(reset));
check('8 sign-up in the app asks for the confirmation link to come back into the app', /emailRedirectTo: AUTH_CALLBACK_URL/.test(prov));
const screen = read('app/auth-callback.tsx');
check('9 the landing screen signs in with the link and sends a reset to Choose a new password', /setSession\(/.test(screen) && /'\/reset-password'/.test(screen) && /parseAuthLink/.test(screen));
check('10 the landing screen is public (no sign-in redirect fights it)', /'auth-callback'/.test(read('app/_layout.tsx')));
check('11 tokens are never logged', !/console\.(log|warn|error)/.test(screen) && !/console\.(log|warn|error)/.test(read('src/lib/authLink.ts')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
