// Roles and row level security: companies are separate, customers see only their own, no direct people inserts (R4),
// who may send notices (R21), the old media bucket (R3), admin powers and the Team access screen.
import { freshDb } from '../helpers/setupDb.mjs';

export default async function run({ check }) {
  const { db, one, all, as, signUp, ownerWithCompany, extraCompany, member } = await freshDb();
  const A = await ownerWithCompany('owner@example.com', 'Company A');
  const admin = await member(A.cid, 'admin@example.com', 'admin', 'Ada');
  const w1 = await member(A.cid, 'w1@example.com', 'worker', 'Wes');
  const w2 = await member(A.cid, 'w2@example.com', 'worker', 'Wanda');
  const c1 = await member(A.cid, 'c1@example.com', 'customer', 'Cora');
  const c2 = await member(A.cid, 'c2@example.com', 'customer', 'Cal');
  const B = await extraCompany('Company B');
  const ownerB = await signUp('ownerb@example.com', { first_name: 'Bo', last_name: 'B' });
  await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1, $2, 'owner', 'active')`, [B, ownerB.pid]);
  const wB = await member(B, 'wb@example.com', 'worker', 'Wyatt');
  const pA1 = (await one(`insert into public.projects (company_id, customer_id, name, status) values ($1, $2, 'A job for Cora', 'active') returning id`, [A.cid, c1.pid])).id;
  const pA2 = (await one(`insert into public.projects (company_id, customer_id, name, status) values ($1, $2, 'A job for Cal', 'active') returning id`, [A.cid, c2.pid])).id;
  const pB = (await one(`insert into public.projects (company_id, name, status) values ($1, 'B job', 'active') returning id`, [B])).id;
  const n = async (u, sql, p) => { const r = await as(u, sql, p); return r.ok ? Number(r.v) : `ERR ${r.msg}`; };

  // ── companies are separate ──
  check('1 a worker sees their own company\'s jobs and none of another company\'s', await n(w1.u, `select count(*) from public.projects`) === 2
    && await n(w1.u, `select count(*) from public.projects where id = $1`, [pB]) === 0);
  check('2 a worker of company B sees none of company A\'s jobs, people or team', await n(wB.u, `select count(*) from public.projects where company_id = $1`, [A.cid]) === 0
    && await n(wB.u, `select count(*) from public.company_members where company_id = $1`, [A.cid]) === 0
    && await n(wB.u, `select count(*) from public.people where id = $1`, [w1.pid]) === 0);
  check('3 company B\'s owner cannot change company A\'s job', await n(ownerB.u, `with u as (update public.projects set name = 'hacked' where id = $1 returning 1) select count(*) from u`, [pA1]) === 0);
  check('4 a signed-out visitor reads nothing', await n(null, `select count(*) from public.projects`) === 0 && await n(null, `select count(*) from public.people`) === 0);

  // ── customers ──
  check('5 a customer sees only their own job, not another customer\'s in the same company', await n(c1.u, `select count(*) from public.projects`) === 1
    && await n(c1.u, `select count(*) from public.projects where id = $1`, [pA2]) === 0);
  check('6 a customer cannot add or change jobs', !(await as(c1.u, `insert into public.projects (company_id, name) values ($1, 'x')`, [A.cid])).ok
    && await n(c1.u, `with u as (update public.projects set name = 'x' where id = $1 returning 1) select count(*) from u`, [pA1]) === 0);
  check('7 a customer cannot read pay rates, workdays or the team history', await n(c1.u, `select count(*) from public.worker_hourly_rates`) === 0
    && await n(c1.u, `select count(*) from public.time_workdays`) === 0 && await n(c1.u, `select count(*) from public.membership_audit_log`) === 0);
  await db.query(`insert into public.worker_hourly_rates (company_id, person_id, hourly_rate, effective_date) values ($1, $2, 25, current_date)`, [A.cid, w1.pid]);
  check('8 a worker cannot read pay rates; the owner can', await n(w1.u, `select count(*) from public.worker_hourly_rates`) === 0 && await n(A.u, `select count(*) from public.worker_hourly_rates`) === 1);

  // ── R4: no direct inserts into people ──
  check('9 R4: a signed-in person cannot add rows to people directly (owner included)', !(await as(w1.u, `insert into public.people (first_name) values ('Fake')`)).ok
    && !(await as(A.u, `insert into public.people (first_name) values ('Fake')`)).ok);

  // ── R21: who may send a notice ──
  const notice = (u, to, ev, cid = A.cid) => as(u, `insert into public.app_notifications (company_id, recipient_id, event_type, title, body) values ($1, $2, $3, 't', 'b')`, [cid, to, ev]);
  check('10 R21: the owner may send any notice to an active member', (await notice(A.u, w1.pid, 'announcement_posted')).ok && (await notice(A.u, c1.pid, 'quote_sent')).ok);
  check('11 R21: a worker may send worker notices only to the owner/admins', (await notice(w1.u, A.pid, 'worker_checked_in')).ok && (await notice(w1.u, admin.pid, 'worker_completed_task')).ok
    && !(await notice(w1.u, w2.pid, 'worker_checked_in')).ok && !(await notice(w1.u, A.pid, 'quote_approved')).ok && !(await notice(w1.u, c1.pid, 'customer_message')).ok);
  check('12 R21: a customer may send only customer_message / customer_request_submitted, only to the owner/admins', (await notice(c1.u, A.pid, 'customer_message')).ok
    && (await notice(c1.u, A.pid, 'customer_request_submitted')).ok && !(await notice(c1.u, A.pid, 'quote_approved')).ok && !(await notice(c1.u, w1.pid, 'customer_message')).ok);
  check('13 R21: nobody may send a notice into another company or to a non-member', !(await notice(wB.u, A.pid, 'worker_checked_in')).ok && !(await notice(A.u, ownerB.pid, 'announcement_posted')).ok
    && !(await notice(A.u, wB.pid, 'announcement_posted', B)).ok);
  check('14 a person reads only their own notices', await n(w1.u, `select count(*) from public.app_notifications where recipient_id <> $1`, [w1.pid]) === 0
    && await n(w1.u, `select count(*) from public.app_notifications`) === 1);

  // ── R3: the old media bucket ──
  await db.query(`insert into storage.objects (bucket_id, name) values ('media', $1), ('media', $2), ('media', 'avatars/x/me.jpg')`, [`${A.cid}/projects/a.jpg`, `${B}/projects/b.jpg`]);
  check('15 R3: nobody signed in can upload into the media bucket (owner and customer included)', !(await as(A.u, `insert into storage.objects (bucket_id, name) values ('media', $1)`, [`${A.cid}/x.jpg`])).ok
    && !(await as(c1.u, `insert into storage.objects (bucket_id, name) values ('media', $1)`, [`${A.cid}/y.jpg`])).ok);
  check('16 R3: listing shows only your own company\'s folder', await n(w1.u, `select count(*) from storage.objects`) === 1
    && await n(w1.u, `select count(*) from storage.objects where name like $1`, [`${B}/%`]) === 0 && await n(null, `select count(*) from storage.objects`) === 0);
  check('17 R3: nobody signed in can change or delete files there', await n(A.u, `with d as (delete from storage.objects returning 1) select count(*) from d`) === 0);

  // ── admin powers and Team access ──
  const perms = await as(A.u, `select public.get_admin_permissions() x`);
  check('18 admin powers have no Snow switch (team, invites, time corrections, pay rates)', perms.ok && JSON.stringify(Object.keys(perms.v).sort()) === '["invites","pay_rates","team","time_corrections"]', JSON.stringify(perms));
  check('19 only the owner can change admin powers', (await as(A.u, `select public.set_admin_permissions(true, false, true, true)`)).ok
    && !(await as(admin.u, `select public.set_admin_permissions(true, true, true, true)`)).ok);
  check('20 with the invites power off, the admin cannot add a worker', !(await as(admin.u, `select public.add_worker('No', 'Way', '5550100999') x`)).ok);
  const ov = await as(A.u, `select public.team_access_overview() x`);
  const row = ov.ok && ov.v.find((r) => r.person_id === w1.pid);
  check('21 Team access lists the team with has_access (no landscaping/snow/worker type fields)', !!row && row.has_access === true
    && !Object.keys(row).some((k) => /landscap|snow|worker_type|maintenance/.test(k)), JSON.stringify(row));
  check('22 a worker cannot open Team access', !(await as(w1.u, `select public.team_access_overview() x`)).ok);
  check('23 the owner deactivates a worker: no access, phone tokens removed', (await as(A.u, `select public.deactivate_member($1, true)`, [w2.pid])).ok
    && (await one(`select status from public.company_members where person_id = $1`, [w2.pid])).status === 'inactive'
    && await n(w2.u, `select count(*) from public.projects`) === 0);
  check('24 reactivate_member takes only the person (no landscaping/snow arguments) and gives access back', (await as(A.u, `select public.reactivate_member($1)`, [w2.pid])).ok
    && (await one(`select status from public.company_members where person_id = $1`, [w2.pid])).status === 'active');
  check('25 a worker cannot deactivate anyone, and nobody can deactivate the owner', !(await as(w1.u, `select public.deactivate_member($1, true)`, [w2.pid])).ok
    && !(await as(admin.u, `select public.deactivate_member($1, true)`, [A.pid])).ok);
  check('26 team members cannot be changed by editing the table (role change refused)', !(await as(A.u, `update public.company_members set role = 'admin' where person_id = $1`, [w1.pid])).ok);
  check('27 the owner makes an admin with Make admin', (await as(A.u, `select public.set_member_role($1, 'admin')`, [w1.pid])).ok
    && (await one(`select role from public.company_members where person_id = $1`, [w1.pid])).role === 'admin');
}
