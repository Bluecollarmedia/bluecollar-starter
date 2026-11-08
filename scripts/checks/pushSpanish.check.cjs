// Run: node scripts/checks/pushSpanish.check.cjs
// A person in Español gets the server's push notices in Spanish (the language is saved on the account, update 95); texts not listed go as written.
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(read('supabase/functions/_shared/pushSpanish.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const { spanishPush } = m.exports;
let r = spanishPush('Please confirm your schedule', 'Vineyard project today, full day. Open the app to confirm.');
check('1 the Remind notice is Spanish', r.title === 'Confirma tu horario' && r.body === 'Vineyard project today, full day. Open the app to confirm.'.replace(/^(.+) today, full day\. Open the app to confirm\.$/, '$1 today, todo el día. Abre la app para confirmar.'), JSON.stringify(r));
r = spanishPush('Storm dispatched: Oct 21 Plowing', 'You lead North · 3 stops. Open My Route.');
check('2 a storm dispatch notice is Spanish', r.title === 'Tormenta enviada: Oct 21 Plowing' && r.body === 'Diriges North · 3 paradas. Abre Mi ruta.', JSON.stringify(r));
r = spanishPush('Our crew has arrived', 'Snow removal at 12 Elm St');
check('3 a customer notice is Spanish', r.title === 'Nuestro equipo ya llegó', JSON.stringify(r));
r = spanishPush('Some title nobody listed', 'Some body');
check('4 anything not listed goes as written (never blocked)', r.title === 'Some title nobody listed' && r.body === 'Some body');
for (const f of ['supabase/functions/send-notification/index.ts', 'supabase/functions/send-snow-notification/index.ts']) {
  const s = read(f);
  check(`5 ${f.split('/')[2]} looks up the person's language and translates for Español`, /language === 'es' \? spanishPush\(/.test(s) && /function spanishPush/.test(s));
}
check('6 the phone saves the language on the account when it changes and when the app opens signed in', /set_my_language/.test(read('src/i18n/index.ts')) && /syncLanguageToAccount\(\)/.test(read('app/_layout.tsx')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
