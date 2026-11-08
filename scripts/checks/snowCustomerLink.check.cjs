// Run: node scripts/checks/snowCustomerLink.check.cjs
// In Snow Mode the owner can give the customer their link right on the Snow property page: no trip to Landscaping, no project code.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };

const page = read('app/(owner)/snow-property.tsx');
check('1 the Snow property page shows the customer\'s private link card (Text Message / Copy Link) under the customer', /<CustomerInviteCard personId=\{customer\.personId\}/.test(page) && /import \{ CustomerInviteCard \}/.test(page));
check('2 it is only shown for a customer with an account record to link, and it is the customer\'s ONE link (not per property)', /customer\.personId \? \(\s*<CustomerInviteCard/.test(page) && /covers everything on their customer record/.test(page));
check('3 the Snow Mode screen for a property is the same one (Snow Mode never sends you to Landscaping for a code)', fs.existsSync(path.join(__dirname, '../../app/snow/owner/property.tsx')) && /snow-property/.test(read('app/snow/owner/property.tsx')));
const card = read('src/components/invites/CustomerInviteCard.tsx');
check('4 the card makes the link through the customer (invite_send for the person), and says when they already have a login', /sendInviteAgain\(personId\)/.test(card) && /has a login/.test(card));
const t = read('supabase/tests/086_customer_cohesion.pglite.mjs');
check('5 the end-to-end cohesion test exists: one customer, one link, Snow + maintenance + project all visible, later additions visible, others hidden', /snow_my_properties/.test(t) && /maintenance_my_properties/.test(t) && /exactly one link was ever made/.test(t));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
