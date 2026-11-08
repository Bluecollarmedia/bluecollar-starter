// Run: node scripts/checks/step1TodayClock.check.cjs
// Step 1 of the Today redesign (app only): clock-in first, no clock after clock-in, all routes, one combined list in a fixed order,
// a small Settings clock row, and a finished route that gets another stop is in progress again. Nothing here touches the database.
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

// ── The ordering rules (pure) ───────────────────────────────────────────────
const m = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(read('src/lib/dayWork.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports, () => ({}));
const { buildDayWork, routesForDay, hasOpenWork } = m.exports;
const job = (id, o) => ({ id, status: 'scheduled', isFullDay: false, sortOrder: 0, createdAt: '2026-10-01T00:00:00Z', ...o });
const stop = (id, status = 'pending') => ({ id, status });
const route = (id, createdAt, stops, o = {}) => ({ id, serviceDate: '2026-10-25', status: 'planned', crewIds: ['me'], createdAt, stops, ...o });

const R1 = route('r1', '2026-10-20T08:00:00Z', [stop('a', 'completed'), stop('b'), stop('c')]);
const R2 = route('r2', '2026-10-20T09:00:00Z', [stop('d'), stop('b')]); // 'b' appears again: must show once
const items = buildDayWork({
  routes: routesForDay([R2, R1, route('rx', '2026-10-19T00:00:00Z', [stop('z')], { status: 'cancelled' }), route('ry', '2026-10-19T00:00:00Z', [stop('y')], { serviceDate: '2026-10-26' })], 'me', '2026-10-25'),
  jobs: [
    job('full2', { isFullDay: true, sortOrder: 2 }), job('t1500', { startTime: '15:00' }), job('t0800', { startTime: '08:00' }), job('full1', { isFullDay: true, sortOrder: 1 }),
    job('gone', { status: 'cancelled', startTime: '07:00' }), job('moved', { status: 'reassigned', startTime: '07:30' }), job('t0800b', { startTime: '08:00', sortOrder: 5 }),
  ],
});
const order = items.map((i) => i.id).join(',');
check('1 order: timed jobs by start time, then route stops (routes oldest first, each in its saved order), then full-day jobs', order === 't0800,t0800b,t1500,a,b,c,d,full1,full2', order);
check('2 each stop appears once, cancelled / reassigned jobs and cancelled or other-day routes are left out', items.filter((i) => i.id === 'b').length === 1 && !/gone|moved|\bz\b|\by\b/.test(order), order);
check('3 finished stops and jobs are marked done; anything open means work remains', items.find((i) => i.id === 'a').done && !items.find((i) => i.id === 'b').done && hasOpenWork(items));
check('4 an all-finished day has no open work', !hasOpenWork(buildDayWork({ routes: [route('r', 'x', [stop('p', 'completed'), stop('q', 'skipped')])], jobs: [job('j', { status: 'completed' })] })));

// ── The clock on Today ──────────────────────────────────────────────────────
const card = read('src/components/time/WorkdayCard.tsx');
check('5 the card has a gate version that shows only Clock In: no stale card, no timer, no Clock Out, no closed summary', /gate = false/.test(card) && /w\.stale && !gate/.test(card) && /active && compact && !gate/.test(card) && /active && !compact && !gate/.test(card) && /closedToday && !gate/.test(card));
check('6 the gate shows Clock In again when work remains after a closed session, and still never when there is no work', /!active && !noWork && \(!closedToday \|\| \(gate && moreWork/.test(card));
const today = read('src/components/today/WorkerToday.tsx');
check('7 not clocked in: the worker still sees their route (no Clock In screen replaces it); clocking is manual on the Clock tab', !/return <ClockInScreen/.test(today) && !/if \(!active\) \{/.test(today));
check('8 "clocked in" is only a current session (the one shared definition); a stale or flagged one never counts', /w\.active/.test(today) && /isCurrent\(asSession\(d\)/.test(read('src/hooks/useMyWorkday.ts')));
check('9 no timer, total or Clock Out on Today after clock-in', !/w\.clockOut\(|Clock Out|netMsAt|durationText|clockText|Workday total/.test(today.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
const settings = read('app/(worker)/(tabs)/settings.tsx');
const row = read('src/components/time/ClockRow.tsx');
check('10 Settings has one small clock row: Clock out while clocked in, Clock in again when clocked out and allowed', /<ClockRow \/>/.test(settings) && /w\.clockOut\(\)/.test(row) && /w\.clockIn\(truckId\)/.test(row) && /w\.day\?\.canClockIn !== false/.test(row));
check('11 the row shows no timer or hours, and asks before clocking out', !/durationText|netMsAt|clockText/.test(row) && /Clock out for today\?/.test(row));

// ── Routes, screens, route status ───────────────────────────────────────────
check('12 a worker on several routes sees all of them: the plural hook exists and the clock card counts every route', /export function useMyMaintenanceRoutes/.test(read('src/hooks/useMaintenance.ts')) && /useMyMaintenanceRoutes\(\)/.test(card));
check('13 a worker with route stops gets the simple Today (stops only, or the one combined list when there are jobs too)', /timeOn && day\.hasStops\) return <WorkerToday combined=\{day\.both\} \/>/.test(read('app/(worker)/(tabs)/index.tsx')) && /<WorkerToday \/>/.test(read('app/(worker)/maintenance/index.tsx')));
check('14 a database without the time clock keeps the older maintenance screen', /workday\.installed === false \? <LegacyMaintenanceToday/.test(read('app/(worker)/maintenance/index.tsx')));
check('15 adding a stop to a finished route puts it back in progress', /status === 'completed'\) updateRow\('maintenance_routes', routeId, \{ status: 'in_progress' \}\)/.test(read('src/data/maintenance.ts')));
check('16 the route tab is a map of the day\'s stops', /<RouteMap stops=/.test(read('app/(worker)/maintenance/route.tsx')) && fs.existsSync(path.join(__dirname, '../../src/components/maps/RouteMap.ios.tsx')));
check('17 step 1 itself adds no database file: the new database files all come after step 1, starting with 098 (step 2)', fs.readdirSync(path.join(__dirname, '../../supabase/updates')).filter((f) => /^(09[8-9]|1\d\d)_/.test(f)).join().startsWith('098_auto_close_workday.sql'));
// ── The next-stop card follows where the worker is (driving there / on site) ──────────────────────────
const card2 = read('src/components/today/StopCard.tsx');
check('18 on site, the card opens into the job: the SAME checklist and photo components as the stop screen', /<StopChecklist /.test(card2) && /<StopPhotos /.test(card2) && /const onSite = stop\.status === 'arrived'/.test(card2));
check('19 driving there: name, address, work, task count and the way in (access notes) show; the checklist does not', /accessNotes/.test(card2) && /!onSite && tasksLine/.test(card2) && /\{onSite \? \(\s*<>/.test(card2));
const bar = read('src/components/today/ActionBar.tsx');
check('20 the rules are unchanged: what is missing comes from missingRequirements, leader-only buttons, the same onFinish', /missingRequirements\(stop\)/.test(bar) && /if \(!leader\)/.test(bar) && /onPress=\{onFinish\}/.test(bar));
check('21 I\'M HERE / FINISH STOP are pinned at the bottom of Today, not inside the card, measured against the window like the older pinned button', /actionArea/.test(today) && /measureInWindow/.test(today) && /bar=\{bar\}/.test(today) && !/FinishStopButton|I'M HERE/.test(card2.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
check('22 the button really greys out: FINISH STOP until nothing is missing and nothing is uploading; I\'M HERE while checking in; everything for a non-leader (with who it waits for)', /disabled=\{missing\.length > 0 \|\| uploading > 0 \|\| finishing\}/.test(bar) && /busy=\{!!starting\} disabled=\{!!starting\}/.test(bar) && /disabled\s+reason=\{crewStopMessage/.test(bar) && /backgroundColor: off \? colors\.border/.test(bar));
check('23 the checklist and photos fold away by themselves once met, and unfold when tapped', /if \(tasksSatisfied\) setTasksOpen\(false\)/.test(card2) && /if \(photosSatisfied\) setPhotosOpen\(false\)/.test(card2) && /onToggle=\{\(\) => setTasksOpen\(\(v\) => !v\)\}/.test(card2));
check('24 a finished stop unfolds to show its tasks, photos and who finished, with a Details link to the stop screen', /setUnfolded\(\(v\) => !v\)/.test(card2) && /doneTasks\.map/.test(card2) && /t\('Details'\)/.test(card2));
check('25 the Route tab shows how many stops are done out of today\'s stops (all routes)', /stops done/.test(read('app/(worker)/maintenance/route.tsx')) && /day\.stops\.filter\(\(s\) => s\.done\)/.test(read('app/(worker)/maintenance/route.tsx')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
