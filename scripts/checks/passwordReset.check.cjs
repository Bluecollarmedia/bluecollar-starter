// Run: node scripts/checks/passwordReset.check.cjs <path to typescript package>
// Logic checks for Forgot password: the helpers, and how the app talks to Supabase Auth (FAKE supabase).
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const compile = (src, req) => {
  const m = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', esModuleInterop: true } }).outputText)(m, m.exports, req);
  return m.exports;
};

const legal = compile(read('src/legal/legalContent.ts'), () => ({}));
const lib = compile(read('src/lib/passwordReset.ts'), (n) => (n === '@/legal/legalContent' ? legal : {}));

let calls = [];
let resetResult = { error: null };
let session = { access_token: 't' };
let updateResult = { error: null };
let thrown = null;
const fakeSupabase = {
  auth: {
    resetPasswordForEmail: async (email, opts) => { calls.push(['reset', email, opts]); if (thrown) throw thrown; return resetResult; },
    getSession: async () => ({ data: { session } }),
    updateUser: async (a) => { calls.push(['update', a]); if (thrown) throw thrown; return updateResult; },
  },
};
let webUrl = 'https://app.yourcompany.com';
let configured = true;
let os = 'web';
const authLink = compile(read('src/lib/authLink.ts'), () => ({}));
const data = compile(read('src/data/passwordReset.ts'), (n) => {
  if (n === '@/lib/supabase') return { supabase: fakeSupabase, get isSupabaseConfigured() { return configured; } };
  if (n === '@/lib/config') return { config: { get webUrl() { return webUrl; } } };
  if (n === '@/lib/passwordReset') return lib;
  if (n === '@/lib/authLink') return authLink;
  if (n === 'react-native') return { Platform: { get OS() { return os; } } };
  return {};
});

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };

(async () => {
  check('1 redirect address is the web reset page, with no double slash', lib.resetRedirectUrl('https://app.yourcompany.com/') === 'https://app.yourcompany.com/reset-password' && lib.RESET_PAGE_PATH === '/reset-password');
  check('2 email check', lib.looksLikeEmail('a@gmail.com') && lib.looksLikeEmail(' a.b+c@x.co ') && !lib.looksLikeEmail('nope') && !lib.looksLikeEmail('a@b') && !lib.looksLikeEmail(''));
  check('3 new password rules: 8+ characters, must match', lib.newPasswordProblem('short', 'short') !== '' && lib.newPasswordProblem('longenough', 'different1') !== '' && lib.newPasswordProblem('longenough', 'longenough') === '');
  check('4 send errors: rate limit, email not set up, no connection', /wait a few minutes/.test(lib.resetRequestError({ message: 'email rate limit exceeded' })) && /couldn't send the email right now/.test(lib.resetRequestError(new Error('Error sending recovery email'))) && /connection/.test(lib.resetRequestError(new TypeError('Network request failed'))));
  check('5 an unknown send error keeps the raw text and the support contact', /support@yourcompany.com/.test(lib.resetRequestError('weird')) && /weird/.test(lib.resetRequestError('weird')));
  check('6 set-password errors: expired link, same password, weak password', /expired or was already used/.test(lib.newPasswordError('Auth session missing!')) && /not used before/.test(lib.newPasswordError('New password should be different from the old password.')) && /too easy to guess/.test(lib.newPasswordError('Password is known to be weak and easy to guess')));

  // request
  calls = []; resetResult = { error: null };
  let r = await data.requestPasswordReset(' a@gmail.com ');
  check('7 sends the link to the trimmed email with the web reset page as the destination', r.ok && calls[0][1] === 'a@gmail.com' && calls[0][2].redirectTo === 'https://app.yourcompany.com/reset-password', JSON.stringify(calls));
  // in the app (not the web) the link comes back into the app
  os = 'ios'; calls = [];
  const rApp = await data.requestPasswordReset('a@gmail.com');
  check('7b in the app the reset link comes back into the app (starter://auth-callback)', rApp.ok && calls[0][2].redirectTo === 'starter://auth-callback', JSON.stringify(calls));
  os = 'web'; calls = []; resetResult = { error: null };
  calls = [];
  r = await data.requestPasswordReset('not-an-email');
  check('8 a bad email is refused before anything is sent', !r.ok && calls.length === 0);
  resetResult = { error: { message: 'Error sending recovery email' } };
  r = await data.requestPasswordReset('a@gmail.com');
  check('9 before email sending is set up: polite message pointing to support (the thing you chose to ship first)', !r.ok && /contact us at support@yourcompany.com/.test(r.error), r.error);
  resetResult = { error: null }; thrown = new TypeError('Network request failed');
  r = await data.requestPasswordReset('a@gmail.com');
  check('10 a thrown network failure is caught', !r.ok && /connection/.test(r.error), r.error);
  thrown = null; webUrl = ''; calls = [];
  r = await data.requestPasswordReset('a@gmail.com');
  check('11 if the build has no web address, still sends (Supabase uses its own default page)', r.ok && calls[0][2] === undefined);
  webUrl = 'https://app.yourcompany.com';

  // set password
  calls = []; updateResult = { error: null };
  r = await data.setNewPassword('longenough', 'longenough');
  check('12 saves the new password for the person who opened the link', r.ok && calls[0][0] === 'update' && calls[0][1].password === 'longenough');
  calls = [];
  r = await data.setNewPassword('longenough', 'nope1234');
  check('13 mismatch: refused, nothing sent', !r.ok && calls.length === 0);
  session = null; calls = [];
  r = await data.setNewPassword('longenough', 'longenough');
  check('14 no session (link expired or opened twice): clear message, nothing sent', !r.ok && /expired or was already used/.test(r.error) && calls.length === 0, r.error);
  session = { access_token: 't' };
  updateResult = { error: { message: 'New password should be different from the old password.' } };
  r = await data.setNewPassword('longenough', 'longenough');
  check('15 same-as-old password is explained', !r.ok && /not used before/.test(r.error), r.error);
  configured = false;
  r = await data.requestPasswordReset('a@gmail.com');
  check('16 in demo mode (no backend) it says so instead of pretending', !r.ok && /live database/.test(r.error));

  // wiring
  check('17 the sign-in screen links to Forgot password', /forgot-password/.test(read('app/(auth)/login.tsx')));
  check('18 the reset page is public (works from the email link without signing in)', /'reset-password'/.test(read('app/_layout.tsx')));
  check('19 Netlify serves the reset page (SPA fallback file is in public/)', /\/\*\s+\/index\.html\s+200/.test(read('public/_redirects')));
  check('20 the Support page tells people what to do', /Forgot/.test(read('src/legal/legalContent.ts')));

  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
