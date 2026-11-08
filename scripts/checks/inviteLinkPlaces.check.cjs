// The customer picker tells the form when a customer is new; address suggestions never fail silently.
// File-text checks. Not covered here (needs a phone and Google): the live suggestions and the real link text.
const fs = require('fs');
const read = (p) => fs.readFileSync(p, 'utf8');
let bad = 0;
let n = 0;
const check = (name, ok) => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}`); };
check('the picker tells the form when the customer is new', /onAdded\(id, true\)/.test(read('src/components/customers/QuickAddCustomer.tsx')) && /isNew\?: boolean/.test(read('src/components/customers/CustomerPicker.tsx')));
const pl = read('src/lib/placesAutocomplete.ts');
check('Google is always told which app is asking, even if the running app does not report it', /BUNDLE_ID/.test(pl) && /app\.json/.test(pl) && /X-Ios-Bundle-Identifier/.test(pl));
check('when suggestions fail the screen says why instead of showing nothing', /lastPlacesProblem/.test(read('src/components/ui/StreetSuggestions.tsx')) && /Address suggestions are not working right now/.test(read('src/components/ui/StreetSuggestions.tsx')));
process.exit(bad ? 1 : 0);
