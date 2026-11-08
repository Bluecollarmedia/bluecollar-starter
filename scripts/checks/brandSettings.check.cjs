// Run: node scripts/checks/brandSettings.check.cjs [path to typescript package]
// Step 3: ONE settings file (src/config/brand.js, typed by src/config/brand.ts). It has every setting, the build config reads it, the
// screens read it (no client values typed anywhere else in app/ or src/), every feature switch is used, and the leader label is shown.
const fs = require('fs');
const path = require('path');
const ts = require(process.argv[2] || 'typescript');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(ts|tsx|js)$/.test(e.name) ? [`${d}/${e.name}`] : []));
const { brand, brandModule, expoConfig } = require('./_brand.cjs');

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

// ── 1. every required key, with the right kind of value ──
const REQUIRED = {
  company: { name: 's', legalName: 's', phone: 'o', supportEmail: 's', addressLines: 'a', website: 's', state: 's', timezone: 's' },
  app: { name: 's', slug: 's', bundleId: 's', androidPackage: 's', scheme: 's', expoProjectId: 's', expoOwner: 's', webUrl: 's', appleTeamId: 's' },
  look: { brandColor: 's', logo: 's', icon: 's', androidIconForeground: 's', androidIconBackground: 's', splashImage: 's', splashBackground: 's' },
  wording: { job: 's', jobs: 's', place: 's', places: 's', crew: 's', crews: 's', es: 'o', leaderRoleLabel: 's', uniformSizeLabel: 's', units: 'a', materialUnits: 'a', serviceTypes: 'a', materialCategories: 'a' },
  features: Object.fromEntries(['weather', 'publicVisitorArea', 'widgets', 'uniformSize', 'workerIdPhoto', 'repeatJobs', 'timeClock', 'clockInAlerts', 'financials', 'materials', 'trucks', 'requests', 'issues', 'reports', 'announcements', 'messages', 'customerPortal', 'addressSuggestions', 'maps', 'spanish', 'otaUpdates'].map((k) => [k, 'b'])),
  legal: { businessName: 's', state: 's', contactEmail: 's', privacyUrl: 's', termsUrl: 's', supportUrl: 's', effectiveDate: 's' },
  weather: { defaultPlace: 'o', nearbyTowns: 'a' },
};
const kind = (v) => (Array.isArray(v) ? 'a' : typeof v === 'string' ? 's' : typeof v === 'boolean' ? 'b' : v && typeof v === 'object' ? 'o' : typeof v);
const missing = [];
for (const [sec, keys] of Object.entries(REQUIRED)) {
  for (const [k, want] of Object.entries(keys)) {
    const v = brand[sec] && brand[sec][k];
    if (kind(v) !== want || (want === 's' && k !== 'privacyUrl' && k !== 'termsUrl' && k !== 'supportUrl' && !v.trim())) missing.push(`${sec}.${k}`);
  }
}
check('1 brand.js has every setting, each filled in with the right kind of value', missing.length === 0, missing.join(', '));
check('2 the phone has a display form and a tap-to-call link', typeof brand.company.phone.display === 'string' && /^tel:\+?\d{7,15}$/.test(brand.company.phone.tel), JSON.stringify(brand.company.phone));
check('3 the brand color is a 6-digit hex code', /^#[0-9a-f]{6}$/i.test(brand.look.brandColor), brand.look.brandColor);
check('4 the scheme, slug and bundle ids are in the forms the stores accept', /^[a-z][a-z0-9+.-]*$/.test(brand.app.scheme) && /^[a-z0-9-]+$/.test(brand.app.slug) && /^[A-Za-z][\w-]*(\.[A-Za-z][\w-]*)+$/.test(brand.app.bundleId) && /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(brand.app.androidPackage));
check('5 the web address is https with no trailing slash', /^https:\/\/[^/]+$/.test(brand.app.webUrl), brand.app.webUrl);
const places = [brand.weather.defaultPlace, ...brand.weather.nearbyTowns];
check('6 weather places each have a key, name and a US map point', places.every((p) => p && typeof p.key === 'string' && p.key && typeof p.name === 'string' && p.lat > 17 && p.lat < 72 && p.lon > -180 && p.lon < -60));
check('7 the service choices, units and material groups are non-empty lists of words', brand.wording.serviceTypes.length > 0 && brand.wording.serviceTypes.every((s) => typeof s === 'string' && s.trim()) && brand.wording.units.length > 0 && brand.wording.materialCategories.every((c) => c.name && Array.isArray(c.words) && c.words.length > 0));
check('8 no secrets in the settings file (it ships inside the app)', !/(sk_live|sk_test|service_role|re_[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{20,}|sb_secret_|AIza[0-9A-Za-z_-]{20,})/.test(read('src/config/brand.js')));

// ── 2. the typed file and the build config read it ──
const typed = brandModule(ts);
check('9 src/config/brand.ts gives the app the same values, plus the worked-out ones', typed.brand.app.name === brand.app.name && typed.features === brand.features && typed.companyPhoneLink() === brand.company.phone.tel && typed.legalUrls().privacy.endsWith('/legal/privacy.html') && typed.roleLabel('admin') === brand.wording.leaderRoleLabel);
const cfgSrc = read('app.config.js');
const cfg = expoConfig();
check('10 app.config.js reads src/config/brand.js', /require\('\.\/src\/config\/brand\.js'\)/.test(cfgSrc));
check('11 the build gets its name, slug, scheme, bundle id, package and linked domain from the settings file', cfg.name === brand.app.name && cfg.slug === brand.app.slug && cfg.scheme === brand.app.scheme && cfg.ios.bundleIdentifier === brand.app.bundleId && cfg.android.package === brand.app.androidPackage && cfg.ios.associatedDomains.includes(`applinks:${new URL(brand.app.webUrl).host}`), JSON.stringify({ name: cfg.name, slug: cfg.slug, scheme: cfg.scheme }));
const appJson = read('app.json');
check('12 app.json no longer types any client value (name, slug, scheme, bundle id, domain, permission wording)', !/"(name|slug|scheme|bundleIdentifier|package|associatedDomains)"\s*:/.test(appJson) && !appJson.includes(brand.app.name) && !/yourcompany/i.test(appJson));
check('13 the permission texts and notification color follow the settings', JSON.stringify(cfg.plugins).includes(`Allow ${brand.app.name} to use the camera`) && JSON.stringify(cfg.plugins).includes(brand.look.brandColor));
check('14 the Expo project id and owner are left out while they are still placeholders', brand.app.expoProjectId.startsWith('YOUR-') ? !(cfg.extra && cfg.extra.eas && cfg.extra.eas.projectId) && !cfg.owner : cfg.extra.eas.projectId === brand.app.expoProjectId);
check('15 over-the-air updates follow features.otaUpdates', brand.features.otaUpdates ? !(cfg.updates && cfg.updates.enabled === false) : cfg.updates && cfg.updates.enabled === false);

// ── 3. nothing typed anywhere else ──
const files = [...walk('app'), ...walk('src')].filter((f) => !f.startsWith('src/config/'));
const LITERALS = [/Starter App/, /Your Company/, /yourcompany/i, /\(555\) 555-0100/, /5555550100/];
const leftovers = files.flatMap((f) => { const s = read(f); return LITERALS.filter((re) => re.test(s)).map((re) => `${f} ${re}`); });
check('16 no "Starter App" / "Your Company" / "yourcompany" / "(555) 555-0100" typed in app/ or src/ outside src/config', leftovers.length === 0, leftovers.join('; '));
const scheme = files.filter((f) => new RegExp(`['"\`]${brand.app.scheme}://`).test(read(f)));
check('17 the app link scheme is never typed in app/ or src/ (it comes from brand.app.scheme)', scheme.length === 0, scheme.join(', '));
check('18 the theme takes its primary color from look.brandColor', /brandSettings\.look\.brandColor/.test(read('src/theme/colors.ts')) && /primary: BRAND_COLOR/.test(read('src/theme/colors.ts')));
check('19 the legal pages read the settings file (then node scripts/build-legal-pages.cjs remakes the web copies)', /from '@\/config\/brand'/.test(read('src/legal/legalContent.ts')) && read('public/legal/terms.html').includes(brand.legal.businessName) && read('public/legal/privacy.html').includes(brand.legal.effectiveDate));
check('20 the service choices the app offers are the settings file\'s list (setup.sql must accept the same words)', /brand\.wording\.serviceTypes/.test(read('src/lib/serviceRequest.ts')));

// ── 4. every feature switch is used, and the leader label is shown ──
const all = files.map((f) => read(f)).join('\n');
const unused = Object.keys(brand.features).filter((k) => !new RegExp(`isFeatureOn\\('${k}'\\)|features\\.${k}\\b`).test(all));
check('21 every feature switch in brand.js is used somewhere in app/ or src/ (outside src/config)', unused.length === 0, unused.join(', '));
const routes = read('src/config/featureRoutes.ts');
check('22 switched-off screens are covered by a "Not available" page (route list + root layout)', /blockedFeature\(segments/.test(read('app/_layout.tsx')) && /<FeatureOffScreen feature=\{offFeature\} \/>/.test(read('app/_layout.tsx')) && Object.keys(brand.features).every((k) => new RegExp(`\\b${k}:`).test(routes)));
check('23 the leader label is what people see for the admin role (the database keeps \'admin\')', /roleLabel\(|leaderWord\(|leaderPlural\(|words\.leaderRoleLabel/.test(read('app/(owner)/(tabs)/more/team-access.tsx')) && /roleLabel\(/.test(read('app/(owner)/(tabs)/more/accounts.tsx')) && !/admin: 'Admin'/.test(all));
check('24 weather and the public visitor area are two switches: the weather button follows features.weather, the signed-out area follows features.publicVisitorArea', /isFeatureOn\('weather'\)/.test(read('src/components/weather/WeatherButton.tsx')) && /isFeatureOn\('publicVisitorArea'\)/.test(read('src/hooks/usePublicWeatherSwitch.ts')) && /PUBLIC_AREA_IN_APP/.test(read('app/index.tsx')));
check('25 the customer\'s "Request a service" does not depend on the public visitor area', /isFeatureOn\('requests'\)/.test(read('app/(customer)/(tabs)/index.tsx') + read('src/components/customerHome/PropertyHome.tsx')) && !/publicVisitorArea/.test(read('app/(customer)/request.tsx')));
check('26 the hidden repeat-jobs part is reachable only when features.repeatJobs is on', /ALLOW_REPEAT = isFeatureOn\('repeatJobs'\)/.test(read('app/(owner)/schedule-create.tsx')));
check('27 the shirt-size question is named by the settings and hidden when uniformSize is off', /uniformSizeLabel/.test(read('src/components/account/WorkerExtras.tsx')) && /isFeatureOn\('uniformSize'\)|features\.uniformSize/.test(read('src/components/account/WorkerExtras.tsx')));

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
