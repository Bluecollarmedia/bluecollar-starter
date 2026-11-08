// A customer added while adding a Snow property gets their invite link right there; address suggestions never fail silently.
// File-text checks. Not covered here (needs a phone and Google): the live suggestions and the real link text.
const fs = require('fs');
const read = (p) => fs.readFileSync(p, 'utf8');
let bad = 0;
let n = 0;
const check = (name, ok) => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}`); };
const add = read('src/components/snow/properties/AddSnowProperty.tsx');
check('a customer added in Add Snow Property gets their private invite link made at once (Text / Copy)', /<CustomerInviteCard[^>]*autoMake/.test(add) && /justAddedId === customer\.person\.id/.test(add));
check('the picker tells the form when the customer is new', /onAdded\(id, true\)/.test(read('src/components/customers/QuickAddCustomer.tsx')) && /isNew\?: boolean/.test(read('src/components/customers/CustomerPicker.tsx')));
const pl = read('src/lib/placesAutocomplete.ts');
check('Google is always told which app is asking, even if the running app does not report it', /BUNDLE_ID/.test(pl) && /app\.json/.test(pl) && /X-Ios-Bundle-Identifier/.test(pl));
check('when suggestions fail the screen says why instead of showing nothing', /lastPlacesProblem/.test(read('src/components/ui/StreetSuggestions.tsx')) && /Address suggestions are not working right now/.test(read('src/components/ui/StreetSuggestions.tsx')));
process.exit(bad ? 1 : 0);
