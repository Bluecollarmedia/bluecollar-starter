// Run: node scripts/checks/remindWorker.check.cjs
// "Remind" on the dashboard sends the worker a push notification and stays on the dashboard. It never says "sent" unless something went out.
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };
const m = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(read('src/lib/remindMessage.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports, () => ({}));
const { remindMessage } = m.exports;
check('1 sent to a phone: "Reminder sent"', remindMessage({ sent: true, devices: 1 }, 'Yosef').text === 'Reminder sent to Yosef.');
check('2 saved but no phone set up for push: says so, never "sent"', /no push went out/.test(remindMessage({ sent: true, devices: 0 }, 'Yosef').text) && !/^Reminder sent/.test(remindMessage({ sent: true, devices: 0 }, 'Yosef').text));
check('3 within the hour: says when to try again', /in 25 minutes/.test(remindMessage({ sent: false, reason: 'recent', minutes_left: 25 }, 'Yosef').text));
check('4 a worker who never joined: tells the owner to send the invite', /not joined the app/.test(remindMessage({ sent: false, reason: 'no_login' }, 'Yosef').text) && /invite link/.test(remindMessage({ sent: false, reason: 'no_login' }, 'Yosef').text));
check('5 already confirmed / finished are explained', /already confirmed/.test(remindMessage({ sent: false, reason: 'confirmed' }, 'Yosef').text) && /already finished/.test(remindMessage({ sent: false, reason: 'done' }, 'Yosef').text));
const hook = read('src/hooks/useOwnerDashboard.ts');
const home = read('app/(owner)/(tabs)/index.tsx');
check('6 the "hasn\'t confirmed" item carries the job to remind about', /remind: \{ assignmentId: unconfirmed\.id/.test(hook));
check('7 the button reminds instead of opening the worker page', /item\.remind \|\| item\.confirmOwn \? sendRemind\(item\) : router\.push\(item\.route as any\)/.test(home) && /remindWorker\(item\.remind\.assignmentId/.test(home));
check('8 it shows Sending… then Sent and cannot be double-tapped', /reminding === item\.id \? 'Sending…'/.test(home) && /disabled=\{reminding === item\.id\}/.test(home) && /reminded\[item\.id\] \? 'Sent'/.test(home));
check('9 the database function is called with the job id', /rpc<RemindResult>\('remind_worker_assignment', \{ p_assignment: assignmentId \}\)/.test(read('src/data/remindWorker.ts')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
