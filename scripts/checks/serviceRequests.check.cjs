// Run: node scripts/checks/serviceRequests.check.cjs <path to typescript package>
// "Request a service": the form's checks, the server function (update 114), the Request tab, the owner's list and the notification tap.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const compile = (src) => {
  const m = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', esModuleInterop: true } }).outputText)(m, m.exports, () => ({}));
  return m.exports;
};
const lib = compile(read('src/lib/serviceRequest.ts'));
let bad = 0;
let n = 0;
const check = (name, ok, detail = '') => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}${ok ? '' : '  - ' + detail}`); };

const good = { propertyType: 'residential', services: ['Seasonal Cleanup'], details: '', town: 'Lakewood', name: 'Pat Lee', phone: '(732) 555-0142', email: '' };
check('1 a complete request passes (email and details are optional)', lib.requestProblem(good) === null);
check('2 no service chosen is refused', /at least one service/.test(lib.requestProblem({ ...good, services: [] })));
check('3 a service that is not on the list is refused', /listed/.test(lib.requestProblem({ ...good, services: ['Free money'] })));
check('4 a missing town, name or phone is refused', !!lib.requestProblem({ ...good, town: ' ' }) && !!lib.requestProblem({ ...good, name: 'P' }) && !!lib.requestProblem({ ...good, phone: '12345' }));
check('5 a badly written email is refused, a good one passes', !!lib.requestProblem({ ...good, email: 'pat@' }) && lib.requestProblem({ ...good, email: 'pat@example.com' }) === null);
check('6 an over-long description is refused', !!lib.requestProblem({ ...good, details: 'x'.repeat(2001) }));
check('7 tapping a service twice takes it back off, and the order stays the website order', JSON.stringify(lib.toggleService(lib.toggleService([], 'Seasonal Cleanup'), 'Seasonal Cleanup')) === '[]' && lib.toggleService(['Seasonal Cleanup'], 'Backyard Design & Build')[0] === 'Backyard Design & Build');
const row = (id, status, at) => ({ id, status, created_at: at, services: [], details: '', town: '', name: '', phone: '', email: '', property_type: 'residential' });
const sorted = lib.sortRequests([row('old-done', 'done', '2026-10-01T00:00:00Z'), row('new-1', 'new', '2026-10-02T00:00:00Z'), row('new-2', 'new', '2026-10-03T00:00:00Z'), row('contacted', 'contacted', '2026-10-04T00:00:00Z')]);
check('8 the owner sees new requests first (newest first), then contacted, then done', sorted.map((r) => r.id).join() === 'new-2,new-1,contacted,old-done', sorted.map((r) => r.id).join());
check('9 the new-request count counts only the new ones', lib.newRequestCount(sorted) === 2);

// ── the server function ──
const sql = read('supabase/updates/114_service_requests.sql');
const allowed = (sql.match(/allowed constant text\[\] := array\[([\s\S]*?)\];/) || [])[1] || '';
const sqlServices = [...allowed.matchAll(/'([^']+)'/g)].map((m) => m[1]);
check('10 the server accepts exactly the services the form offers', JSON.stringify(sqlServices) === JSON.stringify([...lib.SERVICE_CHOICES]), JSON.stringify(sqlServices));
check('11 anyone, signed in or not, may send a request; nobody can read the table except an owner or admin', /grant execute on function public\.submit_service_request\(.*\) to anon, authenticated/.test(sql) && /revoke all on public\.service_requests from public, anon, authenticated/.test(sql) && /role in \('owner','admin'\)/.test(sql));
check('12 there is no insert policy and no insert grant (the function is the only way in)', !/for insert/.test(sql) && !/grant[^;]*insert[^;]*service_requests/.test(sql));
check('13 spam is held back: 3 an hour from one phone or email, 40 an hour in all', />= 3 then/.test(sql) && />= 40 then/.test(sql));
check('14 the owner and admins get a notification for each request', /insert into public\.app_notifications/.test(sql) && /'service_request'/.test(sql));
check('15 only status, who handled it and when can be changed by the owner', /grant update \(status, handled_by, handled_at\)/.test(sql));

// ── the app ──
const layout = read('app/weather/(tabs)/_layout.tsx');
const bar = read('src/components/weather/FloatingTabBar.tsx');
check('16 the Request tab is in the Weather area and in its tab bar, and the old Account tab is renamed Brighton', /name="request"/.test(layout) && /\/weather\/request/.test(bar) && /label: 'Brighton'/.test(bar) && !/label: 'Account'/.test(bar));
const screen = read('app/weather/(tabs)/request.tsx');
check('17 the form checks, then sends, and shows the problem in words', /requestProblem\(input\)/.test(screen) && /submitServiceRequest\(input\)/.test(screen) && /setProblem/.test(screen));
check('18 the form never needs a sign-in', !/useAuth|isAuthenticated/.test(screen));
check('19 the owner has the list in both owner areas, and a row in each More screen', fs.existsSync(path.join(__dirname, '../../app/(owner)/service-requests.tsx')) && fs.existsSync(path.join(__dirname, '../../app/snow/owner/service-requests.tsx')) && /service-requests/.test(read('app/(owner)/(tabs)/more/index.tsx')) && /service-requests/.test(read('app/snow/owner/(tabs)/more.tsx')));
const target = compile(read('src/lib/notificationTarget.ts'));
check('20 tapping the notification opens the list', target.ownerNotificationTarget({ eventType: 'service_request', linkedEntityType: 'service_request', linkedEntityId: 'abc' }) === '/(owner)/service-requests');
const es = compile(read('src/i18n/es.weather.ts')).ES_WEATHER;
check('21 every service and every form message has Spanish', lib.SERVICE_CHOICES.every((s) => es[s]) && ['Request a service', 'Send request', 'Request sent', 'Enter your name.', 'Choose at least one service.'].every((k) => es[k]));
const data = read('src/data/serviceRequests.ts');
const fn = read('supabase/functions/notify-request/index.ts');
const sql118 = read('supabase/updates/118_request_email.sql');
check('23 update 118 makes the request function return the new id and adds emailed_at (the rest of the function is as in 114)', /return jsonb_build_object\('ok', true, 'id', rid\);/.test(sql118) && /add column if not exists emailed_at timestamptz/.test(sql118) && /grant execute on function public\.submit_service_request\(.*\) to anon, authenticated/.test(sql118) && !/return jsonb_build_object\('ok', true\);/.test(sql118));
check('24 right after a request is sent the app asks notify-request to email the owner, and a failure there is never shown to the visitor', /supabase\.functions\.invoke\('notify-request', \{ body: \{ id \} \}\)\.catch\(\(\) => \{\}\)/.test(data) && /typeof id === 'string'/.test(data));
check('25 notify-request is one self-contained file (pasted into the website), emails only owners and admins of that company, only a fresh request, and only once', !/from '\.\.\/_shared/.test(fn) && /in\('role', \['owner', 'admin'\]\)/.test(fn) && /FRESH_MS = 15 \* 60 \* 1000/.test(fn) && /\.is\('emailed_at', null\)/.test(fn) && /api\.resend\.com\/emails/.test(fn) && /reply_to: looksLikeEmail\(r\.email\) \? r\.email : undefined/.test(fn));
check('26 the email says who, how to reach them, where, what services and the details, and the subject names them', /Name: \$\{r\.name\}/.test(fn) && /Phone: \$\{r\.phone\}/.test(fn) && /Town \/ ZIP: \$\{r\.town\}/.test(fn) && /Services: \$\{r\.services\.join/.test(fn) && /Details: /.test(fn) && /subject: `New service request: \$\{r\.name\} \(\$\{r\.town\}\)`/.test(fn));
check('22 sending uses the server function and never writes to the table directly', /rpc\('submit_service_request'/.test(data) && !/from\('service_requests'\)\s*\.insert/.test(data));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
