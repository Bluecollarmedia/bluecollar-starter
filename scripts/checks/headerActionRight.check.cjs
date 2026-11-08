// Run: node scripts/checks/headerActionRight.check.cjs
// A tab with no Back button (Snow Team) keeps its "+" on the RIGHT, like Properties and every other tab (it used to jump to the left).
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };
const header = read('src/components/ui/ScreenHeader.tsx');
check('1 with the Back button hidden the header pushes its action to the right', /style=\{\[styles\.buttonRow, hideBack && \{ justifyContent: 'flex-end' \}\]\}/.test(header));
check('2 with a Back button the layout is unchanged (Back left, action right)', /buttonRow: \{[^}]*justifyContent: 'space-between'/.test(header));
check('3 the Snow Team tab hides Back and has the add button as its action', /hideBack=\{asTab\}/.test(read('app/(owner)/(tabs)/more/snow-team.tsx')) && /right=\{<RaisedAddButton/.test(read('app/(owner)/(tabs)/more/snow-team.tsx')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
