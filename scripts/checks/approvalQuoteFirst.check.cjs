// Run: node scripts/checks/approvalQuoteFirst.check.cjs
// The customer's approval page shows the QUOTE first. The name / signature form no longer takes over half the phone screen: it opens only
// when the customer taps Review & Approve, and can be folded back down.
const fs = require('fs');
const path = require('path');
const page = fs.readFileSync(path.join(__dirname, '../../app/approve/[token].tsx'), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };
check('1 the form starts closed', /const \[formOpen, setFormOpen\] = useState\(false\)/.test(page));
check('2 while closed the bottom bar is just Request Changes and Review & Approve', /canAnswer && !declining && !formOpen && \([\s\S]{0,500}Review & Approve[\s\S]{0,120}setFormOpen\(true\)/.test(page));
check('3 the name, signature and agreement only show once it is opened', /canAnswer && !declining && formOpen && \([\s\S]{0,800}label=\{t\('Your full name'\)\}/.test(page));
check('4 the customer can fold the form back down to read the quote again', /setFormOpen\(false\)/.test(page) && /Back to the \{doc\}/.test(page));
check('5 Approve still needs the name, a signature and the agreement', /disabled=\{!nameOk \|\| !signed \|\| !agreed \|\| !!saving\}/.test(page));
check('6 the quote itself still fills the screen above the bar', /<View style=\{styles\.flex\}>\s*<DocumentPreview html=\{html\} \/>/.test(page));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
