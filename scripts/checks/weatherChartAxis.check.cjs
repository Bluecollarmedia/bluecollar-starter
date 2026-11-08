// Run: node scripts/checks/weatherChartAxis.check.cjs <path to typescript package>
// The weather chart names every hour under it (not only 12 AM, 6 AM, 12 PM and 6 PM), as many as fit.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(read('src/lib/weatherView.ts'), { compilerOptions: { module: 'commonjs', esModuleInterop: true } }).outputText)(m, m.exports, () => ({}));
const W = m.exports;
let bad = 0;
let n = 0;
const check = (name, ok, detail = '') => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}${ok ? '' : '  - ' + detail}`); };

check('1 15 hours across a phone get a label for every hour', W.axisStep(15, 290) === 1, String(W.axisStep(15, 290)));
check('2 a whole 24-hour day is too tight for every hour, so it is every 2nd hour; a longer stretch, every 3rd', W.axisStep(24, 290) === 2 && W.axisStep(48, 290) === 3);
check('3 one hour or no width never breaks it', W.axisStep(1, 290) === 1 && W.axisStep(15, 0) === 1);
W.setViewTz('America/New_York');
const noon = W.hourParts('2026-10-28T16:00:00Z', 'en-US');
const one = W.hourParts('2026-10-28T17:00:00Z', 'en-US');
check('4 an hour is split into its number and AM/PM (12 PM, then 1)', noon.num === '12' && noon.period === 'PM' && one.num === '1' && one.period === 'PM', JSON.stringify([noon, one]));
const src = read('src/components/weather/WeatherDetails.tsx');
check('5 the chart labels come from the "every hour that fits" rule, with AM/PM under the first label and at noon and midnight, and the old four fixed times are gone', /axisStep\(hours\.length, plotW\)/.test(src) && /hr === 0 \|\| hr === 12/.test(src) && !/\[0, 6, 12, 18\]\.includes/.test(src));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
