// Run: node scripts/checks/customerSignupNamePhoto.check.cjs
// The customer's sign-up form (from the private link) has a profile photo option like everyone's, and the name the owner typed stays
// (shown, not editable; only a part the owner left empty can be filled in). Email and phone still update. (Behavior in 078 + its test.)
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };
const page = read('app/invite/[token].tsx');
const sql = read('supabase/updates/078_invite_links.sql');
const photo = page.slice(page.indexOf('styles.photoSection}>') - 80, page.indexOf('styles.photoSection}>') + 40);

check('1 the photo option is shown to everyone on the sign-up form, customers included (not only workers)', /styles\.photoSection/.test(page) && !/\{isWorker \? \(\s*<View style=\{styles\.photoSection\}>/.test(page) && /onPress=\{choosePhoto\}/.test(page), photo);
check('2 the photo choices include Take Photo and Choose from Library', /Take Photo/.test(page) && /Choose from Library/.test(page));
check('3 the photo is saved for a customer too (it is kept if email confirmation is pending)', /stashPendingSignup\(\{ email: email\.trim\(\), photoUri/.test(page) && /uploadImage\(photoUri/.test(page));
check('4 the form shows the name the owner typed, not editable for a customer', /firstLocked/.test(page) && /lastLocked/.test(page) && /editable=\{!firstLocked\}/.test(page) && /editable=\{!lastLocked\}/.test(page) && /info\?\.kind === 'customer' && !!info\?\.firstName\?\.trim\(\)/.test(page));
check('5 the database keeps a customer\'s name as the owner typed it, and only fills in a part left empty', /inv\.kind = 'customer' then coalesce\(nullif\(btrim\(first_name\), ''\), nullif\(btrim\(meta->>'first_name'\)/.test(sql) && /inv\.kind = 'customer' then coalesce\(nullif\(btrim\(last_name\), ''\)/.test(sql));
check('6 a worker can still correct their own name, and the email and phone still come from the form', /else coalesce\(nullif\(btrim\(meta->>'first_name'\), ''\), first_name\) end/.test(sql) && /email = coalesce\(new\.email, ''\)/.test(sql) && /phone = coalesce\(nullif\(btrim\(meta->>'phone'\), ''\), phone\)/.test(sql));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
