// Run: node scripts/checks/customerMessages.check.cjs <path to typescript package>
// Owner messages to customers: the groups, the checks, the sentences, and the wiring (compose screen, banner, entry points).
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(read('src/lib/customerMessage.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const c = m.exports;
let bad = 0;
const check = (n, ok, d) => { if (!ok) bad++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (ok ? '' : ' - ' + (d || ''))); };

check('1 four groups: all, landscaping, maintenance, snow',
  c.AUDIENCES.map((a) => a.key).join() === 'customers_all,customers_landscaping,customers_maintenance,customers_snow' && c.isCustomerAudience('customers_snow') && !c.isCustomerAudience('all_workers'));
check('2 a message needs a title and a body, within the size limits',
  c.messageProblem('', 'x') === 'Add a title.' && c.messageProblem('t', '  ') === 'Write the message.' && c.messageProblem('t', 'b') === ''
  && /under 120/.test(c.messageProblem('x'.repeat(121), 'b')) && /under 2000/.test(c.messageProblem('t', 'x'.repeat(2001))));
check('3 the owner is told the real number reached, and the push + banner',
  /Sent to 1 customer\./.test(c.sentText(1)) && /Sent to 12 customers\./.test(c.sentText(12)) && /push notification and a banner/.test(c.sentText(2)) && /nobody was messaged/.test(c.sentText(0)));
check('4 the confirmation says who it goes to and that it cannot be unsent',
  /all your customers/.test(c.confirmText('customers_all').message) && /snow customers/.test(c.confirmText('customers_snow').message) && /can't be unsent/.test(c.confirmText('customers_all').message));
check('5 errors are plain words (update not installed, not allowed)',
  /update 55/.test(c.describeSendError('Could not find the function public.send_customer_announcement in the schema cache')) && /owner or an admin/.test(c.describeSendError('Only the owner or an admin can message customers.')));

const screen = read('src/components/announcements/MessageCustomersScreen.tsx');
check('6 the compose screen: pick a group, title, message, confirm before sending, and a history of what was sent',
  /AUDIENCES\.map/.test(screen) && /label="Title"/.test(screen) && /label="Message"/.test(screen) && /confirmText\(audience\)/.test(screen) && /SENT MESSAGES/.test(screen) && /sendCustomerMessage\(/.test(screen));
const data = read('src/data/customerBlast.ts');
check('7 sending is one database call (the database finds the customers); history is the saved announcements', /rpc\('send_customer_announcement'/.test(data) && /isCustomerAudience\(a\.audience\)/.test(data));
const banner = read('src/components/customer/AnnouncementBanner.tsx');
check('8 the customer banner shows unread messages to customers until dismissed, and dismissing only marks it read',
  /eventType === 'announcement_posted' && n\.status === 'unread'/.test(banner) && /\.to === 'customers'/.test(banner) && /markRead\(n\.id\)/.test(banner) && !/deleteRow/.test(banner));
check('9 the banner is on the customer home screen', /<AnnouncementBanner \/>/.test(read('app/(customer)/(tabs)/index.tsx')));
check('10 entry points: the one Announcements page (landscaping owner) and the Snow More tab both reach the customer message form',
  /MessageCustomersPanel/.test(read('app/(owner)/(tabs)/more/announcements/index.tsx')) && /message-customers/.test(read('app/snow/owner/(tabs)/more.tsx')) && /name="message-customers"/.test(read('app/snow/owner/_layout.tsx'))
  && /export function MessageCustomersPanel/.test(read('src/components/announcements/MessageCustomersScreen.tsx')) && /MessageCustomersScreen/.test(read('app/snow/owner/message-customers.tsx')));
check('11 workers\' announcements never show customer messages', /startsWith\('customers_'\)/.test(read('src/hooks/useAnnouncements.ts')));
const sql = read('supabase/updates/055_customer_announcements.sql');
check('12 the database: owner/admin only, only people with an account, one notification each, customers cannot read the list',
  /Only the owner or an admin can message customers/.test(sql) && /pe\.user_id is not null/.test(sql) && /'announcement_posted'/.test(sql) && fs.existsSync(path.join(__dirname, '../../supabase/tests/055_customer_announcements.pglite.mjs')));
console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
