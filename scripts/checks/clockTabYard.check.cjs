// Run: node scripts/checks/clockTabYard.check.cjs [path to typescript package]
// The worker Clock tab, the clock-in location record, and the owner's clock-in email (clock-in-alert). UNIT tests run the email's real wording code
// in Node; STATIC checks read file text. Not covered here (needs real phones and a deployed function): the real GPS reading, the real email arriving,
// and how the Clock tab looks. The database rules are proved by supabase/tests/107_yard_clock_alerts.pglite.mjs.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let bad = 0;
let n = 0;
const check = (name, ok, detail = '') => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}${ok ? '' : '  - ' + detail}`); };

// ── the email's words ──
const src = read('supabase/functions/clock-in-alert/index.ts');
const marker = src.indexOf('// ───────────────────────────── Deno edge function below');
const pure = src.slice(0, marker).replace(/import \{[^}]*\} from '[^']*';/g, '').replace(/const SUPABASE_URL[\s\S]*?const reply[\s\S]*?\);\n/, '').replace(/Deno\.env\.get\([^)]*\) \?\? ''/g, "''");
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(pure, { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText)(m, m.exports);
const { buildAlert, distanceText } = m.exports;
const base = { worker: 'Maria R.', clockInAtIso: '2026-12-09T13:05:00Z', company: 'Brighton', lat: 40.1058, lng: -74.2170, accuracyM: 12, distanceM: 1100, yardLabel: 'the yard (111 Spruce St, Lakewood, NJ)', radiusM: 152, address: '45 Oak Ave, Howell, NJ 07731, United States' };
const a = buildAlert(base);
check('the email names the worker, the time, and says they were not at the yard', /Maria R\./.test(a.text) && /not at the yard/.test(a.text) && /Dec 9/.test(a.text) && /8:05 AM/.test(a.text), a.text.slice(0, 200));
check('it says exactly where: the street address AND the coordinates AND a map link', a.text.includes('45 Oak Ave, Howell') && a.text.includes('40.105800, -74.217000') && a.text.includes('https://www.google.com/maps?q=40.105800,-74.217000') && a.html.includes('45 Oak Ave'));
check('it says how far that is from the yard, and what counts as the yard', /about 3,?[0-9]{3} ft|about 0\.7 mi|about 1\.?[0-9]? mi|about [0-9,]+ (ft|mi)/.test(a.text) && /yard counts as anywhere within 500 ft/.test(a.text), a.text);
check('the subject says who clocked in away from the yard', a.subject === 'Maria R. clocked in away from the yard', a.subject);
const u = buildAlert({ ...base, lat: null, lng: null, accuracyM: null, distanceM: null, address: '' });
check('with no location it says so plainly and that clocking in was still allowed', /could not give a location/.test(u.text) && /still allowed/.test(u.text) && !/maps/.test(u.text) && /could not be read/.test(u.subject), u.text);
const x = buildAlert({ ...base, worker: '<b>Hacker</b>' });
check('a worker\'s name cannot inject markup into the email', !x.html.includes('<b>Hacker</b>') && x.html.includes('&lt;b&gt;Hacker'));
check('distances read like a person says them', distanceText(30) === '100 ft' || distanceText(30) === '90 ft' || /ft$/.test(distanceText(30)), distanceText(30));
check('a long distance is in miles', distanceText(4000) === '2.5 mi', distanceText(4000));

// ── the function trusts the database, only emails on a real need, and never repeats ──
check('it reads the clock-in record from the database, for the caller\'s own workday, and never emails twice', /loc\.person_id !== me\.id/.test(src) && /alert_sent_at/.test(src) && /already_sent/.test(src));
check('it does not email when alerts are off, no yard is set, or the worker was at the yard', /no_alert/.test(src) && /no_yard/.test(src) && /at_yard/.test(src));
check('it only marks the alert sent after the email really went', src.indexOf('send_failed') < src.indexOf("update({ alert_sent_at"));

// ── the app ──
const lay = read('app/(worker)/(tabs)/_layout.tsx');
const pos = (re) => lay.search(re);
check('the Clock tab sits right after Today, with a clock icon, in both tab bars', pos(/Trigger name="clock"/) > pos(/Trigger name="index"/) && pos(/Trigger name="clock"/) < pos(/Trigger name="jobs"/) && pos(/Screen\s+name="clock"/) > pos(/Screen\s+name="index"/) && pos(/Screen\s+name="clock"/) < pos(/Screen\s+name="jobs"/) && /sf=\{\{ default: 'clock'/.test(lay) && /<Feather name="clock"/.test(lay));
const scr = read('app/(worker)/(tabs)/clock.tsx');
check('the Clock screen is the time clock: the workday card in portal mode, and today\'s punches', /<WorkdayCard portal/.test(scr) && /clockInAt/.test(scr));
const card = read('src/components/time/WorkdayCard.tsx');
check('after clocking out there is a clear Clock back in button, and Clock Out is the big one', /t\('Clock back in'\)/.test(card) && /Clocked out by mistake\? Clock back in and your day keeps going/.test(card) && /height: 56/.test(card));
const fs2 = require('fs');
check('nothing opens the Clock tab by itself: clocking in and out is manual', !fs2.existsSync(path.join(root, 'src/hooks/useOpenOnClock.ts')) && !/useOpenOnClock/.test(lay));
const hook = read('src/hooks/useMyWorkday.ts');
check('the phone\'s location is read WHILE clocking in, never before it, so clocking in is never held up or refused', /const where = getCurrentGps\(\);/.test(hook) && hook.indexOf('const where = getCurrentGps();') < hook.indexOf('apiClockIn(todayKey(), truckId)') && !/await getCurrentGps/.test(hook) && /void reportClockInLocation/.test(hook));
const yard = read('src/data/yard.ts');
check('recording the location never throws and does nothing before the database update is installed', /catch \{/.test(yard) && /if \(error\) return;/.test(yard) && /alert_needed/.test(yard) && /clock-in-alert/.test(yard));
const alerts = read('app/(owner)/(tabs)/more/yard-alerts.tsx');
check('Settings has the screen: a switch for the email, how close counts, and where it goes; it uses the existing Yard Location', /Email me when someone clocks in away from the yard/.test(alerts) && /YARD_RADII/.test(alerts) && /Send the email to/.test(alerts) && /yard-location/.test(alerts));
check('the Settings list links to it', /Yard & clock-in alerts/.test(read('app/(owner)/(tabs)/more/settings.tsx')) && /more\/yard-alerts/.test(read('app/(owner)/(tabs)/more/settings.tsx')));
const sql = read('supabase/updates/107_yard_clock_alerts.sql');
check('alerts start OFF until the owner turns them on, and only the owner can change them', /alert_on boolean not null default false/.test(sql) && /_yard_owner_company\(\)/.test(sql) && /role = 'owner' and m\.status = 'active'/.test(sql));
process.exit(bad ? 1 : 0);
