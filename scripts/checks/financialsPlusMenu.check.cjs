// Quotes & Invoices overview: no buttons floating over the tab bar; a small green + at the top right opens a Quote / Invoice menu.
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', '(owner)', '(tabs)', 'more', 'financials.tsx'), 'utf8');
let bad = 0;
const check = (n, ok) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); };
check('1 the Create Quote / Invoice buttons at the bottom of the screen are gone', !/title="Create Quote"/.test(src) && !/styles\.fab/.test(src) && !/useFixedBottomOffset/.test(src));
check('2 a small green + (RaisedAddButton) is in the top-right of the header', /right=\{[\s\S]*RaisedAddButton[\s\S]*\}/.test(src));
check('3 it opens a Create menu with Quote and Invoice, which open the same new-document screens as before', /label: 'Quote'/.test(src) && /label: 'Invoice'/.test(src) && /kind: 'quote'/.test(src) && /kind: 'invoice'/.test(src));
check('4 the Document defaults button is kept', /Document defaults/.test(src));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
