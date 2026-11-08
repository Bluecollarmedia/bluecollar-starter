// supabase/updates/demo_company.sql: the App Store demo company. Real full schema on PGlite (NOT real Supabase).
// Run: node supabase/tests/demo_company.pglite.mjs <repo path>
//
// What is stand-in here (cannot be real in PGlite): the auth schema is the harness's tiny shim, widened below with the columns the script writes,
// plus an auth.identities table; pgcrypto is the real extension (so a bcrypt hash made by the script is checked with crypt()).
// NOT proven here: that Supabase's real Auth (GoTrue) accepts the email + password. That can only be checked live.
import fs from 'node:fs';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo, { extensions: { pgcrypto } });
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 400)}`); };
check('0 the full schema and all updates load', failures.length === 0, JSON.stringify(failures));

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;
const n = async (sql, p) => Number((await one(sql, p)).n);
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); };
const as = async (u, fn) => { await asUser(u); try { return await fn(); } finally { await asDb(); } };

// ── stand-ins for the parts of Supabase Auth the script writes ──
await db.exec(`
  create extension if not exists pgcrypto;
  alter table auth.users
    add column if not exists instance_id uuid, add column if not exists aud text, add column if not exists role text,
    add column if not exists encrypted_password text, add column if not exists email_confirmed_at timestamptz,
    add column if not exists raw_app_meta_data jsonb, add column if not exists updated_at timestamptz,
    add column if not exists confirmation_token text, add column if not exists recovery_token text,
    add column if not exists email_change_token_new text, add column if not exists email_change text,
    add column if not exists email_change_token_current text, add column if not exists phone_change text,
    add column if not exists phone_change_token text, add column if not exists reauthentication_token text;
  create table if not exists auth.identities (
    id uuid primary key default gen_random_uuid(), provider_id text not null, user_id uuid not null references auth.users(id) on delete cascade,
    identity_data jsonb not null, provider text not null, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz,
    unique (provider_id, provider));
`);

// ── a REAL company that must survive every demo run untouched ──
const signUp = async (email, meta) => {
  const u = (await one(`insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`, [email, JSON.stringify(meta)])).id;
  return { u, pid: (await one(`select id from public.people where user_id = $1`, [u])).id };
};
const real = await signUp('boss@real.test', { first_name: 'Real', last_name: 'Boss', company_name: 'Real Lawn Co' });
const realCo = (await one(`select company_id from public.company_members where person_id = $1 and role = 'owner'`, [real.pid])).company_id;
const realProj = (await one(`insert into public.projects (company_id, name, status) values ($1, 'Real Job', 'active') returning id`, [realCo])).id;
const realCust = await signUp('real.cust@real.test', { first_name: 'Rita', last_name: 'Real' });
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'customer','active')`, [realCo, realCust.pid]);
const realSnap = async () => JSON.stringify([
  await one(`select count(*)::int as n from public.companies`),
  (await one(`select name from public.companies where id = $1`, [realCo])).name,
  await one(`select count(*)::int as n from public.projects where company_id = $1`, [realCo]),
  await one(`select count(*)::int as n from public.people where id in ($1,$2)`, [real.pid, realCust.pid]),
  await one(`select count(*)::int as n from auth.users where id in ($1,$2)`, [real.u, realCust.u]),
]);
const realBefore = JSON.parse(await realSnap());
const realProjCount = async () => n(`select count(*)::int as n from public.projects where company_id = $1`, [realCo]);

const sql = fs.readFileSync(`${repo}/supabase/updates/demo_company.sql`, 'utf8');
const EMAILS = ['demo-owner@brightonlawn.com', 'demo-worker@brightonlawn.com', 'demo-snow@brightonlawn.com', 'demo-customer@brightonlawn.com'];
const PW = 'BrightonDemo2026!';
const runDemo = async () => { try { await db.exec(sql); return null; } catch (e) { return String(e.message); } };

const err1 = await runDemo();
check('1 demo_company.sql runs', err1 === null, err1);
if (err1) { console.log('stopping: first run failed'); process.exit(1); }
const snapshot = async () => ({
  users: await n(`select count(*)::int as n from auth.users`),
  identities: await n(`select count(*)::int as n from auth.identities`),
  people: await n(`select count(*)::int as n from public.people`),
  companies: await n(`select count(*)::int as n from public.companies`),
  members: await n(`select count(*)::int as n from public.company_members`),
  projects: await n(`select count(*)::int as n from public.projects`),
  tasks: await n(`select count(*)::int as n from public.project_tasks`),
  photos: await n(`select count(*)::int as n from public.project_photos`),
  storms: await n(`select count(*)::int as n from public.snow_storms`),
  visits: await n(`select count(*)::int as n from public.snow_visits`),
  media: await n(`select count(*)::int as n from public.snow_completion_media`),
  mstops: await n(`select count(*)::int as n from public.maintenance_stops`),
  mphotos: await n(`select count(*)::int as n from public.maintenance_photos`),
  assignments: await n(`select count(*)::int as n from public.assignments`),
  workdays: await n(`select count(*)::int as n from public.time_workdays`),
});
const first = await snapshot();
const firstIds = (await all(`select id from auth.users where email = any($1)`, [EMAILS])).map((r) => r.id).sort().join();

const err2 = await runDemo();
check('2 it runs a second time (re-runnable)', err2 === null, err2);
const second = await snapshot();
check('2b a second run leaves the same counts (nothing doubled, nothing left over)', JSON.stringify(first) === JSON.stringify(second), JSON.stringify({ first, second }));
const secondIds = (await all(`select id from auth.users where email = any($1)`, [EMAILS])).map((r) => r.id).sort().join();
check('2c the second run really recreated the logins (new ids)', firstIds !== secondIds && secondIds.length > 0);
check('2d the real company, its project and its people/logins are untouched by both runs', JSON.stringify(JSON.parse(await realSnap()).slice(1)) === JSON.stringify(realBefore.slice(1)) && (await realProjCount()) === 1, await realSnap());

// ── the 4 logins ──
const users = await all(`select u.id, u.email, u.email_confirmed_at, u.encrypted_password, u.aud, u.role, u.confirmation_token, u.recovery_token, u.email_change_token_new, u.email_change,
                                (select count(*)::int from auth.identities i where i.user_id = u.id and i.provider = 'email' and i.provider_id = u.id::text and i.identity_data->>'email' = u.email) as ids
                           from auth.users u where u.email = any($1) order by u.email`, [EMAILS]);
check('3 four auth users, each confirmed, with an email identity', users.length === 4 && users.every((u) => u.email_confirmed_at && u.ids === 1 && u.aud === 'authenticated' && u.role === 'authenticated'), JSON.stringify(users));
check('3b the GoTrue token columns are empty strings, not NULL', users.every((u) => u.confirmation_token === '' && u.recovery_token === '' && u.email_change_token_new === '' && u.email_change === ''));
const okPw = [];
for (const u of users) okPw.push((await one(`select (crypt($1, $2) = $2) as ok, ($2 like '$2%') as bcrypt`, [PW, u.encrypted_password])));
check('3c every user has a bcrypt hash that matches the shared password (and a wrong password does not)', okPw.every((x) => x.ok && x.bcrypt) && !(await one(`select (crypt('nope', $1) = $1) as ok`, [users[0].encrypted_password])).ok);
const uid = Object.fromEntries(users.map((u) => [u.email.split('@')[0], u.id]));

const people = await all(`select p.email, p.first_name, p.last_name, p.user_id from public.people p where lower(p.email) = any($1) order by p.email`, [EMAILS]);
check('4 four people linked to the logins with names and emails', people.length === 4 && people.every((p) => p.user_id && p.first_name && p.last_name), JSON.stringify(people));
const co = (await one(`select id, setup_completed_at, setup_state, active_mode from public.companies where name = 'Demo Landscaping Co.'`));
check('5 the demo company exists once, with setup completed', !!co && co.setup_completed_at && co.setup_state.done === true && (await n(`select count(*)::int as n from public.companies where name = 'Demo Landscaping Co.'`)) === 1);
const mem = Object.fromEntries((await all(`select p.email, m.role, m.status, m.works_maintenance, m.worker_type from public.company_members m join public.people p on p.id = m.person_id where m.company_id = $1 and p.email <> ''`, [co.id])).map((r) => [r.email, r]));
check('6 members: owner, worker, snow worker (workers), customer, all active', mem[EMAILS[0]]?.role === 'owner' && mem[EMAILS[1]]?.role === 'worker' && mem[EMAILS[2]]?.role === 'worker' && mem[EMAILS[3]]?.role === 'customer' && Object.values(mem).every((m) => m.status === 'active'), JSON.stringify(mem));
check('6b nobody can join the demo company by a team code', (await n(`select count(*)::int as n from public.team_codes where company_id = $1 and is_active`, [co.id])) === 0 && !(await one(`select join_by_code_enabled as b from public.company_join_settings where company_id = $1`, [co.id])).b);

// snow access
const staff = await all(`select p.email, (select count(*)::int from public.snow_staff_services s where s.person_id = st.person_id and s.company_id = st.company_id) as svc, st.status from public.snow_staff st join public.people p on p.id = st.person_id where st.company_id = $1`, [co.id]);
check('7 only the snow worker is on the Snow team (all 3 services)', staff.length === 1 && staff[0].email === EMAILS[2] && staff[0].svc === 3 && staff[0].status === 'active', JSON.stringify(staff));

// data exists
const cnt = (sqlText) => n(sqlText, [co.id]);
check('8 projects: one active (with the customer), one completed, one on hold', (await cnt(`select count(*)::int as n from public.projects where company_id = $1 and status = 'active' and customer_id is not null and customer_claimed_by is not null`)) === 1
  && (await cnt(`select count(*)::int as n from public.projects where company_id = $1 and status = 'completed'`)) === 1 && (await cnt(`select count(*)::int as n from public.projects where company_id = $1 and status = 'on_hold'`)) === 1);
const pj = await one(`select id, progress, task_lead_id from public.projects where company_id = $1 and status = 'active'`, [co.id]);
check('8b the active project has completed + in-progress tasks, a Task Lead who is the worker, partial progress', (await cnt(`select count(*)::int as n from public.project_tasks where company_id = $1 and status = 'completed'`)) >= 2 && (await cnt(`select count(*)::int as n from public.project_tasks where company_id = $1 and status = 'in_progress'`)) === 1
  && pj.task_lead_id === (await one(`select id from public.people where user_id = $1`, [uid['demo-worker']])).id && pj.progress > 0 && pj.progress < 100, JSON.stringify(pj));
check('8c shared AND internal project photos, updates, timeline, messages, announcements, trucks, project settings', (await cnt(`select count(*)::int as n from public.project_photos where company_id = $1 and is_customer_visible`)) >= 3
  && (await cnt(`select count(*)::int as n from public.project_photos where company_id = $1 and not is_customer_visible`)) >= 2
  && (await cnt(`select count(*)::int as n from public.project_updates where company_id = $1`)) >= 2 && (await cnt(`select count(*)::int as n from public.customer_timeline where company_id = $1`)) >= 3
  && (await cnt(`select count(*)::int as n from public.project_messages where company_id = $1`)) >= 3 && (await cnt(`select count(*)::int as n from public.announcements where company_id = $1`)) >= 2
  && (await cnt(`select count(*)::int as n from public.trucks where company_id = $1`)) >= 2 && (await cnt(`select count(*)::int as n from public.project_settings where company_id = $1`)) === 3);
check('8d the worker has a job today and later this week', (await cnt(`select count(*)::int as n from public.assignments a join public.people p on p.id = a.person_id where a.company_id = $1 and p.email = 'demo-worker@brightonlawn.com' and a.scheduled_date = current_date and a.status = 'scheduled'`)) === 1
  && (await cnt(`select count(*)::int as n from public.assignments a join public.people p on p.id = a.person_id where a.company_id = $1 and p.email = 'demo-worker@brightonlawn.com' and a.scheduled_date > current_date`)) >= 2);
check('8e the worker has time-clock history', (await cnt(`select count(*)::int as n from public.time_workdays where company_id = $1 and status = 'closed'`)) === 3 && (await cnt(`select count(*)::int as n from public.time_intervals where company_id = $1`)) === 3);

// chains: the customer is the contact / owner on the lawn + snow property, and everything hangs off the demo company
const chain = await one(`select (select count(*)::int from public.snow_property_contacts c join public.snow_properties sp on sp.id = c.property_id join public.people p on p.id = c.person_id
                                  where sp.company_id = $1 and p.email = 'demo-customer@brightonlawn.com' and c.removed_at is null and c.company_id = $1) as snow_contact,
                               (select count(*)::int from public.maintenance_properties mp join public.people p on p.id = mp.customer_id
                                  where mp.company_id = $1 and p.email = 'demo-customer@brightonlawn.com') as lawn_owner,
                               (select count(*)::int from public.maintenance_properties mp join public.properties pr on pr.id = mp.property_id join public.snow_properties sp on sp.property_id = pr.id
                                  where mp.company_id = $1 and pr.company_id = $1 and sp.company_id = $1 and pr.customer_id = mp.customer_id) as shared_place,
                               (select count(*)::int from public.maintenance_contracts mc join public.maintenance_properties mp on mp.id = mc.property_id where mc.company_id = $1 and mp.company_id = $1) as contracts`, [co.id]);
check('9 the customer is the Snow contact and the lawn property owner; one shared place; a contract', chain.snow_contact === 1 && chain.lawn_owner === 1 && chain.shared_place === 1 && chain.contracts === 1, JSON.stringify(chain));
const storms = await all(`select name, status from public.snow_storms where company_id = $1 order by created_at`, [co.id]);
check('9b snow: one ended storm (completed by the crew) and one upcoming draft', storms.length === 2 && storms.some((s) => s.status === 'ended') && storms.some((s) => s.status === 'draft'), JSON.stringify(storms));
const vis = await all(`select status, customer_notified_at is not null as notified, (select count(*)::int from public.snow_completion_media m where m.visit_id = v.id and m.shared_at is not null) as shared from public.snow_visits v
                         where v.company_id = $1 and v.status = 'completed'`, [co.id]);
check('9c three completed stops, each with photos already sent to the customer', vis.length === 3 && vis.every((v) => v.notified && v.shared === 2), JSON.stringify(vis));
const lead = await one(`select p.email from public.snow_routes r join public.people p on p.id = r.lead_person_id where r.company_id = $1 and r.cancelled_at is null limit 1`, [co.id]);
check('9d the snow worker leads the snow route', lead?.email === EMAILS[2]);

// ── as the CUSTOMER, through the real policies and RPCs ──
const cust = await as(uid['demo-customer'], async () => ({
  projects: await all(`select id, name, status from public.projects`),
  tasks: await all(`select title, status from public.project_tasks`),
  photos: await all(`select is_customer_visible as v from public.project_photos`),
  updates: await all(`select title from public.project_updates`),
  timeline: await all(`select title from public.customer_timeline`),
  messages: await all(`select body from public.project_messages`),
  snowProps: await all(`select name from public.snow_my_properties()`),
  snowHist: await all(`select visit_id, property_name, service, jsonb_array_length(media) as media from public.snow_customer_history()`),
  snowTl: await all(`select visit_id from public.snow_customer_timeline()`),
  lawnProps: await all(`select name from public.maintenance_my_properties()`),
  lawnHist: await all(`select stop_id, services, jsonb_array_length(photos) as photos from public.maintenance_customer_history()`),
  lawnNext: await all(`select service_date from public.maintenance_customer_next_visits()`),
  ctx: await one(`select public.get_my_context() as c`),
  otherCompanies: await all(`select name from public.companies`),
}));
check('10 the customer sees exactly their one project', cust.projects.length === 1 && cust.projects[0].name === 'Mitchell Backyard Patio & Planting', JSON.stringify(cust.projects));
check('10b ... only its COMPLETED tasks', cust.tasks.length === 2 && cust.tasks.every((t) => t.status === 'completed'), JSON.stringify(cust.tasks));
check('10c ... only shared photos, updates marked visible, the timeline and the message thread', cust.photos.length === 3 && cust.photos.every((p) => p.v) && cust.updates.length === 2 && cust.timeline.length === 4 && cust.messages.length === 4, JSON.stringify({ p: cust.photos.length, u: cust.updates.length, t: cust.timeline.length, m: cust.messages.length }));
check('11 snow_my_properties: the customer\'s Snow property (only theirs)', cust.snowProps.length === 1 && cust.snowProps[0].name === 'Mitchell Residence', JSON.stringify(cust.snowProps));
check('11b snow_customer_history: the finished stop with its 2 shared photos', cust.snowHist.length === 1 && cust.snowHist[0].service === 'plowing' && cust.snowHist[0].media === 2, JSON.stringify(cust.snowHist));
check('11c snow_customer_timeline agrees', cust.snowTl.length === 1);
check('12 maintenance_my_properties: the lawn property', cust.lawnProps.length === 1, JSON.stringify(cust.lawnProps));
check('12b maintenance_customer_history: two finished visits, 3 shared photos each (the staff-only one is hidden)', cust.lawnHist.length === 2 && cust.lawnHist.every((h) => h.photos === 3 && /Lawn cut/.test(h.services)), JSON.stringify(cust.lawnHist));
check('12c maintenance_customer_next_visits: the next planned visit', cust.lawnNext.length === 1, JSON.stringify(cust.lawnNext));
check('13 the customer\'s context says customer of the demo company, and cannot see the real company', cust.ctx.c.memberships.length === 1 && cust.ctx.c.memberships[0].role === 'customer' && cust.ctx.c.memberships[0].company_name === 'Demo Landscaping Co.' && cust.otherCompanies.every((c) => c.name === 'Demo Landscaping Co.'), JSON.stringify(cust.ctx.c.memberships));

// ── as the WORKER, the SNOW worker and the OWNER ──
const wk = await as(uid['demo-worker'], async () => ({
  today: await all(`select a.id from public.assignments a where a.scheduled_date = current_date and a.person_id = public.my_person_id()`),
  projects: await all(`select name from public.projects`),
  ctx: (await one(`select public.get_my_context() as c`)).c,
}));
check('14 the worker sees their job today and the project, as a worker of the demo company', wk.today.length === 1 && wk.projects.length >= 1 && wk.ctx.memberships[0].role === 'worker', JSON.stringify(wk));
const sn = await as(uid['demo-snow'], async () => ({
  routes: await all(`select * from public.snow_my_routes()`).catch((e) => ({ err: String(e.message) })),
  ctx: (await one(`select public.get_my_context() as c`)).c,
}));
check('15 the snow worker is a worker of the demo company and can call snow_my_routes', sn.ctx.memberships[0].role === 'worker' && !sn.routes.err, JSON.stringify(sn.routes).slice(0, 200));
const ow = await as(uid['demo-owner'], async () => ({
  projects: await all(`select name from public.projects`),
  storms: await all(`select name from public.snow_storms`),
  ctx: (await one(`select public.get_my_context() as c`)).c,
  companies: await all(`select name from public.companies`),
}));
check('16 the owner sees the 3 projects and 2 storms, and is the owner (not in onboarding)', ow.projects.length === 3 && ow.storms.length === 2 && ow.ctx.memberships[0].role === 'owner' && ow.companies.length === 1, JSON.stringify(ow));
const rl = await as(real.u, async () => ({ projects: await all(`select name from public.projects`), companies: await all(`select name from public.companies`) }));
check('17 the real owner cannot see any demo data', rl.projects.length === 1 && rl.projects[0].name === 'Real Job' && rl.companies.length === 1, JSON.stringify(rl));

// ── the cleanup leaves nothing behind ──
const orph = await n(`select count(*)::int as n from auth.identities i where not exists (select 1 from auth.users u where u.id = i.user_id)`);
check('18b no orphan identities', orph === 0);
// run the cleanup half on its own: remove everything demo, with the real company still there
await db.exec(sql.replace(/-- ══ 2\. Create the demo company[\s\S]*?\$demo\$;/, ''));
const gone = await n(`select (select count(*) from public.companies where name = 'Demo Landscaping Co.') + (select count(*) from auth.users where email = any($1)) + (select count(*) from auth.identities) + (select count(*) from public.people where lower(email) = any($1) or first_name = 'Luis') + (select count(*) from public.snow_visits) + (select count(*) from public.maintenance_stops) + (select count(*) from public.project_tasks where company_id <> $2)::int as n`, [EMAILS, realCo]);
check('19 cleanup alone removes the demo company, its logins, identities, people and snow/lawn history', gone === 0, gone);
check('19b ... and the real company is still untouched', JSON.stringify(JSON.parse(await realSnap())[1]) === JSON.stringify(realBefore[1]) && (await realProjCount()) === 1 && (await n(`select count(*)::int as n from public.companies`)) === 1);
const err3 = await runDemo();
check('20 and the script can create it all again after a cleanup', err3 === null && (await n(`select count(*)::int as n from auth.users where email = any($1)`, [EMAILS])) === 4, err3);

console.log(bad === 0 ? '\nALL PASS' : `\n${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
