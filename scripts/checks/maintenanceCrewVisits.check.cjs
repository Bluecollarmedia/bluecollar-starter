// Run: node scripts/checks/maintenanceCrewVisits.check.cjs <path to typescript package>
// Update 68: who sees I'M HERE (the crew leader), the not-scheduled / clock-in states, and the owner's property trend helpers.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
// The phone's text translator (tr) is stubbed as English with the {values} filled in, which is what it returns until the phone is set to Spanish.
const i18nStub = { tr: (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text) };
const load = (rel) => { const m = { exports: {} }; new Function('module', 'exports', 'require', ts.transpileModule(read(rel), { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText)(m, m.exports, (name) => (name === '@/i18n' ? i18nStub : {})); return m.exports; };
let bad = 0;
const check = (n, ok, d) => { if (!ok) bad++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (ok ? '' : ' - ' + (d || ''))); };

const L = load('src/lib/maintenanceLeader.ts');
check('1 the named leader sees the check-in button; another crew member does not', L.isCrewLeader({ leadId: 'a', personId: 'a', role: 'worker' }) === true && L.isCrewLeader({ leadId: 'a', personId: 'b', role: 'worker' }) === false);
check('2 owner and admin may check a crew in; a route with NO leader gives no worker the button (nobody becomes leader by default); a signed-out person never', L.isCrewLeader({ leadId: 'a', personId: 'o', role: 'owner' }) && L.isCrewLeader({ leadId: 'a', personId: 'o', role: 'admin' })
  && !L.isCrewLeader({ leadId: null, personId: 'b', role: 'worker' }) && !L.isCrewLeader({ leadId: null, personId: 'a', role: 'worker' }) && !L.isCrewLeader({ leadId: 'a', personId: null, role: 'worker' }));
check('3 a non-leader is told what is happening instead of getting a button that does nothing, and a route with no leader says so', /no crew leader yet/.test(L.crewStopMessage('pending', null, null, null, false)) && /Waiting for Lena to check the crew in/.test(L.crewStopMessage('pending', 'Lena')) && /In progress since 9:05 AM/.test(L.crewStopMessage('arrived', 'Lena', '9:05 AM', 'Lena')));

const T = load('src/lib/propertyTrend.ts');
const v = (date, el, lab) => ({ stopId: date, serviceDate: date, status: 'completed', elapsedMinutes: el, estLaborMinutes: lab, crew: [], tasksDone: 0, tasksTotal: 0, photos: 0, savedVisit: true });
const visits = [v('2026-05-01', 180, 540), v('2026-05-15', 175, 520), v('2026-06-01', 185, 560), v('2026-06-15', 240, 700)];
const s = T.seasonSummary(visits);
check('4 the season summary averages elapsed time and estimated labor separately', s.visits === 4 && Math.round(s.averageElapsedMinutes) === 195 && Math.round(s.averageLaborMinutes) === 580 && s.totalLaborMinutes === 2320, JSON.stringify(s));
const c = T.compareToUsual(visits, '2026-06-15');
check('5 a visit about an hour longer than the usual ~3 hours is flagged as longer than usual', c && c.unusual === true && Math.round(c.usualMinutes) === 180 && Math.round(c.differenceMinutes) === 60, JSON.stringify(c));
check('6 an ordinary visit is not flagged, and the first visit has nothing to compare with', T.compareToUsual(visits, '2026-06-01').unusual === false && T.compareToUsual(visits, '2026-05-01') === null);
check('7 visits still in progress or skipped are left out of the comparison', T.seasonSummary([...visits, { ...v('2026-07-01', null, null), status: 'arrived' }]).visits === 4);
check('8 durations read well', T.minutesText(40) === '40m' && T.minutesText(195) === '3h 15m' && T.hoursText(120) === '2.0 h');

const today = read('app/(worker)/maintenance/index.tsx');
const stop = read('app/(worker)/maintenance-stop/[id].tsx');
const data = read('src/data/maintenance.ts');
const hist = read('app/(owner)/(tabs)/maintenance/history/[id].tsx');
const card = read('src/components/time/WorkdayCard.tsx');
check('9 the maintenance dashboard has no Clock In card and no "not scheduled" gate: clocking is manual, on the Clock tab', !/You're not scheduled today/.test(today) && !/preShiftTitle=\{t\('Ready to start your day'\)\}/.test(today));
check('10 before clock-in the route is hidden and the pre-shift card explains what clocking in does', /showRoute = !!route && \(!timeOn \|\| clockedIn\)/.test(today) && /unlocks today's route/.test(today));
check('11 after clock-in a compact "On the clock" status replaces the big card, with no floating action button', /On the clock/.test(card) && /if \(cardMode\) \{\s*action = null;/.test(today));
check('12 I\'M HERE and FINISH STOP sit on the property card and only for the leader; others see the status text', /styles\.cardAction/.test(today) && /leader \? \(/.test(today) && /crewStopMessage/.test(today) && /leader && stop\.status === 'pending'/.test(stop));
check('13 the phone saves arrival and completion through the leader functions (with a fallback only for an older database)', /maintenance_leader_arrive/.test(data) && /maintenance_leader_complete/.test(data) && /could not find the function/.test(data));
check('14 the owner\'s property history shows time on site, estimated labor-hours and the comparison with usual', /loadPropertyVisits/.test(hist) && /Estimated labor/.test(hist) && /Longer than usual/.test(hist));
check('15 the database update and its test exist', fs.existsSync(path.join(__dirname, '../../supabase/updates/068_maintenance_crew_visits.sql')) && fs.existsSync(path.join(__dirname, '../../supabase/tests/068_maintenance_crew_visits.pglite.mjs')));
console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
