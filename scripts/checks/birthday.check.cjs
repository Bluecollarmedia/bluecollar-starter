// Run: node scripts/checks/birthday.check.cjs <path to typescript package>
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../src/lib/birthday.ts'), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(src, { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const { parseBirthday, birthdayProblem, birthdayInputText, formatBirthday, daysUntilBirthday, birthdaySoon } = m.exports;
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };
const T = (y, mo, d) => new Date(y, mo - 1, d);

check('1 slash date parses', parseBirthday('04/23/1990') === '1990-04-23' && parseBirthday('4/3/1990') === '1990-04-03');
check('2 dash and ISO forms parse', parseBirthday('4-23-1990') === '1990-04-23' && parseBirthday('1990-04-23') === '1990-04-23');
check('3 impossible dates are refused', parseBirthday('02/30/1990') === null && parseBirthday('13/01/1990') === null && parseBirthday('00/10/1990') === null && parseBirthday('abc') === null);
check('4 leap day only in a leap year', parseBirthday('02/29/2000') === '2000-02-29' && parseBirthday('02/29/2001') === null);
check('5 years before 1900 are refused', parseBirthday('01/01/1899') === null);
check('6 empty is fine (optional)', birthdayProblem('') === '' && birthdayProblem('   ') === '');
check('7 a wrong form gets a plain hint', /MM\/DD\/YYYY/.test(birthdayProblem('hello')));
check('8 a future date is refused, today is fine', /future/.test(birthdayProblem('01/01/2030', T(2026, 10, 18))) && birthdayProblem('10/18/2026', T(2026, 10, 18)) === '');
check('9 edit box text round-trips', birthdayInputText('1990-04-23') === '04/23/1990' && birthdayInputText(null) === '' && birthdayInputText('') === '');
check('10 display text', formatBirthday('1990-04-23') === 'Apr 23, 1990' && formatBirthday(undefined) === '');
check('11 days until: today, tomorrow, next year', daysUntilBirthday('1990-10-18', T(2026, 10, 18)) === 0 && daysUntilBirthday('1990-10-19', T(2026, 10, 18)) === 1 && daysUntilBirthday('1990-10-17', T(2026, 10, 18)) === 364);
check('12 wraps over new year', daysUntilBirthday('1990-01-02', T(2026, 12, 30)) === 3);
check('13 Feb 29 counts on Feb 28 in a normal year', daysUntilBirthday('2000-02-29', T(2027, 2, 27)) === 1 && daysUntilBirthday('2000-02-29', T(2028, 2, 27)) === 2);
check('14 soon wording', birthdaySoon('1990-10-18', T(2026, 10, 18)) === 'Birthday today' && birthdaySoon('1990-10-19', T(2026, 10, 18)) === 'Birthday tomorrow' && birthdaySoon('1990-10-23', T(2026, 10, 18)) === 'Birthday in 5 days' && birthdaySoon('1990-12-25', T(2026, 10, 18)) === '' && birthdaySoon('bad') === '');
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
