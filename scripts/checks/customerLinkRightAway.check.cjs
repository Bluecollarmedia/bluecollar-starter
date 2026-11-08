// Run: node scripts/checks/customerLinkRightAway.check.cjs
// Adding a customer takes you straight to their page with their private link already made (Text / Copy). The link belongs to the
// customer, not to a project: sign-up attaches the new login to that customer record by the link, never by email address.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };
const add = read('app/(owner)/customers/new.tsx');
const profile = read('app/(owner)/customers/[id].tsx');
const card = read('src/components/invites/CustomerInviteCard.tsx');
const sql = read('supabase/updates/078_invite_links.sql');

check('1 after Add Customer you land on that customer\'s page (not back to a list)', /const id = await addCustomer/.test(add) && /router\.replace\(`\/\(owner\)\/customers\/\$\{id\}\?justAdded=1`/.test(add) && !/router\.back\(\);\s*\} catch/.test(add));
check('2 that page makes the link at once (autoMake) and shows Text Message and Copy Link', /autoMake=\{justAdded === '1'\}/.test(profile) && /autoMake && !hasLogin/.test(card) && /Text Message/.test(card) && /Copy Link/.test(card));
check('3 a customer who already has a login is told so instead of being sent another link', /has a login/.test(card));
check('4 sign-up with the link attaches the new login to the existing customer record (so their projects, maintenance and Snow properties are already there)', /where id = inv\.person_id and user_id is null/.test(sql) && /user_id = new\.id/.test(sql));
check('5 it is matched by the private link, never by email address, so a different sign-up email does not matter', /no matching by email address/i.test(sql) && !/where lower\(email\) = lower\(new\.email\)/.test(sql.slice(sql.indexOf('create or replace function public.handle_new_user'))));
check('6 the link works once and is marked used before the login is made', /status = 'used'/.test(sql) && /status = 'pending' and expires_at > now\(\)/.test(sql));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
