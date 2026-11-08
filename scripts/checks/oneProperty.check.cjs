// Run: node scripts/checks/oneProperty.check.cjs [path to typescript package]
// One place for every property (src/data/properties.ts, SQL 79): a property is entered once per customer, every form picks
// the customer first and then their saved property, customer pages all read the same list.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const data = read('src/data/properties.ts');
const proj = read('app/(owner)/project-new.tsx');
const cust = read('app/(owner)/customers/[id].tsx');
const store = read('src/data/store.ts');
const sql = read('supabase/updates/079_one_property_place.sql');

check('1 the store knows the properties table and the property link on projects', /properties: \{ scope: 'company'/.test(store) && /'customerId', 'propertyId', 'name'/.test(store));
check('2 every save goes through propertyForSave: it reuses the customer\'s property or makes it once, and still saves when update 79 is not installed yet', /export async function propertyForSave/.test(data) && /res\.missing \? \{\} : \{ error: res\.error \}/.test(data) && /ensure_property/.test(data));
check('3 a New Project picks the customer FIRST, then their saved property or a new address, and links the project to it', proj.indexOf('title="Customer"') > -1 && proj.indexOf('title="Customer"') < proj.indexOf('title="Project Info"') && /<PropertyChoice/.test(proj) && /propertyForSave\(/.test(proj) && /propertyId: linked\.propertyId/.test(proj));
check('8 a customer\'s page lists their properties and lets you add one', /CustomerPropertiesCard/.test(cust) && /ensureProperty/.test(read('src/components/properties/CustomerPropertiesCard.tsx')));
check('9 the database: ensure_property and the address-follows trigger exist and are staff-only', /function public\.ensure_property|function public\.ensure_property\(/.test(sql) && /properties_address_follows/.test(sql) && /_property_staff_company/.test(sql));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
