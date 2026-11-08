// Run: node scripts/checks/checkinRadius.check.cjs <path to typescript package>
// Check-in distance: the real distance rule, the worker refusal wording, and the sheet/map wiring.
const ts = require(process.argv[2] || 'typescript'); const fs = require('fs'); const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const m = { exports: {} }; new Function('module', 'exports', ts.transpileModule(read('src/lib/checkInRadius.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const r = m.exports;
let bad = 0; const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : ' — ' + d}`); };
const site = { latitude: 40, longitude: -74 };
const at = (dLat, accuracy = 10) => ({ latitude: 40 + dLat, longitude: -74, accuracy });

check('1 haversine: 0.001 degree of latitude is about 111 m; a degree of longitude shrinks with latitude', Math.abs(r.haversineMeters(site, at(0.001)) - 111.2) < 1 && r.haversineMeters({ latitude: 60, longitude: 0 }, { latitude: 60, longitude: 1 }) < 56000);
check('2 inside the saved distance is accepted (and reports the distance)', (() => { const v = r.evaluateCheckIn({ gps: at(0.001), site, radiusM: 152 }); return v.ok && v.distance === 111; })());
check('3 outside is refused as too_far with the real distance', (() => { const v = r.evaluateCheckIn({ gps: at(0.003), site, radiusM: 152 }); return !v.ok && v.reason === 'too_far' && v.distance === 334 && v.radius === 152; })());
check('4 the phone\'s error margin helps up to 75 m, never more', r.evaluateCheckIn({ gps: at(0.0015, 30), site, radiusM: 152 }).ok === true && r.evaluateCheckIn({ gps: at(0.0016, 5), site, radiusM: 152 }).ok === false && r.evaluateCheckIn({ gps: at(0.0027, 90), site, radiusM: 152 }).ok === false);
check('5 a fix worse than 100 m is "inaccurate", never accepted or rejected on its reading', (() => { const v = r.evaluateCheckIn({ gps: at(0.0005, 250), site, radiusM: 152 }); return !v.ok && v.reason === 'inaccurate'; })());
check('6 a job with no usable location is refused (no_site), not waved through', ['no_site'].every((x) => [null, undefined, {}, { latitude: 0, longitude: 0 }, { latitude: NaN, longitude: 1 }].every((s) => { const v = r.evaluateCheckIn({ gps: at(0), site: s, radiusM: 152 }); return !v.ok && v.reason === x; })));
check('7 an unreadable GPS fix is refused (bad_gps)', (() => { const v = r.evaluateCheckIn({ gps: { latitude: NaN, longitude: 1 }, site, radiusM: 152 }); return !v.ok && v.reason === 'bad_gps'; })());
const fmt = (m) => `${m} m`;
const far = r.checkInRefusal({ ok: false, reason: 'too_far', distance: 334, radius: 152 }, 'Wyndham 2', fmt);
check('8 the too-far message says so, with the worker\'s distance and the allowed distance', far.title === 'You are too far from this project to check in' && /334 m from Wyndham 2/.test(far.message) && /within 152 m/.test(far.message) && far.retry === false);
check('9 inaccurate and missing-location messages are clear, and only the GPS ones invite a retry', r.checkInRefusal({ ok: false, reason: 'inaccurate', accuracy: 250, radius: 1 }, 'X', fmt).retry === true && /address/.test(r.checkInRefusal({ ok: false, reason: 'no_site', radius: 1 }, 'X', fmt).message));

const wp = read('src/providers/WorkerProvider.tsx');
check('10 the worker check-in uses the saved radius for THIS project, the project coordinates and the shared rule', /db\.settings\[job\.projectId\]\?\.checkinRadiusMeters \?\? DEFAULT_CHECKIN_RADIUS_M/.test(wp) && /findCoords\(job\.project\)/.test(wp) && /evaluateCheckIn\(\{ gps, site, radiusM: radius \}\)/.test(wp) && !/there's nothing to compare against, so allow it/.test(wp));
check('11 permission denied still offers Open Settings; GPS unavailable is refused', /openSettings: true/.test(wp) && /here\.status === 'unavailable'/.test(wp));
const sheet = read('src/components/projects/CheckInRadiusSheet.tsx'), ios = read('src/components/maps/RadiusMap.ios.tsx'), screen = read('app/(owner)/(tabs)/projects/[id].tsx');
check('12 the sheet resolves the PROJECT location (never the phone\'s), shows an error and blocks Save when it can\'t', /findCoords\(place\)/.test(sheet) && !/getCurrentGps|getCurrentPosition/.test(sheet) && /This project's location can't be found/.test(sheet) && /disabled=\{!canSave\}/.test(sheet));
check('13 save is single-shot and only runs with coordinates (or when Anywhere is chosen)', /savingRef\.current/.test(sheet) && /canSave = anywhere \|\| !!coords/.test(sheet) && /if \(!canSave \|\| savingRef\.current\) return;/.test(sheet));
check('14 the native map is created after the sheet opens, only for valid coordinates, inside an error guard; the circle is a real-radius Circle', /setMapReady\(true\)/.test(sheet) && /!ready \|\| !validCoords\(coords\)/.test(ios) && /class MapGuard/.test(ios) && /radius=\{radiusMeters\}/.test(ios));
check('15 the screen opens the sheet once and saves this project\'s distance (plus its map spot if it had none)', /openRadiusPicker/.test(screen) && /updateSettings\(\{ checkinRadiusMeters: meters \}\)/.test(screen) && /updateProject\(\{ latitude: coords\.latitude, longitude: coords\.longitude \}\)/.test(screen));
const sql = read('supabase/updates/052_checkin_radius_enforcement.sql');
check('16 the database repeats the rule (distance, accuracy, missing fix) with the same numbers; owners exempt', /public\.haversine_m/.test(sql) && /v_acc > 100/.test(sql) && /least\(v_acc, 75\)/.test(sql) && /coalesce\(v_radius, 805\)/.test(sql) && /is_staff\(v_company\)/.test(sql) && /You are too far from this project to check in\./.test(sql));
console.log(bad ? `\n${bad} failed` : '\nall passed'); process.exit(bad ? 1 : 0);
