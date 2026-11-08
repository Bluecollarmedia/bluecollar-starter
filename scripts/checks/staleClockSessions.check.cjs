// Run: node scripts/checks/staleClockSessions.check.cjs
// A clock session that was never closed (workday clock for landscaping + maintenance, and the Snow clock) must never get in the way of the
// next day and must never be given an invented end time. One rule (lib/clockSession) used by every clock, the database flags the old session
// at zero hours, the worker answers with ONE card, the owner settles it, and Sign Out warns while a clock is running.
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const m = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(read('src/lib/clockSession.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports, (n) => (n === '@/i18n' ? { getLanguage: () => 'en', tr: (t, v) => (v ? t.replace(/\{(\w+)\}/g, (x, k) => (k in v ? v[k] : x)) : t) } : {}));
const { sessionState, isCurrent, needsAnswer, stopTimeChoices, answeredText, WORKDAY_STALE_HOURS, SNOW_STALE_HOURS } = m.exports;

const H = 3600000;
const now = Date.parse('2026-10-22T17:00:00Z');
const ago = (h) => new Date(now - h * H).toISOString();

// ── the rule ──
check('1 a session with an end time is CLOSED (history only, never a warning)', sessionState({ clockInAt: ago(30), clockOutAt: ago(22) }, now) === 'closed');
check('2 an open session 5 hours old is CURRENT', sessionState({ clockInAt: ago(5) }, now) === 'current');
check('3 an open workday 26 hours old (clocked in Wednesday, looked at Thursday) is STALE', sessionState({ clockInAt: ago(26) }, now, WORKDAY_STALE_HOURS) === 'stale');
check('4 an overnight workday that is still plausible (10 hours) is CURRENT, not stale', sessionState({ clockInAt: ago(10) }, now, WORKDAY_STALE_HOURS) === 'current');
check('5 a storm shift that has run 16 hours overnight is still CURRENT for Snow (20-hour threshold)', sessionState({ clockInAt: ago(16) }, now, SNOW_STALE_HOURS) === 'current' && sessionState({ clockInAt: ago(25) }, now, SNOW_STALE_HOURS) === 'stale');
check('6 a session the database already flagged is REVIEW whatever its age', sessionState({ clockInAt: ago(1), clockOutAt: ago(1), flagged: true }, now) === 'review');
check('7 only a CURRENT session counts as "clocked in"; stale and review never do', isCurrent({ clockInAt: ago(2) }, now) && !isCurrent({ clockInAt: ago(26) }, now) && !isCurrent({ clockInAt: ago(1), clockOutAt: ago(1), flagged: true }, now));
check('8 stale and review sessions are the ones that need the one question', needsAnswer({ clockInAt: ago(26) }, now) && needsAnswer({ clockInAt: ago(1), clockOutAt: ago(1), flagged: true }, now) && !needsAnswer({ clockInAt: ago(2) }, now) && !needsAnswer({ clockInAt: ago(30), clockOutAt: ago(22) }, now));
const choices = stopTimeChoices(ago(26), now);
check('9 the "I stopped at" choices lie between the clock-in and now, never in the future, at most 49', choices.length > 0 && choices.length <= 49 && choices.every((c) => Date.parse(c.iso) >= now - 26 * H && Date.parse(c.iso) < now));
check('10 the answered card says what they said, and that the boss decides', /not sure/.test(answeredText(null, null)) && /Your boss will set the real end time/.test(answeredText(ago(8), 'Left at 5')) && /Left at 5/.test(answeredText(ago(8), 'Left at 5')));

// ── every clock uses that one rule ──
const workday = read('src/hooks/useMyWorkday.ts');
check('11 the workday clock decides "clocked in" with the shared rule (a stale day is never `active`)', /isCurrent\(asSession\(d\), nowMs, staleHours\)/.test(workday) && /stale: days\.find\(\(d\) => needsAnswer/.test(workday) && /d\.status !== 'needs_review'/.test(workday));
const snow = read('src/data/snowShifts.ts');
const snowHook = read('src/hooks/useSnowClock.ts');
check('12 the Snow clock uses the same rule (with the Snow threshold), and reads old open shifts from ANY week (not only since Monday)', /splitShifts/.test(snow) && /SNOW_STALE_HOURS/.test(snow) && /loadMyUnsettledShifts/.test(snowHook) && /flagged_at\.not\.is\.null/.test(snow));
check('13 the Snow clock asks the database to flag a forgotten shift BEFORE showing anything', /await checkMyShift\(\);/.test(snowHook) && /snow_check_my_shift/.test(snow));
const card = read('src/components/time/WorkdayCard.tsx');
check('14 the old advice "clock out now" (which would stamp today\'s time on yesterday) is gone from the workday card', !/clock out now and tell your boss/.test(card) && /<StaleSessionCard/.test(card));
const gate = read('src/components/snow/time/SnowClockGate.tsx');
const timeScreens = read('src/components/snow/time/SnowTimeScreens.tsx');
check('15 the Snow Clock In screen, the Route banner and the Time Clock tab all show the one card and read the one clock', /<SnowStaleShiftCard/.test(gate) && /topNotice=\{staleCard\}/.test(gate) && /<SnowStaleShiftCard/.test(timeScreens) && /const clock = useSnowClock\(\)/.test(timeScreens) && /topNotice/.test(read('src/components/snow/routes/MyRouteScreen.tsx')));
check('16 a failed clock-out stays on the Snow Time Clock screen and says the person is still clocked in', /You are still clocked in\./.test(timeScreens) && /You are still not clocked in\./.test(timeScreens) && /clockError \?/.test(timeScreens));

// ── the owner ──
check('17 the owner sees "Never clocked out" with the worker\'s answer and can use their time or set another', /Never clocked out/.test(read('app/(owner)/(tabs)/more/labor-day.tsx')) && /Use their time/.test(read('app/(owner)/(tabs)/more/labor-day.tsx')) && /Use their time/.test(timeScreens) && /needs_end_time/.test(read('src/lib/timeCalc.ts')));

// ── sign-out ──
const screens = ['app/(worker)/(tabs)/settings.tsx', 'app/snow/owner/(tabs)/more.tsx', 'src/components/snow/SnowWorkerSettings.tsx', 'app/snow/notice.tsx', 'app/(owner)/(tabs)/more/settings.tsx', 'app/(owner)/(tabs)/more/index.tsx'];
check('18 every Sign Out that a clocked-in person can reach warns first (it prompts, never blocks)', screens.every((f) => /useGuardedSignOut\(\)/.test(read(f)) && /guardedSignOut/.test(read(f))), screens.filter((f) => !/guardedSignOut/.test(read(f))).join(', '));
const guard = read('src/hooks/useGuardedSignOut.ts');
check('19 the warning offers "Sign out anyway" and a failed check never stops a sign-out', /Sign out anyway/.test(guard) && (guard.match(/catch \{/g) || []).length >= 2);

// ── the database ──
const sql = read('supabase/updates/090_stale_clock_sessions.sql');
check('20 a stale workday is closed at its OWN clock-in (zero hours), never at now(), and the original clock-in is untouched', /set clock_out_at = clock_in_at, status = 'needs_review'/.test(sql) && !/set clock_out_at = now\(\), status = 'needs_review'/.test(sql));
check('21 a stale Snow shift is closed the same way', /set clock_out_at = clock_in_at, flagged_at = now\(\)/.test(sql));
check('22 clocking in and out flag a stale session first, so it never blocks today and clock-out never closes the old one at now()', (sql.match(/_time_flag_stale\(me, cid\)/g) || []).length >= 3 && /_snow_flag_stale\(me, cid\)/.test(sql));
check('23 the worker\'s answer is only SAVED (bounded between clock-in and now); it changes no hours', /p_stopped_at < w\.clock_in_at or p_stopped_at > now\(\)/.test(sql) && /set claimed_out_at = p_stopped_at/.test(sql) && !/claimed_out_at.*clock_out_at = p_stopped_at/.test(sql));
check('24 an unresolved day cannot be approved for payroll; the owner\'s end time settles it', /status = 'needs_review' then raise exception/.test(sql) && /when w\.status = 'needs_review' and new_out is not null and new_out > new_in then 'closed'/.test(sql));
check('25 the repeated clock-out answers for the workday\'s own date (not the server\'s UTC date, which is already tomorrow in the evening)', /coalesce\(last_day, current_date\)/.test(sql));
check('26 the owner is told when a session is flagged', (sql.match(/_time_notify_staff\(/g) || []).length >= 4);
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
