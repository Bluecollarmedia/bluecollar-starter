// Run: node scripts/checks/snowWorkerClockIn.check.cjs
// The Snow worker's Route tab is a gate: until they have clocked in they see ONE screen with ONE Clock In button and no route; once the
// database confirms the clock-in, the normal Route screen shows with a quiet "Clocked in since" line. Clock Out lives only in Time Clock.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('node:url');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };

(async () => {
  const v = await import(pathToFileURL(path.join(__dirname, '..', '..', 'src', 'lib', 'snowClockView.ts')).href);

  check('1 which screen: loading, route (clocked in), ready (can clock in), none (cannot)', v.clockGateState({ loading: true, clockedIn: false, allowed: true }) === 'loading' && v.clockGateState({ loading: false, clockedIn: true, allowed: false }) === 'route' && v.clockGateState({ loading: false, clockedIn: false, allowed: true }) === 'ready' && v.clockGateState({ loading: false, clockedIn: false, allowed: false }) === 'none');
  check('2 an open shift always shows the route, even if the storm just ended (never hides a running clock)', v.clockGateState({ loading: false, clockedIn: true, allowed: true }) === 'route' && v.clockGateState({ loading: false, clockedIn: true, allowed: false }) === 'route');
  check('3 errors are plain sentences: connection, not on a route, anything else; no technical text leaks', /Check your connection/.test(v.clockInErrorText('Network request failed')) && /not on a dispatched route/.test(v.clockInErrorText('not on a route for a dispatched storm')) && v.clockInErrorText('PGRST301: relation "x" JWT stack') === "Couldn't clock in. Please try again." && !/PGRST|JWT|relation/.test(v.clockInErrorText('PGRST301 relation JWT')));
  check('4 the storm and route line: "Oct 21 Plowing · North Route", with either part missing', v.stormRouteLine('Oct 21 Plowing', 'North Route') === 'Oct 21 Plowing · North Route' && v.stormRouteLine(undefined, 'North Route') === 'North Route' && v.stormRouteLine('', '') === '');

  const gate = read('src/components/snow/time/SnowClockGate.tsx');
  const route = read('src/components/snow/routes/MyRouteScreen.tsx');
  const index = read('app/snow/worker/(tabs)/index.tsx');
  const layout = read('app/snow/worker/(tabs)/_layout.tsx');
  const hook = read('src/hooks/useSnowClock.ts');
  const time = read('src/components/snow/time/SnowTimeScreens.tsx');

  check('5 the Route tab is the gate, shown to every Snow worker (the tab is never hidden)', /SnowClockGate/.test(index) && /name: 'index', title: 'Route'/.test(layout) && !/hidden/.test(layout));
  check('6 the Route tab always shows the route: no Clock In screen, no "No active storm assignment" screen, nothing here clocks anyone in', !/Ready to start\?/.test(gate) && !/No active storm assignment/.test(gate) && !/clockInNow/.test(gate) && /<MyRouteScreen clockedInSince=\{open\?\.clockInAt\}/.test(gate));
  check('12 the Route screen has the quiet "Clocked in since … Clock out in the Time Clock tab." line above My Route, and no clock buttons', /Clocked in since \{time\}/.test(route) && /formatClock\(clockedInSince\)/.test(route) && /Clock out in the Time Clock tab/.test(route) && route.indexOf('Clocked in since') < route.indexOf("t('My Route')") && !/clockIn\(|clockOut\(|Clock Out"|title="Clock In"/.test(route));
  check('13 the state comes from the database clock (shifts + can-clock-in), is re-read whenever a screen comes to the front and every minute while not clocked in', /loadShifts\(startOfWeekIso\(\)\)/.test(hook) && /canClockIn\(\)/.test(hook) && /useFocusEffect/.test(hook) && /60_000/.test(hook) && /AppState\.addEventListener/.test(hook));
  check('14 clocking out stays only in the Time Clock tab, which re-reads the clock when it comes to the front', /clockOut\(\)/.test(time) && /Clock Out/.test(time) && /useFocusEffect\(useCallback\(\(\) => \{ void reload\(\); \}, \[reload\]\)\)/.test(time));
  check('15 no location is used anywhere in the clock-in', !/expo-location|requestForegroundPermissions|Location\./.test(gate + hook));
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
