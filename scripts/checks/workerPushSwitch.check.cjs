// Run: node scripts/checks/workerPushSwitch.check.cjs
// The worker's own "Push Notifications" switch is stored in the database (worker_settings.notifications_enabled, each person's own
// row) and the SERVER respects it: no phone push to someone who turned it off. The in-app notice is still made.
// Tested for real in supabase/tests/setup/13_leftovers.test.mjs.
const fs = require('fs');
const path = require('path');
const sql = require('./_sql.cjs');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };

check('1 the switch is a database column with "on" as the default', /notifications_enabled boolean default true not null/.test(sql.table('worker_settings')));
check('2 a person can read and change ONLY their own switch (row rule on person_id = my_person_id, for reading and writing)',
  /worker_settings_own on public\.worker_settings for all to public\s+using \(\(person_id = public\.my_person_id\(\)\)\)\s+with check \(\(person_id = public\.my_person_id\(\)\)\)/.test(sql.policies('worker_settings')));
const trig = sql.fn('push_app_notification');
check('3 the push trigger skips the phone push for someone who switched it off (no row = on), and still lets emailed events through',
  /select s\.notifications_enabled from public\.worker_settings s where s\.person_id = new\.recipient_id/.test(trig) && /not push_on or not exists/.test(trig) && /new\.event_type not in \('quote_approved','quote_declined'\)/.test(trig));
check('4 the trigger never stops the notice itself (it is an AFTER INSERT trigger that only decides about the phone push)',
  /create trigger app_notifications_push AFTER INSERT ON public\.app_notifications/.test(sql.setup) && /return new;/.test(trig));
const fn = read('supabase/functions/send-notification/index.ts');
check('5 send-notification checks the same switch before pushing (second guard), and still sends the owner email',
  /from\('worker_settings'\)\.select\('notifications_enabled'\)\.eq\('person_id', n\.recipient_id\)/.test(fn) && /notifications_enabled === false\) return 'push notifications are turned off by the recipient'/.test(fn)
  && fn.indexOf("from('worker_settings')") < fn.indexOf("from('push_tokens')") && /EMAIL_EVENTS\.has\(n\.event_type\) \? sendEmail/.test(fn));
const app = read('src/providers/WorkerProvider.tsx');
const store = read('src/data/store.ts');
check('6 the app saves the switch to the database (worker_settings row) and loads it back', /upsertRow\('worker_settings', \{ personId: workerId, navApp: db\.workerSettings\.navApp, notificationsEnabled: enabled \}\)/.test(app)
  && /worker_settings: \{ scope: 'me', pk: 'personId', cols: \['personId', 'navApp', 'notificationsEnabled', 'updatedAt'\] \}/.test(store));
const screen = read('app/(worker)/notifications.tsx');
const es = read('src/i18n/es.worker.ts');
const footer = (screen.match(/footer=\{t\("([^"]+)"\)\}/) || [])[1] || '';
check('7 the screen says plainly what the switch does now (off = no phone alerts, notices still in the app), with a Spanish translation',
  /Off: no phone alerts are sent to you, but every notice still shows in the app/.test(footer) && !/only saves your choice/.test(screen) && es.includes(JSON.stringify(footer)));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
