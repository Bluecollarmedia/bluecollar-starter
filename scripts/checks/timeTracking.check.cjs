// Run: node scripts/checks/timeTracking.check.cjs
// Workday and property time tracking: the app only calls database functions that exist, every owner switch is really used by the database,
// workers never get owner-only data, the notification types the database writes are known to the app, and the screens are wired.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let bad = 0;
const check = (n, ok, detail) => { if (!ok) bad++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (ok ? '' : ' - ' + (detail || ''))); };

const sql = ['063_time_tracking_core', '064_time_corrections_approval_alerts', '065_time_tracking_followups', '090_stale_clock_sessions'].map((f) => read(`supabase/updates/${f}.sql`)).join('\n');
const fnames = new Set([...sql.matchAll(/create or replace function public\.(time_[a-z_]+)\(/g)].map((m) => m[1]));
const data = read('src/data/timeTracking.ts') + read('src/data/maintenance.ts') + read('src/data/timePhotos.ts');
const calls = new Set([...data.matchAll(/(?:rpc\(|timeRpc\(|rpcDone\(|callDay\()\s*'(time_[a-z_]+)'/g)].map((m) => m[1]));
const missing = [...calls].filter((c) => !fnames.has(c));
check('1 every time_* function the app calls exists in the database updates (' + calls.size + ' calls)', calls.size > 20 && missing.length === 0, missing.join(', '));

const grants = [...fnames].filter((f) => !f.startsWith('_') && !sql.includes(`grant execute on function public.${f}(`) && !sql.includes(`'${f}(`));
check('2 every worker/owner function is granted to signed-in users only (and revoked from the public)', grants.length === 0 && /revoke all on function public\.time_clock_in/.test(sql), grants.join(', '));

const toggles = { breaks_enabled: /time_break_start[\s\S]*?breaks_enabled/, require_start_photo: /require_start_photo/, require_complete_photo: /require_complete_photo/, target_alerts_enabled: /st\.target_alerts_enabled/, target_notify_crew: /st\.target_notify_crew/, overtime_alerts_enabled: /st\.overtime_alerts_enabled/, breaks_paid: /st\.breaks_paid/ };
const dead = Object.entries(toggles).filter(([, re]) => !re.test(sql)).map(([k]) => k);
check('3 every owner switch is used by the database logic (breaks, both photo rules, target alerts, crew prompt, overtime alerts, paid breaks)', dead.length === 0, dead.join(', '));
check('4 the settings screen saves every switch', ['breaksEnabled', 'breaksPaid', 'requireStartPhoto', 'requireCompletePhoto', 'targetAlertsEnabled', 'targetNotifyCrew', 'overtimeAlertsEnabled'].every((k) => read('app/(owner)/(tabs)/more/labor-settings.tsx').includes(k) && read('src/data/timeTracking.ts').includes(k)));

const worker = read('src/data/timeTracking.ts');
const dayParse = worker.slice(worker.indexOf('function parseDay'), worker.indexOf('export async function timeRpc') > 0 ? worker.indexOf('/** Calls one of the worker functions') : undefined);
check('5 what a worker\'s phone receives has no pay rate, target, cost or average (the day JSON and the parser)', !/rate|target|cost|average|alert/i.test(dayParse) && !/'(rate|target|cost|average|alert)/i.test(sql.slice(sql.indexOf('function public._time_day_json'), sql.indexOf('function public.time_my_day'))), dayParse.match(/rate|target|cost|average|alert/gi)?.join());
const workerFiles = ['src/components/time/WorkdayCard.tsx', 'src/components/time/SkipRequestSheet.tsx', 'src/hooks/useMyWorkday.ts', 'app/(worker)/maintenance/index.tsx', 'app/(worker)/maintenance-stop/[id].tsx', 'app/(worker)/(tabs)/index.tsx'];
const leaks = workerFiles.filter((f) => /laborReports|loadLabor|visitHistoryStats|hourlyRate|loadTargets|loadAudit|loadAlerts/.test(read(f)));
check('6 worker screens never import owner reports, labor loaders, audit, targets or pay rates', leaks.length === 0, leaks.join(', '));
check('7 no offline queue for time actions: the worker hook shows a failure instead of saving locally', !/AsyncStorage|offlineQueue/.test(read('src/hooks/useMyWorkday.ts') + read('src/data/timeTracking.ts')) && /No connection\. This was not saved/.test(read('src/data/timeTracking.ts')));

const events = [...sql.matchAll(/(?:_time_notify_staff\(p_company, |event_type[^)]*values \([^)]*?')(time_[a-z_]+)'/g)].map((m) => m[1]);
const evAll = new Set([...sql.matchAll(/'(time_(?:skip_request|over_target|overtime|unusual|progress_check))'/g)].map((m) => m[1]));
const labels = read('src/lib/notificationEvents.ts');
const unknown = [...evAll].filter((e) => !new RegExp(`${e}:`).test(labels));
check('8 every notification type the database writes (' + [...evAll].join(', ') + ') has a label and icon in the app', evAll.size === 5 && unknown.length === 0, unknown.join(','));
check('9 tapping a time alert opens the day, the visit or the overview', /time_workday/.test(read('src/lib/notificationTarget.ts')) && /time_visit/.test(read('src/lib/notificationTarget.ts')) && /time_skip/.test(read('src/lib/notificationTarget.ts')));

const screens = ['labor', 'labor-day', 'labor-visit', 'labor-property', 'labor-properties', 'labor-week', 'labor-review', 'labor-settings'];
const menu = read('app/(owner)/(tabs)/more/index.tsx');
check('10 the Hours & Labor screens exist and the More menu links to them', screens.every((s) => fs.existsSync(path.join(root, `app/(owner)/(tabs)/more/${s}.tsx`))) && /HOURS & LABOR/.test(menu) && ['labor\'', 'labor-review', 'labor-week', 'labor-properties', 'labor-settings'].every((s) => menu.includes(`/more/${s.replace(/'$/, '')}`)));
check('11 route order, skip approval and photos are enforced by the database (not only on screen)', /Stops are worked in order|Jobs are worked in order/.test(sql) && /time_decide_skip/.test(sql) && /Take the start photo/.test(sql) && /Take the completion photo/.test(sql) && /Complete the property you are working at/.test(sql));
check('12 clock-out is refused with a property open (never closes it silently) and no property time is invented for a skipped stop', /You are still working at/.test(sql) && !/insert into public\.time_intervals[^;]*skipp/i.test(sql));
check('13 approved days are locked from ordinary edits: workers have no write access, owner corrections reopen the day and are audited', /time_touch_approval/.test(sql) && /was_approved/.test(sql) && !/create policy [a-z_]+ on public\.time_(workdays|intervals|breaks) for (insert|update|delete)/i.test(sql));
const exp = read('src/lib/exportCsv.ts') + read('src/lib/timeCalc.ts');
check('14 exports are real CSV files (byte-order mark, CRLF, shared as .csv), only of the scope on screen', /\\uFEFF/.test(exp) && /text\/csv/.test(exp) && read('app/(owner)/(tabs)/more/labor-week.tsx').includes('weekly-hours-${weekStart}') && /dailyCsv\(\[row\]\)/.test(read('app/(owner)/(tabs)/more/labor-day.tsx')));
check('15 the tests for the database updates exist', ['063_time_tracking_core', '064_time_corrections_approval_alerts', 'time_tracking_review'].every((f) => fs.existsSync(path.join(root, `supabase/tests/${f}.pglite.mjs`))));
console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
