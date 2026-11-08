// Run: node scripts/checks/step1TodayClock.check.cjs
// The worker's clock (app only): the dashboards' Clock In gate, clock-in again when work remains, "clocked in" is only a current session,
// and a small Settings clock row. Nothing here touches the database.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

// ── The clock on Today ──────────────────────────────────────────────────────
const card = read('src/components/time/WorkdayCard.tsx');
check('1 the card has a gate version that shows only Clock In: no stale card, no timer, no Clock Out, no closed summary', /gate = false/.test(card) && /w\.stale && !gate/.test(card) && /active && compact && !gate/.test(card) && /active && !compact && !gate/.test(card) && /closedToday && !gate/.test(card));
check('2 the gate shows Clock In again when work remains after a closed session, and still never when there is no work', /!active && !noWork && \(!closedToday \|\| \(gate && moreWork/.test(card));
check('3 "clocked in" is only a current session (the one shared definition); a stale or flagged one never counts', /isCurrent\(asSession\(d\)/.test(read('src/hooks/useMyWorkday.ts')));
const settings = read('app/(worker)/(tabs)/settings.tsx');
const row = read('src/components/time/ClockRow.tsx');
check('4 Settings has one small clock row: Clock out while clocked in, Clock in again when clocked out and allowed', /<ClockRow \/>/.test(settings) && /w\.clockOut\(\)/.test(row) && /w\.clockIn\(truckId\)/.test(row) && /w\.day\?\.canClockIn !== false/.test(row));
check('5 the row shows no timer or hours, and asks before clocking out', !/durationText|netMsAt|clockText/.test(row) && /Clock out for today\?/.test(row));
check('6 step 1 itself adds no database file: the new database files all come after step 1, starting with 098 (step 2)', fs.readdirSync(path.join(__dirname, '../../supabase/updates')).filter((f) => /^(09[8-9]|1\d\d)_/.test(f)).join().startsWith('098_auto_close_workday.sql'));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
