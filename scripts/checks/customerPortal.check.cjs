// Run: node scripts/checks/customerPortal.check.cjs <path to typescript package>
// Logic checks for what a customer's portal says when nothing is linked yet (src/lib/customerPortal.ts).
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../src/lib/customerPortal.ts'), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(src, { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const { emptyPortalText } = m.exports;

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };
const t = emptyPortalText();
check('1 the empty state has a title and says jobs appear once they are linked', !!t.title && /jobs appear here/i.test(t.description));
check('2 the empty text names no single trade (no landscaping, maintenance or snow)', !/landscap|maintenance|snow|lawn/i.test(t.title + t.description));
const es = fs.readFileSync(path.join(__dirname, '../../src/i18n/es.customer.ts'), 'utf8');
check('3 the empty text has its Spanish', es.includes(`'${t.title}'`) && es.includes(`'${t.description}'`));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
