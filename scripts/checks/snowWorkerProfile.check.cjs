// Run: node scripts/checks/snowWorkerProfile.check.cjs <path to typescript package>
// Logic checks for the Snow worker profile helpers (src/lib/snowWorkerProfile.ts).
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../src/lib/snowWorkerProfile.ts'), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(src, { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const { displayName, formatPhone, roleLabel, profileNudge } = m.exports;

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };

check('1 name shows first and last', displayName({ firstName: 'Jane', lastName: 'Smith', email: 'j@x.test' }) === 'Jane Smith');
check('2 with no name the email is shown, then a placeholder', displayName({ email: 'j@x.test' }) === 'j@x.test' && displayName(null) === 'Your name' && displayName({}) === 'Your name');
check('3 a first name alone is fine', displayName({ firstName: 'Jane' }) === 'Jane');

check('4 10-digit phone is formatted', formatPhone('7325550100') === '(732) 555-0100' && formatPhone('732-555-0100') === '(732) 555-0100');
check('5 a leading 1 is dropped', formatPhone('+1 732 555 0100') === '(732) 555-0100');
check('6 anything else is shown as typed, empty stays empty', formatPhone('555-0100') === '555-0100' && formatPhone('') === '' && formatPhone(undefined) === '');

check('7 owner and admin roles', roleLabel('owner') === 'Owner' && roleLabel('admin') === 'Admin');
check('8 a worker with services is on the snow team', roleLabel('worker', ['plowing']) === 'Snow team' && roleLabel(undefined, ['salting']) === 'Snow team');
check('9 a worker with no services says so', roleLabel('worker', []) === 'Snow team (no services yet)');

check('10 nudge asks for both when both are missing', /photo and your phone/.test(profileNudge({})));
check('11 nudge asks only for what is missing', /photo/.test(profileNudge({ phone: '7325550100' })) && !/phone/.test(profileNudge({ phone: '7325550100' })) && /phone/.test(profileNudge({ avatarUrl: 'x' })) && !/photo/.test(profileNudge({ avatarUrl: 'x' })));
check('12 no nudge once photo and phone are there', profileNudge({ avatarUrl: 'x', phone: '7325550100' }) === null && profileNudge({ avatarUrl: 'x', phone: '   ' }) !== null);
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
