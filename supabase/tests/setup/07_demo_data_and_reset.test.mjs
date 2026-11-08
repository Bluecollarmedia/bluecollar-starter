// demo_data.sql (the fake Demo Company) and admin_reset_all_data.sql.
import { freshDb, demoSql, read, TEST_DEMO_PASSWORD } from '../helpers/setupDb.mjs';

export default async function run({ check }) {
  const raw = read('supabase/demo_data.sql');
  check('1 demo_data.sql ships with the CHANGE-ME placeholder, uses only @example.com addresses and never names Brighton',
    /^ {2}demo_password text := 'CHANGE-ME';/m.test(raw) && !/brighton/i.test(raw)
    && [...raw.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)].every((m) => m[0].endsWith('@example.com')));

  const h = await freshDb();
  const { db, one, all, as, signUp } = h;
  let refused = '';
  try { await db.exec(raw); } catch (e) { refused = e.message; }
  check('2 with the password still CHANGE-ME it refuses and changes nothing', /Change demo_password/.test(refused)
    && (await one(`select count(*)::int n from auth.users`)).n === 0 && (await one(`select count(*)::int n from public.companies`)).n === 0, refused);

  let loaded = ''; try { await db.exec(demoSql()); } catch (e) { loaded = e.message; }
  check('3 with a password it runs on a database made by setup.sql', loaded === '', loaded);
  const users = await all(`select email, encrypted_password, email_confirmed_at from auth.users order by email`);
  check('4 eight demo logins, all confirmed, all @example.com', users.length === 8 && users.every((u) => u.email.endsWith('@example.com') && u.email_confirmed_at));
  const pw = await one(`select bool_and(encrypted_password like '$2%' and extensions.crypt($1, encrypted_password) = encrypted_password) ok from auth.users`, [TEST_DEMO_PASSWORD]);
  check('5 each password is stored as a bcrypt hash of the one demo password (the password itself is not stored)', pw.ok === true);
  check('6 each login has its email identity row (needed for email sign-in)', (await one(`select count(*)::int n from auth.identities where provider = 'email'`)).n === 8);
  const roles = Object.fromEntries((await all(`select role || ':' || status k, count(*)::int n from public.company_members group by 1`)).map((r) => [r.k, r.n]));
  check('7 one "Demo Company" with an owner, an admin, 3 active workers + 1 invited, and 3 customers',
    (await one(`select count(*)::int n from public.companies where name = 'Demo Company'`)).n === 1 && (await one(`select count(*)::int n from public.companies`)).n === 1
    && roles['owner:active'] === 1 && roles['admin:active'] === 1 && roles['worker:active'] === 3 && roles['worker:invited'] === 1 && roles['customer:active'] === 3, JSON.stringify(roles));
  const c = await one(`select (select count(*)::int from public.properties) sites, (select count(*)::int from public.projects) jobs, (select count(distinct status)::int from public.projects) states,
      (select count(*)::int from public.project_tasks) tasks, (select count(*)::int from public.crews) crews, (select count(*)::int from public.trucks) trucks,
      (select count(*)::int from public.project_materials) materials, (select count(*)::int from public.quotes) quotes, (select count(*)::int from public.invoices) invoices,
      (select count(*)::int from public.time_workdays where work_date >= current_date - 7) workdays, (select count(*)::int from public.time_intervals) intervals,
      (select count(*)::int from public.announcements) announcements, (select count(*)::int from public.project_messages) messages,
      (select count(*)::int from public.assignments where scheduled_date >= current_date) upcoming`);
  check('8 job sites, jobs in several states with tasks, crews, trucks, materials, quotes, an invoice, a week of time, announcements and messages',
    c.sites === 5 && c.jobs === 7 && c.states >= 4 && c.tasks >= 10 && c.crews === 2 && c.trucks === 2 && c.materials >= 2 && c.quotes === 2 && c.invoices === 1
    && c.workdays >= 9 && c.intervals === c.workdays && c.announcements === 2 && c.messages >= 2 && c.upcoming >= 3, JSON.stringify(c));
  const uid = async (email) => (await one(`select id from auth.users where email = $1`, [email])).id;
  const w1 = await uid('demo-worker1@example.com');
  const c1 = await uid('demo-customer1@example.com');
  check('9 the demo logins work with the security rules: a worker sees the jobs, a customer only their own',
    (await as(w1, `select count(*)::int n from public.projects`)).v === 7 && (await as(c1, `select count(*)::int n from public.projects`)).v === 3);
  const day = await as(await uid('demo-owner@example.com'), `select public.time_review_list() x`);
  check('10 the owner\'s Hours & Labor review opens with the demo time', day.ok, day.msg);

  let rerun = ''; try { await db.exec(demoSql()); } catch (e) { rerun = e.message; }
  check('11 running it again replaces the old Demo Company (still one company, eight logins)', rerun === ''
    && (await one(`select count(*)::int n from public.companies`)).n === 1 && (await one(`select count(*)::int n from auth.users`)).n === 8, rerun);

  // The "remove demo logins" snippet from the header.
  const snippet = (raw.match(/^-- {3}-- (delete from auth\.users where email in \([^;]+\);)$/m) || [])[1];
  await db.exec(snippet);
  check('12 the header\'s "remove demo logins" line removes every demo login (the records stay, without a login)', !!snippet
    && (await one(`select count(*)::int n from auth.users`)).n === 0 && (await one(`select count(*)::int n from public.people where user_id is null`)).n >= 9);

  // admin_reset_all_data.sql
  let reset = ''; try { await db.exec(read('supabase/admin_reset_all_data.sql')); } catch (e) { reset = e.message; }
  check('13 admin_reset_all_data.sql empties the company, every person and every login, and keeps functions_url', reset === ''
    && (await one(`select count(*)::int n from public.companies`)).n === 0 && (await one(`select count(*)::int n from public.people`)).n === 0
    && (await one(`select count(*)::int n from public.projects`)).n === 0 && (await one(`select count(*)::int n from public.time_workdays`)).n === 0
    && (await one(`select count(*)::int n from public.app_settings where key = 'functions_url'`)).n === 1, reset);
  const fresh = await signUp('new-owner@example.com', { first_name: 'New', last_name: 'Owner', company_name: 'After Reset Co' });
  check('14 after a reset, Create a Company works again', (await one(`select count(*)::int n from public.company_members where person_id = $1 and role = 'owner'`, [fresh.pid])).n === 1);
  let other = ''; try { await db.exec(demoSql()); } catch (e) { other = e.message; }
  check('15 demo_data.sql refuses to run on a database that already has a real company (one company per database)', /already has a real company/.test(other)
    && (await one(`select count(*)::int n from public.companies`)).n === 1, other);
  check('16 setup.sql never contains the reset (it is a separate admin script)', !/truncate table public\.companies/i.test(read('supabase/setup.sql')));
}
