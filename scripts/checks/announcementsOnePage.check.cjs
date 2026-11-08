// Run: node scripts/checks/announcementsOnePage.check.cjs
// Announcements is ONE page: choose Workers or Customers, write it, send it, and the sent ones are right below. No pencil that opens
// a second screen, no separate "message customers" screen to find.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const exists = (p) => fs.existsSync(path.join(__dirname, '../..', p));
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };

const page = read('app/(owner)/(tabs)/more/announcements/index.tsx');
const composer = read('src/components/announcements/WorkerAnnouncementComposer.tsx');
const dir = 'app/(owner)/(tabs)/more/announcements';

check('1 the page has the worker form on it (no pencil, no second screen)', /<WorkerAnnouncementComposer \/>/.test(page) && !/name="edit"/.test(page) && !/announcements\/new/.test(page));
check('2 the old New Announcement and Message Customers screens inside Announcements are gone', !exists(`${dir}/new.tsx`) && !exists(`${dir}/customers.tsx`) && !/announcements\/customers/.test(page));
check('3 one toggle at the top picks Workers or Customers, and the customer form is on the same page', /Announcement to workers/.test(page) && /Message to customers/.test(page) && /<MessageCustomersPanel \/>/.test(page));
check('4 the announcements already sent are listed right below the form', /SENT ANNOUNCEMENTS/.test(page) && /sorted\.map\(\(ann\)/.test(page) && /BottomSheetModal/.test(page));
check('5 sending clears the form and puts the keyboard away (nothing stays open or half-filled)', /Keyboard\.dismiss\(\)/.test(composer) && /setTitle\(''\)/.test(composer) && /setBody\(''\)/.test(composer));
check('6 the worker form keeps title, message, priority, weather action, the push note and Send; there is no Cancel', /Weather Action/.test(composer) && /Priority/.test(composer) && /Push notifications will be sent/.test(composer) && /Send to All Workers/.test(composer) && !/Cancel/.test(composer));
check('7 a message to customers still reads the same way it did (audience chips, counts, confirm) and Snow Mode keeps its own screen for it', /AUDIENCES\.map/.test(read('src/components/announcements/MessageCustomersScreen.tsx')) && /export function MessageCustomersScreen/.test(read('src/components/announcements/MessageCustomersScreen.tsx')) && exists('app/snow/owner/message-customers.tsx'));
check('8 the dashboard quick action and More both open this one page', /\/\(owner\)\/more\/announcements'/.test(read('app/(owner)/(tabs)/index.tsx')) && /more\/announcements/.test(read('app/(owner)/(tabs)/more/index.tsx')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
