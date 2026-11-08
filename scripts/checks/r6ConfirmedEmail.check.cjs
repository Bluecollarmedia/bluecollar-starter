// Run: node scripts/checks/r6ConfirmedEmail.check.cjs
// R6: when the owner adds a customer by email, an existing login is linked ONLY if that login's email is CONFIRMED. Otherwise the
// customer record is made unlinked and that same login is linked automatically when it confirms that same email.
// Invite links stay the main way to join. This protection needs Supabase "Confirm email" ON (CLAUDE.md rule 20).
// The behaviour itself is tested in supabase/tests/setup/13_leftovers.test.mjs (npm run test:db).
const fs = require('fs');
const path = require('path');
const sql = require('./_sql.cjs');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };

const add = sql.fn('add_customer');
const link = sql.fn('_link_customer_on_email_confirm');
check('1 add_customer looks a login up by its auth email and links it only when email_confirmed_at is set',
  /join auth\.users u on u\.id = p\.user_id/.test(add) && /where lower\(u\.email\) = mail/.test(add) && /\(u\.email_confirmed_at is not null\) as confirmed/.test(add) && /if found and acct\.confirmed then/.test(add));
check('2 an unconfirmed login is NOT linked: a separate unlinked record is made and noted in customer_email_links (outcome "waiting_for_email_confirmation")',
  /insert into public\.customer_email_links/.test(add) && /'waiting_for_email_confirmation'/.test(add));
check('3 the waiting list is private (row rules on, no app access)', /create table if not exists public\.customer_email_links/.test(sql.setup)
  && /alter table public\.customer_email_links enable row level security;/.test(sql.setup) && /revoke all on table public\.customer_email_links from anon, authenticated;/.test(sql.setup)
  && sql.policies('customer_email_links') === '');
check('4 a trigger links that SAME login when it confirms that SAME email (never on sign-up itself)',
  /create trigger on_auth_email_confirmed AFTER UPDATE OF email_confirmed_at ON auth\.users FOR EACH ROW EXECUTE FUNCTION public\._link_customer_on_email_confirm\(\);/.test(sql.setup)
  && /new\.email_confirmed_at is null or old\.email_confirmed_at is not null/.test(link) && /where k\.user_id = new\.id and lower\(k\.email\) = lower\(coalesce\(new\.email, ''\)\)/.test(link));
check('5 ...with the same company rules as add_customer: only a still-unlinked, still-invited record; never someone on the team or whose access was turned off; it never blocks the confirmation',
  /p\.user_id is null/.test(link) && /cm\.status = 'invited'/.test(link) && /m\.role <> 'customer' or m\.status = 'inactive'/.test(link) && /_merge_placeholder_customer\(l\.company_id, l\.person_id, me\)/.test(link) && /exception when others then/.test(link) && /security definer/.test(link));
check('6 nobody can call the trigger function directly', sql.grantedTo('_link_customer_on_email_confirm').every((r) => r === 'service_role'), sql.grants('_link_customer_on_email_confirm'));
check('7 sign-up itself still never matches by email (handle_new_user unchanged: invite link only)', !/email_confirmed_at|customer_email_links/.test(sql.fn('handle_new_user')));
const rules = read('CLAUDE.md');
check('8 the rulebook says the protection depends on Supabase "Confirm email" being ON (R6)', /Confirm email[^\n]*\n?[^\n]*R6/.test(rules) && /CONFIRMED/.test(rules));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
