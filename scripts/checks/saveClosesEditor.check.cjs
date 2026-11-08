// Run: node scripts/checks/saveClosesEditor.check.cjs
// The owner's rule: after Save, nothing stays open. The keyboard goes away and inline editors fold up. These are the places that
// used to leave a text box open and focused after a successful save; each must dismiss the keyboard in its save path.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const must = {
  'src/components/trucks/TruckMaintenanceSheet.tsx': 1,
  'src/components/trucks/TruckDocumentSheet.tsx': 1,
  'src/components/projects/ProjectPrivateNotes.tsx': 2,
  'app/(owner)/(tabs)/more/payroll.tsx': 2,
  'app/(owner)/(tabs)/more/storage.tsx': 3,
  'app/(owner)/(tabs)/more/labor-property.tsx': 2,
  'app/(owner)/(tabs)/more/yard-location.tsx': 1,
  'app/(owner)/setup.tsx': 1,
  'app/(owner)/(tabs)/projects/[id].tsx': 4,
  'src/components/snow/routes/SkipRequests.tsx': 1,
  'src/components/snow/routes/RouteEditScreen.tsx': 2,
  'src/components/properties/CustomerPropertiesCard.tsx': 1,
  'src/components/snow/properties/AddSnowProperty.tsx': 1,
  'app/(customer)/project.tsx': 1,
  'src/components/customers/QuickAddCustomer.tsx': 1,
  'app/(owner)/snow-property.tsx': 2,
};
for (const [file, n] of Object.entries(must)) {
  const s = read(file);
  const count = (s.match(/Keyboard\.dismiss\(\)/g) || []).length;
  check(`${file}: the save path dismisses the keyboard (${n}+ place${n === 1 ? '' : 's'})`, count >= n && /\bKeyboard\b[^;]*from 'react-native'|import \{[^}]*\bKeyboard\b[^}]*\} from 'react-native'/.test(s), `found ${count}`);
}
const sp = read('app/(owner)/snow-property.tsx');
check('Snow instructions fold up to a short summary after Save (and only open while writing)', /setEditing\(false\)/.test(sp) && /setEditing\(true\)/.test(sp) && /numberOfLines=\{3\}/.test(sp));
const pay = read('app/(owner)/(tabs)/more/payroll.tsx');
check('a saved hourly rate folds the worker card back up', /Keyboard\.dismiss\(\);\s*onToggle\(\);/.test(pay));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
