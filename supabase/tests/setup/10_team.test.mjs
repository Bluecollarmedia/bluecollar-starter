// The team: the one-company rule, a person's own details (birthday, hoodie size, language, worker ID photo), invite links in depth,
// account access (owner protection, admin powers, deactivate / reactivate), deleting unused members, Remind, Task Leads and crews,
// and a company delete that fails half way.
import { freshDb, read } from '../helpers/setupDb.mjs';

export default async function run({ check }) {
  const { db, one, all, as, signUp, ownerWithCompany, extraCompany, member } = await freshDb();
  const n = async (u, sql, p) => { const r = await as(u, sql, p); return r.ok ? Number(r.v) : `ERR ${r.msg}`; };
  const count = async (sql, p) => Number((await one(sql, p)).n);
  const raw = async (sql, p) => { try { await db.query(sql, p); return { ok: true }; } catch (e) { return { ok: false, msg: String(e.message) }; } };

  // ── the one-company rule ──
  const anonCreate = await as(null, `select public.create_company('{"company_name":"Sneaky"}'::jsonb) x`);
  check('1 a signed-out visitor cannot create a company', !anonCreate.ok && (await count(`select count(*)::int n from public.companies`)) === 0, anonCreate.msg);
  const A = await ownerWithCompany('owner@example.com', 'Acme Paving');
  const direct = await raw(`insert into public.companies (name) values ('Second Co')`);
  check('2 once a company exists, even a direct insert of a second one is refused (database admin included)', !direct.ok && /already exists/.test(direct.msg)
    && (await count(`select count(*)::int n from public.companies`)) === 1, direct.msg);
  const ownDel = await as(A.u, `select public.delete_my_account()`);
  check('3 the owner cannot delete their own login while they own the company', !ownDel.ok && /own the company/.test(ownDel.msg), ownDel.msg);

  const admin = await member(A.cid, 'admin@example.com', 'admin', 'Ada');
  const w1 = await member(A.cid, 'w1@example.com', 'worker', 'Wes');
  const w2 = await member(A.cid, 'w2@example.com', 'worker', 'Wanda');
  const w3 = await member(A.cid, 'w3@example.com', 'worker', 'Will');
  const c1 = await member(A.cid, 'c1@example.com', 'customer', 'Cora');
  const stranger = await signUp('stranger@example.com', { first_name: 'Stan', last_name: 'Ger' });
  const B = await extraCompany('Other Co');
  const ownerB = await signUp('ownerb@example.com', { first_name: 'Bo', last_name: 'B' });
  await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1, $2, 'owner', 'active')`, [B, ownerB.pid]);

  // ── birthday, hoodie size, language ──
  const bad = await as(w1.u, `update public.people set birthday = '1850-01-01' where id = $1`, [w1.pid]);
  check('4 a birthday before 1900 is refused', !bad.ok && /people_birthday_range/.test(bad.msg), bad.msg);
  const bday = async (pid) => (await one(`select birthday::text d from public.people where id = $1`, [pid])).d;
  check('5 a person sets their own birthday and can clear it again', (await as(w1.u, `update public.people set birthday = '1991-05-06' where id = $1`, [w1.pid])).ok
    && (await bday(w1.pid)) === '1991-05-06' && (await as(w1.u, `update public.people set birthday = null where id = $1`, [w1.pid])).ok && (await bday(w1.pid)) === null);
  await as(w1.u, `update public.people set birthday = '1980-01-01', hoodie_size = 'M' where id = $1`, [w2.pid]);
  check('6 a worker cannot change someone else\'s birthday or hoodie size (nothing changes)', (await bday(w2.pid)) === null
    && (await one(`select hoodie_size from public.people where id = $1`, [w2.pid])).hoodie_size === null);
  check('7 a worker sets their own hoodie size; a made-up size is refused', (await as(w1.u, `update public.people set hoodie_size = 'L' where id = $1`, [w1.pid])).ok
    && !(await as(w1.u, `update public.people set hoodie_size = 'GIANT' where id = $1`, [w1.pid])).ok
    && (await one(`select hoodie_size from public.people where id = $1`, [w1.pid])).hoodie_size === 'L');
  const lang = async () => (await one(`select language from public.people where id = $1`, [w1.pid])).language;
  check('8 everyone starts in English and can save Español', (await lang()) === 'en' && (await as(w1.u, `select public.set_my_language('es')`)).ok && (await lang()) === 'es');
  check('9 an unknown language is refused, and English can be chosen again', !(await as(w1.u, `select public.set_my_language('fr')`)).ok && (await lang()) === 'es'
    && (await as(w1.u, `select public.set_my_language('en')`)).ok && (await lang()) === 'en');

  // ── the worker's ID photo record ──
  const idKey = (pid, f = 'abc') => `ids/${pid}/${f}.jpg`;
  check('10 a worker adds their own ID photo, but not one for someone else', (await as(w1.u, `insert into public.person_ids (person_id, id_key) values ($1, $2)`, [w1.pid, idKey(w1.pid)])).ok
    && !(await as(w1.u, `insert into public.person_ids (person_id, id_key) values ($1, $2)`, [w2.pid, idKey(w2.pid)])).ok);
  check('11 the ID cannot be pointed at someone else\'s folder; the worker can replace it and read it', !(await as(w1.u, `update public.person_ids set id_key = $2 where person_id = $1`, [w1.pid, idKey(w2.pid, 'steal')])).ok
    && (await as(w1.u, `update public.person_ids set id_key = $2 where person_id = $1`, [w1.pid, idKey(w1.pid, 'new')])).ok
    && (await as(w1.u, `select id_key from public.person_ids`)).v === idKey(w1.pid, 'new'));
  await db.query(`insert into public.person_ids (person_id, id_key) values ($1, $2)`, [w2.pid, idKey(w2.pid)]);
  check('12 the owner sees the ID of each worker on the team, and may have their own', await n(A.u, `select count(*) from public.person_ids`) === 2
    && (await as(A.u, `insert into public.person_ids (person_id, id_key) values ($1, $2)`, [A.pid, idKey(A.pid)])).ok);
  await db.query(`delete from public.person_ids where person_id = $1`, [A.pid]);
  await as(A.u, `update public.person_ids set id_key = 'ids/x/y.jpg'`);
  await as(A.u, `delete from public.person_ids`);
  check('13 the owner cannot change or delete a worker\'s ID', (await count(`select count(*)::int n from public.person_ids`)) === 2
    && (await one(`select id_key from public.person_ids where person_id = $1`, [w2.pid])).id_key === idKey(w2.pid));
  for (const [who, label] of [[admin, 'an admin'], [w3, 'another worker'], [c1, 'a customer'], [stranger, 'a stranger']]) {
    const seen = await n(who.u, `select count(*) from public.person_ids`);
    await as(who.u, `delete from public.person_ids`);
    await as(who.u, `update public.person_ids set id_key = 'ids/x/y.jpg'`);
    check(`14 ${label} sees no ID photos and cannot change or delete them`, seen === 0 && (await count(`select count(*)::int n from public.person_ids where id_key like 'ids/x/%'`)) === 0
      && (await count(`select count(*)::int n from public.person_ids`)) === 2, String(seen));
  }
  const media = read('supabase/functions/media/index.ts');
  check('15 the media function signs an ID only for that person or the owner of their company, for 5 minutes, and uploads only into the person\'s own ids folder',
    /action === 'id-sign'/.test(media) && /me\.roles\[r\.company_id\] === 'owner'/.test(media) && /first === 'avatars' \|\| first === 'ids' \? second === me\.personId/.test(media)
    && /presignGet\(key, 300\)/.test(media));

  // ── invite links in depth ──
  const add = await as(A.u, `select public.add_worker('Gabriel', 'Rivera', '(555) 010-0142') x`);
  const gab = add.v;
  const rec = add.ok && await one(`select p.user_id, m.role, m.status from public.people p join public.company_members m on m.person_id = p.id where p.id = $1`, [gab.person_id]);
  check('16 a new worker from Add worker is an invited worker with no login yet, and the private link is long', add.ok && gab.created === true && gab.token.length >= 60
    && rec.role === 'worker' && rec.status === 'invited' && rec.user_id === null, JSON.stringify({ add, rec }));
  check('17 an admin (allowed by default) can add a worker too', (await as(admin.u, `select public.add_worker('Pat', 'Admin', '5550100101') x`)).ok);
  const dupe = await as(A.u, `select public.add_worker('Gabe', 'Again', '555-010-0142') x`);
  check('18 a first name and a phone number are required, and the same phone twice is refused', !(await as(A.u, `select public.add_worker('', 'X', '5550100199') x`)).ok
    && !(await as(A.u, `select public.add_worker('A', 'X', '12') x`)).ok && !dupe.ok && /already on your team/.test(dupe.msg), dupe.msg);
  const look = await as(null, `select public.invite_lookup($1) x`, [gab.token]);
  check('19 the invite page shows only the company, kind, and the name and phone the owner typed', look.ok && look.v.kind === 'worker'
    && Object.keys(look.v).sort().join() === 'company_name,first_name,kind,last_name,phone,valid', JSON.stringify(look.v));
  check('19b a made-up link says invalid', (await as(null, `select public.invite_lookup('nope') x`)).v.valid === false);
  const peopleBefore = await count(`select count(*)::int n from public.people`);
  const gabSU = await signUp('gabriella@example.com', { first_name: 'Gabriella', last_name: 'Rivera', invite_token: gab.token });
  check('20 signing up with the link uses the record the owner made: the worker fixes their own name, the email is saved, no second person',
    gabSU.pid === gab.person_id && gabSU.person.first_name === 'Gabriella' && gabSU.person.email === 'gabriella@example.com'
    && (await count(`select count(*)::int n from public.people`)) === peopleBefore, JSON.stringify(gabSU.person));
  const dana = (await as(A.u, `select public.add_worker('Dana', 'Cole', '5550100202') x`)).v;
  await db.query(`update public.invites set expires_at = now() - interval '1 minute' where person_id = $1`, [dana.person_id]);
  check('21 an expired link says expired and joins nobody', (await as(null, `select public.invite_lookup($1) x`, [dana.token])).v.reason === 'expired'
    && (await signUp('dana@example.com', { first_name: 'Dana', last_name: 'Cole', invite_token: dana.token })).pid !== dana.person_id);
  const eli = (await as(A.u, `select public.add_worker('Eli', 'Moss', '5550100303') x`)).v;
  const again = await as(A.u, `select public.invite_send($1) x`, [eli.person_id]);
  check('22 "send again" makes a new link and the old one stops working', again.ok && again.v.token !== eli.token
    && (await as(null, `select public.invite_lookup($1) x`, [eli.token])).v.valid === false && (await as(null, `select public.invite_lookup($1) x`, [again.v.token])).v.valid === true);
  const pend = await as(A.u, `select public.invites_pending() x`);
  check('23 the owner\'s list shows who still has an unused link, never the link itself', pend.ok && pend.v.some((i) => i.person_id === eli.person_id)
    && !pend.v.some((i) => 'token' in i || 'token_hash' in i), JSON.stringify(pend.v).slice(0, 200));
  const inv = pend.v.find((i) => i.person_id === eli.person_id);
  check('24 the owner cancels a link and it no longer works', (await as(A.u, `select public.invite_revoke($1)`, [inv.id])).ok
    && (await as(null, `select public.invite_lookup($1) x`, [again.v.token])).v.valid === false);
  check('25 another company\'s owner sees none of our pending links', (await as(ownerB.u, `select public.invites_pending() x`)).v.length === 0);
  const dan = (await as(A.u, `select public.add_customer('Dan', 'Dealer', 'dan@example.com', '5550100606') x`)).v;
  const danLink = (await as(A.u, `select public.invite_send($1) x`, [dan.person_id])).v;
  const danSU = await signUp('someone.else@example.com', { first_name: 'Daniel', last_name: 'Dealerman', invite_token: danLink.token });
  const danRow = await one(`select first_name, last_name, email, user_id from public.people where id = $1`, [dan.person_id]);
  check('26 a customer keeps the name the owner typed, and signing up with a different email still links them', danSU.pid === dan.person_id
    && danRow.first_name === 'Dan' && danRow.last_name === 'Dealer' && danRow.user_id === danSU.u && danRow.email === 'someone.else@example.com', JSON.stringify(danRow));
  const eve = await as(A.u, `select public.add_customer('Eve', '', '', '5550100707') x`);
  const eveLink = eve.ok && (await as(A.u, `select public.invite_send($1) x`, [eve.v.person_id])).v;
  if (eveLink) await signUp('eve@example.com', { first_name: 'Evelyn', last_name: 'Fox', invite_token: eveLink.token });
  const eveRow = eve.ok && await one(`select first_name, last_name from public.people where id = $1`, [eve.v.person_id]);
  check('27 a part of the name the owner left empty is filled in from the sign-up form (Eve stays, last name Fox)', eveRow && eveRow.first_name === 'Eve' && eveRow.last_name === 'Fox', JSON.stringify({ eve, eveRow }));
  const existing = await member(B, 'existing@example.com', 'customer', 'Ed');
  const ed = (await as(A.u, `select public.add_customer('Ed', 'Existing', '', '5550100505') x`)).v;
  const edJob = (await one(`insert into public.projects (company_id, customer_id, name, status) values ($1, $2, 'Ed driveway', 'active') returning id`, [A.cid, ed.person_id])).id;
  const edLink = (await as(A.u, `select public.invite_send($1) x`, [ed.person_id])).v;
  const acc = await as(existing.u, `select public.invite_accept($1) x`, [edLink.token]);
  check('28 a customer who already has a login elsewhere opens the link while signed in: the record and its job move to their account', acc.ok && acc.v.success === true
    && (await one(`select customer_id from public.projects where id = $1`, [edJob])).customer_id === existing.pid
    && (await count(`select count(*)::int n from public.people where id = $1`, [ed.person_id])) === 0
    && (await one(`select status from public.company_members where person_id = $1 and company_id = $2`, [existing.pid, A.cid])).status === 'active', JSON.stringify(acc));
  check('29 their other company membership is untouched, and the link cannot be used again', (await one(`select status from public.company_members where person_id = $1 and company_id = $2`, [existing.pid, B])).status === 'active'
    && (await as(existing.u, `select public.invite_accept($1) x`, [edLink.token])).v.success === false);

  // ── owner protection ──
  check('30 an admin cannot delete the owner\'s account', !(await as(admin.u, `select public.delete_account($1)`, [A.pid])).ok);
  const selfOwner = await as(admin.u, `update public.company_members set role = 'owner' where person_id = $1`, [admin.pid]);
  check('31 an admin cannot make themselves owner by editing the team list', !selfOwner.ok && (await one(`select role from public.company_members where person_id = $1`, [admin.pid])).role === 'admin', selfOwner.msg);
  check('32 nobody can demote or delete the owner row directly', !(await as(admin.u, `update public.company_members set role = 'worker' where person_id = $1`, [A.pid])).ok
    && !(await as(admin.u, `delete from public.company_members where person_id = $1`, [A.pid])).ok
    && (await one(`select role from public.company_members where person_id = $1`, [A.pid])).role === 'owner');
  check('33 a direct insert of an owner row is refused, and a worker editing the team list to deactivate a coworker changes nothing',
    !(await as(admin.u, `insert into public.company_members (company_id, person_id, role, status) values ($1, $2, 'owner', 'active')`, [A.cid, stranger.pid])).ok
    && (await as(w1.u, `update public.company_members set status = 'inactive' where person_id = $1`, [w2.pid]), true)
    && (await one(`select status from public.company_members where person_id = $1`, [w2.pid])).status === 'active');
  check('34 the owner cannot demote or deactivate themselves', !(await as(A.u, `select public.set_member_role($1, 'worker')`, [A.pid])).ok
    && !(await as(A.u, `select public.deactivate_member($1, true)`, [A.pid])).ok);

  // ── admin powers ──
  check('35 the owner makes a worker an admin; an admin cannot make another admin', (await as(A.u, `select public.set_member_role($1, 'admin')`, [w3.pid])).ok
    && !(await as(admin.u, `select public.set_member_role($1, 'admin')`, [w1.pid])).ok);
  check('36 the owner takes admin away: the person stays, active, as a worker', (await as(A.u, `select public.set_member_role($1, 'worker')`, [w3.pid])).ok
    && JSON.stringify(await one(`select role, status from public.company_members where person_id = $1`, [w3.pid])) === '{"role":"worker","status":"active"}');
  check('37 a former admin is refused by the owner functions straight away', !(await as(w3.u, `select public.time_scan_alerts() x`)).ok
    && !(await as(w3.u, `select public.deactivate_member($1, true)`, [w1.pid])).ok);
  check('38 both role changes are in the team history', (await count(`select count(*)::int n from public.membership_audit_log where target_id = $1 and event_type in ('admin_granted', 'admin_removed')`, [w3.pid])) === 2);
  check('39 the owner switches the four admin powers off', (await as(A.u, `select public.set_admin_permissions(false, false, false, false)`)).ok);
  const tc = await as(admin.u, `select public.time_staff_add_workday($1, current_date, now() - interval '5 hours', now() - interval '1 hour', 'forgot') x`, [w1.pid]);
  const pr = await as(admin.u, `select public.time_set_hourly_rate($1, 20, current_date, 'x')`, [w1.pid]);
  check('40 with the powers off, the database refuses the admin: team, invites, time corrections, pay rates',
    !(await as(admin.u, `select public.deactivate_member($1, true)`, [w1.pid])).ok && !(await as(admin.u, `select public.add_worker('No', 'Way', '5550100999') x`)).ok
    && !tc.ok && /not allowed admins/.test(tc.msg) && !pr.ok && /not allowed admins/.test(pr.msg), [tc.msg, pr.msg].join(' | '));
  await db.query(`insert into public.worker_hourly_rates (company_id, person_id, hourly_rate, effective_date) values ($1, $2, 22, '2020-01-01')`, [A.cid, w1.pid]);
  check('41 ...and the admin can no longer read pay rates, while the owner still can', await n(admin.u, `select count(*) from public.worker_hourly_rates`) === 0
    && await n(A.u, `select count(*) from public.worker_hourly_rates`) === 1);
  await as(A.u, `select public.set_admin_permissions(true, true, true, true)`);
  check('42 the owner switches them back on and the admin can read pay rates again', await n(admin.u, `select count(*) from public.worker_hourly_rates`) === 1);

  // ── deactivation ──
  const job = (await one(`insert into public.projects (company_id, name, status) values ($1, 'Back patio', 'active') returning id`, [A.cid])).id;
  const wd = (await one(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, clock_out_at, status)
    values ($1, $2, current_date - 2, now() - interval '50 hours', now() - interval '42 hours', 'closed') returning id`, [A.cid, w2.pid])).id;
  await db.query(`insert into public.push_tokens (token, person_id) values ('tok-w2', $1)`, [w2.pid]);
  await db.query(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, status) values ($1, $2, $3, current_date + 1, 'scheduled')`, [A.cid, job, w2.pid]);
  await db.query(`insert into public.time_workdays (company_id, person_id, work_date, clock_in_at) values ($1, $2, current_date, now() - interval '1 hour')`, [A.cid, w1.pid]);
  const onClock = await as(A.u, `select public.deactivate_member($1, true)`, [w1.pid]);
  check('43 a person who is on the clock cannot be deactivated until their time is closed', !onClock.ok && /clocked in/.test(onClock.msg)
    && (await one(`select status from public.company_members where person_id = $1`, [w1.pid])).status === 'active', onClock.msg);
  await db.query(`delete from public.time_workdays where person_id = $1 and clock_out_at is null`, [w1.pid]);
  const warn = await as(A.u, `select public.deactivate_member($1, false)`, [w2.pid]);
  const chk = await as(A.u, `select public.member_deactivation_check($1) x`, [w2.pid]);
  check('44 unfinished work is shown as a warning (the upcoming job) and needs a confirmation', !warn.ok && /confirm/.test(warn.msg)
    && chk.ok && chk.v.warnings.some((w) => /upcoming job/.test(w)), JSON.stringify({ warn: warn.msg, chk: chk.v }));
  check('45 with the confirmation the owner deactivates the worker', (await as(A.u, `select public.deactivate_member($1, true)`, [w2.pid])).ok);
  const myDay = await as(w2.u, `select public.time_my_day(current_date) x`);
  const clockIn = await as(w2.u, `select public.time_clock_in(current_date) x`);
  check('46 the same old session can read nothing, see no workday and cannot clock in (membership is checked on every request)',
    await n(w2.u, `select count(*) from public.projects`) === 0 && !myDay.ok && !clockIn.ok && (await as(w2.u, `select public.is_member($1) x`, [A.cid])).v === false,
    JSON.stringify([myDay, clockIn.msg]));
  await as(w2.u, `update public.company_members set status = 'active' where person_id = $1`, [w2.pid]);
  check('47 they cannot switch themselves back on by editing the team list (the edit changes nothing)', (await one(`select status from public.company_members where person_id = $1`, [w2.pid])).status === 'inactive');
  check('48 their workday stays, the job stays scheduled for the owner to reassign, their phone is removed from push',
    (await count(`select count(*)::int n from public.time_workdays where id = $1`, [wd])) === 1
    && (await one(`select status from public.assignments where person_id = $1`, [w2.pid])).status === 'scheduled'
    && (await count(`select count(*)::int n from public.push_tokens where person_id = $1`, [w2.pid])) === 0);
  check('49 the deactivation is in the team history with who did it', (await count(`select count(*)::int n from public.membership_audit_log where event_type = 'member_deactivated' and target_id = $1 and actor_id = $2`, [w2.pid, A.pid])) >= 1);

  // ── reactivation ──
  check('50 a worker cannot reactivate anyone', !(await as(w1.u, `select public.reactivate_member($1)`, [w2.pid])).ok);
  await as(A.u, `select public.set_member_role($1, 'admin')`, [w3.pid]);
  await as(A.u, `select public.deactivate_member($1, true)`, [w3.pid]);
  const back = await as(A.u, `select public.reactivate_member($1)`, [w3.pid]);
  check('51 a deactivated admin comes back as a plain worker, never as admin', back.ok && (await one(`select role from public.company_members where person_id = $1`, [w3.pid])).role === 'worker'
    && (await as(w3.u, `select public.is_staff($1) x`, [A.cid])).v === false, back.msg);
  check('52 reactivating someone who is already active is refused', !(await as(A.u, `select public.reactivate_member($1)`, [w1.pid])).ok);

  // ── team history ──
  const histBefore = await count(`select count(*)::int n from public.membership_audit_log where company_id = $1`, [A.cid]);
  check('53 a history row cannot be written in someone else\'s name', !(await as(w1.u, `insert into public.membership_audit_log (company_id, event_type, actor_id) values ($1, 'fake', $2)`, [A.cid, A.pid])).ok);
  await as(A.u, `delete from public.membership_audit_log`);
  check('54 nobody can delete the team history through the app (owner included)', histBefore > 5 && (await count(`select count(*)::int n from public.membership_audit_log where company_id = $1`, [A.cid])) === histBefore);

  // ── a person who owns no company may delete their own login ──
  const leaver = await member(A.cid, 'leaver@example.com', 'worker', 'Lee');
  check('55 a worker (who owns no company) can delete their own account: the login goes, the membership becomes inactive',
    (await as(leaver.u, `select public.delete_my_account()`)).ok && (await count(`select count(*)::int n from auth.users where id = $1`, [leaver.u])) === 0
    && (await one(`select status from public.company_members where person_id = $1`, [leaver.pid])).status === 'inactive');

  // ── crews ──
  const crew1 = (await as(A.u, `insert into public.crews (company_id, name) values ($1, 'Crew One') returning id`, [A.cid])).v;
  const crew2 = (await as(A.u, `insert into public.crews (company_id, name) values ($1, 'Crew Two') returning id`, [A.cid])).v;
  check('56 crew names are unique without caring about capitals or spaces', !(await as(A.u, `insert into public.crews (company_id, name) values ($1, 'crew one ')`, [A.cid])).ok);
  await as(A.u, `insert into public.crew_members (company_id, crew_id, person_id) values ($1, $2, $3), ($1, $4, $3)`, [A.cid, crew1, w1.pid, crew2]);
  await as(A.u, `delete from public.crew_members where crew_id = $1 and person_id = $2`, [crew1, w1.pid]);
  check('57 taking a worker out of one crew leaves their other crews', (await count(`select count(*)::int n from public.crew_members where person_id = $1`, [w1.pid])) === 1);
  await as(A.u, `insert into public.crew_members (company_id, crew_id, person_id) values ($1, $2, $3)`, [A.cid, crew1, w3.pid]);
  await as(A.u, `delete from public.crews where id = $1`, [crew1]);
  check('58 deleting a crew frees its members (the other crew keeps its own)', (await count(`select count(*)::int n from public.crew_members where crew_id = $1`, [crew1])) === 0
    && (await count(`select count(*)::int n from public.crew_members where crew_id = $1`, [crew2])) === 1);
  await as(w1.u, `update public.crews set name = 'Hackers' where id = $1`, [crew2]);
  check('59 a worker cannot rename a crew', (await one(`select name from public.crews where id = $1`, [crew2])).name === 'Crew Two');

  // ── deleting an unused team member ──
  const del = (u, pid) => as(u, `select public.delete_unused_member($1) x`, [pid]);
  const uw1 = (await as(A.u, `select public.add_worker('Never', 'Used', '5550107001') x`)).v.person_id;
  const uw2 = (await as(A.u, `select public.add_worker('Worked', 'Once', '5550107002') x`)).v.person_id;
  const uc1 = (await as(A.u, `select public.add_customer('New', 'Cust', '', '5550107003') x`)).v.person_id;
  const uc2 = (await as(A.u, `select public.add_customer('Has', 'Job', '', '5550107004') x`)).v.person_id;
  await as(A.u, `insert into public.crew_members (company_id, crew_id, person_id) values ($1, $2, $3)`, [A.cid, crew2, uw1]);
  await db.query(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, status) values ($1, $2, $3, current_date, 'scheduled')`, [A.cid, job, uw2]);
  await db.query(`insert into public.projects (company_id, customer_id, name, status) values ($1, $2, 'Has a job', 'active')`, [A.cid, uc2]);
  const exists = async (pid) => (await count(`select count(*)::int n from public.people where id = $1`, [pid])) === 1;
  const delBefore = await count(`select count(*)::int n from public.membership_audit_log where event_type = 'member_deleted'`);
  const wDel = await del(w1.u, uw1);
  check('60 a worker cannot delete anyone', !wDel.ok && /not allowed/.test(wDel.msg), wDel.msg);
  const d1 = await del(A.u, uw1);
  check('61 the owner deletes a worker who never signed up and never worked: person, membership and crew place are gone', d1.ok && d1.v.deleted === true && !(await exists(uw1))
    && (await count(`select count(*)::int n from public.company_members where person_id = $1`, [uw1])) === 0
    && (await count(`select count(*)::int n from public.crew_members where person_id = $1`, [uw1])) === 0, JSON.stringify(d1));
  const d2 = await del(A.u, uw2);
  check('62 a worker with a scheduled job is refused (deactivate instead) and nothing is removed', !d2.ok && /HAS_HISTORY/.test(d2.msg) && /assignments/.test(d2.msg) && (await exists(uw2)), d2.msg);
  const d3 = await del(A.u, uc1);
  check('63 a customer with no records can be deleted', d3.ok && !(await exists(uc1)), d3.msg);
  const d4 = await del(A.u, uc2);
  check('64 a customer with a job is refused', !d4.ok && /HAS_HISTORY/.test(d4.msg) && /projects/.test(d4.msg), d4.msg);
  check('65 every deletion is written to the team history', (await count(`select count(*)::int n from public.membership_audit_log where event_type = 'member_deleted'`)) === delBefore + 2);
  check('66 the owner cannot delete themselves that way', !(await del(A.u, A.pid)).ok);

  // ── Remind (ask the worker to confirm a job) ──
  let jobs = 0;
  const mkJob = async (pid, state = 'awaiting', status = 'scheduled', name = null) => {
    const pj = (await one(`insert into public.projects (company_id, name, status) values ($1, $2, 'active') returning id`, [A.cid, name ?? `Remind job ${++jobs}`])).id;
    return (await one(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, is_full_day, status, confirmation_state)
      values ($1, $2, $3, current_date, true, $4, $5) returning id`, [A.cid, pj, pid, status, state])).id;
  };
  const remind = (u, id) => as(u, `select public.remind_worker_assignment($1) x`, [id]);
  const notes = (pid) => all(`select * from public.app_notifications where recipient_id = $1 and event_type = 'schedule_reminder'`, [pid]);
  const a1 = await mkJob(w1.pid, 'awaiting', 'scheduled', 'Vineyard patio');
  const wr = await remind(w3.u, a1);
  check('67 a worker cannot send a reminder', !wr.ok && /not allowed/.test(wr.msg), wr.msg);
  const r1 = await remind(A.u, a1);
  const note = (await notes(w1.pid))[0];
  check('68 the owner\'s Remind sends the worker one notice saying which job and when, asking them to confirm', r1.ok && r1.v.sent === true && (await notes(w1.pid)).length === 1
    && /Vineyard patio/.test(note.body) && /today/.test(note.body) && /confirm/i.test(note.body) && /confirm/i.test(note.title), JSON.stringify({ r1, note }));
  check('69 the notice is addressed to the worker and linked to the job', note.recipient_id === w1.pid && note.linked_entity_id === a1);
  const r2 = await remind(A.u, a1);
  check('70 a second tap within the hour sends nothing more and says why', r2.ok && r2.v.sent === false && r2.v.reason === 'recent' && (await notes(w1.pid)).length === 1, JSON.stringify(r2));
  await db.query(`update public.app_notifications set created_at = now() - interval '2 hours' where recipient_id = $1`, [w1.pid]);
  const r3 = await remind(A.u, a1);
  check('71 after an hour it can be sent again', r3.ok && r3.v.sent === true && (await notes(w1.pid)).length === 2, JSON.stringify(r3));
  const r4 = await remind(A.u, await mkJob(w1.pid, 'confirmed'));
  check('72 a job the worker already confirmed is not reminded', r4.ok && r4.v.sent === false && r4.v.reason === 'confirmed', JSON.stringify(r4));
  const r5 = await remind(A.u, await mkJob(uw2));
  check('73 a worker with no login cannot be reached: nothing is sent and the owner is told', r5.ok && r5.v.sent === false && r5.v.reason === 'no_login' && (await notes(uw2)).length === 0, JSON.stringify(r5));
  const r6 = await remind(A.u, await mkJob(w3.pid, 'awaiting', 'completed'));
  check('74 a finished job is not reminded', r6.ok && r6.v.sent === false && r6.v.reason === 'done', JSON.stringify(r6));
  await db.query(`insert into public.push_tokens (token, person_id) values ('tok-w3', $1)`, [w3.pid]);
  const r7 = await remind(A.u, await mkJob(w3.pid));
  check('75 it reports how many phones are registered (so a worker with none is told honestly)', r7.ok && r7.v.sent === true && typeof r7.v.devices === 'number', JSON.stringify(r7));

  // ── Task Leads ──
  const ann = await member(A.cid, 'ann@example.com', 'worker', 'Ann');
  const bo = await member(A.cid, 'bo@example.com', 'worker', 'Bo');
  const cy = await member(A.cid, 'cy@example.com', 'worker', 'Cy');
  const proj = async (name) => (await one(`insert into public.projects (company_id, name, status) values ($1, $2, 'active') returning id`, [A.cid, name])).id;
  const lead = async (id) => (await one(`select task_lead_id from public.projects where id = $1`, [id])).task_lead_id;
  const assign = (p, who, status = 'scheduled') => db.query(`insert into public.assignments (company_id, project_id, person_id, scheduled_date, status) values ($1, $2, $3, current_date, $4)`, [A.cid, p, who.pid, status]);
  const setLead = (p, pid) => as(A.u, `update public.projects set task_lead_id = $2 where id = $1`, [p, pid]);
  const pOne = await proj('One worker');
  await assign(pOne, ann);
  check('76 one worker on a job with no Task Lead becomes the Task Lead', (await lead(pOne)) === ann.pid);
  const pTwo = await proj('Two workers');
  await assign(pTwo, ann); await assign(pTwo, bo);
  check('77 a second worker added later does not take the lead; the owner can still pick someone else', (await lead(pTwo)) === ann.pid
    && (await setLead(pTwo, bo.pid)).ok && (await lead(pTwo)) === bo.pid);
  const pPicked = await proj('Owner picked');
  await setLead(pPicked, bo.pid);
  await assign(pPicked, ann);
  check('78 a lead the owner picked is never replaced', (await lead(pPicked)) === bo.pid);
  const pAdmin = await proj('Admin only');
  await assign(pAdmin, admin);
  const pCancel = await proj('Cancelled');
  await assign(pCancel, ann, 'cancelled');
  check('79 an admin on a job is never made lead, and a cancelled assignment does not count', (await lead(pAdmin)) === null && (await lead(pCancel)) === null);
  const custLead = await setLead(pTwo, c1.pid);
  check('80 a customer cannot be made Task Lead', !custLead.ok && /Task Lead must be/.test(custLead.msg) && (await lead(pTwo)) === bo.pid, custLead.msg);
  const task = async (p, title) => (await one(`insert into public.project_tasks (company_id, project_id, title, status, sort_order) values ($1, $2, $3, 'pending', 1) returning id`, [A.cid, p, title])).id;
  const complete = (who, id, extra = '') => as(who.u, `update public.project_tasks set status = 'completed'${extra} where id = $1`, [id]);
  const tOne = await task(pOne, 'Trim');
  const c0 = await complete(ann, tOne);
  check('81 the lone worker (now Task Lead) can complete a task on their job', c0.ok, c0.msg);
  await setLead(pTwo, null);
  const t1 = await task(pTwo, 'Dig');
  const c1r = await complete(bo, t1);
  check('82 by default anyone on a job with no Task Lead can check off a task, and the database stamps who did it', c1r.ok
    && (await one(`select completed_by from public.project_tasks where id = $1`, [t1])).completed_by === bo.pid, c1r.msg);
  const c2r = await complete(cy, await task(pTwo, 'Edge'));
  check('83 a worker who is not on the job cannot', !c2r.ok && /on this job/.test(c2r.msg), c2r.msg);
  await setLead(pTwo, ann.pid);
  const c3r = await complete(bo, await task(pTwo, 'Pour'));
  check('84 with a Task Lead picked, another worker on the job can still check off (the default)', c3r.ok, c3r.msg);
  const tFake = await task(pTwo, 'Level');
  await complete(ann, tFake, `, completed_by = '${bo.pid}'`);
  const fake = await one(`select completed_by, completed_at from public.project_tasks where id = $1`, [tFake]);
  check('85 the database stamps the real person and time, not a faked "completed by"', fake.completed_by === ann.pid && fake.completed_at !== null, JSON.stringify(fake));
  await db.query(`update public.companies set task_lead_only = true where id = $1`, [A.cid]);
  const tMulch = await task(pTwo, 'Mulch');
  const c4r = await complete(bo, tMulch);
  const c5r = await complete(ann, tMulch);
  check('86 with "Task Lead only" on, a worker who is not the lead cannot, the Task Lead can', !c4r.ok && /Task Lead/.test(c4r.msg) && c5r.ok, [c4r.msg, c5r.msg].join(' | '));
  await setLead(pTwo, null);
  const c6r = await complete(ann, await task(pTwo, 'Water'));
  check('87 "Task Lead only" with no lead picked: nobody on the job can', !c6r.ok && /no Task Lead/.test(c6r.msg), c6r.msg);
  await db.query(`update public.companies set task_lead_only = false where id = $1`, [A.cid]);
  check('88 a worker cannot rename a task', !(await as(bo.u, `update public.project_tasks set title = 'Hacked' where id = $1`, [t1])).ok);
  const reopen = await as(bo.u, `update public.project_tasks set status = 'pending' where id = $1`, [t1]);
  check('89 a worker on the job can reopen a task (the completion stamp is cleared)', reopen.ok && (await one(`select completed_by from public.project_tasks where id = $1`, [t1])).completed_by === null, reopen.msg);

  // ── a company delete that fails half way changes nothing ──
  check('90 another company\'s owner cannot delete this company, and an admin cannot even see the preview', !(await as(ownerB.u, `select public.delete_my_company('Acme Paving')`)).ok
    && !(await as(admin.u, `select public.company_closure_preview() x`)).ok);
  // A test-only table that refuses to let the company go, to make the delete fail after it has started.
  await db.exec(`create table public.zz_test_blocker (company_id uuid references public.companies(id) on delete restrict)`);
  await db.query(`insert into public.zz_test_blocker values ($1)`, [A.cid]);
  const membersBefore = await count(`select count(*)::int n from public.company_members where company_id = $1`, [A.cid]);
  const failed = await as(A.u, `select public.delete_my_company('Acme Paving')`);
  check('91 when the delete fails part way, the company, its team and the logins are all still there and the slot stays closed', !failed.ok
    && (await count(`select count(*)::int n from public.companies where id = $1`, [A.cid])) === 1
    && (await count(`select count(*)::int n from public.company_members where company_id = $1`, [A.cid])) === membersBefore
    && (await count(`select count(*)::int n from auth.users where id = $1`, [w1.u])) === 1
    && (await as(null, `select public.company_slot_open() x`)).v === false, failed.msg);
  check('92 ...no closure record or cleanup list was left, the delete switch is not left on, and no trigger is left switched off',
    (await count(`select count(*)::int n from public.company_closure_log`)) === 0 && (await count(`select count(*)::int n from public.storage_cleanup_queue where company_id = $1`, [A.cid])) === 0
    && (await one(`select coalesce(current_setting('app.allow_company_delete', true), '') f`)).f !== 'on'
    && (await count(`select count(*)::int n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace
         where s.nspname = 'public' and not t.tgisinternal and t.tgenabled = 'D'`)) === 0);
  await db.exec(`drop table public.zz_test_blocker`);
  const ok = await as(A.u, `select public.delete_my_company('Acme Paving')`);
  const leftovers = [];
  for (const row of await all(`select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace and s.nspname = 'public'
      where c.relkind = 'r' and c.relname not in ('company_closure_log', 'storage_cleanup_queue')
        and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)`)) {
    const k = await count(`select count(*)::int n from public.${row.relname} where company_id = $1`, [A.cid]);
    if (k > 0) leftovers.push(`${row.relname}:${k}`);
  }
  check('93 once the blocker is gone the delete works, and no table anywhere still holds a row of the deleted company', ok.ok && leftovers.length === 0, ok.msg || leftovers.join(', '));
  check('94 the other company and its people are untouched', (await count(`select count(*)::int n from public.company_members where company_id = $1`, [B])) === 2
    && (await count(`select count(*)::int n from auth.users where id = $1`, [ownerB.u])) === 1);
}
