// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && copy this file (and ./helpers/fullSchema.mjs) beside it, then:
//   node <file> <path to the repo>
// Proves update 55 on the REAL full schema + every update (PGlite, not real Supabase): the owner can message each group of
// customers (landscaping, maintenance, Snow, everyone); only people with an account are reached; each gets ONE unread
// notification; a worker, a customer or a stranger cannot send; customers cannot read the announcements list.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 240)}`); };
check('0 the full schema and all updates (including 055) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/055_customer_announcements.sql`, 'utf8')); } catch (e) { again = false; }
check('0b update 55 can be run a second time', again);
const fails = async (sql, p) => { try { await db.query(sql, p); return { raised: false, msg: '' }; } catch (e) { return { raised: true, msg: String(e.message) }; } };
const one = async (sql, p) => (await db.query(sql, p)).rows[0];

const co = (await one(`insert into public.companies (name) values ('Test Co') returning id`)).id;
const mk = async (email, name, withAccount = true) => {
  if (!withAccount) {
    const pid = (await one(`insert into public.people (email, first_name, last_name) values ($1, $2, 'T') returning id`, [email, name])).id;
    return { u: null, pid };
  }
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const owner = await mk('owner@x.test', 'Owner');
const worker = await mk('worker@x.test', 'Worker');
const landscaping = await mk('land@x.test', 'Land');
const claimer = await mk('claim@x.test', 'Claim');
const maint = await mk('maint@x.test', 'Maint');
const snow = await mk('snow@x.test', 'Snow');
const memberOnly = await mk('member@x.test', 'Member');
const noAccount = await mk('typed@x.test', 'Typed', false);
const stranger = await mk('stranger@x.test', 'Stranger');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active'),($1,$3,'worker','active'),($1,$4,'customer','active'),($1,$5,'customer','active'),($1,$6,'customer','active')`, [co, owner.pid, worker.pid, landscaping.pid, memberOnly.pid, snow.pid]);

await db.query(`insert into public.projects (company_id, name, customer_id, customer_claimed_by, status) values ($1, 'P1', $2, $3, 'active'), ($1, 'P2 typed only', $4, null, 'active'), ($1, 'P3 done', $5, null, 'completed')`, [co, landscaping.pid, claimer.pid, noAccount.pid, stranger.pid]);
await db.query(`insert into public.maintenance_properties (company_id, name, customer_id, is_active) values ($1, 'M1', $2, true)`, [co, maint.pid]);
const sp = (await one(`insert into public.snow_properties (company_id, name, address) values ($1, 'S1', '1 Oak') returning id`, [co])).id;
await db.query(`insert into public.snow_property_contacts (company_id, property_id, name, person_id) values ($1, $2, 'Snow Contact', $3)`, [co, sp, snow.pid]);

const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const send = async (audience, title = 'Storm update', body = 'We plowed early today.') => (await one(`select public.send_customer_announcement($1, $2, $3) r`, [title, body, audience])).r;
const notifFor = async (pid, annId) => (await one(`select count(*)::int n, min(status) st from public.app_notifications where recipient_id = $1 and linked_entity_id = $2`, [pid, annId]));

await asUser(owner.u);
let r = await send('customers_landscaping');
await db.exec('reset role');
let a = await notifFor(landscaping.pid, r.announcement_id), b = await notifFor(claimer.pid, r.announcement_id), c = await notifFor(maint.pid, r.announcement_id);
check('1 landscaping: the project customer and the person who claimed it are reached, nobody else', r.recipients === 2 && a.n === 1 && b.n === 1 && c.n === 0, JSON.stringify({ r, a, b, c }));
check('2 each notification is one unread "announcement_posted" for that customer', (await one(`select count(*)::int n from public.app_notifications where linked_entity_id = $1 and status = 'unread' and event_type = 'announcement_posted' and metadata->>'to' = 'customers'`, [r.announcement_id])).n === 2);

await asUser(owner.u);
r = await send('customers_maintenance');
await db.exec('reset role');
check('3 maintenance: only maintenance customers', r.recipients === 1 && (await notifFor(maint.pid, r.announcement_id)).n === 1);
await asUser(owner.u);
r = await send('customers_snow');
await db.exec('reset role');
check('4 snow: only Snow property contacts with an account', r.recipients === 1 && (await notifFor(snow.pid, r.announcement_id)).n === 1);
await asUser(owner.u);
r = await send('customers_all');
await db.exec('reset role');
check('5 everyone: all five customers once each (a customer on two lists is not messaged twice)', r.recipients === 5 && (await one(`select count(distinct recipient_id)::int n from public.app_notifications where linked_entity_id = $1`, [r.announcement_id])).n === 5, JSON.stringify(r));
check('6 a customer who was only typed in (no account) and a finished project\'s customer are skipped', (await notifFor(noAccount.pid, r.announcement_id)).n === 0 && (await notifFor(stranger.pid, r.announcement_id)).n === 0);
check('7 the owner\'s history keeps the message and who it went to', (await one(`select count(*)::int n from public.announcements where audience like 'customers_%' and title = 'Storm update'`)).n === 4);

for (const [who, label] of [[worker, 'a worker'], [landscaping, 'a customer'], [stranger, 'a stranger']]) {
  await asUser(who.u);
  const f = await fails(`select public.send_customer_announcement('x', 'y', 'customers_all')`);
  await db.exec('reset role');
  check(`8 ${label} cannot send a customer message`, f.raised && /owner or an admin/.test(f.msg), f.msg);
}
await asUser(owner.u);
let f = await fails(`select public.send_customer_announcement('', 'body', 'customers_all')`);
check('9 an empty title is refused', f.raised && /title/.test(f.msg), f.msg);
f = await fails(`select public.send_customer_announcement('t', '   ', 'customers_all')`);
check('10 an empty message is refused', f.raised && /message/i.test(f.msg), f.msg);
f = await fails(`select public.send_customer_announcement('t', 'b', 'everybody')`);
check('11 an unknown audience is refused', f.raised && /who/i.test(f.msg), f.msg);
await db.exec('reset role');

await asUser(landscaping.u);
const own = await one(`select count(*)::int n from public.app_notifications`);
const anns = await one(`select count(*)::int n from public.announcements`);
await db.exec('reset role');
check('12 a customer sees their own notification but cannot read the announcements list', own.n >= 1 && anns.n === 0, JSON.stringify({ own, anns }));

console.log(results.every(Boolean) ? '\nall passed' : `\n${results.filter((x) => !x).length} failed`);
process.exit(results.every(Boolean) ? 0 : 1);
