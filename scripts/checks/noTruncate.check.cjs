// Run: node scripts/checks/noTruncate.check.cjs
// The app roles (anon = signed out, authenticated = signed in) never get TRUNCATE (it empties a table and skips the row rules), nor
// REFERENCES / TRIGGER (the app uses neither). setup.sql takes them back on every public table and for tables made later.
// Tested for real in supabase/tests/setup/13_leftovers.test.mjs (permission denied on TRUNCATE for every table).
const sql = require('./_sql.cjs');
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };
const grantLines = (sql.setup.match(/^grant [^\n]* on table [^\n]*$/gim) || []);
const wide = grantLines.filter((l) => /\b(truncate|references|trigger|all)\b/i.test(l.replace(/ on table .*/i, '')) && /\b(anon|authenticated)\b/.test(l));
check('1 no explicit table grant gives the app roles TRUNCATE, REFERENCES, TRIGGER or ALL', wide.length === 0, wide.join(' | '));
check('2 TRUNCATE, REFERENCES and TRIGGER are taken back from the app roles on EVERY public table',
  /execute format\('revoke truncate, references, trigger on table public\.%I from public, anon, authenticated', t\)/.test(sql.setup));
check('3 ...and for tables made later (default privileges)', /alter default privileges in schema public revoke truncate, references, trigger on tables from public, anon, authenticated;/.test(sql.setup));
const at = sql.setup.indexOf('revoke truncate, references, trigger on table');
check('4 the take-back runs after every table exists and after the explicit grants (end of PART 7)', at > sql.setup.lastIndexOf('create table if not exists public.') && at > sql.setup.lastIndexOf('grant select on table') && at < sql.setup.indexOf('PART 8.'));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
