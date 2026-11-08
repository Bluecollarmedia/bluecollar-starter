// Run: node scripts/checks/noDemoInRelease.check.cjs
// R20 (owner decision 7): a RELEASE build never falls into demo mode. Without its Supabase address/key it shows one plain
// "App not set up" screen. Demo / sample sign-in and sample data exist only in development builds (__DEV__). Real demo data for a
// client comes only from the demo SQL. The invite and approve pages never show sample data in a release build either.
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8').replace(/\r\n/g, '\n');
let bad = 0;
let n = 0;
const check = (name, ok, detail = '') => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}${ok ? '' : '  - ' + detail}`); };

// Run the REAL src/lib/supabase.ts with a given build (dev or release) and settings (present or missing).
const supaSrc = read('src/lib/supabase.ts');
const flags = (dev, env) => {
  const m = { exports: {} };
  const req = (name) => {
    if (name === '@supabase/supabase-js') return { createClient: () => ({}) };
    if (name === 'react-native') return { Platform: { OS: 'ios' } };
    return {};
  };
  const code = ts.transpileModule(supaSrc, { compilerOptions: { module: 'commonjs', esModuleInterop: true } }).outputText;
  new Function('module', 'exports', 'require', 'process', '__DEV__', code)(m, m.exports, req, { env }, dev);
  return { configured: m.exports.isSupabaseConfigured, demo: m.exports.isDemoMode, notSetUp: m.exports.isAppNotSetUp };
};
const set = { EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_x' };
let f = flags(false, {});
check('release build, no Supabase settings: NOT demo mode, shows "App not set up"', f.demo === false && f.notSetUp === true, JSON.stringify(f));
f = flags(false, { EXPO_PUBLIC_SUPABASE_URL: 'https://your-project-id.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'your-anon-key-here' });
check('release build with the .env.example placeholders: also "App not set up"', f.demo === false && f.notSetUp === true, JSON.stringify(f));
f = flags(false, set);
check('release build with its settings: the real app (no demo, no setup screen)', f.configured === true && f.demo === false && f.notSetUp === false, JSON.stringify(f));
f = flags(true, {});
check('development build with no settings: demo mode is allowed', f.demo === true && f.notSetUp === false, JSON.stringify(f));
f = flags(true, set);
check('development build with settings: the real app', f.demo === false && f.notSetUp === false, JSON.stringify(f));

const auth = read('src/providers/AuthProvider.tsx');
const effect = auth.slice(auth.indexOf('if (!isSupabaseConfigured) {', auth.indexOf('useEffect(() => {', auth.indexOf('export function AuthProvider'))));
check('AuthProvider: with no settings, a release build stays signed out BEFORE any demo sign-in', /if \(!isDemoMode\) \{\s*dispatch\(\{ type: 'SIGN_OUT' \}\);\s*return;\s*\}\s*const user = DEV_USERS\.worker;\s*startDemoSession/.test(effect));
check('AuthProvider: switching demo role / state works only in demo mode', /const switchDevRole = useCallback\(\(role: UserRole\) => \{\s*if \(!isDemoMode\) return;/.test(auth) && /const switchDevState = useCallback\([^)]*\) => \{\s*if \(!isDemoMode\) return;/.test(auth));
check('AuthProvider: every other demo sign-in (startDemoSession / SET_DEV_MODE) sits behind those guards', (auth.match(/startDemoSession\(/g) || []).length === 2 && (auth.match(/type: 'SET_DEV_MODE',/g) || []).length === 3);
check('store: the sample data is never loaded outside demo mode', /export function startDemoSession\([^)]*\): void \{\s*if \(!isDemoMode\) return;/.test(read('src/data/store.ts')));

const layout = read('app/_layout.tsx');
check('root layout: "App not set up" replaces the whole app (only the legal pages still open), before the splash and every screen',
  /if \(isAppNotSetUp && \(segments as string\[\]\)\[0\] !== 'legal'\) \{\s*return <AppNotSetUpScreen \/>;\s*\}/.test(layout) &&
  layout.indexOf('return <AppNotSetUpScreen />') < layout.indexOf('<SplashScreen') && layout.indexOf('return <AppNotSetUpScreen />') < layout.indexOf('<Slot />'));
check('root layout: no redirects while the app is not set up', /if \(isAppNotSetUp \|\| isLoading \|\| !splashDone \|\| isPublicPage\) return;/.test(layout));
const screen = read('src/components/branding/AppNotSetUpScreen.tsx');
check('the "App not set up" screen says the app is missing its setup and to contact the company, using the app\'s theme and components',
  /'App not set up'/.test(screen) && /missing its setup/.test(screen) && /contact the company/.test(screen) && /useTheme\(\)/.test(screen) && /<EmptyState /.test(screen));

const invite = read('app/invite/[token].tsx');
check('invite page: the sample invite exists only in demo mode; a release build with no database says the link can\'t be used',
  /if \(!isSupabaseConfigured\) \{\s*\/\/[^\n]*\n\s*if \(!isDemoMode\) return \{ valid: false, reason: 'invalid' \};/.test(invite) && /if \(isDemoMode\) \{\s*await new Promise/.test(invite));
const approve = read('app/approve/[token].tsx');
check('approve page: no sample data at all (no database = "missing")', /if \(!isSupabaseConfigured \|\| !token\) \{\s*setState\('missing'\);/.test(approve) && !/mock|sample|demo/i.test(approve));

console.log(bad ? `\n${bad} of ${n} FAILED` : `\nAll ${n} passed`);
process.exit(bad ? 1 : 0);
