// Deleting the company (owner only, all or nothing) and deleting an unused team member.
import { freshDb } from '../helpers/setupDb.mjs';

export default async function run({ check }) {
  const { db, one, as, signUp, ownerWithCompany, extraCompany, member } = await freshDb();
  const A = await ownerWithCompany('owner@example.com', 'Acme Paving');
  const admin = await member(A.cid, 'admin@example.com', 'admin', 'Ada');
  const w1 = await member(A.cid, 'w1@example.com', 'worker', 'Wes');
  const c1 = await member(A.cid, 'c1@example.com', 'customer', 'Cora');
  // Someone who is also in another company keeps their login.
  const B = await extraCompany('Other Co');
  const both = await member(A.cid, 'both@example.com', 'worker', 'Bea');
  await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1, $2, 'worker', 'active')`, [B, both.pid]);
  const job = (await one(`insert into public.projects (company_id, customer_id, name) values ($1, $2, 'Driveway') returning id`, [A.cid, c1.pid])).id;
  await db.query(`insert into public.project_photos (company_id, project_id, uploaded_by, file_key, file_url) values ($1, $2, $3, $4, 'https://x/p.jpg')`, [A.cid, job, w1.pid, `${A.cid}/projects/${job}/p.jpg`]);
  await db.query(`insert into public.assignments (company_id, project_id, person_id, scheduled_date) values ($1, $2, $3, current_date)`, [A.cid, job, w1.pid]);

  const prev = await as(A.u, `select public.company_closure_preview() x`);
  check('1 the owner sees what is still going on before deleting (no Snow or storm counts)', prev.ok && 'on_the_clock' in prev.v && !Object.keys(prev.v).some((k) => /snow|storm/.test(k)), JSON.stringify(prev));
  check('2 an admin, a worker or a customer cannot delete the company or see the preview', !(await as(admin.u, `select public.delete_my_company('Acme Paving')`)).ok
    && !(await as(w1.u, `select public.delete_my_company('Acme Paving')`)).ok && !(await as(c1.u, `select public.company_closure_preview() x`)).ok);
  check('3 the name must be typed exactly', !(await as(A.u, `select public.delete_my_company('Acme')`)).ok);
  await as(w1.u, `select public.time_clock_in(current_date) x`);
  const busy = await as(A.u, `select public.delete_my_company('acme paving')`);
  check('4 refused while someone is clocked in', !busy.ok && /clocked in/i.test(busy.msg), busy.msg);
  await as(w1.u, `select public.time_clock_out() x`);
  check('5 a plain delete of the company row is refused (only the delete function may do it)', !(await as(A.u, `delete from public.companies where id = $1`, [A.cid])).ok
    || (await one(`select count(*)::int n from public.companies where id = $1`, [A.cid])).n === 1);
  let raw = true; try { await db.query(`delete from public.companies where id = $1`, [A.cid]); } catch { raw = false; }
  check('5b ...even for the database admin without the delete switch', !raw);

  const del = await as(A.u, `select public.delete_my_company('acme paving')`);
  check('6 the owner deletes the company (name matched without caring about capitals)', del.ok, del.msg);
  check('7 the company and everything in it are gone', (await one(`select count(*)::int n from public.companies where id = $1`, [A.cid])).n === 0
    && (await one(`select count(*)::int n from public.projects`)).n === 0 && (await one(`select count(*)::int n from public.time_workdays where company_id = $1`, [A.cid])).n === 0);
  const gone = await one(`select count(*)::int n from auth.users where id in ($1, $2, $3, $4)`, [A.u, admin.u, w1.u, c1.u]);
  check('8 the logins of people who were only in this company are deleted (owner too)', gone.n === 0);
  check('9 a person who is also in another company keeps their login and that membership', (await one(`select count(*)::int n from auth.users where id = $1`, [both.u])).n === 1
    && (await one(`select count(*)::int n from public.company_members where person_id = $1 and company_id = $2`, [both.pid, B])).n === 1);
  const log = await one(`select * from public.company_closure_log where company_id = $1`, [A.cid]);
  check('10 a closure record is kept (who, when, what was there)', !!log && log.company_name === 'Acme Paving' && log.counts.accounts_deleted === 4, JSON.stringify(log));
  const q = (await db.query(`select file_key, kind from public.storage_cleanup_queue where company_id = $1 order by file_key`, [A.cid])).rows;
  check('11 every stored file and folder is queued for the storage-cleanup function (company folder, ID and avatar folders, each file)',
    q.some((r) => r.kind === 'prefix' && r.file_key === `${A.cid}/`) && q.some((r) => r.file_key === `ids/${w1.pid}/`) && q.some((r) => r.file_key === `avatars/${w1.pid}/`)
    && q.some((r) => r.kind === 'file' && r.file_key.endsWith('/p.jpg')) && !q.some((r) => r.file_key.includes(both.pid)), JSON.stringify(q));
  check('12 the triggers on the company tables are switched back on afterwards', (await one(`select count(*)::int n from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and not t.tgisinternal and t.tgenabled = 'D'`)).n === 0);
  // Back to an empty database except the other test company; remove it too, then Create a Company works again.
  await db.exec(`select set_config('app.allow_company_delete', 'on', false); delete from public.companies; select set_config('app.allow_company_delete', 'off', false);`);
  const again = await signUp('new@example.com', { first_name: 'New', last_name: 'Owner', company_name: 'Fresh Start' });
  check('13 after the delete, a new "Create a Company" works again', (await one(`select count(*)::int n from public.companies where name = 'Fresh Start'`)).n === 1 && !!again.pid);

  // ── deleting an unused team member ──
  const C = (await one(`select company_id from public.company_members where person_id = $1`, [again.pid])).company_id;
  const add = await as(again.u, `select public.add_worker('Una', 'Used', '5550100321') x`);
  const du = await as(again.u, `select public.delete_unused_member($1) x`, [add.v.person_id]);
  check('14 a worker who never signed up and has no records can be deleted completely', du.ok
    && (await one(`select count(*)::int n from public.people where id = $1`, [add.v.person_id])).n === 0, JSON.stringify(du));
  const w9 = await member(C, 'w9@example.com', 'worker', 'Lo');
  const r = await as(again.u, `select public.delete_unused_member($1) x`, [w9.pid]);
  check('15 a person with a login is never deleted that way (deactivate instead)', !r.ok && /HAS_HISTORY/.test(r.msg), r.msg);
}
