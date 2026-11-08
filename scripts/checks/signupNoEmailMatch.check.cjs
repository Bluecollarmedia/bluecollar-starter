// Run: node scripts/checks/signupNoEmailMatch.check.cjs
// R5: a new login is connected to an owner-made record ONLY through an invite link, never by a matching email address
// (email confirmation can be off, so anyone could sign up with a worker's or customer's email and take over the record).
// The database is supabase/setup.sql: it must define each of these functions exactly once (that definition is the one that counts).
const sql = require('./_sql.cjs');
let bad = 0;
let n = 0;
const check = (name, ok, detail = '') => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}${ok ? '' : '  - ' + detail}`); };

/** Every `create or replace function public.<name>(` in setup.sql, with its body (between the $function$ markers). */
const definitions = (name) => [...sql.setup.replace(/\r\n/g, '\n').matchAll(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\([\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$`, 'gi'))].map((m) => ({ body: m[1] }));
const squash = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
/** The text of every WHERE clause (up to the end of the statement or a RETURNING). */
const wheres = (body) => [...squash(body).matchAll(/\bwhere\b(.*?)(?:\breturning\b|;)/gi)].map((m) => m[1]);

const hnu = definitions('handle_new_user');
const last = hnu[0];
check('handle_new_user is defined exactly once in setup.sql', hnu.length === 1, String(hnu.length));
check('handle_new_user links a login only through the invite link (invite_token + its hash)', last && /invite_token/.test(last.body) && /_invite_hash\(/.test(last.body));
check('handle_new_user never MATCHES anybody by email (no WHERE clause mentions email)', last && wheres(last.body).every((w) => !/email/i.test(w)), last && JSON.stringify(wheres(last.body)));
check('handle_new_user never looks people up (no select from people) and has no old code paths (team / project codes, email invitations)', last && !/from\s+public\.people/i.test(last.body) && !/team_code|project_code|_request_join|_claim_project|_accept_invitations/i.test(last.body));
// The original app's first version linked a login like this; the rule above must still catch it.
const oldEmailMatch = `begin update public.people set user_id = new.id where lower(email) = lower(new.email) and user_id is null returning id into pid; end;`;
check('the old email-matching version is still recognised as bad by this check', wheres(oldEmailMatch).some((w) => /email/i.test(w)));

const acc = definitions('_accept_invitations');
check('the old "accept invitations sent to my email" helper (still called by get_my_context) is defined once and does nothing', acc.length === 1 && !/email|company_invitations|insert|update/i.test(squash(acc[0].body).replace(/never by matching an email address/i, '')), String(acc.length));
check('and nobody signed in or signed out can call that helper directly',
  /^revoke all on function public\._accept_invitations\([^)]*\) from public, anon, authenticated\b/m.test(sql.grants('_accept_invitations'))
  && sql.grantedTo('_accept_invitations').every((r) => r === 'service_role'), sql.grants('_accept_invitations'));
check('the sign-up trigger runs handle_new_user', /create trigger on_auth_user_created\s+after insert on auth\.users\s+for each row execute function public\.handle_new_user\(\)/i.test(sql.setup));

console.log(bad ? `\n${bad} of ${n} FAILED` : `\nAll ${n} passed`);
process.exit(bad ? 1 : 0);
