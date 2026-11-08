// Leftovers: R6 (Add customer by email links a login only once its email is CONFIRMED), a customer whose access is off reads
// none of their old jobs, no app role may TRUNCATE (or has REFERENCES / TRIGGER rights), and the worker's own Push Notifications
// switch is respected by the push trigger (the in-app notice is still made).
import { freshDb } from '../helpers/setupDb.mjs';

export default async function run({ check }) {
  await r6(check);
  await customerAccessOff(check);
  await noTruncate(check);
  await workerPushSwitch(check);
}

// ════════════════════════ R6: link only a confirmed login ════════════════════════
async function r6(check) {
  const { db, one, as, signUp, ownerWithCompany, member } = await freshDb();
  const A = await ownerWithCompany('owner@example.com', 'Company A');
  const add = (first, email) => as(A.u, `select public.add_customer($1, 'Test', $2, null) x`, [first, email]);
  const memberOf = (pid) => one(`select role, status from public.company_members where company_id = $1 and person_id = $2`, [A.cid, pid]);
  const confirm = (u) => db.query(`update auth.users set email_confirmed_at = now() where id = $1`, [u]);
  const jobsSeen = async (u) => (await as(u, `select count(*)::int n from public.projects`)).v;

  // An unconfirmed login with the same email is NOT linked.
  const una = await signUp('una@example.com', { first_name: 'Una', last_name: 'Confirmed' });
  let r = await add('Una', 'UNA@example.com');
  const rec = r.v?.person_id;
  check('1 R6: a login whose email is NOT confirmed is not linked: the owner gets a separate, unlinked customer record (waiting)',
    r.ok && r.v.outcome === 'waiting_for_email_confirmation' && rec && rec !== una.pid && !(await memberOf(una.pid))
    && (await one(`select user_id from public.people where id = $1`, [rec])).user_id === null && (await memberOf(rec)).status === 'invited', JSON.stringify(r));
  const job = (await one(`insert into public.projects (company_id, customer_id, name, status) values ($1, $2, 'Una job', 'active') returning id`, [A.cid, rec])).id;
  await db.query(`insert into public.project_tasks (company_id, project_id, title, status, sort_order) values ($1, $2, 'Done task', 'completed', 1)`, [A.cid, job]);
  check('2 ...and that unconfirmed login cannot see the customer\'s jobs or tasks', (await jobsSeen(una.u)) === 0
    && (await as(una.u, `select count(*)::int n from public.project_tasks`)).v === 0);
  check('3 the waiting list is private: no signed-in or signed-out person can read it',
    !(await as(una.u, `select count(*) from public.customer_email_links`)).ok && !(await as(null, `select count(*) from public.customer_email_links`)).ok
    && !(await as(A.u, `select count(*) from public.customer_email_links`)).ok);
  r = await add('Una', 'una@example.com');
  check('4 adding the same email again while waiting gives back the same record (no duplicate)', r.ok && r.v.person_id === rec && r.v.outcome === 'already_customer', JSON.stringify(r));

  await confirm(una.u);
  check('5 once that login CONFIRMS its email it is linked: an active customer of this company', (await memberOf(una.pid))?.status === 'active' && (await memberOf(una.pid))?.role === 'customer');
  check('6 ...the job moves to that login, it sees the job and the completed task, and the empty record and the waiting note are gone',
    (await one(`select customer_id from public.projects where id = $1`, [job])).customer_id === una.pid && (await jobsSeen(una.u)) === 1
    && (await as(una.u, `select count(*)::int n from public.project_tasks`)).v === 1
    && (await one(`select count(*)::int n from public.people where id = $1`, [rec])).n === 0
    && (await one(`select count(*)::int n from public.customer_email_links`)).n === 0);
  check('7 the link is written to the team history', (await one(`select count(*)::int n from public.membership_audit_log where event_type = 'customer_linked_email_confirmed' and target_id = $1`, [una.pid])).n === 1);

  // A confirmed login is linked at once.
  const cal = await signUp('cal@example.com', { first_name: 'Cal', last_name: 'Ready' });
  await confirm(cal.u);
  r = await add('Cal', 'cal@example.com');
  const calJob = (await one(`insert into public.projects (company_id, customer_id, name, status) values ($1, $2, 'Cal job', 'active') returning id`, [A.cid, cal.pid])).id;
  check('8 R6: a login whose email IS confirmed is linked at once (the same person, active) and sees the job put on them',
    r.ok && r.v.outcome === 'existing_account' && r.v.person_id === cal.pid && (await memberOf(cal.pid)).status === 'active' && (await jobsSeen(cal.u)) === 1 && !!calJob, JSON.stringify(r));

  // Only that same login, with that same email.
  const mia = await signUp('mia@example.com', { first_name: 'Mia', last_name: 'Changed' });
  const miaRec = (await add('Mia', 'mia@example.com')).v.person_id;
  await db.query(`update auth.users set email = 'someone.else@example.com', email_confirmed_at = now() where id = $1`, [mia.u]);
  check('9 a login that confirms a DIFFERENT email than the one the owner typed is not linked', !(await memberOf(mia.pid)) && (await memberOf(miaRec)).status === 'invited');
  const stranger = await signUp('stranger@example.com', { first_name: 'S', last_name: 'T' });
  await confirm(stranger.u);
  check('10 confirming some other login links nothing', !(await memberOf(stranger.pid)));

  // The owner turned the record off before the login confirmed: no link.
  const ned = await signUp('ned@example.com', { first_name: 'Ned', last_name: 'Off' });
  const nedRec = (await add('Ned', 'ned@example.com')).v.person_id;
  await as(A.u, `select public.set_customer_portal_access($1::uuid, false) x`, [nedRec]);
  await confirm(ned.u);
  check('11 a waiting record whose access the owner turned off is not linked when the login confirms', !(await memberOf(ned.pid)) && (await memberOf(nedRec)).status === 'inactive');

  // Someone on the team is never made a customer this way.
  const wes = await member(A.cid, 'wes@example.com', 'worker', 'Wes');
  check('12 an email that belongs to someone on the team is still refused', /someone on your team/.test((await add('Wes', 'wes@example.com')).msg ?? ''));
  const confirmedNow = await as(A.u, `select 1 x`);
  check('13 invite links still work as before (a link is made for the waiting record, which has no login)', confirmedNow.ok
    && (await as(A.u, `select public.invite_send($1::uuid) x`, [miaRec])).ok && !!wes);
}

// ════════════════════════ customer access off: no old jobs ════════════════════════
async function customerAccessOff(check) {
  const { db, one, as, ownerWithCompany, member } = await freshDb();
  const A = await ownerWithCompany('owner@example.com', 'Company A');
  const cora = await member(A.cid, 'cora@example.com', 'customer', 'Cora');
  const dot = await member(A.cid, 'dot@example.com', 'customer', 'Dot');
  const mk = async (cust, name) => {
    const id = (await one(`insert into public.projects (company_id, customer_id, name, status) values ($1, $2, $3, 'active') returning id`, [A.cid, cust, name])).id;
    await db.query(`insert into public.project_tasks (company_id, project_id, title, status, sort_order) values ($1, $2, 'Done', 'completed', 1)`, [A.cid, id]);
    await db.query(`insert into public.project_photos (company_id, project_id, file_url, is_customer_visible) values ($1, $2, 'https://x/p.jpg', true)`, [A.cid, id]);
    await db.query(`insert into public.project_messages (company_id, project_id, sender_id, body) values ($1, $2, $3, 'Hello')`, [A.cid, id, A.pid]);
    await db.query(`insert into public.project_updates (company_id, project_id, title, is_customer_visible) values ($1, $2, 'Week 1', true)`, [A.cid, id]);
    await db.query(`insert into public.quotes (company_id, project_id, customer_id, number, status, total) values ($1, $2, $3, $4, 'sent', 10)`, [A.cid, id, cust, `Q-${name}`]);
    await db.query(`insert into public.invoices (company_id, project_id, number, status, total, issued_at) values ($1, $2, $3, 'issued', 10, now())`, [A.cid, id, `I-${name}`]);
    return id;
  };
  await mk(cora.pid, 'Cora');
  await mk(dot.pid, 'Dot');
  const TABLES = ['projects', 'project_tasks', 'project_photos', 'project_messages', 'project_updates', 'quotes', 'invoices'];
  const seen = async (u) => {
    const out = {};
    for (const t of TABLES) { const r = await as(u, `select count(*)::int n from public.${t}`); out[t] = r.ok ? r.v : `ERR ${r.msg}`; }
    return out;
  };
  const before = await seen(cora.u);
  check('14 an active customer sees her job and its shared rows (task, photo, message, update, quote, invoice)', TABLES.every((t) => before[t] === 1), JSON.stringify(before));
  const off = await as(A.u, `select public.set_customer_portal_access($1::uuid, false) x`, [cora.pid]);
  const after = await seen(cora.u);
  check('15 after the owner turns her access off she reads 0 jobs and 0 related rows', off.ok && TABLES.every((t) => after[t] === 0), JSON.stringify(after));
  const other = await seen(dot.u);
  check('16 another, still active customer still sees exactly his own', TABLES.every((t) => other[t] === 1), JSON.stringify(other));
  await as(A.u, `select public.set_customer_portal_access($1::uuid, true) x`, [cora.pid]);
  const back = await seen(cora.u);
  check('17 turned back on, she sees her job again', TABLES.every((t) => back[t] === 1), JSON.stringify(back));
}

// ════════════════════════ no TRUNCATE (nor REFERENCES / TRIGGER) for the app roles ════════════════════════
async function noTruncate(check) {
  const { db, all, one, as, ownerWithCompany, member } = await freshDb({ setupRuns: 2 });
  const A = await ownerWithCompany('owner@example.com', 'Company A');
  const w = await member(A.cid, 'w@example.com', 'worker', 'Will');
  const tables = (await all(`select c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`)).map((x) => x.t);
  const allowed = [];
  for (const t of tables) {
    for (const [who, u] of [['worker', w.u], ['owner', A.u], ['signed out', null]]) {
      const r = await as(u, `truncate public.${t} cascade`);
      if (r.ok || !/permission denied/i.test(r.msg)) allowed.push(`${who}:${t}:${r.msg ?? 'ok'}`);
    }
  }
  check(`18 a worker, the owner's login and a signed-out visitor get "permission denied" on TRUNCATE for every public table (${tables.length} tables)`, tables.length > 40 && allowed.length === 0, allowed.slice(0, 5).join(' | '));
  const extra = await one(`select count(*)::int n from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC') and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')`);
  check('19 no app role holds TRUNCATE, REFERENCES or TRIGGER on any public table (setup.sql run twice)', extra.n === 0, String(extra.n));
  await db.query(`create table public.later_table (id int)`);
  const later = await one(`select has_table_privilege('authenticated', 'public.later_table', 'TRUNCATE') t, has_table_privilege('anon', 'public.later_table', 'TRIGGER') g,
    has_table_privilege('authenticated', 'public.later_table', 'SELECT') s`);
  check('20 a table made later does not get TRUNCATE / TRIGGER for the app roles either (default rights), but keeps normal reading', later.t === false && later.g === false && later.s === true, JSON.stringify(later));
  await db.query(`drop table public.later_table`);
  const plain = await as(w.u, `select count(*)::int n from public.projects`);
  check('21 normal reading still works for the app roles', plain.ok);
}

// ════════════════════════ worker Push Notifications switch ════════════════════════
async function workerPushSwitch(check) {
  const { db, one, as, ownerWithCompany, member } = await freshDb();
  const A = await ownerWithCompany('owner@example.com', 'Company A');
  const on = await member(A.cid, 'on@example.com', 'worker', 'Onna');
  const offW = await member(A.cid, 'off@example.com', 'worker', 'Otto');
  await db.query(`update public.app_settings set value = 'https://abc123.supabase.co/functions/v1' where key = 'functions_url'`);
  await db.query(`insert into public.push_tokens (token, person_id, platform) values ('tok-on', $1, 'ios'), ('tok-off', $2, 'ios'), ('tok-own', $3, 'ios')`, [on.pid, offW.pid, A.pid]);
  const save = await as(offW.u, `insert into public.worker_settings (person_id, notifications_enabled) values ($1, false)
    on conflict (person_id) do update set notifications_enabled = excluded.notifications_enabled`, [offW.pid]);
  check('22 a worker saves his own Push Notifications switch (off) in the database', save.ok && (await one(`select notifications_enabled x from public.worker_settings where person_id = $1`, [offW.pid])).x === false, save.msg);
  const calls = async () => (await one(`select count(*)::int n from net.calls`)).n;
  const notify = (pid, ev = 'announcement_posted') => as(A.u, `insert into public.app_notifications (company_id, recipient_id, event_type, title, body) values ($1, $2, $3, 'Please confirm your schedule', 'x')`, [A.cid, pid, ev]);
  let c0 = await calls();
  const n1 = await notify(on.pid);
  const c1 = await calls();
  const n2 = await notify(offW.pid);
  const c2 = await calls();
  check('23 a worker with the switch ON (no row = on) gets a phone push call', n1.ok && c1 === c0 + 1, JSON.stringify({ n1, c0, c1 }));
  check('24 a worker who turned it OFF gets no phone push call, but the notice is still saved for the app', n2.ok && c2 === c1
    && (await one(`select count(*)::int n from public.app_notifications where recipient_id = $1`, [offW.pid])).n === 1
    && (await as(offW.u, `select count(*)::int n from public.app_notifications`)).v === 1, JSON.stringify({ n2, c1, c2 }));
  await as(offW.u, `update public.worker_settings set notifications_enabled = true where person_id = $1`, [offW.pid]);
  c0 = await calls();
  await notify(offW.pid);
  check('25 turned back on, pushes go out again', (await calls()) === c0 + 1);
  await as(offW.u, `update public.worker_settings set notifications_enabled = false where person_id = $1`, [offW.pid]);

  const hack = await as(on.u, `update public.worker_settings set notifications_enabled = true where person_id = $1 returning 1`, [offW.pid]);
  const hackIns = await as(on.u, `insert into public.worker_settings (person_id, notifications_enabled) values ($1, false)`, [A.pid]);
  const peek = await as(on.u, `select count(*)::int n from public.worker_settings where person_id = $1`, [offW.pid]);
  check('26 a person cannot change (or read, or create) someone else\'s switch', hack.ok && hack.rows.length === 0 && !hackIns.ok && peek.v === 0
    && (await one(`select notifications_enabled x from public.worker_settings where person_id = $1`, [offW.pid])).x === false
    && (await one(`select count(*)::int n from public.worker_settings where person_id = $1`, [A.pid])).n === 0, JSON.stringify({ hack, hackIns, peek }));

  // An emailed event still reaches the function (it emails the owner; the function itself skips the phone push when switched off).
  await db.query(`insert into public.worker_settings (person_id, notifications_enabled) values ($1, false)`, [A.pid]);
  c0 = await calls();
  await db.query(`insert into public.app_notifications (company_id, recipient_id, event_type, title, body) values ($1, $2, 'quote_approved', 'Quote approved', '')`, [A.cid, A.pid]);
  check('27 an emailed event (quote approved) still calls send-notification even with pushes off, so the email goes out', (await calls()) === c0 + 1);
}
