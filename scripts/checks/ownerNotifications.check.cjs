// Run: node scripts/checks/ownerNotifications.check.cjs <path to typescript package>
// Owner notifications: tap targets, wording, Clear All vs Read All, unread badge wiring, push-only preference.
const ts = require(process.argv[2] || 'typescript'); const fs = require('fs'); const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const m = { exports: {} }; new Function('module', 'exports', ts.transpileModule(read('src/lib/notificationTarget.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const t = m.exports;
let bad = 0; const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : ' — ' + d}`); };

check('1 a customer message opens that project\'s Messages thread, not the Overview', t.ownerNotificationTarget({ eventType: 'customer_message', linkedEntityType: 'project', linkedEntityId: 'p1' }) === '/(owner)/projects/p1?section=messages');
check('2 other project notifications still open the project; requests open Requests', t.ownerNotificationTarget({ eventType: 'schedule_changed', linkedEntityType: 'project', linkedEntityId: 'p1' }) === '/(owner)/projects/p1' && t.ownerNotificationTarget({ eventType: 'customer_request_submitted', linkedEntityType: 'project', linkedEntityId: 'p1' }).endsWith('section=requests'));
check('3 documents and issues keep their routes', t.ownerNotificationTarget({ linkedEntityType: 'invoice', linkedEntityId: 'i1' }).pathname === '/(owner)/document' && t.ownerNotificationTarget({ linkedEntityType: 'issue', linkedEntityId: 'x' }).pathname === '/(owner)/issue-detail');
check('4 no conversation id: no target (never an unrelated screen)', t.ownerNotificationTarget({ eventType: 'customer_message', linkedEntityType: 'project', linkedEntityId: null }) === null && t.ownerNotificationTarget({ eventType: 'customer_message' }) === null);
check('5 wording names the customer and project', t.customerMessageTitle('Eli Semah') === 'New message from Eli Semah' && t.customerMessageTitle(' ') === 'New message from a customer' && t.customerMessageBody('Wyndham 2', 'Hi') === 'Wyndham 2: Hi' && t.customerMessageBody(undefined, 'x'.repeat(200)).length === 118);

const center = read('app/(owner)/notification-center.tsx'), ops = read('src/hooks/useOperations.ts'), push = read('src/hooks/usePushNotifications.ts');
check('6 Read All and Clear All are separate; Clear All asks first with the agreed wording and only Cancel/Clear All', /onPress=\{markAllRead\}/.test(center) && /onPress=\{confirmClearAll\}/.test(center) && /Clear all notifications\?/.test(center) && /Your messages and project data will not be deleted\./.test(center) && /text: 'Cancel', style: 'cancel'/.test(center) && /text: 'Clear All', style: 'destructive', onPress: clearAll/.test(center));
check('7 clearAll removes only notification records; markAllRead only flips them to read', /deleteRow\('app_notifications', n\.id\)/.test(ops) && !/deleteRow\('(project_messages|projects)'/.test(ops) && /status: 'read', readAt: now/.test(ops));
check('8 tapping marks only that notification read, then goes to the shared target', /if \(isUnread\) markRead\(n\.id\)/.test(center) && /ownerNotificationTarget\(n\)/.test(center));
check('9 push taps use the same target (foreground, background, cold start via the last-response hook)', /ownerNotificationTarget\(\{ eventType: d\.eventType/.test(push) && /useLastNotificationResponse/.test(push) && /status === 'unread'/.test(push));
const dash = read('app/(owner)/(tabs)/index.tsx'), layout = read('app/(owner)/(tabs)/_layout.tsx'), badge = read('src/components/ui/UnreadBadge.tsx');
check('10 the unread count shows only on the bells (dashboard and notifications screen), never on the tab bar', /<UnreadBadge \/>/.test(dash) && /badge=\{unreadCount\}/.test(read('app/(owner)/(tabs)/more/notifications.tsx')) && !/Trigger\.Badge|tabBarBadge|badgeText/.test(layout));
check('11 no badge at zero', /if \(n <= 0\) return null;/.test(badge));
const prefs = read('src/data/pushPrefs.ts'), row = read('src/components/settings/CustomerMessagePushRow.tsx'), fn = read('supabase/functions/send-notification/index.ts');
check('12 push preference defaults on and lives in the owner\'s own preference row', /\?\? true/.test(prefs) && /personId: db\.personId, eventType: CUSTOMER_MESSAGE_PUSH/.test(prefs));
check('13 settings row: exact label and description, phone-permission note with a way to open settings, no auto re-prompt', /Customer Message Notifications/.test(row) && /Receive push notifications when customers send you messages\./.test(row) && /Linking\.openSettings/.test(row) && !/requestPermissionsAsync/.test(row));
check('14 the send function skips customer-message pushes when the owner turned them off, and nothing else', /customer_message_push/.test(fn) && /pref\.enabled === false/.test(fn));
check('15 the in-app notification is created whatever the push setting says', !/customerMessagePushEnabled/.test(read('src/data/actions.ts')) && !/customerMessagePushEnabled/.test(read('src/hooks/useProjectMessages.ts')));
console.log(bad ? `\n${bad} failed` : '\nall passed'); process.exit(bad ? 1 : 0);
