// Run: node scripts/checks/addFromCustomer.check.cjs
// On a customer's own page, Add opens New Project already knowing the customer:
// it never asks you to pick a customer, or add a new one, when you are already inside that customer.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };

const profile = read('app/(owner)/customers/[id].tsx');
const project = read('app/(owner)/project-new.tsx');

check('1 the customer page has one Add button that opens New Project', /onPress=\{addForCustomer\}/.test(profile) && /function addForCustomer\(\)/.test(profile));
check('2 it passes this customer along', /project-new\?customerId=\$\{p\.id\}/.test(profile));
check('3 New Project reads the customer it was opened for and starts with it chosen', /customerId: fromCustomer/.test(project) && /existing\?\.customerId \?\? \(editId \? undefined : fromCustomer\)/.test(project));
const lockedBlock = project.slice(project.indexOf('{lockedCustomer ? ('), project.indexOf('<Card title="Project Info">'));
check('4 New Project, opened from a customer, shows just their name: no chips to pick another customer and no Add a new customer', /lockedCustomer/.test(lockedBlock) && /\) : \(/.test(lockedBlock) && lockedBlock.indexOf('lockedCustomer ? (') < lockedBlock.indexOf('<QuickAddCustomer') && /^\s*\{lockedCustomer \? \(\s*<Card title="Customer"[^]*?\) : \(/.test(lockedBlock));
check('5 New Project from the main Projects list still lets you pick or add a customer', (project.match(/<QuickAddCustomer/g) || []).length === 1 && /changeCustomer\(c\.person\.id\)/.test(project));
check('6 editing an existing project is unchanged (the customer can still be changed there)', /editId \? undefined : fromCustomer/.test(project));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
