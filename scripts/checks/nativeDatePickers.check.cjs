// Run: node scripts/checks/nativeDatePickers.check.cjs
// Guard: dates and times are never typed. Fails if a text field that looks like a date/time sneaks back in.
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out); else if (/\.tsx$/.test(e.name)) out.push(rel);
  }
  return out;
}
const files = [...walk('app'), ...walk('src')];
let bad = 0; const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : ' — ' + d}`); };

// 1. No text input is told to expect a typed date or time.
const typed = [];
for (const f of files) {
  const src = read(f);
  // an <Input/InputRow/TextInput ...> element (possibly multi-line) mentioning a date/time format or label
  for (const m of src.matchAll(/<(Input|InputRow|TextInput|NoteField)\b[\s\S]*?\/>/g)) {
    const el = m[0];
    if (/MM\/DD|YYYY|HH:MM|\bh:mm\b|2026-\d\d-\d\d|(?<![A-Za-z])label=["'][^"']*(Date|Time|Birthday)\b/i.test(el)) typed.push(`${f}: ${el.slice(0, 70).replace(/\s+/g, ' ')}`);
  }
}
check('1 no text field asks for a typed date or time', typed.length === 0, typed.join(' | '));

// 2. The fields that used to be typed now use the shared DateField.
check('2 Edit Profile and sign-up birthdays use DateField, set to start in 1990 and never in the future', ['src/components/account/EditProfileScreen.tsx', 'app/invite/[token].tsx'].every((f) => { const s = read(f); return /<DateField[\s\S]*?Birthday[\s\S]*?initialPickerDate="1990-01-01"/.test(s) && /maximumDate=/.test(s); }));
check('3 project start / est. end dates use DateField; end date cannot be before the start', (() => { const s = read('app/(owner)/project-new.tsx'); return /<DateField\s+label="Start Date"/.test(s) && /<DateField\s+label="Est\. End Date"/.test(s) && /minimumDate=\{startDate \|\| undefined\}/.test(s) && /endDate < k\) setEndDate\(''\)/.test(s); })());

// 4. The shared component picks the native picker on each platform.
const df = read('src/components/ui/DateField.tsx');
check('4 DateField: iOS wheel picker, Android system dialog, web date input', /display="spinner"/.test(df) && /DateTimePickerAndroid\.open/.test(df) && /type: 'date'/.test(df));
check('5 DateField is exported from the ui index', /DateField/.test(read('src/components/ui/index.ts')));
check('6 DateRow opens a picker for an empty optional date on iPhone (no silent "today")', !/onChange\(localDateKey\(new Date\(\)\)\)\)/.test(read('src/components/financials/FormBits.tsx')) && /IosDateSheet/.test(read('src/components/financials/FormBits.tsx')));

// 7. Time fields stay on native time pickers.
const timeFiles = ['src/components/maintenance/TimeCorrectionSheet.tsx', 'src/components/snow/time/ShiftCorrectionSheet.tsx', 'src/components/materials/ReminderSheet.tsx', 'app/(owner)/schedule-create.tsx'];
check('7 time fields use the native DateTimePicker', timeFiles.every((f) => /DateTimePicker/.test(read(f))));
console.log(bad ? `\n${bad} failed` : '\nall passed'); process.exit(bad ? 1 : 0);
