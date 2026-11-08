// Run: node scripts/checks/activityFold.check.cjs <path to typescript package>
const ts = require(process.argv[2] || 'typescript'); const fs = require('fs'); const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../src/lib/activityFold.ts'), 'utf8');
const m = { exports: {} }; new Function('module', 'exports', ts.transpileModule(src, { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const f = m.exports; const screen = fs.readFileSync(path.join(__dirname, '../../app/(worker)/maintenance/activity.tsx'), 'utf8');
let bad = 0; const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : ' — ' + d}`); };
const ev = (t) => ({ eventType: t });
const days = [{ key: '2026-10-19', events: [ev('arrived'), ev('completed')] }, { key: '2026-10-02', events: [ev('arrived')] }, { key: '2026-09-30', events: [ev('completed'), ev('completed')] }, { key: '2026-08-01', events: [ev('arrived')] }];
const months = f.groupByMonth(days);
check('1 days group into months, newest first', months.map((x) => x.key).join() === '2026-10,2026-09,2026-08' && months[0].days.length === 2 && months[1].count === 2);
check('2 today key is local yyyy-mm-dd', f.todayKey(new Date(2026, 9, 5)) === '2026-10-05');
check('3 only the current month shows its days', f.isCurrentMonth('2026-10', new Date(2026, 9, 19)) && !f.isCurrentMonth('2026-09', new Date(2026, 9, 19)));
check('4 summaries', f.daySummary(days[0].events) === '2 updates · 1 stop finished' && f.daySummary(days[1].events) === '1 update' && f.monthSummary(months[1]) === '1 day · 2 updates · 2 stops finished', f.monthSummary(months[1]));
check('5 month heading', f.monthHeading('2026-09') === 'September 2026');
check('6 screen: today always open, earlier days and months fold and toggle', /isToday \|\| !!open\[day\.key\]/.test(src === '' ? '' : screen) && /isCurrentMonth\(month\.key\)/.test(screen) && /groupByMonth/.test(screen));
console.log(bad ? `\n${bad} failed` : '\nall passed'); process.exit(bad ? 1 : 0);
