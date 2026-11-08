// Run: node scripts/checks/pushSpanish.check.cjs
// A person in Español gets the server's push notices in Spanish (the language is saved on the account, people.language in setup.sql). Only known system
// notices are translated, by event type and exact wording; text people typed (announcements, chat and customer messages) is never changed.
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };
const shared = read('supabase/functions/_shared/pushSpanish.ts');
const fn = read('supabase/functions/send-notification/index.ts');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(shared, { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const { spanishPush } = m.exports;

let r = spanishPush('schedule_reminder', 'Please confirm your schedule', 'Vineyard project today, full day. Open the app to confirm.');
check('1 the Remind notice is Spanish', r.title === 'Confirma tu horario' && r.body === 'Vineyard project today, todo el día. Abre la app para confirmar.', JSON.stringify(r));
r = spanishPush('time_progress_check', 'Check your progress', 'Take a moment to check how the work at 12 Elm St is going.');
check('2 the progress nudge is Spanish', r.title === 'Revisa tu avance' && r.body === 'Tómate un momento para ver cómo va el trabajo en 12 Elm St.', JSON.stringify(r));
r = spanishPush('announcement_posted', 'Crew meeting at the shop', 'Task completed');
check('3 an owner announcement goes exactly as typed (no "at" -> "en", no "completed" -> "completado")', r.title === 'Crew meeting at the shop' && r.body === 'Task completed', JSON.stringify(r));
r = spanishPush('customer_message', 'Please confirm your schedule', 'Check your progress');
check('4 a customer/chat message goes exactly as typed, even when it happens to match a system wording', r.title === 'Please confirm your schedule' && r.body === 'Check your progress', JSON.stringify(r));
r = spanishPush('schedule_reminder', 'Some title nobody listed', 'Some body');
check('5 anything not listed goes as written (never blocked)', r.title === 'Some title nobody listed' && r.body === 'Some body');
r = spanishPush(undefined, 'Check your progress', '');
check('6 no event type, no translation', r.title === 'Check your progress');
check('7 an odd event type name never breaks it', spanishPush('constructor', 'x', 'y').title === 'x' && spanishPush('__proto__', 'x', 'y').title === 'x');

const rulesOf = (s) => { const a = s.indexOf('const RULES'); const b = s.indexOf('return { title: tr(title)', a); return s.slice(a, b).replace(/\r\n/g, '\n').replace('export function', 'function'); };
check('8 the hand copy in send-notification has exactly the same rules as _shared/pushSpanish.ts', rulesOf(shared) === rulesOf(fn) && rulesOf(fn).length > 100);
const catchAll = /\[\/\^\(\.\+\) completed\$\/|\[\/\^\(\.\+\) at \(\.\+\)\$\/|completado'|'\$1 en \$2'/;
check('9 the old catch-all rules ("(.+) completed", "(.+) at (.+)") are gone from both copies', !catchAll.test(shared) && !catchAll.test(fn));
check('10 every rule is anchored to the whole text (^...$)', (rulesOf(shared).match(/\[\/[^\n]*?\/, '/g) || []).every((x) => x.startsWith('[/^') && /\$\/, '$/.test(x)));
check('11 send-notification looks up the person\'s language and translates by event type', /language === 'es' \? spanishPush\(n\.event_type, /.test(fn) && /function spanishPush\(eventType/.test(fn));
check('12 the phone saves the language on the account when it changes and when the app opens signed in', /set_my_language/.test(read('src/i18n/index.ts')) && /syncLanguageToAccount\(\)/.test(read('app/_layout.tsx')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
