// Run: node scripts/checks/customerPickerAddNew.check.cjs
// Wherever a customer is picked (Snow property page, Add Snow Property), "Add a new customer" is at the TOP, always in view,
// not buried under a long list.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };
const picker = read('src/components/customers/CustomerPicker.tsx');
check('1 the picker offers Add a new customer', /<QuickAddCustomer onAdded=\{onPick\} \/>/.test(picker) && (picker.match(/<QuickAddCustomer/g) || []).length === 1);
check('2 it comes before the search box and the list, so it is the first thing seen', picker.indexOf('<QuickAddCustomer') < picker.indexOf('<SearchBar') && picker.indexOf('<QuickAddCustomer') < picker.indexOf('shown.slice(0, 40)'));
check('3 a new customer is handed straight back to be picked', /onAdded=\{onPick\}/.test(picker));
check('4 the Snow property page and Add Snow Property both use this picker', /<CustomerPicker/.test(read('app/(owner)/snow-property.tsx')) && /<CustomerPicker/.test(read('src/components/snow/properties/AddSnowProperty.tsx')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
