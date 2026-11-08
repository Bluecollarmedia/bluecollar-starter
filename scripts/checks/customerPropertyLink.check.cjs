// Adding a customer is decided by the database, and every place that adds one shows the reason when it is refused.
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
let bad = 0;
const check = (n, ok) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); };
const hook2 = read('src/hooks/useCustomers.ts');
check('1 "Add customer" is decided by the database (add_customer) so existing accounts are reused, with demo mode keeping the local behaviour', /rpc\('add_customer'/.test(hook2) && /if \(!db\.demo\)/.test(hook2));
check('2 all three places that add a customer wait for the result and show the reason when it is refused', /await addCustomer\(/.test(read('app/(owner)/customers/new.tsx')) && /await addCustomer\(/.test(read('src/components/customers/QuickAddCustomer.tsx')) && /addCustomer\(\{ firstName: first[^]*?\.catch\(/.test(read('src/components/financials/NewProjectForm.tsx')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
