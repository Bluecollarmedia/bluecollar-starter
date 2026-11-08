// Sign-up and invite links: a login is joined to a person ONLY through a valid invite link, never by email.
import { freshDb } from '../helpers/setupDb.mjs';

export default async function run({ check }) {
  const { one, all, as, signUp, ownerWithCompany, extraCompany } = await freshDb();

  // ── creating the company ──
  check('1 before anyone signs up, Create a Company is open (anyone may ask)', (await as(null, `select public.company_slot_open() x`)).v === true);
  const owner = await ownerWithCompany('owner@example.com', 'Test Co');
  check('2 a sign-up carrying a company name makes the company with that person as its active owner', !!owner.cid
    && (await one(`select role, status from public.company_members where person_id = $1`, [owner.pid])).status === 'active');
  check('3 the slot is now closed and no team join code was made', (await as(null, `select public.company_slot_open() x`)).v === false
    && (await one(`select count(*)::int n from public.team_codes`)).n === 0);
  const second = await signUp('second@example.com', { first_name: 'Sec', last_name: 'Ond', company_name: 'Second Co' });
  check('4 one company per database: a second "Create a Company" makes no second company (the person is made, with no team)',
    (await one(`select count(*)::int n from public.companies`)).n === 1 && !!second.pid
    && (await one(`select count(*)::int n from public.company_members where person_id = $1`, [second.pid])).n === 0);
  const direct = await as(second.u, `select public.create_company('{"company_name":"Third Co"}'::jsonb) x`);
  check('4b ...and asking for it directly is refused with a plain message', !direct.ok && /invite link|already exists/i.test(direct.msg), direct.msg);

  // ── worker invite ──
  const add = await as(owner.u, `select public.add_worker('Gabe', 'Rivera', '(555) 010-0142') x`);
  check('5 the owner adds a worker by name and phone and gets a private link (only its hash is stored)', add.ok && typeof add.v.token === 'string'
    && (await one(`select count(*)::int n from public.invites where token_hash = $1`, [add.v.token])).n === 0, JSON.stringify(add));
  const look = await as(null, `select public.invite_lookup($1) x`, [add.v.token]);
  check('6 a signed-out visitor with the link sees only the company and the invited name', look.ok && look.v.valid === true && look.v.company_name === 'Test Co' && look.v.first_name === 'Gabe');
  const gabe = await signUp('gabe@example.com', { first_name: 'Gabriel', last_name: 'Rivera', invite_token: add.v.token });
  const gm = await one(`select p.id, p.user_id, m.status from public.people p join public.company_members m on m.person_id = p.id where p.id = $1`, [add.v.person_id]);
  check('7 signing up WITH the link joins that login to the invited worker record, now active (no second person)',
    gabe.pid === add.v.person_id && gm.user_id === gabe.u && gm.status === 'active', JSON.stringify({ gabe, gm }));
  const reuse = await signUp('thief@example.com', { first_name: 'T', last_name: 'X', invite_token: add.v.token });
  check('8 the same link cannot be used twice: a second sign-up with it gets a fresh person with no team',
    reuse.pid !== add.v.person_id && (await one(`select count(*)::int n from public.company_members where person_id = $1`, [reuse.pid])).n === 0);
  check('8b the used link shows as used', (await as(null, `select public.invite_lookup($1) x`, [add.v.token])).v.reason === 'used');

  // ── R5: no email takeover ──
  const cust = await as(owner.u, `select public.add_customer('Casey', 'Customer', 'casey@example.com', null) x`);
  check('9 the owner adds a customer with an email address (no login yet)', cust.ok && cust.v.outcome === 'created', JSON.stringify(cust));
  const proj = (await one(`insert into public.projects (company_id, customer_id, name) values ($1, $2, 'Casey job') returning id`, [owner.cid, cust.v.person_id])).id;
  const stranger = await signUp('CASEY@example.com', { first_name: 'Not', last_name: 'Casey' });
  check('10 R5: someone who signs up with the SAME email but no link gets their own new person, NOT the customer record',
    stranger.pid !== cust.v.person_id && (await one(`select user_id from public.people where id = $1`, [cust.v.person_id])).user_id === null);
  check('10b ...is on no team and cannot see the customer\'s job', (await one(`select count(*)::int n from public.company_members where person_id = $1`, [stranger.pid])).n === 0
    && (await as(stranger.u, `select count(*)::int n from public.projects where id = $1`, [proj])).v === 0);
  const ctx = await as(stranger.u, `select public.get_my_context() x`);
  check('10c ...and opening the app (get_my_context) joins them to nothing either', ctx.ok && ctx.v.memberships.length === 0, JSON.stringify(ctx));

  // ── customer invite ──
  const cinv = await as(owner.u, `select public.invite_send($1) x`, [cust.v.person_id]);
  const casey = await signUp('casey.real@example.com', { first_name: 'Casey', last_name: 'Customer', invite_token: cinv.v.token });
  check('11 the customer signs up with their link: same record, active, and now sees their job', casey.pid === cust.v.person_id
    && (await as(casey.u, `select count(*)::int n from public.projects where id = $1`, [proj])).v === 1);

  // ── who may invite ──
  check('12 a worker cannot add workers or send links', !(await as(gabe.u, `select public.add_worker('A', 'B', '5550100100') x`)).ok
    && !(await as(gabe.u, `select public.invite_send($1) x`, [cust.v.person_id])).ok);
  const coB = await extraCompany('Other Co');
  const ownerB = await signUp('ownerb@example.com', { first_name: 'B', last_name: 'Owner' });
  await h_member(one, coB, ownerB.pid, 'owner');
  check('13 another company\'s owner cannot send a link for this company\'s person', !(await as(ownerB.u, `select public.invite_send($1) x`, [cust.v.person_id])).ok);
  const revoke = await as(owner.u, `select public.add_worker('Rae', 'Voke', '5550100177') x`);
  await as(owner.u, `select public.invite_revoke($1)`, [revoke.v.invite_id]);
  const late = await signUp('rae@example.com', { first_name: 'Rae', last_name: 'Voke', invite_token: revoke.v.token });
  check('14 a revoked link no longer joins anyone', late.pid !== revoke.v.person_id);
  const audit = await all(`select event_type from public.membership_audit_log where company_id = $1`, [owner.cid]);
  check('15 invites and their use are written to the team history', audit.some((a) => a.event_type === 'invite_created') && audit.some((a) => a.event_type === 'invite_used'));
}

async function h_member(one, cid, pid, role) {
  await one(`insert into public.company_members (company_id, person_id, role, status) values ($1, $2, $3, 'active') returning id`, [cid, pid, role]);
}
