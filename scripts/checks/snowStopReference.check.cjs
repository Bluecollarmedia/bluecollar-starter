// Run: node scripts/checks/snowStopReference.check.cjs
// A worker (or crew member) can open the instructions and reference photos of ANY stop on their route, from the stop list, at any
// time: before the storm starts and for stops still ahead. Before this, they showed only for the current stop of a dispatched storm.
const fs = require('fs');
const path = require('path');
const s = fs.readFileSync(path.join(__dirname, '../../src/components/snow/routes/MyRouteScreen.tsx'), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

check('1 every row in the stop list is tappable and opens that stop\'s instructions and photos', /setOpenStopId\(open \? null : s\.id\)/.test(s) && /accessibilityState=\{\{ expanded: open \}\}/.test(s));
check('2 the opened stop shows the card (instructions + photos viewer) for each service at that property', /<SnowServiceReferenceCard propertyId=\{s\.propertyId\} service=\{sv\} \/>/.test(s));
check('3 the list rows show a chevron so it is obvious they open', /name=\{open \? 'chevron-up' : 'chevron-down'\} size=\{18\} color=\{colors\.textTertiary\}/.test(s));
check('4 the current stop still shows its instructions and photos while working (unchanged)', /<SnowServiceReferenceCard propertyId=\{current\.propertyId\} service=\{sv\} \/>/.test(s));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
