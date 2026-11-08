// Run: node scripts/checks/everyoneEverywhere.check.cjs
// One shared directory: a customer joins the app ONCE
// (a project never asks for its own "Set Up Access"), and customer pickers list everyone. Checked from the source, not on a phone.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const project = read('app/(owner)/(tabs)/projects/[id].tsx');
const picker = read('src/components/customers/CustomerPicker.tsx');

check('8 a project never shows "Set Up Access": it follows the customer\'s own login', !/Set Up Access/.test(project) && /function customerHasApp\(personId\?: string\)/.test(project) && /'Connected' : 'Waiting'/.test(project));
check('9 a customer with a login is Connected on every project without any per-project step', /access\?\.claimedBy \|\| hasApp/.test(project));
check('10 the one-time invite stays on the customer (not per job)', /CustomerInviteCard personId=\{p\.customer\.id\}/.test(project));
check('11 customer pickers list every customer (no area or module filter)', /m\.role === 'customer' && m\.status !== 'inactive' && m\.person/.test(picker) && !/worksOn/i.test(picker.slice(picker.indexOf('.filter'), picker.indexOf('.filter') + 200)));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
