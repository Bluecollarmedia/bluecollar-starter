// Run: node scripts/checks/functionsConfig.check.cjs
// R16: every Edge Function is deployed from the repo with the right login (JWT) check, written down in supabase/config.toml.
// A plain `supabase functions deploy` turns the check ON, which would silently stop pushes, request emails, invite sign-ups and the
// public weather. Exactly these four must be OFF; every other function must be ON.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
let bad = 0;
let n = 0;
const check = (name, ok, detail = '') => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}${ok ? '' : '  - ' + detail}`); };

const OPEN = ['invite-signup', 'notify-request', 'send-notification', 'weather'];
const cfgPath = path.join(root, 'supabase/config.toml');
check('supabase/config.toml exists', fs.existsSync(cfgPath));
const cfg = fs.existsSync(cfgPath) ? read('supabase/config.toml') : '';

// [functions.<name>] blocks and their verify_jwt line.
const settings = {};
for (const m of cfg.matchAll(/^\[functions\.([A-Za-z0-9_-]+)\]\s*\n((?:(?!^\[)[^\n]*\n?)*)/gm)) {
  const v = /^\s*verify_jwt\s*=\s*(true|false)\s*$/m.exec(m[2]);
  settings[m[1]] = v ? v[1] === 'true' : undefined;
}
const fnDir = path.join(root, 'supabase/functions');
const functions = fs.readdirSync(fnDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && fs.existsSync(path.join(fnDir, d.name, 'index.ts')))
  .map((d) => d.name).sort();

check('there are functions to deploy', functions.length > 0);
const missing = functions.filter((f) => !(f in settings) || settings[f] === undefined);
check('every function folder is listed in config.toml with a verify_jwt setting', missing.length === 0, 'missing: ' + missing.join(', '));
const extra = Object.keys(settings).filter((f) => !functions.includes(f));
check('config.toml lists no function that does not exist', extra.length === 0, 'extra: ' + extra.join(', '));
for (const f of OPEN) {
  check(`${f}: login check OFF (it is called without a login)`, functions.includes(f) && settings[f] === false, String(settings[f]));
}
const wrong = functions.filter((f) => !OPEN.includes(f) && settings[f] !== true);
check('every other function has the login check ON', wrong.length === 0, 'not ON: ' + wrong.join(', '));
check('config.toml has a project_id (the Supabase CLI refuses a config without one)', /^project_id\s*=\s*"[^"]+"/m.test(cfg));

// The invite sign-up never dead-ends when the function answers 401 (deployed with the check ON) or 404 (not deployed).
const inv = read('src/lib/inviteSignup.ts');
check('the app treats a 401 from invite-signup like a 404 (falls back to the normal sign-up)', /res\.status === 404 \|\| res\.status === 401\) return 'unavailable'/.test(inv));
const invFn = read('supabase/functions/invite-signup/index.ts');
check('invite-signup\'s deploy note says the login check must be OFF (not the old "keep it ON")', /must be OFF/.test(invFn) && !/keep "Enforce JWT verification" ON/.test(invFn));

console.log(bad ? `\n${bad} of ${n} FAILED` : `\nAll ${n} passed`);
process.exit(bad ? 1 : 0);
