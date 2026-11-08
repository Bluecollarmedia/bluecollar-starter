// The maintenance "Add Service" flow: three schedule choices, no first/last visit, one short screen, one tap from the property.
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
let bad = 0;
const check = (n, ok) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); };
const draft = read('src/lib/maintenanceServiceDraft.ts');
const add = read('app/(owner)/maintenance-service-add.tsx');
const edit = read('app/(owner)/maintenance-property-edit.tsx');
const prop = read('app/(owner)/(tabs)/maintenance/properties/[id].tsx');
const layout = read('app/(owner)/_layout.tsx');

const freqBlock = draft.match(/export const FREQUENCIES[^=]*=\s*\[([\s\S]*?)\];/)[1];
const keys = [...freqBlock.matchAll(/key: '([a-z_]+)'/g)].map((m) => m[1]);
check('1 exactly three ways to say how often: every week, every N days, set number of visits', keys.join(',') === 'weekly,every_n_days,fixed_dates' && /Every week/.test(freqBlock) && /Every N days/.test(freqBlock) && /Set number of visits/.test(freqBlock));
check('2 "First visit" and "Last visit" are gone from both the Add Service screen and the property form', !/First visit|Last visit/.test(add) && !/First visit|Last visit/.test(edit));
check('3 the visits are spread across the season automatically (default span: from today, to the season end or the end of November)', /defaultSpan/.test(draft) && /-11-30/.test(draft) && /spreadForDraft/.test(add) && /spreadForDraft/.test(edit));
check('4 services saved with an older schedule (every 2 weeks, once in a date range, as needed) still open and show their own name; they are just not offered for new ones', /LEGACY_FREQUENCY_LABELS/.test(draft) && /LEGACY_FREQUENCY_LABELS\[d\.frequency\]/.test(edit));
check('5 the Add Service screen never shows the address, customer or contract', !/AddressFields|SERVICE ADDRESS|QuickAddCustomer|CONTRACT/.test(add));
check('6 the property\'s Services list has an Add Service row that opens the short screen (also when there are already services); no second "Add Service" step', /maintenance-service-add\?propertyId=/.test(prop) && /onServices\.length > 0 && <ListRow icon="plus" title="Add Service"/.test(prop) && !/title="Add Services"[^>]*onPress=\{edit\}/.test(prop));
check('7 one tap on the save button adds the service and goes back to the property', /addServiceRule\(contractId, input\)/.test(add) && /router\.back\(\)/.test(add));
check('8 the extras (photos, checklist, instructions, last done) are tucked under "More options"', /More options/.test(add) && /Completion photos required/.test(add));
check('9 the screen is registered as a modal like the other maintenance forms', /name="maintenance-service-add"/.test(layout));
check('10 a service always belongs to a contract (one is created if the property has none)', /createContract\(detail\.property\.id/.test(add));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
