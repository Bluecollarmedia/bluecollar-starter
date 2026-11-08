// Run: node scripts/checks/stepsOpenAtTop.check.cjs
// Every step of a multi-step form opens at the TOP (it used to stay scrolled to the bottom of the step before, so "Next" looked like nothing
// happened), and the quote editor's step 2 no longer repeats the notes / materials / pictures block from step 1.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };
const top = /scrollRef\.current\?\.scrollTo\?\.\(\{ x: 0, y: 0, animated: false \}\); \}, \[step\]\)/;
const doc = read('app/(owner)/document-edit.tsx');
const route = read('app/(owner)/route-new.tsx');
const company = read('app/(auth)/create-company.tsx');
check('1 the quote / change order / invoice editor scrolls to the top on every step', top.test(doc) && /<KeyboardAwareScrollView(\s+bounces=\{false\})?\s+ref=\{scrollRef\}/.test(doc));
check('2 the new-route builder does too', top.test(route) && /<KeyboardAwareScrollView(\s+bounces=\{false\})?\s+ref=\{scrollRef\}/.test(route));
check('3 so does the company setup', top.test(company) && /<KeyboardAwareScrollView( bounces=\{false\})? ref=\{scrollRef\}/.test(company));
check('4 the notes / materials / pictures block is on step 1 only', (doc.match(/<ProjectPrivateNotes/g) || []).length === 1 && /step === 0 && doc\.kind === 'quote' && project && \(\s*<View[^>]*>\s*<ProjectPrivateNotes/.test(doc));
check('5 step 2 (Line Items) starts with the line items', /\{step === 1 && \(\s*<>/.test(doc));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
