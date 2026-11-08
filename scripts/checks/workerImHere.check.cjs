// Run: node scripts/checks/workerImHere.check.cjs
// Worker maintenance Today: the I'M HERE action is outside the ScrollView and anchored to the window bottom.
const fs = require('fs'); const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../app/(worker)/maintenance/index.tsx'), 'utf8');
let bad = 0; const check = (n, ok) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); };
const scrollEnd = src.indexOf('</ScrollView>');
const action = src.indexOf("styles.actionArea");
check('1 action area is rendered after the ScrollView closes (not scrolling content)', scrollEnd > 0 && action > scrollEnd);
check('2 action area is absolutely positioned', /actionArea: \{ position: 'absolute'/.test(src));
check('3 bottom offset subtracts the measured gap above the window bottom', /measureInWindow/.test(src) && /bottomOffset = Math\.max\(.*- gapBelow/.test(src) && /\{ bottom: bottomOffset \}/.test(src));
check('4 scroll content keeps bottom padding for the button', /paddingBottom: scrollPadding/.test(src) && /ACTION_AREA/.test(src));
check('5 label and handler unchanged', /title: timeOn \? 'START PROPERTY' : "I'M HERE"/.test(src) && /onPress: \(\) => handleArrive\(next\)/.test(src));
console.log(bad ? `\n${bad} failed` : '\nall passed'); process.exit(bad ? 1 : 0);
