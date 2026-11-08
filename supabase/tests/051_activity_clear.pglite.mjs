// Run: copy this file and ./helpers/fullSchema.mjs beside each other in a folder with @electric-sql/pglite installed, then:
//   node <file> <path to the repo>
// Proves update 51 on the REAL full schema + every update (PGlite, not real Supabase): the owner can archive, restore and delete
// activity-log entries by period; archived entries leave the normal feed; nobody else can touch the log; the "append only" rule
// still blocks every other change; and a project's activity can be cleared by owner/admin only.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + String(detail).slice(0, 220)}`); };
check('0 the full schema and all updates (including 051) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/051_activity_clear.sql`, 'utf8')); } catch (e) { again = false; }
check('0b update 51 can be run a second time', again);
const fails = async (sql, p) => { try { await db.query(sql, p); return { raised: false, msg: '' }; } catch (e) { return { raised: true, msg: String(e.message) }; } };
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u ?? ''}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };

const co = (await one(`insert into public.companies (name) values ('Test Co') returning id`)).id;
const mk = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const owner = await mk('owner@x.test', 'Owner');
const worker = await mk('worker@x.test', 'Worker');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1, $2, 'owner', 'active'), ($1, $3, 'worker', 'active')`, [co, owner.pid, worker.pid]);

const day = (offset, h = 12) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const startOfDay = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const ev = (action, when) => db.query(`insert into public.snow_activity_events (company_id, occurred_at, action, entity_type, note) values ($1, $2, $3, 'storm', 'n')`, [co, when, action]);
for (const [a, off] of [['storm.created', 0], ['storm.dispatched', 0], ['route.created', 0], ['storm.ended', -1], ['route.created', -1], ['storm.created', -40], ['storm.ended', -400]]) await ev(a, day(off));
const live = async () => (await one(`select count(*)::int n from public.snow_activity_events where company_id = $1 and archived_at is null`, [co])).n;
const archived = async () => (await one(`select count(*)::int n from public.snow_activity_events where company_id = $1 and archived_at is not null`, [co])).n;
const feed = async (arch) => (await db.query(`select * from public.snow_activity_feed($1, null, null, null, null, null, null, null, 200, $2)`, [co, arch])).rows;
check('1 fixtures: 7 entries', (await live()) === 7);

// ── who can use it
await asUser(worker.u);
let f = await fails(`select public.snow_clear_activity(null, null, 'archive')`);
check('2 a worker cannot clear the log', f.raised && /owner or an admin/.test(f.msg), f.msg);
await asUser(null);
f = await fails(`select public.snow_clear_activity(null, null, 'delete')`);
check('3 a signed-out caller cannot', f.raised, f.msg);
await asDb(); await db.exec('set role anon');
f = await fails(`select public.snow_clear_activity(null, null, 'delete')`);
check('4 the signed-out role is not allowed to call it', f.raised && /permission denied/i.test(f.msg), f.msg);
await asDb();
check('5 nothing changed so far', (await live()) === 7 && (await archived()) === 0);

// ── the append-only rule still holds for everything else
await asUser(owner.u);
await db.query(`update public.snow_activity_events set note = 'x' where company_id = $1`, [co]).catch(() => {});
await db.query(`delete from public.snow_activity_events where company_id = $1`, [co]).catch(() => {});
await db.query(`update public.snow_activity_events set archived_at = now() where company_id = $1`, [co]).catch(() => {});
await asDb();
const same = await one(`select count(*)::int n, count(*) filter (where note = 'n')::int notes, count(*) filter (where archived_at is not null)::int arch from public.snow_activity_events where company_id = $1`, [co]);
check('6 even the owner cannot edit, delete or archive entries directly: after trying, all 7 are unchanged', same.n === 7 && same.notes === 7 && same.arch === 0, JSON.stringify(same));
await asUser(owner.u);

// ── dry run, archive today
let r = (await one(`select public.snow_clear_activity($1, $2, 'archive', true) as r`, [startOfDay(0), startOfDay(1)])).r;
check('9 a dry run for today counts 3 and changes nothing', r.count === 3 && r.dry_run === true && (await live()) === 7, JSON.stringify(r));
r = (await one(`select public.snow_clear_activity($1, $2, 'archive') as r`, [startOfDay(0), startOfDay(1)])).r;
const liveNow = await feed(false);
check('10 archive today: 3 entries move to history; the normal feed shows the other 4 plus a short note', r.count === 3 && (await archived()) === 3 && liveNow.length === 5 && liveNow.some((e) => e.action === 'activity.archived'), JSON.stringify({ r, live: liveNow.length }));
const arch = await feed(true);
check('11 the Archived view shows exactly the archived entries', arch.length === 3 && arch.every((e) => e.action !== 'activity.archived'));
check('12 the note says what happened', /3 entries moved to history/.test(liveNow.find((e) => e.action === 'activity.archived').note), liveNow.find((e) => e.action === 'activity.archived')?.note);
r = (await one(`select public.snow_clear_activity($1, $2, 'archive') as r`, [startOfDay(0), startOfDay(1)])).r;
check('13 archiving the same period again only sweeps up the short note from the first time', r.count === 1, JSON.stringify(r));

// ── restore, then delete
r = (await one(`select public.snow_clear_activity($1, $2, 'restore') as r`, [startOfDay(0), startOfDay(1)])).r;
check('14 restore brings today back (the 3 entries and the note)', r.count === 4 && (await archived()) === 0, JSON.stringify(r));
r = (await one(`select public.snow_clear_activity($1, $2, 'delete') as r`, [startOfDay(-1), startOfDay(0)])).r;
const gone = await one(`select count(*)::int n from public.snow_activity_events where company_id = $1 and action in ('storm.ended','route.created') and occurred_at < $2 and occurred_at >= $3`, [co, startOfDay(0), startOfDay(-1)]);
check('15 delete yesterday: its 2 entries are gone for good', r.count === 2 && gone.n === 0, JSON.stringify({ r, gone }));
const years = (await db.query(`select * from public.snow_activity_years()`)).rows;
check('16 the years list shows this year (and last year) with counts', years.length >= 1 && years[0].live > 0, JSON.stringify(years));
r = (await one(`select public.snow_clear_activity(null, $1, 'archive') as r`, [startOfDay(-30)])).r;
check('17 "everything up to a date" archives the old entries (the ones 40 and 400 days old)', r.count === 2, JSON.stringify(r));
r = (await one(`select public.snow_clear_activity(null, null, 'delete') as r`)).r;
check('18 delete all time removes everything, leaving only the short note', r.count >= 1 && (await live()) === 1 && (await feed(false))[0].action === 'activity.deleted', JSON.stringify({ r, live: await live() }));

// ── other company's log is untouched
await asDb();
await db.exec(`set session_replication_role = replica`);
const co2 = (await one(`insert into public.companies (name) values ('Other') returning id`)).id;
await db.exec(`set session_replication_role = origin`);
await db.query(`insert into public.snow_activity_events (company_id, occurred_at, action, entity_type) values ($1, now(), 'storm.created', 'storm')`, [co2]);
await asUser(owner.u);
await db.query(`select public.snow_clear_activity(null, null, 'delete')`);
await asDb();
check('19 another company\'s log is never touched', (await one(`select count(*)::int n from public.snow_activity_events where company_id = $1`, [co2])).n === 1);

// ── the filter lists skip archived entries
await asDb();
await ev('storm.created', day(0));
await asUser(owner.u);
await db.query(`select public.snow_clear_activity(null, null, 'archive')`);
const opts = (await db.query(`select * from public.snow_activity_filter_options($1)`, [co])).rows;
check('20 filter lists do not include archived entries', !opts.some((o) => o.kind === 'action' && o.action === 'storm.created'), JSON.stringify(opts));

// ── project activity (landscaping)
await asDb();
const proj = (await one(`insert into public.projects (company_id, name) values ($1, 'Smith patio') returning id`, [co])).id;
const hist = (offset) => db.query(`insert into public.project_history (company_id, project_id, event_type, description, created_at) values ($1, $2, 'note', 'x', $3)`, [co, proj, day(offset)]);
await hist(0); await hist(0); await hist(-1); await hist(-50);
await asUser(worker.u);
f = await fails(`select public.clear_project_activity($1, null, null)`, [proj]);
check('21 a worker cannot clear a project\'s activity', f.raised && /owner or an admin/.test(f.msg), f.msg);
await asUser(owner.u);
r = (await one(`select public.clear_project_activity($1, $2, $3, true) as r`, [proj, startOfDay(0), startOfDay(1)])).r;
check('22 dry run counts today\'s project entries (2) and deletes nothing', r.count === 2 && (await asDb(), (await one(`select count(*)::int n from public.project_history where project_id = $1`, [proj])).n === 4), JSON.stringify(r));
await asUser(owner.u);
r = (await one(`select public.clear_project_activity($1, $2, $3) as r`, [proj, startOfDay(0), startOfDay(1)])).r;
await asDb();
check('23 clearing today removes just those 2; the rest stay', r.count === 2 && (await one(`select count(*)::int n from public.project_history where project_id = $1`, [proj])).n === 2);
await asUser(owner.u);
r = (await one(`select public.clear_project_activity($1, null, null) as r`, [proj])).r;
await asDb();
check('24 clearing all time empties the project\'s log', r.count === 2 && (await one(`select count(*)::int n from public.project_history where project_id = $1`, [proj])).n === 0);

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
