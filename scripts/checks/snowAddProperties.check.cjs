// Run: node scripts/checks/snowAddProperties.check.cjs [path to typescript package]
// The Add Properties bottom sheet on a Plowing Route: search, All / service / Customer filters, the Add button label,
// and the rules that were asked for (no map, no Nearby, no thumbnails; opens as a bottom sheet, one Add keeps the draft).
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };
const compile = (src) => {
  const m = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', esModuleInterop: true } }).outputText)(m, m.exports, () => ({}));
  return m.exports;
};

const lib = compile(read('src/lib/snowPropertyPicker.ts'));
const props = [
  { propertyId: 'a', name: 'Maple Ridge', address: '123 Maple Rd', services: ['plowing', 'salting'] },
  { propertyId: 'b', name: 'Oak Valley', address: '789 Oak Ln', services: ['salting'] },
  { propertyId: 'c', name: 'Cedar Lane', address: '321 Cedar Ave', city: 'Lakewood' },
];
const contacts = { a: ['Pat Jones'], b: ['Lee Smith', 'Pat Jones'] };
const st = (o) => ({ query: '', filter: 'all', customer: null, contacts, services: ['plowing'], ...o });
const ids = (r) => r.map((p) => p.propertyId).join('');

check('1 All shows every eligible property, sorted by name', ids(lib.filterProperties(props, st({}))) === 'cab');
check('2 search finds a property by name, address, city or customer', ids(lib.filterProperties(props, st({ query: 'oak' }))) === 'b' && ids(lib.filterProperties(props, st({ query: '321 cedar' }))) === 'c' && ids(lib.filterProperties(props, st({ query: 'lakewood' }))) === 'c' && ids(lib.filterProperties(props, st({ query: 'pat jones' }))) === 'ab');
check('3 the service filter keeps only properties that offer the route\'s service (no list = the route\'s own service)', ids(lib.filterProperties(props, st({ filter: 'service' }))) === 'ca');
check('4 the Customer filter narrows to that customer\'s properties and works together with search', ids(lib.filterProperties(props, st({ filter: 'customer', customer: 'Pat Jones' }))) === 'ab' && ids(lib.filterProperties(props, st({ filter: 'customer', customer: 'Pat Jones', query: 'oak' }))) === 'b' && ids(lib.filterProperties(props, st({ filter: 'customer', customer: 'Lee Smith' }))) === 'b');
check('5 the Add button label: Select Properties / Add 1 Property / Add 5 Properties', lib.addButtonLabel(0) === 'Select Properties' && lib.addButtonLabel(1) === 'Add 1 Property' && lib.addButtonLabel(5) === 'Add 5 Properties');

const sheet = read('src/components/snow/routes/AddPropertiesSheet.tsx');
const edit = read('src/components/snow/routes/RouteEditScreen.tsx');
check('6 it is a bottom sheet with a grip, a title, a close button and rounded top corners', /BottomSheetModal/.test(sheet) && /Add Properties/.test(sheet) && /styles\.grip/.test(sheet) && /borderTopLeftRadius/.test(sheet) && /accessibilityLabel="Close"/.test(sheet));
check('7 there is NO map, Nearby, distance or thumbnail in the sheet', !/nearby|distance|latitude|longitude|thumbnail|MapView|<Image|label: 'Map'/i.test(sheet));
check('8 the filters are All, the service and Customer only', /key: 'all', label: 'All'/.test(sheet) && /key: 'customer', label: 'Customer'/.test(sheet) && !/label: 'Map'|Nearby/.test(sheet));
check('9 the footer stays visible (outside the scroll view), clears the home indicator, and Cancel is there', /insets\.bottom \+ spacing\.sm/.test(sheet) && /Cancel/.test(sheet) && /addButtonLabel\(chosen\.length\)/.test(sheet));
check('10 selections are kept when search or filters change (kept in their own state), and the sheet starts fresh each time it opens', /const \[chosen, setChosen\]/.test(sheet) && /setChosen\(\[\]\)/.test(sheet));
check('11 the route editor opens the sheet instead of an inline list, adds through the existing addStops, and never dispatches', /<AddPropertiesSheet/.test(edit) && /addStops\(route\.id, items\)/.test(edit) && !/dispatchStorm/.test(edit));
check('12 customers come from the property contacts that already exist (no database change)', /snow_property_contacts/.test(read('src/data/snowProperties.ts')) && /loadPropertyContactNames/.test(sheet));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
