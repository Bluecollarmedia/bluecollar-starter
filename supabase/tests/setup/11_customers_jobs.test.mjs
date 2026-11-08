// Customers and jobs: Add customer (no duplicates, no name guessing), customer portal access on/off, Message customers
// (who is reached, counts = sends), one customer record + one link, job sites (properties) and their guards, quote
// approval by link with a drawn signature, invoice links, problem reports, what a customer sees of tasks, automatic
// progress, and repeating schedules.
import { freshDb } from '../helpers/setupDb.mjs';

export default async function run({ check }) {
  await customers(check);
  await jobs(check);
}

// ════════════════════════ customers: add, access, messages, one link ════════════════════════
async function customers(check) {
  const { db, one, all, as, signUp, ownerWithCompany, extraCompany, member } = await freshDb();
  const A = await ownerWithCompany('owner@example.com', 'Company A');
  const admin = await member(A.cid, 'admin@example.com', 'admin', 'Ada');
  const w1 = await member(A.cid, 'worker@example.com', 'worker', 'Will');
  const B = await extraCompany('Company B');
  const ownerB = await signUp('ownerb@example.com', { first_name: 'Bo', last_name: 'B' });
  await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1, $2, 'owner', 'active')`, [B, ownerB.pid]);
  const people = async () => (await one(`select count(*)::int c from public.people`)).c;
  const memberOf = (co, pid) => one(`select role, status from public.company_members where company_id = $1 and person_id = $2`, [co, pid]);
  const add = (u, first, last, email, phone = null) => as(u, `select public.add_customer($1, $2, $3, $4) x`, [first, last, email, phone]);

  // ── Add customer ──
  let r = await add(w1.u, 'Pat', 'Smith', 'pat@example.com');
  check('1 a worker cannot add customers', !r.ok && /Only the owner or an admin/.test(r.msg), r.msg);
  let before = await people();
  r = await add(A.u, 'Pat', 'NoEmail', '');
  check('2 with no email: one new customer record, invite pending, no login', r.ok && r.v.outcome === 'created' && (await people()) === before + 1
    && (await memberOf(A.cid, r.v.person_id)).status === 'invited' && (await one(`select user_id from public.people where id = $1`, [r.v.person_id])).user_id === null, JSON.stringify(r));
  before = await people();
  r = await add(A.u, 'Pat', 'NoEmail', '');
  check('3 the same name with no email again is NOT guessed to be the same person (no name matching)', r.ok && r.v.outcome === 'created' && (await people()) === before + 1);
  const lee = await add(A.u, 'Lee', 'Placeholder', 'Lee@Example.com');
  before = await people();
  r = await add(A.u, 'Lee', 'Placeholder', 'lee@example.com');
  check('4 the same email again (any capitalisation) gives back the same record: no duplicate', lee.ok && r.ok && r.v.person_id === lee.v.person_id && r.v.outcome === 'already_customer' && (await people()) === before);

  const existing = await signUp('existing@example.com', { first_name: 'Existing', last_name: 'Account' });
  await db.query(`update auth.users set email_confirmed_at = now() where id = $1`, [existing.u]);   // R6: only a CONFIRMED login is linked
  await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1, $2, 'customer', 'active')`, [B, existing.pid]);
  before = await people();
  r = await add(A.u, 'Typed', 'Differently', 'EXISTING@example.com');
  check('5 someone who already has a CONFIRMED login (a customer of another company) is added as that SAME person, with access; no second person',
    r.ok && r.v.person_id === existing.pid && r.v.outcome === 'existing_account' && (await people()) === before && (await memberOf(A.cid, existing.pid)).status === 'active', JSON.stringify(r));
  check('6 ...their other company is untouched and their name is not overwritten by what the owner typed', (await memberOf(B, existing.pid)).status === 'active'
    && (await one(`select first_name from public.people where id = $1`, [existing.pid])).first_name === 'Existing');
  r = await add(A.u, 'Typed', 'Again', 'existing@example.com');
  check('7 adding them again changes nothing (already a customer here)', r.ok && r.v.outcome === 'already_customer'
    && (await one(`select count(*)::int c from public.company_members where company_id = $1 and person_id = $2`, [A.cid, existing.pid])).c === 1);
  const theirs = (await one(`insert into public.people (email, first_name, last_name) values ('shared@example.com', 'Their', 'Record') returning id`)).id;
  await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1, $2, 'customer', 'invited')`, [B, theirs]);
  r = await add(A.u, 'Mine', 'Own', 'shared@example.com');
  check('8 another company\'s typed-in record (no login) with the same email is not reused or changed: this company gets its own',
    r.ok && r.v.person_id !== theirs && r.v.outcome === 'created' && (await one(`select first_name from public.people where id = $1`, [theirs])).first_name === 'Their' && !(await memberOf(A.cid, theirs)));
  const selfOff = await signUp('selfoff@example.com', { first_name: 'Sal', last_name: 'Off' });
  await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1, $2, 'customer', 'inactive')`, [A.cid, selfOff.pid]);
  r = await add(A.u, 'Sal', 'Off', 'selfoff@example.com');
  check('9 an inactive customer the owner did NOT remove is given back as the same person (no duplicate)', r.ok && r.v.person_id === selfOff.pid && r.v.outcome === 'already_customer', JSON.stringify(r));
  r = await add(A.u, 'Wil', 'Liam', 'worker@example.com');
  check('10 an email that belongs to someone on the team is refused (they are not a customer)', !r.ok && /someone on your team/.test(r.msg), r.msg);
  const outsider = await member(B, 'outsider@example.com', 'worker', 'Otto');
  await db.query(`update auth.users set email_confirmed_at = now() where id = $1`, [outsider.u]);
  before = await people();
  r = await add(A.u, 'Out', 'Sider', 'outsider@example.com');
  check('11 a login that works for another company becomes a customer here as the same person; their other role is untouched',
    r.ok && r.v.person_id === outsider.pid && (await people()) === before && (await memberOf(B, outsider.pid)).role === 'worker' && (await memberOf(A.cid, outsider.pid)).role === 'customer');
  check('12 a first name is required and a bad email is refused', /first name/.test((await add(A.u, '', 'X', 'a@example.com')).msg ?? '')
    && /email/.test((await add(A.u, 'A', 'B', 'not-an-email')).msg ?? ''));

  // ── Customer portal access on/off ──
  const cora = await member(A.cid, 'cora@example.com', 'customer', 'Cora');
  const coraJob = (await one(`insert into public.projects (company_id, customer_id, name, status) values ($1, $2, 'Backyard', 'active') returning id`, [A.cid, cora.pid])).id;
  const nolan = (await add(A.u, 'Nolan', 'NoLogin', 'nolan@example.com')).v.person_id;
  const nolanLink = await as(A.u, `select public.invite_send($1::uuid) x`, [nolan]);
  const access = (u, pid, on) => as(u, `select public.set_customer_portal_access($1::uuid, $2) x`, [pid, on]);
  const status = async (pid) => (await memberOf(A.cid, pid)).status;
  const seesJob = async () => (await as(cora.u, `select count(*)::int n from public.projects where id = $1`, [coraJob])).v;
  const reach = async () => (await as(A.u, `select public.customer_message_reach() x`)).v;
  r = await access(w1.u, cora.pid, false);
  check('13 a worker cannot change customer access', !r.ok && /Only the owner/.test(r.msg), r.msg);
  check('14 only customers can be changed here: not a worker, not another company\'s person, not yourself',
    /not one of your customers/.test((await access(A.u, w1.pid, false)).msg ?? '') && /not one of your customers/.test((await access(A.u, ownerB.pid, false)).msg ?? '')
    && !(await access(A.u, A.pid, false)).ok);
  const reachBefore = await reach();
  check('15 before: the customer sees her job', (await seesJob()) === 1);
  r = await access(A.u, cora.pid, false);
  check('16 turning access off makes her inactive, her job is kept, and she can no longer read it', r.ok && r.v === 'inactive' && (await status(cora.pid)) === 'inactive'
    && (await one(`select count(*)::int c from public.projects where customer_id = $1`, [cora.pid])).c === 1 && (await seesJob()) === 0, JSON.stringify(r));
  const reachOff = await reach();
  check('17 Message customers no longer counts her', reachOff.customers_all === reachBefore.customers_all - 1 && reachOff.customers_active === reachBefore.customers_active - 1, JSON.stringify({ reachBefore, reachOff }));
  r = await add(A.u, 'Cora', 'Again', 'cora@example.com');
  check('18 while her access is off, Add customer does not quietly re-add her', !r.ok && /access was removed/.test(r.msg) && (await status(cora.pid)) === 'inactive', r.msg);
  check('19 turning it off twice is harmless', (await access(A.u, cora.pid, false)).v === 'inactive');
  r = await access(A.u, cora.pid, true);
  check('20 turning it back on: a customer with a login is active again and still sees her job', r.ok && r.v === 'active' && (await seesJob()) === 1
    && !!(await one(`select 1 x from public.company_members where person_id = $1 and deactivated_at is null and deactivated_by is null`, [cora.pid])), JSON.stringify(r));
  r = await access(A.u, nolan, false);
  check('21 turning off a customer who never signed up cancels their unused link', nolanLink.ok && r.ok && r.v === 'inactive'
    && (await one(`select status from public.invites where person_id = $1`, [nolan])).status === 'revoked', JSON.stringify({ nolanLink, r }));
  r = await as(A.u, `select public.invite_send($1::uuid) x`, [nolan]);
  check('22 while access is off no new link can be made', !r.ok && /access was removed/.test(r.msg), r.msg);
  r = await access(A.u, nolan, true);
  check('23 turning it on for someone who never signed up puts them back to invite pending, and a new link can be made', r.ok && r.v === 'invited'
    && (await as(A.u, `select public.invite_send($1::uuid) x`, [nolan])).ok, JSON.stringify(r));
  check('24 every access change is in the team history', (await one(`select count(*)::int c from public.membership_audit_log where company_id = $1 and event_type in ('customer_access_off', 'customer_access_on')`, [A.cid])).c === 4);

  // ── Message customers: who is reached ──
  const jo = await member(A.cid, 'jo@example.com', 'customer', 'Jo');
  const done = await member(A.cid, 'done@example.com', 'customer', 'Dot');
  await db.query(`insert into public.projects (company_id, customer_id, name, status) values ($1, $2, 'Jo job', 'active'), ($1, $3, 'Dot job', 'completed'), ($1, $4, 'Nolan job', 'active')`,
    [A.cid, jo.pid, done.pid, nolan]);
  const rc = await reach();
  const sendAll = await as(A.u, `select public.send_customer_announcement('Storm update', 'We start early tomorrow.', 'customers_all') x`);
  const sendActive = await as(admin.u, `select public.send_customer_announcement('Holiday', 'Closed Monday', 'customers_active') x`);
  check('25 the counts on Message customers equal exactly who a send reaches (everyone / active jobs); an admin may send too',
    sendAll.ok && sendActive.ok && sendAll.v.recipients === rc.customers_all && sendActive.v.recipients === rc.customers_active, JSON.stringify({ rc, sendAll, sendActive }));
  const got = async (pid, ann) => (await one(`select count(*)::int n from public.app_notifications where recipient_id = $1 and linked_entity_id = $2`, [pid, ann])).n;
  check('26 a customer with an active job (on both lists) gets ONE unread announcement_posted notice for customers', await got(jo.pid, sendAll.v.announcement_id) === 1
    && (await one(`select count(*)::int n from public.app_notifications where recipient_id = $1 and linked_entity_id = $2 and status = 'unread' and event_type = 'announcement_posted' and metadata->>'to' = 'customers'`, [jo.pid, sendAll.v.announcement_id])).n === 1);
  check('27 a customer whose only job is finished gets "everyone" messages but not "active jobs" ones', await got(done.pid, sendAll.v.announcement_id) === 1 && await got(done.pid, sendActive.v.announcement_id) === 0);
  check('28 a customer with no login yet is skipped, even with an active job', await got(nolan, sendAll.v.announcement_id) === 0 && await got(nolan, sendActive.v.announcement_id) === 0);
  check('29 workers are never reached by a customer message', await got(w1.pid, sendAll.v.announcement_id) === 0);
  check('30 the owner\'s history keeps each message and its audience', (await one(`select count(*)::int c from public.announcements where audience in ('customers_all', 'customers_active')`)).c === 2);
  const stranger = await signUp('stranger@example.com', { first_name: 'Stan', last_name: 'Ger' });
  check('31 a customer or someone on no team cannot send a customer message', /owner or an admin/.test((await as(jo.u, `select public.send_customer_announcement('x', 'y', 'customers_all') x`)).msg ?? '')
    && /owner or an admin/.test((await as(stranger.u, `select public.send_customer_announcement('x', 'y', 'customers_all') x`)).msg ?? ''));
  check('32 an empty title, an empty message or an unknown audience is refused', /title/.test((await as(A.u, `select public.send_customer_announcement('', 'b', 'customers_all') x`)).msg ?? '')
    && /message/i.test((await as(A.u, `select public.send_customer_announcement('t', '   ', 'customers_all') x`)).msg ?? '')
    && /who/i.test((await as(A.u, `select public.send_customer_announcement('t', 'b', 'everybody') x`)).msg ?? ''));
  check('33 a customer sees their own notice but cannot read the announcements list', (await as(jo.u, `select count(*)::int n from public.app_notifications`)).v >= 1
    && (await as(jo.u, `select count(*)::int n from public.announcements`)).v === 0);
  check('34 a worker cannot read the counts, and the audience helper cannot be called by anyone signed in', /owner or an admin/i.test((await as(w1.u, `select public.customer_message_reach() x`)).msg ?? '')
    && !(await as(A.u, `select public._customer_audience($1::uuid, 'customers_all') x`, [A.cid])).ok);

  // ── one customer record, one link ──
  const cathy = (await add(A.u, 'Cathy', 'Client', 'cathy@example.com', '7325550404')).v.person_id;
  const site = (await as(A.u, `select public.ensure_property($1::uuid, 'Cathy Home', '12 Elm St', 'Lakewood', 'NJ', '08701') x`, [cathy])).v.property_id;
  await db.query(`insert into public.projects (company_id, name, customer_id, property_id, status) values ($1, 'Patio', $2, $3, 'active')`, [A.cid, cathy, site]);
  const link = await as(A.u, `select public.invite_send($1::uuid) x`, [cathy]);
  const kat = await signUp('some.other.email@example.com', { first_name: 'Katherine', last_name: 'Clientele', invite_token: link.v?.token });
  const row = await one(`select first_name, last_name, email from public.people where id = $1`, [cathy]);
  check('35 signing up with the link (even with a different email) attaches the login to the SAME customer record', kat.pid === cathy, `${kat.pid} vs ${cathy}`);
  check('36 the name the owner typed stays; the email on file becomes the one they signed up with', row.first_name === 'Cathy' && row.last_name === 'Client' && row.email === 'some.other.email@example.com', JSON.stringify(row));
  check('37 she sees her job at once', (await as(kat.u, `select count(*)::int n from public.projects`)).v === 1);
  await db.query(`insert into public.projects (company_id, name, customer_id, property_id, status) values ($1, 'Tree removal', $2, $3, 'active')`, [A.cid, cathy, site]);
  check('38 a job added later shows up with no new link, and exactly one link was ever made for her', (await as(kat.u, `select count(*)::int n from public.projects`)).v === 2
    && (await one(`select count(*)::int c from public.invites where person_id = $1`, [cathy])).c === 1);
  check('39 a customer has no direct access to the job sites table', (await as(kat.u, `select count(*)::int n from public.properties`)).v === 0
    && (await one(`select count(*)::int c from public.properties where customer_id = $1`, [cathy])).c === 1);
}

// ════════════════════════ jobs: sites, documents, problems, tasks, schedules ════════════════════════
async function jobs(check) {
  const { db, one, all, as, signUp, ownerWithCompany, extraCompany, member } = await freshDb();
  const A = await ownerWithCompany('owner@example.com', 'Company A');
  const admin = await member(A.cid, 'admin@example.com', 'admin', 'Adam');
  const will = await member(A.cid, 'will@example.com', 'worker', 'Will');
  const wanda = await member(A.cid, 'wanda@example.com', 'worker', 'Wanda');
  const cathy = await member(A.cid, 'cathy@example.com', 'customer', 'Cathy');
  const dan = await member(A.cid, 'dan@example.com', 'customer', 'Dan');
  const B = await extraCompany('Company B');
  const ownerB = await signUp('ownerb@example.com', { first_name: 'Bo', last_name: 'B' });
  await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1, $2, 'owner', 'active')`, [B, ownerB.pid]);
  const custB = await member(B, 'custb@example.com', 'customer', 'Cy');
  const n = async (u, sql, p) => { const r = await as(u, sql, p); return r.ok ? Number(r.v) : `ERR ${r.msg}`; };

  // ── a customer link stays inside its company ──
  const job = (await one(`insert into public.projects (company_id, name, status) values ($1, 'A job', 'active') returning id`, [A.cid])).id;
  const jobB = (await one(`insert into public.projects (company_id, name, status) values ($1, 'B job', 'active') returning id`, [B])).id;
  let r = await as(A.u, `update public.projects set customer_id = $2 where id = $1`, [job, custB.pid]);
  check('40 a job cannot be linked to a customer of ANOTHER company', !r.ok && /not a customer of this company/.test(r.msg), r.msg);
  check('41 a job cannot have a team member as its customer', !(await as(A.u, `update public.projects set customer_id = $2 where id = $1`, [job, will.pid])).ok);
  r = await as(A.u, `update public.projects set customer_id = $2 where id = $1`, [job, cathy.pid]);
  check('42 linking a job to this company\'s own customer works', r.ok && (await one(`select customer_id from public.projects where id = $1`, [job])).customer_id === cathy.pid, r.msg);
  r = await as(A.u, `insert into public.quotes (company_id, project_id, customer_id, number) values ($1, $2, $3, 'Q-X1')`, [A.cid, job, custB.pid]);
  check('43 a quote cannot be made for another company\'s customer', !r.ok && /not a customer of this company/.test(r.msg), r.msg);
  r = await as(A.u, `insert into public.quotes (company_id, project_id, customer_id, number) values ($1, $2, $3, 'Q-X2')`, [A.cid, jobB, cathy.pid]);
  check('44 nor attached to another company\'s job', !r.ok, r.msg);
  r = await as(A.u, `insert into public.quotes (company_id, project_id, customer_id, number) values ($1, $2, $3, 'Q-X3')`, [A.cid, job, cathy.pid]);
  check('45 a normal quote for its own customer and job saves', r.ok, r.msg);

  // ── one way to write an address ──
  const key = async (a, c, s, z) => (await one(`select public.normalize_address($1, $2, $3, $4) x`, [a, c, s, z])).x;
  check('46 "123 Main St." and "123 MAIN STREET" (ZIP+4 too) are the same place; North/N and Avenue/Ave. are the same; another number is not',
    (await key('123 Main St.', 'Lakewood', 'NJ', '08701')) === (await key('123 MAIN STREET', 'lakewood', 'nj', '08701-1234'))
    && (await key('55 North Park Avenue', '', '', '44107')) === (await key('55 N Park Ave.', '', '', '44107'))
    && (await key('55 N Park Ave', '', '', '44107')) !== (await key('56 N Park Ave', '', '', '44107')));
  check('47 units are kept: "Apt 3", "#3" and "Unit 3" match each other but not unit 4',
    (await key('10 Oak St Apt 3', '', '', '08701')) === (await key('10 oak street #3', '', '', '08701'))
    && (await key('10 Oak St Unit 3', '', '', '08701')) === (await key('10 Oak St, Apt 3', '', '', '08701'))
    && (await key('10 Oak St Apt 3', '', '', '08701')) !== (await key('10 Oak St Apt 4', '', '', '08701')));
  check('48 another ZIP is another place; with no ZIP the city decides; a blank street gives an empty key',
    (await key('1 Main St', '', '', '08701')) !== (await key('1 Main St', '', '', '08702'))
    && (await key('1 Main St', 'Lakewood', 'NJ', '')) !== (await key('1 Main St', 'Toms River', 'NJ', '')) && (await key('  ', 'Lakewood', 'NJ', '08701')) === '');

  // ── job sites (properties) ──
  const addSite = (u, co, cust, addr, extra = '') => as(u, `insert into public.properties (company_id, customer_id, name, address, city, state, zip) values ($1, $2, 'Home', $3, 'Lakewood', $4, '08701') returning id`, [co, cust, addr, extra || 'NJ']);
  r = await addSite(A.u, A.cid, cathy.pid, '5 Elm St');
  const elm = r.v;
  check('49 the owner adds a job site for their own customer', r.ok, r.msg);
  r = await addSite(A.u, A.cid, cathy.pid, '5 Elm Street.', 'nj');
  check('50 the same place for the same customer cannot be saved twice, even typed differently', !r.ok && /duplicate|unique/i.test(r.msg), r.msg);
  r = await addSite(A.u, A.cid, custB.pid, '7 Elm St');
  check('51 a job site cannot be given to another company\'s customer', !r.ok && /not a customer of this company/.test(r.msg), r.msg);
  check('52 a worker cannot add job sites', !(await addSite(will.u, A.cid, cathy.pid, '6 Elm St')).ok);
  check('53 a worker can read job sites; another company\'s owner cannot', await n(will.u, `select count(*) from public.properties`) === 1 && await n(ownerB.u, `select count(*) from public.properties`) === 0);
  const elmJob = (await one(`insert into public.projects (company_id, name, status, customer_id) values ($1, 'Elm job', 'active', $2) returning id`, [A.cid, cathy.pid])).id;
  check('54 a job can use a job site of ITS OWN customer', (await as(A.u, `update public.projects set property_id = $2 where id = $1`, [elmJob, elm])).ok);
  const danJob = (await one(`insert into public.projects (company_id, name, status, customer_id) values ($1, 'Dan job', 'active', $2) returning id`, [A.cid, dan.pid])).id;
  r = await as(A.u, `update public.projects set property_id = $2 where id = $1`, [danJob, elm]);
  check('55 ...but not one that belongs to a different customer', !r.ok && /different customer/.test(r.msg), r.msg);
  const siteB = (await one(`insert into public.properties (company_id, customer_id, address) values ($1, $2, '1 Other Rd') returning id`, [B, custB.pid])).id;
  r = await as(A.u, `update public.projects set property_id = $2 where id = $1`, [elmJob, siteB]);
  check('56 ...nor another company\'s job site', !r.ok && /different company/.test(r.msg), r.msg);

  // ── a job site is entered once: ensure_property ──
  const ens = (u, c, addr, city = 'Lakewood', zip = '08701') => as(u, `select public.ensure_property($1::uuid, null, $2, $3, 'NJ', $4) x`, [c, addr, city, zip]);
  r = await ens(A.u, dan.pid, '12 Oak Street');
  const oak = r.v?.property_id;
  check('57 the owner adds a job site for a customer: it is created', r.ok && r.v.created === true, r.msg);
  r = await ens(A.u, dan.pid, '12 oak st.');
  check('58 the same customer + the same address typed differently gives the SAME site, not a second one', r.ok && r.v.created === false && r.v.property_id === oak
    && (await one(`select count(*)::int c from public.properties where customer_id = $1`, [dan.pid])).c === 1, r.msg);
  r = await ens(A.u, dan.pid, '14 Oak Street');
  check('59 a different address for the same customer is a second site of theirs', r.ok && r.v.created === true && (await one(`select count(*)::int c from public.properties where customer_id = $1`, [dan.pid])).c === 2);
  check('60 a worker cannot add sites; another company\'s owner cannot add to our customer', !(await ens(will.u, dan.pid, '1 Main St')).ok && !(await ens(ownerB.u, dan.pid, '5 Elm St')).ok);
  check('61 the customer must be one of ours and is required, and the street is required', !(await ens(A.u, custB.pid, '1 Main St')).ok
    && !(await as(A.u, `select public.ensure_property(null, null, '1 Main St') x`)).ok && !(await ens(A.u, dan.pid, '  ')).ok);
  await as(A.u, `update public.projects set property_id = $2, address = '12 Oak Street' where id = $1`, [danJob, oak]);
  r = await as(A.u, `update public.properties set address = '12 Oak Avenue' where id = $1`, [oak]);
  check('62 changing a site\'s address once changes it on the jobs that use it', r.ok && (await one(`select address from public.projects where id = $1`, [danJob])).address === '12 Oak Avenue', r.msg);
  await as(will.u, `update public.properties set address = 'Hacked' where id = $1`, [oak]);
  check('63 a worker cannot change a job site', (await one(`select address from public.properties where id = $1`, [oak])).address === '12 Oak Avenue');

  // ── quote approval by link, with a drawn signature ──
  let qn = 0;
  const quote = async (status = 'sent') => {
    qn += 1;
    const token = `tok${String(qn).padStart(2, '0')}${'x'.repeat(40)}`;
    const id = (await one(`insert into public.quotes (company_id, project_id, number, status, total, share_token, sent_at) values ($1, $2, $3, $4, 100, $5, now()) returning id`, [A.cid, job, `Q-${qn}`, status, token])).id;
    return { id, token };
  };
  const respond = async (token, approve, name, note, sig) => (await as(null, `select public.respond_by_link($1, $2, $3, $4, $5) x`, [token, approve, name, note, sig])).v;
  const quoteRow = (id) => one(`select status, approved_name, approved_signature, decline_reason from public.quotes where id = $1`, [id]);
  const SIG = 'M 10 20 L 30 40 L 55.5 60 M 70 80 L 90 100';
  let q = await quote();
  r = await respond(q.token, true, 'Eli Semah', null, SIG);
  let row = await quoteRow(q.id);
  check('64 a signed-out customer with the link approves with a drawn signature, and it is saved', r.success === true && row.status === 'approved' && row.approved_name === 'Eli Semah' && row.approved_signature === SIG, JSON.stringify({ r, row }));
  const shared = (await as(null, `select public.get_shared_document($1) x`, [q.token])).v;
  check('65 the shared page shows the signature to whoever holds the link', shared?.document?.approved_signature === SIG);
  q = await quote();
  r = await respond(q.token, true, 'Eli Semah', null, 'M 0 0 L 1 1"><script>alert(1)</script>');
  row = await quoteRow(q.id);
  check('66 a signature with anything but path text is refused and nothing is approved', r.success === false && r.error === 'bad_signature' && row.status === 'sent' && row.approved_signature === null, JSON.stringify({ r, row }));
  r = await respond(q.token, true, 'Eli Semah', null, 'M 1 1 ' + 'L 1 1 '.repeat(4000));
  check('67 an oversized signature is refused, and a name is required to approve', r.error === 'bad_signature' && (await respond(q.token, true, 'E', null, SIG)).error === 'name_required');
  r = await respond(q.token, false, null, 'Please add the back yard', null);
  row = await quoteRow(q.id);
  check('68 "Request changes" keeps the customer\'s note and needs no signature', r.success === true && row.status === 'declined' && row.decline_reason === 'Please add the back yard' && row.approved_signature === null, JSON.stringify({ r, row }));
  check('69 an answered quote cannot be answered again', (await respond(q.token, true, 'Eli Semah', null, SIG)).error === 'not_open');
  q = await quote();
  r = await respond(q.token, true, 'Eli Semah', null, null);
  check('70 approving without a signature still works (the signature is optional)', r.success === true && (await quoteRow(q.id)).status === 'approved');
  const draft = await quote('draft');
  check('71 a draft cannot be approved, and a made-up link opens nothing', (await respond(draft.token, true, 'Eli Semah', null, SIG)).success === false
    && (await respond('short', true, 'Eli Semah', null, SIG)).error === 'not_found');

  // ── invoice links ──
  const inv = await one(`insert into public.invoices (company_id, project_id, number, status, total, issued_at) values ($1, $2, 'INV-1', 'issued', 250, now()) returning id, share_token`, [A.cid, job]);
  check('72 an invoice gets its own private link token', typeof inv.share_token === 'string' && inv.share_token.length >= 32, JSON.stringify(inv));
  r = await as(null, `select public.get_shared_document($1) x`, [inv.share_token]);
  check('73 the public page shows an issued invoice by its link, with the job name and no private columns', r.ok && r.v?.kind === 'invoice' && r.v.document.number === 'INV-1'
    && r.v.project_name === 'A job' && !('created_by' in r.v.document), JSON.stringify(r).slice(0, 200));
  const invDraft = await one(`insert into public.invoices (company_id, project_id, number, status, total) values ($1, $2, 'INV-2', 'draft', 99) returning share_token`, [A.cid, job]);
  check('74 a DRAFT invoice never shows, even with its token', (await as(null, `select public.get_shared_document($1) x`, [invDraft.share_token])).v === null);
  r = await as(null, `select public.respond_by_link($1, true, 'Sneaky Customer', null) x`, [inv.share_token]);
  check('75 an invoice link can never approve anything, and the invoice is untouched', (!r.ok || r.v?.success === false)
    && (await one(`select status from public.invoices where id = $1`, [inv.id])).status === 'issued', JSON.stringify(r));
  const fromQuote = await one(`insert into public.invoices (company_id, project_id, quote_id, number, status, total, issued_at) values ($1, $2, (select id from public.quotes where number = 'Q-1'), 'INV-3', 'issued', 100, now()) returning share_token`, [A.cid, job]);
  check('76 an invoice made from a quote names that quote on the page', (await as(null, `select public.get_shared_document($1) x`, [fromQuote.share_token])).v?.quote_number === 'Q-1');
  let dupOk = true;
  try { await db.query(`insert into public.invoices (company_id, project_id, number, status, total, share_token) values ($1, $2, 'INV-X', 'draft', 1, $3)`, [A.cid, job, inv.share_token]); } catch { dupOk = false; }
  check('77 every link token is unique (a copy is refused)', !dupOk);

  // ── problem reports (against the real property_issues table: a report is always on a job) ──
  const patio = (await one(`insert into public.projects (company_id, name, status, customer_id) values ($1, 'Patio', 'active', $2) returning id`, [A.cid, cathy.pid])).id;
  const report = (u, by, type = 'tree_down', proj = patio, place = 'Patio', notes = 'Big oak across the drive') => as(u,
    `insert into public.property_issues (company_id, reported_by, issue_type, place_name, project_id, notes) values ($1, $2, $3, $4, $5, $6) returning id`, [A.cid, by, type, place, proj, notes]);
  r = await report(will.u, will.pid);
  const issue = r.v;
  const notes = await all(`select recipient_id, title, body, linked_entity_type, linked_entity_id, event_type from public.app_notifications where event_type = 'issue_reported'`);
  check('78 a worker reports a problem on a job: the owner and the admin are told (not the worker, not the customer)', r.ok && notes.length === 2
    && notes.every((x) => x.recipient_id === A.pid || x.recipient_id === admin.pid), JSON.stringify({ r, notes }));
  check('79 the notice says what and where, who reported it, and links to the report', notes[0]?.title === 'Tree down · Patio' && notes[0].body.includes('By Will')
    && notes[0].linked_entity_type === 'issue' && notes[0].linked_entity_id === issue, JSON.stringify(notes[0]));
  check('80 a report with no job, an unknown problem type, or in someone else\'s name is refused', !(await report(will.u, will.pid, 'damage', null)).ok
    && !(await report(will.u, will.pid, 'ufo')).ok && !(await report(will.u, wanda.pid, 'damage')).ok);
  check('81 a customer cannot file a report', !(await report(cathy.u, cathy.pid, 'damage')).ok);
  await report(wanda.u, wanda.pid, 'safety');
  check('82 a worker sees only their own reports; the owner sees all', await n(will.u, `select count(*) from public.property_issues`) === 1 && await n(A.u, `select count(*) from public.property_issues`) === 2);
  check('83 a worker cannot resolve a report; an unknown status is refused', await n(will.u, `with u as (update public.property_issues set status = 'resolved' where id = $1 returning 1) select count(*) from u`, [issue]) === 0
    && !(await as(A.u, `update public.property_issues set status = 'nope' where id = $1`, [issue])).ok);
  const before = (await one(`select updated_at from public.property_issues where id = $1`, [issue])).updated_at;
  await new Promise((res) => setTimeout(res, 15));
  r = await as(A.u, `update public.property_issues set status = 'resolved', resolved_by = $2, resolved_at = now(), resolution_note = 'Cleared' where id = $1`, [issue, A.pid]);
  const after = await one(`select updated_at, status from public.property_issues where id = $1`, [issue]);
  check('84 the owner resolves it and updated_at is refreshed', r.ok && after.status === 'resolved' && after.updated_at > before, JSON.stringify({ r, after }));
  const c0 = (await one(`select count(*)::int c from public.app_notifications where event_type = 'issue_reported'`)).c;
  await report(A.u, A.pid, 'other');
  const c1 = (await one(`select count(*)::int c from public.app_notifications where event_type = 'issue_reported'`)).c;
  check('85 when the owner reports, only the admin is told (not the owner themselves)', c1 - c0 === 1);
  await db.query(`delete from public.projects where id = $1`, [patio]);
  check('86 deleting the job removes its reports', (await one(`select count(*)::int c from public.property_issues`)).c === 0);

  // ── what a customer sees of tasks ──
  const elmTasks = elmJob;
  await db.query(`insert into public.project_tasks (company_id, project_id, title, status, sort_order) values ($1, $2, 'Dig', 'completed', 1), ($1, $2, 'Pave', 'pending', 2), ($1, $2, 'Seal', 'in_progress', 3)`, [A.cid, elmTasks]);
  const seen = await as(cathy.u, `select title, status from public.project_tasks where project_id = $1 order by sort_order`, [elmTasks]);
  check('87 the customer sees the completed task of her job, and not the pending or in-progress ones', seen.ok && seen.rows.length === 1 && seen.rows[0].title === 'Dig', JSON.stringify(seen));
  check('88 another customer sees none of that job\'s tasks', await n(dan.u, `select count(*) from public.project_tasks where project_id = $1`, [elmTasks]) === 0);
  check('89 a customer cannot change tasks', await n(cathy.u, `with u as (update public.project_tasks set status = 'pending' where project_id = $1 returning 1) select count(*) from u`, [elmTasks]) === 0);

  // ── automatic job progress from tasks ──
  // As the database itself, with no signed-in person left over from as() (task triggers look at who is signed in).
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`);
  const auto = (await one(`insert into public.projects (company_id, name, status) values ($1, 'Auto', 'active') returning id`, [A.cid])).id;
  const prog = async () => (await one(`select progress from public.projects where id = $1`, [auto])).progress;
  const t = [];
  for (let i = 0; i < 4; i++) t.push((await one(`insert into public.project_tasks (company_id, project_id, title, status, sort_order) values ($1, $2, 'T', 'pending', 1) returning id`, [A.cid, auto])).id);
  const setTask = (ids, st) => db.query(`update public.project_tasks set status = $2 where id = any($1::uuid[])`, [ids, st]);
  const p0 = await prog();
  await setTask([t[0]], 'completed'); const p1 = await prog();
  await setTask([t[1]], 'in_progress'); const p2 = await prog();
  await setTask([t[1], t[2], t[3]], 'completed'); const p3 = await prog();
  check('90 progress follows the tasks: 0% → one of four done 25% → plus one in progress (half) 38% → all done is held at 99% until the job is completed',
    p0 === 0 && p1 === 25 && p2 === 38 && p3 === 99, JSON.stringify([p0, p1, p2, p3]));
  await db.query(`insert into public.project_settings (company_id, project_id, auto_progress) values ($1, $2, false)`, [A.cid, auto]);
  await db.query(`update public.projects set progress = 40 where id = $1`, [auto]);
  await setTask([t[0]], 'pending');
  const off = await prog();
  await db.query(`update public.project_settings set auto_progress = true where project_id = $1`, [auto]);
  await setTask([t[0]], 'completed');
  const on = await prog();
  check('91 with automatic progress off a hand-set number is left alone; back on, the next task change re-estimates', off === 40 && on === 99, JSON.stringify({ off, on }));
  await db.query(`update public.projects set status = 'completed', progress = 100 where id = $1`, [auto]);
  await setTask([t[0]], 'pending');
  check('92 a completed job keeps 100%', (await prog()) === 100);

  // ── repeating schedules ──
  const route = (await one(`insert into public.projects (company_id, name, status) values ($1, 'Regular service', 'active') returning id`, [A.cid])).id;
  const S = (await as(A.u, `insert into public.schedule_series (company_id, project_id, person_id, frequency, start_date, start_time, end_time) values ($1, $2, $3, 'biweekly', '2026-10-12', '07:00', '15:00') returning id`, [A.cid, route, will.pid])).v;
  // Will is already on this job on Oct 26 (added by hand), so the repeat skips that day.
  await as(A.u, `insert into public.assignments (company_id, project_id, person_id, scheduled_date, is_full_day) values ($1, $2, $3, '2026-10-26', true)`, [A.cid, route, will.pid]);
  const extend = async (u, series, today, horizon = null) => { const x = await as(u, `select public.extend_schedule_series($1::uuid, $2::date, $3::int) x`, [series, today, horizon]); return x.ok ? x.v : `ERR ${x.msg}`; };
  const days = async (series) => (await all(`select to_char(scheduled_date, 'YYYY-MM-DD') d from public.assignments where series_id = $1 order by 1`, [series])).map((x) => x.d);
  const added = await extend(A.u, S, '2026-10-13', 56);
  const sRows = await all(`select start_time, end_time, confirmation_state, status from public.assignments where series_id = $1`, [S]);
  check('93 every two weeks from Mon Oct 12 (filled 8 weeks from Oct 13): Nov 9, Nov 23, Dec 7; Oct 12 is past and Oct 26 was already booked by hand',
    added === 3 && JSON.stringify(await days(S)) === '["2026-11-09","2026-11-23","2026-12-07"]'
    && sRows.every((x) => x.start_time === '07:00' && x.end_time === '15:00' && x.confirmation_state === 'awaiting' && x.status === 'scheduled')
    && (await one(`select count(*)::int c from public.assignments where person_id = $1 and scheduled_date = '2026-10-26'`, [will.pid])).c === 1, JSON.stringify({ added, d: await days(S), sRows }));
  check('94 each added day is written to the schedule history', (await one(`select count(*)::int c from public.schedule_changes where notes = 'Repeating schedule' and change_type = 'created'`)).c === 3);
  check('95 running it again adds nothing', (await extend(A.u, null, '2026-10-13', 56)) === 0);
  await as(A.u, `update public.assignments set status = 'cancelled' where series_id = $1 and scheduled_date = '2026-11-09'`, [S]);
  const again = await extend(A.u, null, '2026-10-20', 56);
  const nov9 = await all(`select status from public.assignments where scheduled_date = '2026-11-09'`);
  check('96 a day the owner cancelled is not brought back by a later top-up', again === 0 && nov9.length === 1 && nov9[0].status === 'cancelled', JSON.stringify({ again, nov9 }));
  const later = await extend(A.u, null, '2026-10-27', 56);
  check('97 a week later the window moves on and Dec 21 is added', later === 1 && (await days(S)).at(-1) === '2026-12-21', JSON.stringify({ later, d: await days(S) }));
  const M = (await as(A.u, `insert into public.schedule_series (company_id, project_id, person_id, frequency, start_date, end_date, is_full_day) values ($1, $2, $3, 'monthly', '2027-01-31', '2027-04-30', true) returning id`, [A.cid, route, wanda.pid])).v;
  const monthly = await extend(A.u, M, '2027-01-01', 365);
  check('98 monthly from Jan 31 lands on the last day of shorter months and stops at its end date', monthly === 4
    && JSON.stringify(await days(M)) === '["2027-01-31","2027-02-28","2027-03-31","2027-04-30"]', JSON.stringify({ monthly, d: await days(M) }));
  await as(A.u, `update public.schedule_series set stopped_at = now() where id = $1`, [S]);
  check('99 a stopped repeat is not topped up', (await extend(A.u, S, '2026-12-01', 56)) === 0 && (await days(S)).length === 4);
  check('100 a worker cannot create a repeat or restart one', !(await as(will.u, `insert into public.schedule_series (company_id, project_id, person_id, frequency, start_date) values ($1, $2, $3, 'weekly', '2026-10-13')`, [A.cid, route, will.pid])).ok
    && await n(will.u, `with u as (update public.schedule_series set stopped_at = null where id = $1 returning 1) select count(*) from u`, [S]) === 0
    && (await one(`select stopped_at is not null x from public.schedule_series where id = $1`, [S])).x === true);
  check('101 a worker can see the repeats but filling them in as a worker adds nothing', await n(will.u, `select count(*) from public.schedule_series`) === 2
    && (await extend(will.u, null, '2026-10-13', 56)) === 0);
  const C = (await as(A.u, `insert into public.schedule_series (company_id, project_id, person_id, frequency, interval_days, horizon_days, start_date, is_full_day) values ($1, $2, $3, 'custom', 10, 28, '2026-10-13', true) returning id`, [A.cid, route, wanda.pid])).v;
  const custom = await extend(A.u, C, '2026-10-13');
  check('102 a custom repeat every 10 days uses its own 4-week window: Oct 13, Oct 23, Nov 2', custom === 3 && JSON.stringify(await days(C)) === '["2026-10-13","2026-10-23","2026-11-02"]', JSON.stringify({ custom, d: await days(C) }));
  check('103 a custom repeat without a day count is refused', !(await as(A.u, `insert into public.schedule_series (company_id, project_id, person_id, frequency, start_date) values ($1, $2, $3, 'custom', '2026-10-13')`, [A.cid, route, wanda.pid])).ok);
}
