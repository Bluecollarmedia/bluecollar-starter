// Run: node scripts/checks/weatherSwitchLaunch.check.cjs [path to typescript package]
// Weather, Phase 1: the master switch and the signed-out launch route.
//   UNIT tests (1-24): the real decision code (src/lib/weatherSwitch.ts, src/lib/launchRoute.ts) run in Node with a fake clock and a fake network.
//   STATIC checks (25+): they read FILE TEXT. They show the code is what it should be; they do NOT prove the running app behaves that way.
//   Not covered here (needs a real phone or simulator): the real network call, the 1.5 s cap on a real network, launch time, the splash,
//   foregrounding, router.replace actually moving the screen, a real invite or password-reset link.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlHelper = require('./_sql.cjs');   // supabase/setup.sql, the one file that builds the database
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const load = (p) => { const m = { exports: {} }; new Function('module', 'exports', ts.transpileModule(read(p), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports); return m.exports; };
const { decideWeatherOn, createWeatherSwitch, CACHE_MAX_AGE_MS, REQUEST_CAP_MS } = load('src/lib/weatherSwitch.ts');
const { signedOutRedirect, effectiveWeatherOn, entryRedirect, WEATHER_EXPERIENCE_BUILT } = load('src/lib/launchRoute.ts');

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };
const H = 3_600_000;
const NOW = 1_800_000_000_000;

// ── decideWeatherOn ──
check('1 a fresh ON answer, nothing remembered -> ON', decideWeatherOn({ fresh: { enabled: true }, cached: null, now: NOW }) === true);
check('2 a fresh ON answer beats a remembered OFF', decideWeatherOn({ fresh: { enabled: true }, cached: { enabled: false, checkedAt: NOW }, now: NOW }) === true);
check('3 a fresh OFF answer beats a remembered ON', decideWeatherOn({ fresh: { enabled: false }, cached: { enabled: true, checkedAt: NOW - H }, now: NOW }) === false);
check('4 no answer and nothing remembered -> OFF', decideWeatherOn({ fresh: null, cached: null, now: NOW }) === false);
check('5 remembered ON, 5 h 59 m old -> ON', decideWeatherOn({ fresh: null, cached: { enabled: true, checkedAt: NOW - (6 * H - 60_000) }, now: NOW }) === true);
check('6 remembered ON, exactly 6 h old -> OFF', decideWeatherOn({ fresh: null, cached: { enabled: true, checkedAt: NOW - 6 * H }, now: NOW }) === false);
check('7 remembered ON, 6 h and 1 ms old -> OFF', decideWeatherOn({ fresh: null, cached: { enabled: true, checkedAt: NOW - 6 * H - 1 }, now: NOW }) === false);
check('8 remembered OFF -> OFF', decideWeatherOn({ fresh: null, cached: { enabled: false, checkedAt: NOW - 60_000 }, now: NOW }) === false);
check('9 remembered ON dated in the future (clock changed) -> OFF', decideWeatherOn({ fresh: null, cached: { enabled: true, checkedAt: NOW + H }, now: NOW }) === false);
check('10 only the exact value true counts (string, 1, null, undefined are OFF)', ['true', 1, null, undefined, {}].every((v) => decideWeatherOn({ fresh: { enabled: v }, cached: null, now: NOW }) === false));
check('10b the age limit is six hours', CACHE_MAX_AGE_MS === 6 * H && REQUEST_CAP_MS === 1500);

// ── the controller, with a fake clock, fake timers and a fake network ──
function rig({ cache = null, readThrows = false, writeThrows = false } = {}) {
  const clock = { t: NOW, timers: [] };
  const pending = [];
  const writes = [];
  const sw = createWeatherSwitch({
    fetchAnswer: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    readCache: async () => { if (readThrows) throw new Error('storage'); return cache; },
    writeCache: async (c) => { if (writeThrows) throw new Error('disk'); writes.push(c); },
    now: () => clock.t,
    setTimer: (fn, ms) => { const timer = { fn, at: clock.t + ms, live: true }; clock.timers.push(timer); return timer; },
    clearTimer: (t) => { if (t) t.live = false; },
  });
  const advance = async (ms) => { clock.t += ms; for (const t of clock.timers) if (t.live && t.at <= clock.t) { t.live = false; t.fn(); } await Promise.resolve(); await Promise.resolve(); };
  let changed = 0;
  sw.subscribe(() => { changed++; });
  return { sw, pending, writes, advance, clock, changes: () => changed };
}
const settle = () => new Promise((r) => setImmediate(r));

(async () => {
  let r = rig();
  let done = false; const p1 = r.sw.refresh().then(() => { done = true; });
  r.pending[0].resolve(true); await p1;
  check('11 server answers ON -> ON, and the answer is remembered', r.sw.getEnabled() === true && r.writes.length === 1 && r.writes[0].enabled === true && r.writes[0].checkedAt === NOW);

  r = rig({ cache: { enabled: true, checkedAt: NOW - H } }); await r.sw.loadCache();
  const p2 = r.sw.refresh(); r.pending[0].resolve(false); await p2;
  check('12 server answers OFF after a remembered ON -> OFF, and OFF is remembered', r.sw.getEnabled() === false && r.writes[0].enabled === false);

  r = rig(); const p3 = r.sw.refresh(); r.pending[0].reject(new Error('network')); await p3;
  check('13a a failed request with nothing remembered -> OFF (failure is never ON)', r.sw.getEnabled() === false && r.writes.length === 0);
  r = rig({ cache: { enabled: true, checkedAt: NOW - 2 * H } }); await r.sw.loadCache();
  const p3b = r.sw.refresh(); r.pending[0].reject(new Error('network')); await p3b;
  check('13b a failed request leaves a 2-hour-old remembered ON alone (still ON), and writes nothing', r.sw.getEnabled() === true && r.writes.length === 0);
  r = rig({ cache: { enabled: true, checkedAt: NOW - 7 * H } }); await r.sw.loadCache();
  const p3c = r.sw.refresh(); r.pending[0].reject(new Error('network')); await p3c;
  check('13c a failed request with a 7-hour-old remembered ON -> OFF', r.sw.getEnabled() === false);

  r = rig(); let settled = false; const p4 = r.sw.refresh().then(() => { settled = true; });
  await r.advance(1499); const before = settled;
  await r.advance(1); await p4;
  check('14 a request that never answers still lets refresh() finish at 1.5 s (not before, not after), and the answer is OFF', before === false && settled === true && r.sw.getEnabled() === false);

  r = rig(); const p5 = r.sw.refresh(); await r.advance(1500); await p5;
  const changesBefore = r.changes();
  r.clock.t += 2500; r.pending[0].resolve(true); await settle();
  check('15 a late ON (4 s) after the cap is applied: ON, remembered, listeners told once', r.sw.getEnabled() === true && r.writes.length === 1 && r.changes() === changesBefore + 1);

  r = rig({ cache: { enabled: true, checkedAt: NOW - H } }); await r.sw.loadCache();
  const p6 = r.sw.refresh(); await r.advance(1500); await p6;
  const onAtLaunch = r.sw.getEnabled();
  r.clock.t += 2500; r.pending[0].resolve(false); await settle();
  check('16 launched on a remembered ON, then a late OFF arrives: ON at launch, OFF after, listeners told', onAtLaunch === true && r.sw.getEnabled() === false && r.changes() >= 1);

  r = rig(); const pa = r.sw.refresh(); const pb = r.sw.refresh();
  r.pending[1].resolve(false); await settle(); r.pending[0].resolve(true); await Promise.all([pa, pb]);
  check('17 two overlapping requests: the older answer arriving last is ignored', r.sw.getEnabled() === false && r.writes.length === 1);

  r = rig(); const f1 = r.sw.refresh(); r.pending[0].resolve(true); await f1;
  const f2 = r.sw.refresh(); r.pending[1].resolve(false); await f2;
  check('18 coming back to the app (a new request) that answers OFF after ON -> OFF, remembered OFF', r.sw.getEnabled() === false && r.writes[1].enabled === false);

  r = rig({ readThrows: true }); await r.sw.loadCache();
  check('19a a storage read that throws is treated as nothing remembered', r.sw.getEnabled() === false);
  r = rig({ cache: { enabled: 'yes', checkedAt: 'x' } }); await r.sw.loadCache();
  check('19b garbage in storage is treated as nothing remembered', r.sw.getEnabled() === false);

  r = rig({ writeThrows: true }); const w1 = r.sw.refresh(); r.pending[0].resolve(true); await w1; await settle();
  check('20 a storage write that throws does not matter: the answer is still used', r.sw.getEnabled() === true);

  r = rig({ cache: { enabled: true, checkedAt: NOW - H } });
  const racePromise = r.sw.refresh(); r.pending[0].resolve(false); await racePromise; await r.sw.loadCache();
  check('20b a remembered answer that loads AFTER a fresh answer never replaces it', r.sw.getEnabled() === false);

  // ── launchRoute ──
  const segments = ['(auth)', undefined, 'index', '(owner)', '(worker)', '(customer)', '(onboarding)', 'weather', 'approve', 'other'];
  const oracle = (seg) => (seg === '(auth)' ? null : '/(auth)/welcome'); // a copy of the original code: stay in the sign-in area, else go to welcome
  check('21 with Weather OFF every signed-out location gets exactly what the original code gave', segments.every((s) => signedOutRedirect({ firstSegment: s, weatherOn: false }) === oracle(s)));
  check('22 with Weather ON: stay in the sign-in area or Weather, otherwise go to /weather', segments.every((s) => signedOutRedirect({ firstSegment: s, weatherOn: true }) === (s === '(auth)' || s === 'weather' ? null : '/weather')));
  check('23 effectiveWeatherOn: not built -> always off, built -> follows the answer', effectiveWeatherOn(false, true) === false && effectiveWeatherOn(true, true) === true && effectiveWeatherOn(true, false) === false && effectiveWeatherOn(false, false) === false);
  check('24 a late OFF while on Weather goes to welcome; a late ON while in the sign-in area stays put', signedOutRedirect({ firstSegment: 'weather', weatherOn: false }) === '/(auth)/welcome' && signedOutRedirect({ firstSegment: '(auth)', weatherOn: true }) === null);

  // ── the root route (the real first stop: it sends everyone to the login screen today) ──
  check('24b the root route: Weather OFF always gives the original login redirect, signed in or out', [true, false].every((a) => entryRedirect({ isAuthenticated: a, weatherOn: false }) === '/(auth)/login'));
  check('24c the root route: Weather ON sends ONLY a signed-out visitor to /weather; a signed-in person still gets the original redirect', entryRedirect({ isAuthenticated: false, weatherOn: true }) === '/weather' && entryRedirect({ isAuthenticated: true, weatherOn: true }) === '/(auth)/login');

  // ── static checks (file text only) ──
  const sha = (s) => crypto.createHash('sha256').update(s.replace(/\r\n/g, '\n')).digest('hex');
  const layout = read('app/_layout.tsx');
  const cut = (s) => { const a = s.indexOf('    // The setup hub links to the create-company screen'); const b = s.indexOf('  }, [isLoading, isAuthenticated, user, appState,'); return s.slice(a, b); };
  check('25 the onboarding and signed-in blocks of the launch routing are identical to before (text fingerprint, retaken in Step 2a)', sha(cut(layout)) === 'c7fd905489ade11ee9fa9191397de2041b79681735087363f664abc4427d767c');
  const pub = layout.split(/\r?\n/).filter((l) => l.includes('const isPublicPage = [')).join('|');
  check('26 the list of public pages (invite, approve, legal, reset-password, auth-callback) is identical to before', sha(pub) === 'a14557971050ff7ae964d67dabb476b97a4c0dd60442ae6a37a1fa2c30923eb2');
  check('27 the signed-out branch now asks signedOutRedirect and nothing else changed there', /const goTo = signedOutRedirect\(\{ firstSegment: \(segments as string\[\]\)\[0\], weatherOn \}\);\s*if \(goTo\) router\.replace\(goTo as any\);/.test(layout) && /weatherOn\]\);/.test(layout) && !/router\.replace\('\/\(auth\)\/welcome'\)/.test(layout));
  // Fingerprints retaken in Step 2c (the original company name and trade-specific wording were removed from these screens),
  // and in Step 3 for welcome / create-company (the app name and company example now come from src/config/brand.js),
  // and in Step 3b for create-company (its one sentence says "jobs" instead of "projects"),
  // and in Step 4 for welcome / WelcomeOverlay (plain look: theme color tokens and the plain logo mark instead of the leaf; comments only otherwise).
  const fp = {
    'app/(auth)/welcome.tsx': '5dfa9fa9e0ae5f1b62f6e0defdc3312698676216c890e4ed5e0c6e1c30ae8b6a',
    'app/(auth)/login.tsx': '879b7e355d33e5c88ce975be9e67018e38b94b70edbc415f351275bcdf73cf13',
    'app/(auth)/forgot-password.tsx': '5c502ed34a4ff2df6dd22d8dcb3f2b9387e9d816221ccab9a21f0eff27a016f5',
    'app/(auth)/create-company.tsx': '6cba8faa485d0306ea4e2a2994b47bbe32b1fe6658107b1ee764adb5b7a9f3ce', // Step 3b: "projects" -> "jobs"
    'app/(auth)/_layout.tsx': '1d276fc0fd221a87d2e47732dd860a9f5000475e4e1e78bf5ca0eab379074109',
    'src/components/branding/WelcomeOverlay.tsx': '77bed7dfd21ed2bc3d03f54b5222b883e7fb8c86d99b6aa7d20638d828a62927',
  };
  const changed = Object.entries(fp).filter(([f, h]) => sha(read(f)) !== h).map(([f]) => f);
  check('28 the welcome, sign-in, forgot-password, create-company screens, the auth layout and the sign-in welcome overlay are unchanged', changed.length === 0, changed.join(', '));
  const wfiles = fs.existsSync(path.join(root, 'app/weather')) ? fs.readdirSync(path.join(root, 'app/weather')).sort().join() : '';
  check('29 the Weather area is exactly its layout and its screens (home, request, account), and no other new area exists', wfiles === '(tabs),_layout.tsx' && fs.readdirSync(path.join(root, 'app/weather/(tabs)')).sort().join() === '_layout.tsx,account.tsx,index.tsx,request.tsx', wfiles);
  check('30 the Weather screens are built, and the owner\'s switch still decides: the database default is OFF', WEATHER_EXPERIENCE_BUILT === true && /^\s+enabled boolean default false not null,$/m.test(sqlHelper.table('public_weather_settings')));
  const finalConfig = require('./_brand.cjs').expoConfig();
  check('31 the build config has nothing about weather or location changes apart from the widget setup (permission text untouched)', !/weather/i.test(JSON.stringify(finalConfig, (k, v) => (Array.isArray(v) && v[0] === 'expo-widgets' ? undefined : v))) && JSON.stringify(finalConfig).includes(`${require('./_brand.cjs').brand.app.name} uses your location to check you in when you arrive at a job site.`));
  const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
  const callers = [...walk('app'), ...walk('src')].filter((f) => /\.(ts|tsx)$/.test(f) && /set_public_weather_enabled/.test(read(f)));
  check('32 the owner-only switch function is called from exactly one place (the data file the owner\'s Settings row uses), and that row is shown only to the owner', callers.map((f) => f.replace(/\\/g, '/')).join() === 'src/data/publicWeather.ts' && /db\.role === 'owner'/.test(read('src/hooks/usePublicWeatherRow.ts')) && /weatherRow\.canChange/.test(read('app/(owner)/(tabs)/more/settings.tsx')));
  const sql = sqlHelper.fn('set_public_weather_enabled');
  check('33 signed-out visitors only get the yes/no answer: public_weather_config is the one weather function they may call, the switch needs a sign-in',
    sqlHelper.grantedTo('public_weather_config').includes('anon') && !sqlHelper.grantedTo('set_public_weather_enabled').includes('anon') && sqlHelper.grantedTo('set_public_weather_enabled').includes('authenticated'));
  check('34 setup.sql revokes all direct table access, enables row security and gives the table no rule (only the functions reach it)',
    /^alter table public\.public_weather_settings enable row level security;$/m.test(sqlHelper.setup) && /^revoke all on table public\.public_weather_settings from anon, authenticated;$/m.test(sqlHelper.grants('public_weather_settings'))
    && !/^grant /m.test(sqlHelper.grants('public_weather_settings')) && sqlHelper.policies('public_weather_settings') === '');
  check('35 the owner function checks the exact owner role and active membership', /m\.role = 'owner' and m\.status = 'active'/.test(sql) && !/is_staff/.test(sql));
  const idx = read('app/index.tsx');
  check('36b app/index.tsx still redirects to the login screen unless entryRedirect says otherwise (file text)', /<Redirect href=\{entryRedirect\(\{ isAuthenticated, weatherOn \}\)\} \/>/.test(idx) && /'\/\(auth\)\/login'/.test(read('src/lib/launchRoute.ts')));
  check('36 the app asks only the anonymous config function', /rpc\('public_weather_config'\)/.test(read('src/data/publicWeather.ts')));

  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
