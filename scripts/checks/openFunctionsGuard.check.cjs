// Run: node scripts/checks/openFunctionsGuard.check.cjs
// R8: send-notification and notify-request run with the login check OFF (anyone on the internet can call them). They are safe ONLY
// because of their own rules: they take nothing but a row id, act only on a row made in the last 15 minutes, and claim each row once
// before sending. This check fails if any of those rules (or the warning at the top of each file) is removed.
// R21: send-notification emails a quote decision only when the quote really has that status and belongs to the notice's company.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8').replace(/\r\n/g, '\n');
let bad = 0;
let n = 0;
const check = (name, ok, detail = '') => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}${ok ? '' : '  - ' + detail}`); };

const sn = read('supabase/functions/send-notification/index.ts');
const head = (s) => s.slice(0, s.indexOf('*/'));
check('send-notification: warning at the top (login check off on purpose, keep the 15-minute / once-only rules)', /WARNING: the login \(JWT\) check is OFF/.test(head(sn)) && /15 minutes/.test(head(sn)) && /once/.test(head(sn)));
check('send-notification: takes only a notification id (a uuid), nothing else from the caller', /id = \(await req\.json\(\)\)\?\.id;/.test(sn) && /if \(typeof id !== 'string' \|\| !\/\^\[0-9a-f-\]\{36\}\$\/i\.test\(id\)\) return json\(\{ error: 'bad_request' \}, 400\);/.test(sn));
check('send-notification: the 15-minute limit is still 15 minutes', /const MAX_AGE_MS = 15 \* 60 \* 1000;/.test(sn));
check('send-notification: claims the notice once (pushed_at null -> set) and only if it is younger than the limit, BEFORE sending',
  /\.update\(\{ pushed_at: new Date\(\)\.toISOString\(\) \}\)\s*\.eq\('id', id\)\s*\.is\('pushed_at', null\)\s*\.gt\('created_at', new Date\(Date\.now\(\) - MAX_AGE_MS\)\.toISOString\(\)\)/.test(sn) &&
  /if \(!n\) return json\(\{ skipped: true \}\);/.test(sn) && sn.indexOf(".is('pushed_at', null)") < sn.indexOf('sendPush(db, n)'));
check('send-notification: the quote email goes out only when the document belongs to the notice\'s company AND really is approved / declined',
  /if \(!doc \|\| doc\.company_id !== n\.company_id \|\| doc\.status !== wanted\) return/.test(sn) &&
  /const wanted = n\.event_type === 'quote_approved' \? 'approved' : 'declined';/.test(sn) &&
  /\.select\('company_id, status, number, total, share_token/.test(sn) && /select\('id, company_id, recipient_id, event_type/.test(sn));

const nr = read('supabase/functions/notify-request/index.ts');
check('notify-request: warning at the top (login check off on purpose, keep the 15-minute / once-only rules)', /WARNING: the login \(JWT\) check is OFF/.test(head(nr)) && /15 minutes/.test(head(nr)) && /once/.test(head(nr)));
check('notify-request: takes only a request id (a uuid)', /const id = typeof body\.id === 'string' && \/\^\[0-9a-f-\]\{36\}\$\/i\.test\(body\.id\) \? body\.id : null;/.test(nr));
check('notify-request: the 15-minute limit is still 15 minutes', /const FRESH_MS = 15 \* 60 \* 1000;/.test(nr));
check('notify-request: unknown, already emailed or old requests are skipped', /if \(!r \|\| r\.emailed_at \|\| Date\.now\(\) - new Date\(r\.created_at\)\.getTime\(\) > FRESH_MS\) return reply\(\{ ok: true, sent: 0 \}\);/.test(nr));
check('notify-request: claims the request once (emailed_at null -> set) before emailing',
  /\.update\(\{ emailed_at: new Date\(\)\.toISOString\(\) \}\)\.eq\('id', id\)\.is\('emailed_at', null\)/.test(nr) &&
  /if \(!claimed \|\| claimed\.length === 0\) return reply\(\{ ok: true, sent: 0 \}\);/.test(nr) &&
  nr.indexOf(".is('emailed_at', null)") < nr.indexOf('api.resend.com'));

console.log(bad ? `\n${bad} of ${n} FAILED` : `\nAll ${n} passed`);
process.exit(bad ? 1 : 0);
