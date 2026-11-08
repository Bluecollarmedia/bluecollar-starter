// Run: node scripts/checks/signupNoEmailMatch.check.cjs
// R5: a new login is connected to an owner-made record ONLY through an invite link, never by a matching email address
// (email confirmation can be off, so anyone could sign up with a worker's or customer's email and take over the record).
// The database is schema.sql plus every numbered update in file order; the LAST definition of a function is the one that counts.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
let bad = 0;
let n = 0;
const check = (name, ok, detail = '') => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}${ok ? '' : '  - ' + detail}`); };

// Same order the database is built in (supabase/tests/helpers/fullSchema.mjs): schema.sql, then the numbered updates sorted by name.
const files = ['supabase/schema.sql', ...fs.readdirSync(path.join(root, 'supabase/updates'))
  .filter((f) => /^\d+.*\.sql$/.test(f) && !f.startsWith('reset')).sort().map((f) => `supabase/updates/${f}`)];

/** Every `create [or replace] function public.<name>(` in file order, with its body (between the first pair of $$). */
function definitions(name) {
  const out = [];
  const re = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`, 'gi');
  for (const f of files) {
    const sql = read(f);
    let m;
    while ((m = re.exec(sql))) {
      const a = sql.indexOf('$$', m.index);
      const b = sql.indexOf('$$', a + 2);
      out.push({ file: f, body: sql.slice(a + 2, b) });
    }
  }
  return out;
}
const squash = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
/** The text of every WHERE clause (up to the end of the statement or a RETURNING). */
const wheres = (body) => [...squash(body).matchAll(/\bwhere\b(.*?)(?:\breturning\b|;)/gi)].map((m) => m[1]);

const hnu = definitions('handle_new_user');
const last = hnu[hnu.length - 1];
check('handle_new_user is defined (schema.sql and later updates)', hnu.length >= 2, String(hnu.length));
check('the LAST handle_new_user (the one the database keeps) is the security update 200', last && last.file.endsWith('200_security_fixes.sql'), last && last.file);
const v078 = hnu.find((d) => d.file.includes('/078_'));
check('update 200 re-creates handle_new_user exactly as update 078 made it (the invite-only version)', v078 && last && squash(v078.body) === squash(last.body));
check('no update between 078 and 200 changed handle_new_user', hnu.filter((d) => /\/(\d+)_/.test(d.file) && Number(d.file.match(/\/(\d+)_/)[1]) > 78 && !d.file.endsWith('200_security_fixes.sql')).length === 0);
check('the final handle_new_user links a login only through the invite link (invite_token + its hash)', last && /invite_token/.test(last.body) && /_invite_hash\(/.test(last.body));
check('the final handle_new_user never MATCHES anybody by email (no WHERE clause mentions email)', last && wheres(last.body).every((w) => !/email/i.test(w)), last && JSON.stringify(wheres(last.body)));
check('the final handle_new_user never looks people up (no select from people) and has no old code paths (team / project codes, email invitations)', last && !/from\s+public\.people/i.test(last.body) && !/team_code|project_code|_request_join|_claim_project|_accept_invitations/i.test(last.body));
check('the old email-matching version is still recognised as bad by this check (schema.sql\'s first version fails the rule)', hnu[0] && wheres(hnu[0].body).some((w) => /email/i.test(w)));

const acc = definitions('_accept_invitations');
const accLast = acc[acc.length - 1];
check('the old "accept invitations sent to my email" helper (still called by get_my_context) does nothing any more', accLast && accLast.file.endsWith('200_security_fixes.sql') && !/email|company_invitations|insert|update/i.test(squash(accLast.body).replace(/never by matching an email address/i, '')), accLast && accLast.file);
check('and nobody can call that helper directly', /revoke all on function public\._accept_invitations\(uuid\) from public, anon, authenticated/.test(read('supabase/updates/200_security_fixes.sql')));
check('the sign-up trigger runs handle_new_user', /create trigger on_auth_user_created\s+after insert on auth\.users\s+for each row execute function public\.handle_new_user\(\)/.test(read('supabase/schema.sql')));

console.log(bad ? `\n${bad} of ${n} FAILED` : `\nAll ${n} passed`);
process.exit(bad ? 1 : 0);
