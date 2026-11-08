// Records and stored files: content reports, clearing a job's activity, the owner's private truck and job records, the truck
// service log, Company Resources (codes kept in the Vault, access per worker), the public weather switch in detail, the storage
// clean-up queue (deleted files and the clean-up job), and the old code / join-request functions staying gone.
import { freshDb } from '../helpers/setupDb.mjs';

export default async function run({ check }) {
  const { db, one, all, as, signUp, ownerWithCompany, extraCompany, member } = await freshDb();
  const A = await ownerWithCompany('owner@example.com', 'Company A');
  const admin = await member(A.cid, 'admin@example.com', 'admin', 'Ada');
  const marcus = await member(A.cid, 'marcus@example.com', 'worker', 'Marcus');
  const tyler = await member(A.cid, 'tyler@example.com', 'worker', 'Tyler');
  const carlos = await member(A.cid, 'carlos@example.com', 'worker', 'Carlos');
  const c1 = await member(A.cid, 'c1@example.com', 'customer', 'Cora');
  const c2 = await member(A.cid, 'c2@example.com', 'customer', 'Cal');
  const stranger = await signUp('stranger@example.com', { first_name: 'Stan', last_name: 'Ger' });
  const B = await extraCompany('Company B');
  const ownerB = await signUp('ownerb@example.com', { first_name: 'Bo', last_name: 'B' });
  await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1, $2, 'owner', 'active')`, [B, ownerB.pid]);
  const job = (await one(`insert into public.projects (company_id, customer_id, name, status) values ($1, $2, 'Cora job', 'active') returning id`, [A.cid, c1.pid])).id;
  const jobB = (await one(`insert into public.projects (company_id, name, status) values ($1, 'Their job', 'active') returning id`, [B])).id;
  const truck = (await one(`insert into public.trucks (company_id, name) values ($1, 'Truck 5') returning id`, [A.cid])).id;
  const truckB = (await one(`insert into public.trucks (company_id, name) values ($1, 'Their truck') returning id`, [B])).id;
  const n = async (u, sql, p) => { const r = await as(u, sql, p); return r.ok ? Number(r.v) : `ERR ${r.msg}`; };
  const cnt = async (sql, p) => (await one(sql, p)).n;
  const queued = async (key) => (await one(`select source_table from public.storage_cleanup_queue where file_key = $1`, [key]))?.source_table;

  // ── content reports ──
  const MSG = '55555555-5555-5555-5555-555555555555';
  const report = (u, by, reason = 'inappropriate', type = 'message', id = MSG) => as(u, `insert into public.content_reports (project_id, reported_by, content_type, content_id, reason, details)
    values ($1, $2, $3, $4, $5, 'x')`, [job, by, type, id, reason]);
  let r = await report(c1.u, c1.pid);
  check('1 the job\'s customer can report a message on it, as themself', r.ok, r.msg);
  check('2 the report\'s company is filled in from the job', (await one(`select company_id from public.content_reports`)).company_id === A.cid);
  r = await report(c1.u, c1.pid);
  check('3 reporting the same item twice is refused as a duplicate', !r.ok && /unique|duplicate/i.test(r.msg), r.msg);
  r = await report(c1.u, A.pid);
  check('4 a customer cannot file a report in someone else\'s name', !r.ok && /row-level security/.test(r.msg), r.msg);
  r = await report(c1.u, c1.pid, 'rude', 'message', '66666666-6666-6666-6666-666666666666');
  check('5 an unknown reason is refused', !r.ok && /check/i.test(r.msg), r.msg);
  r = await report(c1.u, c1.pid, 'spam', 'message', '66666666-6666-6666-6666-666666666666');
  check('6 a different message can be reported', r.ok, r.msg);
  const rw = await report(marcus.u, marcus.pid, 'inappropriate', 'photo', '77777777-7777-7777-7777-777777777777');
  const rc = await report(c2.u, c2.pid, 'inappropriate', 'photo', '77777777-7777-7777-7777-777777777777');
  check('7 a worker, or the customer of another job, cannot report on this job', !rw.ok && !rc.ok && /row-level security/.test(rw.msg) && /row-level security/.test(rc.msg), rw.msg + rc.msg);
  const CR = `select count(*) from public.content_reports`;
  check('8 ...and they see no reports', await n(marcus.u, CR) === 0 && await n(c2.u, CR) === 0);
  check('9 the reporter sees their own reports', await n(c1.u, CR) === 2);
  check('10 the reporter cannot mark a report handled', await n(c1.u, `with u as (update public.content_reports set status = 'handled' returning 1) select count(*) from u`) === 0
    && await cnt(`select count(*)::int n from public.content_reports where status = 'handled'`) === 0);
  check('11 the owner and an admin see every report', await n(A.u, CR) === 2 && await n(admin.u, CR) === 2);
  r = await report(A.u, A.pid, 'harassment', 'photo', '88888888-8888-8888-8888-888888888888');
  check('12 the owner can report too', r.ok, r.msg);
  r = await as(A.u, `update public.content_reports set status = 'handled', handled_note = 'removed it' where content_id = $1 and content_type = 'message'`, [MSG]);
  const h = await one(`select status, handled_by, handled_at from public.content_reports where content_id = $1`, [MSG]);
  check('13 the owner marks it handled; who and when are recorded', r.ok && h.status === 'handled' && h.handled_by === A.pid && !!h.handled_at, JSON.stringify({ r, h }));
  r = await as(A.u, `update public.content_reports set details = 'edited', reason = 'spam' where content_id = $1`, [MSG]);
  check('14 what a report says can never be edited (owner included)', !r.ok && /can't be changed/.test(r.msg), r.msg);
  await as(A.u, `delete from public.content_reports`);
  await as(c1.u, `delete from public.content_reports`);
  check('15 reports cannot be deleted', await cnt(`select count(*)::int n from public.content_reports`) === 3);
  check('16 a signed-out visitor cannot read reports', !(await as(null, CR)).ok);

  // ── clearing a job's activity (the job part; the Snow log is gone) ──
  for (const ago of ['0 seconds', '0 seconds', '1 day', '50 days']) {
    await db.query(`insert into public.project_history (project_id, event_type, description, created_at) values ($1, 'note', 'x', now() - $2::interval)`, [job, ago]);
  }
  const HIST = async () => cnt(`select count(*)::int n from public.project_history where project_id = $1`, [job]);
  const TODAY = `date_trunc('day', now()), date_trunc('day', now()) + interval '1 day'`;
  const rwk = await as(marcus.u, `select public.clear_project_activity($1, null, null) x`, [job]);
  const rcu = await as(c1.u, `select public.clear_project_activity($1, null, null) x`, [job]);
  check('17 a worker or the job\'s customer cannot clear a job\'s activity', !rwk.ok && /owner or an admin/.test(rwk.msg) && !rcu.ok && await HIST() === 4, rwk.msg);
  r = await as(A.u, `select public.clear_project_activity($1, ${TODAY}, true) x`, [job]);
  check('18 a dry run counts today\'s 2 entries and deletes nothing', r.ok && r.v.count === 2 && r.v.dry_run === true && await HIST() === 4, JSON.stringify(r));
  r = await as(admin.u, `select public.clear_project_activity($1, ${TODAY}) x`, [job]);
  check('19 an admin clears today: just those 2 go, the older ones stay', r.ok && r.v.count === 2 && await HIST() === 2, JSON.stringify(r));
  r = await as(A.u, `select public.clear_project_activity($1, null, null) x`, [job]);
  check('20 clearing all time empties the job\'s activity', r.ok && r.v.count === 2 && await HIST() === 0, JSON.stringify(r));

  // ── the owner's truck documents, notes and service log ──
  const docKey = `${A.cid}/trucks/${truck}/insurance.pdf`;
  const doc = await as(A.u, `insert into public.truck_documents (company_id, truck_id, kind, title, file_url, file_key, content_type, expires_on)
    values ($1, $2, 'insurance', 'Insurance 2026', 'https://files.example.com/insurance.pdf', $3, 'application/pdf', '2027-01-31') returning id`, [A.cid, truck, docKey]);
  check('21 the owner adds an insurance PDF for a truck, with an expiry date', doc.ok, doc.msg);
  const note = await as(A.u, `insert into public.truck_notes (company_id, truck_id, body) values ($1, $2, 'Needs new tires in March') returning id`, [A.cid, truck]);
  const edit = await as(A.u, `update public.truck_notes set body = 'Needs new tires in April' where id = $1`, [note.v]);
  check('22 the owner adds a private truck note and edits it', note.ok && edit.ok && (await one(`select body from public.truck_notes where id = $1`, [note.v])).body === 'Needs new tires in April', note.msg || edit.msg);
  check('23 only the known document kinds are accepted', !(await as(A.u, `insert into public.truck_documents (company_id, truck_id, kind, title, file_url) values ($1, $2, 'bogus', 'x', 'https://files.example.com/y')`, [A.cid, truck])).ok);
  const svc = (u, title, s, d, t = truck) => as(u, `insert into public.truck_maintenance (company_id, truck_id, title, serviced_on, due_on, notes) values ($1, $2, $3, $4, $5, 'Oil and filter')`, [A.cid, t, title, s, d]);
  const oil = await svc(A.u, 'Oil change', '2026-10-01', '2027-04-01');
  const tires = await svc(A.u, 'Tires', '2026-09-15', null);
  check('24 the owner logs truck service: title, date serviced, next due date (optional) and notes', oil.ok && tires.ok, oil.msg || tires.msg);
  check('25 a next-due date before the service date, or a blank title, is refused', !(await svc(A.u, 'Bad dates', '2026-10-01', '2026-09-01')).ok && !(await svc(A.u, '   ', '2026-10-01', null)).ok);
  check('26 a note, a document or a service record cannot be put on another company\'s truck',
    !(await as(A.u, `insert into public.truck_notes (company_id, truck_id, body) values ($1, $2, 'not mine')`, [A.cid, truckB])).ok
    && !(await as(A.u, `insert into public.truck_documents (company_id, truck_id, kind, title, file_url) values ($1, $2, 'other', 'x', 'https://files.example.com/z')`, [A.cid, truckB])).ok
    && !(await svc(A.u, 'Sneaky', '2026-10-01', null, truckB)).ok);
  const truckSeen = (u) => as(u, `select json_build_object('d', (select count(*) from public.truck_documents), 'n', (select count(*) from public.truck_notes), 'm', (select count(*) from public.truck_maintenance)) x`);
  for (const [i, [who, label]] of [[admin, 'an admin'], [marcus, 'a worker'], [c1, 'a customer'], [stranger, 'someone outside the company']].entries()) {
    const seen = await truckSeen(who.u);
    const tries = [await as(who.u, `insert into public.truck_notes (company_id, truck_id, body) values ($1, $2, 'sneaky')`, [A.cid, truck]),
      await as(who.u, `insert into public.truck_documents (company_id, truck_id, kind, title, file_url) values ($1, $2, 'other', 'sneaky', 'https://files.example.com/s')`, [A.cid, truck]),
      await svc(who.u, 'Nope', '2026-10-01', null)];
    check(`27${'abcd'[i]} ${label} sees none of the truck documents, notes or service records, and cannot add any`, seen.ok && seen.v.d === 0 && seen.v.n === 0 && seen.v.m === 0
      && tries.every((t) => !t.ok), JSON.stringify(seen));
  }
  for (const who of [admin, marcus]) {
    for (const sql of ['delete from public.truck_notes', 'delete from public.truck_documents', 'delete from public.truck_maintenance',
      `update public.truck_notes set body = 'changed'`, `update public.truck_maintenance set title = 'Hacked'`]) await as(who.u, sql);
  }
  const tAfter = await one(`select (select count(*)::int from public.truck_documents) d, (select count(*)::int from public.truck_notes) n, (select count(*)::int from public.truck_maintenance) m,
    (select body from public.truck_notes limit 1) b, (select count(*)::int from public.truck_maintenance where title = 'Hacked') h`);
  check('28 an admin or a worker cannot change or delete any of them (nothing was touched)', tAfter.d === 1 && tAfter.n === 1 && tAfter.m === 2 && tAfter.b === 'Needs new tires in April' && tAfter.h === 0, JSON.stringify(tAfter));
  const tch = await as(A.u, `update public.truck_maintenance set title = 'Oil and filter change', due_on = null where title = 'Oil change'`);
  const tdl = await as(A.u, `delete from public.truck_maintenance where title = 'Tires'`);
  const tdn = await as(A.u, `delete from public.truck_notes where id = $1`, [note.v]);
  check('29 the owner can change a service record and clear its due date, and delete a service record and a note', tch.ok && tdl.ok && tdn.ok
    && (await one(`select due_on from public.truck_maintenance where title = 'Oil and filter change'`))?.due_on === null
    && await cnt(`select count(*)::int n from public.truck_maintenance`) === 1 && await cnt(`select count(*)::int n from public.truck_notes`) === 0, tch.msg || tdl.msg || tdn.msg);
  const tdd = await as(A.u, `delete from public.truck_documents where id = $1`, [doc.v]);
  check('30 the owner deletes the truck document and its stored file goes on the clean-up queue', tdd.ok && await queued(docKey) === 'truck_documents', tdd.msg);

  // ── the owner's private job notes, pictures and materials lists ──
  const quote = (await one(`insert into public.projects (company_id, customer_id, name, status) values ($1, $2, 'Back yard quote', 'prospect') returning id`, [A.cid, c1.pid])).id;
  const picKey = `${A.cid}/owner/${quote}/site.jpg`;
  const addNote = (u, body, p = quote) => as(u, `insert into public.owner_project_notes (company_id, project_id, body) values ($1, $2, $3) returning id`, [A.cid, p, body]);
  const addPic = (u, p = quote, key = null) => as(u, `insert into public.owner_project_photos (company_id, project_id, file_url, file_key, caption) values ($1, $2, 'https://files.example.com/site.jpg', $3, 'Before') returning id`, [A.cid, p, key]);
  const addList = (u, p = quote) => as(u, `insert into public.owner_material_lists (company_id, project_id, title, items, source_text) values ($1, $2, 'Materials list', $3::jsonb, 'Order 12 yards') returning id`,
    [A.cid, p, JSON.stringify([{ category: 'Stone', item: 'Gravel', quantity: 12, unit: 'yards' }])]);
  const on = await addNote(A.u, 'Order 12 yards of gravel; 40 ft of edging');
  const op = await addPic(A.u, quote, picKey);
  const ol = await addList(A.u);
  check('31 while a job is only a quote (prospect), the owner keeps a private note, a picture with a caption and a materials list', on.ok && op.ok && ol.ok, on.msg || op.msg || ol.msg);
  await db.query(`update public.projects set status = 'active' where id = $1`, [quote]);
  const ownerSeen = (u) => as(u, `select json_build_object('n', (select count(*) from public.owner_project_notes), 'p', (select count(*) from public.owner_project_photos), 'l', (select count(*) from public.owner_material_lists)) x`);
  const oe = await as(A.u, `update public.owner_project_notes set body = 'Order 14 yards of gravel' where id = $1`, [on.v]);
  const os = await ownerSeen(A.u);
  check('32 once the job is active they are all still there, and the owner can edit the note', os.ok && os.v.n === 1 && os.v.p === 1 && os.v.l === 1 && oe.ok
    && (await one(`select body from public.owner_project_notes where id = $1`, [on.v])).body === 'Order 14 yards of gravel', JSON.stringify(os));
  check('33 an empty note is refused', !(await addNote(A.u, '   ')).ok);
  for (const [i, [who, label]] of [[admin, 'an admin'], [marcus, 'a worker'], [c1, 'the job\'s customer'], [stranger, 'someone outside the company']].entries()) {
    const seen = await ownerSeen(who.u);
    const tries = [await addNote(who.u, 'sneaky'), await addPic(who.u), await addList(who.u)];
    check(`34${'abcd'[i]} ${label} sees none of the owner's private notes, pictures or lists, and cannot add any`, seen.ok && seen.v.n === 0 && seen.v.p === 0 && seen.v.l === 0
      && tries.every((t) => !t.ok), JSON.stringify(seen));
  }
  for (const who of [admin, marcus, c1]) {
    for (const sql of ['delete from public.owner_project_notes', 'delete from public.owner_project_photos', 'delete from public.owner_material_lists',
      `update public.owner_project_notes set body = 'changed'`]) await as(who.u, sql);
  }
  const oAfter = await one(`select (select count(*)::int from public.owner_project_notes) n, (select count(*)::int from public.owner_project_photos) p,
    (select count(*)::int from public.owner_material_lists) l, (select body from public.owner_project_notes limit 1) b`);
  check('35 others cannot change or delete them either (nothing was touched)', oAfter.n === 1 && oAfter.p === 1 && oAfter.l === 1 && oAfter.b === 'Order 14 yards of gravel', JSON.stringify(oAfter));
  check('36 nothing can be attached to another company\'s job', !(await addNote(A.u, 'not mine', jobB)).ok && !(await addPic(A.u, jobB)).ok && !(await addList(A.u, jobB)).ok);
  const odp = await as(A.u, `delete from public.owner_project_photos where id = $1`, [op.v]);
  const odn = await as(A.u, `delete from public.owner_project_notes where id = $1`, [on.v]);
  check('37 the owner deletes the note and the picture; the picture\'s stored file goes on the clean-up queue', odp.ok && odn.ok
    && await cnt(`select count(*)::int n from public.owner_project_notes`) === 0 && await queued(picKey) === 'owner_project_photos', odp.msg || odn.msg);

  // ── Company Resources: codes in the Vault, access per worker ──
  const REVEAL = `select public.reveal_resource_secret($1) x`;
  const RES = `select count(*) from public.company_resources`;
  const grant = (u, rid, pid) => as(u, `insert into public.resource_access (company_id, resource_id, person_id) values ($1, $2, $3)`, [A.cid, rid, pid]);
  const res = await as(A.u, `insert into public.company_resources (company_id, category, name, description, truck_id) values ($1, 'vehicle', 'Truck 5 lockbox', 'Key is in the lockbox on the hitch', $2) returning id`, [A.cid, truck]);
  const rid = res.v;
  const setCode = await as(A.u, `select public.set_resource_secret($1, '4821')`, [rid]);
  const row = await one(`select has_secret, row_to_json(r)::text t from public.company_resources r where id = $1`, [rid]);
  check('38 the owner adds a truck lockbox code: the resource says it has a code, and the code itself is only in the Vault', res.ok && setCode.ok && row.has_secret === true
    && !row.t.includes('4821') && await cnt(`select count(*)::int n from vault.secrets where secret = '4821'`) === 1, res.msg || setCode.msg);
  check('39 a new resource gives no worker access by default', await cnt(`select count(*)::int n from public.resource_access where resource_id = $1`, [rid]) === 0 && await n(marcus.u, RES) === 0);
  const gm = await grant(A.u, rid, marcus.pid);
  check('40 the owner gives Marcus access, and can see the code', gm.ok && (await as(A.u, REVEAL, [rid])).v === '4821', gm.msg);
  check('41 Marcus sees the resource and its code, and only his own access row', await n(marcus.u, RES) === 1 && (await as(marcus.u, REVEAL, [rid])).v === '4821'
    && await n(marcus.u, `select count(*) from public.resource_access`) === 1);
  check('42 Marcus cannot read the secrets table, the Vault or the resource history', !(await as(marcus.u, `select count(*) from public.resource_secrets`)).ok
    && !(await as(marcus.u, `select count(*) from vault.decrypted_secrets`)).ok && await n(marcus.u, `select count(*) from public.resource_audit_log`) === 0);
  const tr1 = await as(tyler.u, REVEAL, [rid]);
  check('43 Tyler (no access) cannot find it, search for it or open its code, nor a resource that does not exist', await n(tyler.u, RES) === 0
    && await n(tyler.u, `select count(*) from public.company_resources where name ilike '%lock%'`) === 0 && !tr1.ok && /isn't available/.test(tr1.msg)
    && !(await as(tyler.u, REVEAL, ['99999999-0000-0000-0000-000000000000'])).ok, tr1.msg);
  const tSelf = await grant(tyler.u, rid, tyler.pid);
  await as(tyler.u, `update public.company_resources set name = 'hacked' where id = $1`, [rid]);
  const tSet = await as(tyler.u, `select public.set_resource_secret($1, '0000')`, [rid]);
  check('44 Tyler cannot give himself access, rename it or change its code', !tSelf.ok && !tSet.ok && (await one(`select name from public.company_resources where id = $1`, [rid])).name === 'Truck 5 lockbox'
    && (await as(A.u, REVEAL, [rid])).v === '4821', tSelf.msg);
  const gt = await grant(A.u, rid, tyler.pid);
  check('45 once the owner gives Tyler access he sees it and its code, and only his own access row', gt.ok && await n(tyler.u, RES) === 1 && (await as(tyler.u, REVEAL, [rid])).v === '4821'
    && await n(tyler.u, `select count(*) from public.resource_access`) === 1, gt.msg);
  const rv = await as(A.u, `delete from public.resource_access where resource_id = $1 and person_id = $2`, [rid, marcus.pid]);
  check('46 the owner takes Marcus\'s access away: he no longer sees it or its code', rv.ok && await n(marcus.u, RES) === 0 && !(await as(marcus.u, REVEAL, [rid])).ok, rv.msg);
  const deact = await as(A.u, `select public.deactivate_member($1, true)`, [tyler.pid]);
  const gInactive = await grant(A.u, rid, tyler.pid);
  check('47 deactivating Tyler removes his access; access cannot be given to an inactive worker; he sees nothing', deact.ok
    && await cnt(`select count(*)::int n from public.resource_access where person_id = $1`, [tyler.pid]) === 0 && !gInactive.ok && /active workers/.test(gInactive.msg)
    && await n(tyler.u, RES) === 0 && !(await as(tyler.u, REVEAL, [rid])).ok, deact.msg || gInactive.msg);
  const card = await as(A.u, `insert into public.company_resources (company_id, category, name, card_last_four, card_holder_id) values ($1, 'company_card', 'Fuel card', '1234', $2) returning id`, [A.cid, carlos.pid]);
  check('48 a company card keeps only its last four digits and who holds it', card.ok
    && JSON.stringify(await one(`select card_last_four, card_holder_id from public.company_resources where id = $1`, [card.v])) === JSON.stringify({ card_last_four: '1234', card_holder_id: carlos.pid }), card.msg);
  check('49 a card entry cannot hold a code', !(await as(A.u, `select public.set_resource_secret($1, '9876')`, [card.v])).ok);
  const addRes = (cat, name, desc, last4 = null) => as(A.u, `insert into public.company_resources (company_id, category, name, description, card_last_four) values ($1, $2, $3, $4, $5) returning name`, [A.cid, cat, name, desc, last4]);
  const bad = [await addRes('company_info', 'Card', '4111 1111 1111 1111'), await addRes('company_info', 'Card', 'CVV 123'), await addRes('company_card', 'Fuel', 'PIN 4455'),
    await as(A.u, `select public.set_resource_secret($1, '4111-1111-1111-1111')`, [rid]), await addRes('company_card', 'Bad', null, '12345')];
  check('50 card numbers, security codes and card PINs are refused (in a description or as a code), and last four must be 4 digits', bad.every((b) => !b.ok), JSON.stringify(bad.map((b) => b.ok)));
  const gate = await addRes('access_code', 'Yard gate', 'Gate on Pine St, code 2580 then #');
  check('51 a 4-digit gate code in a description is fine', gate.ok, gate.msg);
  const audit = await as(A.u, `select coalesce(json_agg(json_build_object('e', event_type, 'p', target_person_id, 'm', metadata) order by created_at), '[]') x from public.resource_audit_log`);
  const ev = audit.ok ? audit.v : [];
  const has = (e, f = () => true) => ev.some((x) => x.e === e && f(x));
  check('52 the owner\'s resource history shows created, code changed, access given, code seen and access removed (Tyler\'s with the reason "deactivated"), and never the code',
    audit.ok && has('created') && has('code_changed') && has('access_granted', (x) => x.p === marcus.pid) && has('access_granted', (x) => x.p === tyler.pid) && has('code_revealed')
    && has('access_revoked', (x) => x.p === marcus.pid) && has('access_revoked', (x) => x.p === tyler.pid && x.m?.reason === 'deactivated')
    && await cnt(`select count(*)::int n from public.resource_audit_log l where l::text like '%4821%'`) === 0, JSON.stringify(audit).slice(0, 400));
  const rdel = await as(A.u, `delete from public.company_resources where id = $1`, [rid]);
  check('53 deleting the resource removes its code from the Vault', rdel.ok && await cnt(`select count(*)::int n from vault.secrets where secret = '4821'`) === 0
    && await cnt(`select count(*)::int n from public.resource_secrets where resource_id = $1`, [rid]) === 0, rdel.msg);

  // ── the public weather switch in detail (06 covers default OFF, owner on, admin and signed-out refused) ──
  const invited = await signUp('invited@example.com', { first_name: 'Ivy', last_name: 'Invited' });
  await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1, $2, 'owner', 'invited')`, [A.cid, invited.pid]);
  const CONFIG = `select public.public_weather_config() x`;
  const SET = (on) => `select public.set_public_weather_enabled(${on}) x`;
  const direct = [];
  for (const u of [null, A.u, admin.u, marcus.u, c1.u]) {
    for (const [sql, p] of [[`select count(*) from public.public_weather_settings`], [`insert into public.public_weather_settings (company_id, enabled) values ($1, true)`, [A.cid]],
      [`update public.public_weather_settings set enabled = true`], [`delete from public.public_weather_settings`]]) {
      const x = await as(u, sql, p); if (x.ok || !/permission denied/i.test(x.msg)) direct.push({ u, sql, x });
    }
  }
  check('54 nobody (signed out, owner, admin, worker, customer) can read or change the weather switch table directly', direct.length === 0, JSON.stringify(direct));
  const refusals = [];
  for (const u of [marcus.u, c1.u, admin.u, invited.u]) { const x = await as(u, SET(true)); if (x.ok || !/Only the owner can do that/.test(x.msg)) refusals.push(x); }
  check('55 a worker, a customer, an admin and an owner who is only invited get the plain "Only the owner" refusal', refusals.length === 0, JSON.stringify(refusals));
  const nul = await as(A.u, SET('null'));
  check('56 a choice of neither on nor off is refused', !nul.ok && /Choose on or off/.test(nul.msg), nul.msg);
  check('57 after those refusals there is still no setting saved and the answer is OFF', await cnt(`select count(*)::int n from public.public_weather_settings`) === 0
    && (await as(null, CONFIG)).v.enabled === false);
  r = await as(A.u, SET(true));
  const wrow = await one(`select * from public.public_weather_settings`);
  const ans = (await as(null, CONFIG)).v;
  check('58 the owner turns it on: the setting records who and when, and a visitor gets exactly {"enabled": true} (no company, name or time)', r.ok && wrow.company_id === A.cid
    && wrow.enabled === true && wrow.updated_by === A.pid && !!wrow.updated_at && JSON.stringify(ans) === '{"enabled":true}', JSON.stringify({ r, wrow, ans }));
  r = await as(A.u, SET(false));
  check('59 the owner turns it off again and everyone sees OFF', r.ok && (await as(null, CONFIG)).v.enabled === false && (await as(marcus.u, CONFIG)).v.enabled === false);
  await as(A.u, SET(true)); await as(A.u, SET(true));
  check('60 turning it on twice keeps one setting for the company', await cnt(`select count(*)::int n from public.public_weather_settings`) === 1);
  await db.query(`insert into public.public_weather_settings (company_id, enabled) values ($1, false)`, [B]);
  const safe = (await as(null, CONFIG)).v.enabled;
  await db.query(`update public.public_weather_settings set enabled = true where company_id = $1`, [B]);
  check('61 if a second company ever existed and said OFF, the answer is OFF (fails safe); with both ON it is ON', safe === false && (await as(null, CONFIG)).v.enabled === true);
  await as(ownerB.u, SET(false));
  const wrows = await all(`select company_id, enabled from public.public_weather_settings`);
  check('62 an owner changes only their own company\'s setting', wrows.find((x) => x.company_id === A.cid)?.enabled === true && wrows.find((x) => x.company_id === B)?.enabled === false, JSON.stringify(wrows));

  // ── deleted files go on the clean-up queue ──
  const trg = await all(`select c.relname, p.proname from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal and p.proname in ('_enqueue_deleted_file', '_enqueue_deleted_issue_files')`);
  const withFiles = (await all(`select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' and c.relname <> 'storage_cleanup_queue'
    and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
    and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'file_key' and not a.attisdropped)`)).map((x) => x.relname);
  check('63 every table that keeps a stored file (job photos, task attachments, truck documents, the owner\'s private pictures, problem-report photos) queues the file when a row is deleted',
    [...new Set([...withFiles, 'project_photos', 'task_attachments', 'truck_documents', 'owner_project_photos'])].every((t) => trg.some((x) => x.relname === t && x.proname === '_enqueue_deleted_file'))
    && trg.some((x) => x.relname === 'property_issues' && x.proname === '_enqueue_deleted_issue_files'), JSON.stringify({ withFiles, trg }));
  const fileJob = (await one(`insert into public.projects (company_id, name, status) values ($1, 'Patio', 'active') returning id`, [A.cid])).id;
  const task = (await one(`insert into public.project_tasks (company_id, project_id, title) values ($1, $2, 'Lay stone') returning id`, [A.cid, fileJob])).id;
  const k = (f) => `${A.cid}/projects/${fileJob}/${f}`;
  const ph = (await one(`insert into public.project_photos (company_id, project_id, file_key, file_url) values ($1, $2, $3, 'https://files.example.com/a.jpg') returning id`, [A.cid, fileJob, k('a.jpg')])).id;
  await db.query(`delete from public.project_photos where id = $1`, [ph]);
  check('64 a job photo deleted on its own goes on the clean-up queue', await queued(k('a.jpg')) === 'project_photos');
  await db.query(`insert into public.project_photos (company_id, project_id, file_key, file_url) values ($1, $2, $3, 'https://files.example.com/b.jpg')`, [A.cid, fileJob, k('b.jpg')]);
  await db.query(`insert into public.task_attachments (company_id, project_id, task_id, media_type, file_url, file_key) values ($1, $2, $3, 'image', 'https://files.example.com/c.jpg', $4)`, [A.cid, fileJob, task, k('c.jpg')]);
  let pdel = ''; try { await db.query(`delete from public.projects where id = $1`, [fileJob]); } catch (e) { pdel = e.message; }
  check('65 when a job is deleted, its photos and task attachments go on the queue too (the rows go by themselves, the files must not stay)', pdel === ''
    && await queued(k('b.jpg')) === 'project_photos' && await queued(k('c.jpg')) === 'task_attachments', pdel);
  const issueKey = `${A.cid}/issues/i1.jpg`;
  await db.query(`insert into public.property_issues (company_id, reported_by, issue_type, project_id, photos) values ($1, $2, 'other', $3, $4::jsonb)`,
    [A.cid, marcus.pid, job, JSON.stringify([{ key: issueKey, url: 'https://files.example.com/i1.jpg' }, { key: 'https://already.example.com/a/link.jpg', url: 'https://x/l' }])]);
  await db.query(`delete from public.property_issues where project_id = $1`, [job]);
  check('66 the photos inside a deleted problem report are queued (real stored files only, never a web link)', await queued(issueKey) === 'property_issues'
    && await cnt(`select count(*)::int n from public.storage_cleanup_queue where file_key like '%already.example.com%'`) === 0);
  let rep = '';
  try {
    await db.query(`insert into public.project_photos (company_id, project_id, file_key, file_url) values ($1, $2, $3, 'https://files.example.com/a.jpg')`, [A.cid, job, k('a.jpg')]);
    await db.query(`delete from public.project_photos where file_key = $1`, [k('a.jpg')]);
  } catch (e) { rep = e.message; }
  check('67 deleting a file that is already queued is harmless (no error, no second entry)', rep === '' && await cnt(`select count(*)::int n from public.storage_cleanup_queue where file_key = $1`, [k('a.jpg')]) === 1, rep);

  // ── the clean-up job (05 covers what a company delete queues) ──
  await db.query(`insert into public.storage_cleanup_queue (company_id, source_table, file_key, kind) values ($1, 'company_folder', $2, 'prefix')`, [A.cid, `${A.cid}/`]);
  const pending = await cnt(`select count(*)::int n from public.storage_cleanup_queue where status = 'pending'`);
  const claimed = await all(`select * from public.storage_cleanup_claim(50)`);
  check('68 the clean-up job claims every pending item, each with its kind (file or folder)', claimed.length === pending && pending >= 7
    && claimed.every((x) => x.kind === 'file' || x.kind === 'prefix') && claimed.some((x) => x.kind === 'prefix'), JSON.stringify({ pending, claimed: claimed.length }));
  const pre = claimed.find((x) => x.kind === 'prefix');
  await db.query(`select public.storage_cleanup_finish($1::uuid, false, null, true)`, [pre.id]);
  const qrow = await one(`select status, attempts, next_attempt_at <= now() due, locked_until from public.storage_cleanup_queue where id = $1`, [pre.id]);
  check('69 a folder that still has files stays pending and due at once, without counting as a failed try', qrow.status === 'pending' && qrow.due && qrow.attempts === pre.attempts - 1
    && qrow.locked_until === null, JSON.stringify(qrow));
  const again = await all(`select * from public.storage_cleanup_claim(50)`);
  check('70 ...and is claimed again straight away (the other items are still locked by the first claim)', again.length === 1 && again[0].id === pre.id, JSON.stringify(again));
  await db.query(`select public.storage_cleanup_finish($1::uuid, true)`, [pre.id]);
  const done = await one(`select status, processed_at from public.storage_cleanup_queue where id = $1`, [pre.id]);
  check('71 only when the folder is really empty is it marked done', done.status === 'done' && done.processed_at !== null, JSON.stringify(done));
  check('72 nobody in the app (owner included) or signed out can claim, finish, count or read the clean-up items', !(await as(A.u, `select count(*) x from public.storage_cleanup_claim(5)`)).ok
    && !(await as(A.u, `select public.storage_cleanup_finish($1::uuid, true)`, [pre.id])).ok && !(await as(A.u, `select public.storage_cleanup_status() x`)).ok
    && !(await as(A.u, `select count(*) from public.storage_cleanup_queue`)).ok && !(await as(null, `select count(*) x from public.storage_cleanup_claim(5)`)).ok);

  // ── the old code / join-request functions stay gone (01 covers Snow and the project-code functions) ──
  const fns = new Set((await all(`select proname from pg_proc where pronamespace = 'public'::regnamespace`)).map((x) => x.proname));
  const gone = ['approve_join_request', 'decline_join_request', 'request_join', 'join_with_code', '_request_join', '_join_requests_guard', '_guard_requested_worker_type',
    'lookup_any_code', 'lookup_team_code', 'claim_project', '_claim_project', '_claim_maintenance', 'regenerate_maintenance_code', '_new_customer_code', '_maintenance_property_code'];
  check('73 the old join-code / join-request functions are gone', gone.every((f) => !fns.has(f)), JSON.stringify(gone.filter((f) => fns.has(f))));
  const live = ['invite_send', 'invite_lookup', 'invite_accept', 'invite_revoke', 'add_worker', 'add_customer', 'handle_new_user', 'deactivate_member', 'reactivate_member',
    'get_my_context', 'list_accounts', 'delete_account', 'delete_my_company', 'company_closure_preview', 'set_customer_portal_access', 'send_customer_announcement', 'ensure_property'];
  check('74 every function that replaced them is there (invite links, adding people, team access, closing the company)', live.every((f) => fns.has(f)), JSON.stringify(live.filter((f) => !fns.has(f))));
  check('75 the old join-request and code triggers are gone', await cnt(`select count(*)::int n from pg_trigger where not tgisinternal
    and tgname in ('maintenance_properties_code', 'join_requests_guard', 'join_requests_guard_worker_type')`) === 0);
}
