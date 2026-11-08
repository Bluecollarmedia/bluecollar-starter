// Update 104: Brighton's storm outlooks. Real full schema on PGlite (not real Supabase).
// Proves: only the exact owner can publish or end; every publish is a new locked version (the original is never changed); one active storm;
// half ranges and unsourced actual snowfall are refused; visitors read only while public Weather is on and never see who published; and
// applying the update changes nothing that already existed.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
const NEW = ['storm_outlooks', 'storm_outlook_versions'];
const NEWFN = ['storm_versions_are_permanent', 'storm_outlook_json', 'public_storm_current', 'public_storm_history', 'owner_storm_current', 'publish_storm_outlook', 'end_storm_outlook'];

{
  const { db: base, failures } = await buildFullSchema(repo, { upTo: 103 });
  check('0 the schema through update 103 loads', failures.length === 0, JSON.stringify(failures));
  const names = NEW.map((n) => `'${n}'`).join(',');
  const fns = NEWFN.map((n) => `'${n}'`).join(',');
  const snap = async () => ({
    policies: (await base.query(`select schemaname, tablename, policyname, cmd, roles::text as roles, qual, with_check from pg_policies where tablename not in (${names}) order by 1,2,3`)).rows,
    tableGrants: (await base.query(`select table_schema, table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name not in (${names}) order by 1,2,3,4`)).rows,
    functions: (await base.query(`select p.proname, p.proacl::text as acl, md5(pg_get_functiondef(p.oid)) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname not in (${fns}) order by 1, 2`)).rows,
    rls: (await base.query(`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname not in (${names}) order by 1`)).rows,
  });
  const before = await snap();
  await base.exec(fs.readFileSync(`${repo}/supabase/updates/104_storm_outlooks.sql`, 'utf8'));
  const after = await snap();
  check('1 applying 104 changes no existing policy', JSON.stringify(before.policies) === JSON.stringify(after.policies));
  check('2 applying 104 changes no existing table privilege', JSON.stringify(before.tableGrants) === JSON.stringify(after.tableGrants));
  check('3 applying 104 changes no existing function (definition or privileges)', JSON.stringify(before.functions) === JSON.stringify(after.functions));
  check('4 applying 104 changes no existing table\'s row security', JSON.stringify(before.rls) === JSON.stringify(after.rls));
}

const { db, failures } = await buildFullSchema(repo);
check('5 the full schema and all updates (including 104) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/104_storm_outlooks.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('6 update 104 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asRole = async (role, u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u ?? ''}', false); set role ${role};`); };
const asDb = async () => { await db.exec('reset role'); };
const call = async (role, u, sql, p) => { await asRole(role, u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };

const co = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
const mk = async (email, name) => {
  await asDb();
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const owner = await mk('owner@x.test', 'Owner');
const admin = await mk('admin@x.test', 'Admin');
const worker = await mk('worker@x.test', 'Worker');
const customer = await mk('customer@x.test', 'Customer');
const invitedOwner = await mk('invited@x.test', 'Invited');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'owner','active','landscaping'),($1,$3,'admin','active','landscaping'),($1,$4,'worker','active','landscaping'),($1,$5,'customer','active',null),($1,$6,'owner','invited','landscaping')`,
  [co, owner.pid, admin.pid, worker.pid, customer.pid, invitedOwner.pid]);

const PUB = (o = {}) => {
  const a = { id: null, name: 'Tuesday night snow', head: 'Plan for snow Tuesday night', msg: 'Light snow starts at 6 PM.', es: null, lo: 3, hi: 6, st: '2026-12-08T23:00:00Z', en: '2026-12-09T11:00:00Z', dis: 'Brighton estimate, not an official forecast.', act: null, src: null, fin: false, ...o };
  return { sql: `select public.publish_storm_outlook($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) as x`, p: [a.id, a.name, a.head, a.msg, a.es, a.lo, a.hi, a.st, a.en, a.dis, a.act, a.src, a.fin] };
};
const publish = (role, u, o) => { const q = PUB(o); return call(role, u, q.sql, q.p); };
const CURRENT = `select public.public_storm_current() as x`;
const HISTORY = `select public.public_storm_history() as x`;

// ── nothing leaks while public Weather is off, and nobody touches the tables directly ──
let r = await call('anon', null, CURRENT);
check('7 public Weather off: visitors get nothing (null) and an empty history', r.ok && r.v === null && (await call('anon', null, HISTORY)).v.length === 0);
for (const [who, role, u] of [['signed out', 'anon', null], ['owner', 'authenticated', owner.u], ['admin', 'authenticated', admin.u], ['worker', 'authenticated', worker.u], ['customer', 'authenticated', customer.u]]) {
  const bad = [];
  for (const t of NEW) {
    const sel = await call(role, u, `select count(*) as x from public.${t}`);
    const del = await call(role, u, `delete from public.${t} returning 1 as x`);
    if (sel.ok || del.ok) bad.push(t);
  }
  check(`8 ${who} cannot read or delete either table directly`, bad.length === 0, JSON.stringify(bad));
}

// ── only the exact owner can publish ──
for (const [who, role, u] of [['signed-out caller', 'anon', null], ['worker', 'authenticated', worker.u], ['customer', 'authenticated', customer.u], ['ADMIN', 'authenticated', admin.u], ['owner whose membership is only invited', 'authenticated', invitedOwner.u]]) {
  r = await publish(role, u);
  check(`9 ${who} cannot publish`, !r.ok, JSON.stringify(r));
  if (role === 'authenticated') check(`9b ${who} gets the plain refusal`, /Only the owner can do that/.test(r.msg ?? ''), r.msg);
}
check('9c nothing was saved by the refused attempts', (await one(`select count(*)::int as n from public.storm_outlooks`)).n === 0);

// ── the owner publishes ──
r = await publish('authenticated', owner.u, { name: 'Tuesday night snow' });
check('10 the owner publishes a new storm: version 1', r.ok && r.v.version_no === 1 && r.v.ended === false, JSON.stringify(r));
const oid = r.v?.outlook_id;
r = await publish('authenticated', owner.u, { name: 'Second storm' });
check('11 a second storm cannot start while one is active', !r.ok && /already active/.test(r.msg), JSON.stringify(r));
const ownerView = await call('authenticated', owner.u, `select public.owner_storm_current() as x`);
check('12 the owner sees the active storm and its latest version even while public Weather is off', ownerView.ok && ownerView.v.id === oid && ownerView.v.latest.version_no === 1 && ownerView.v.latest.headline === 'Plan for snow Tuesday night');
check('13 nobody else can use the owner\'s view', !(await call('authenticated', admin.u, `select public.owner_storm_current() as x`)).ok && !(await call('anon', null, `select public.owner_storm_current() as x`)).ok);

// public Weather on
await call('authenticated', owner.u, `select public.set_public_weather_enabled(true) as x`);
r = await call('anon', null, CURRENT);
check('14 public Weather on: visitors (signed out) see the active storm with its latest version', r.ok && r.v && r.v.id === oid && r.v.latest.version_no === 1 && r.v.version_count === 1 && r.v.status === 'active', JSON.stringify(r).slice(0, 300));
check('15 visitors never see who published, and the answer carries the owner\'s own words, the estimate pair, the times and the disclaimer', r.v.latest.published_by === undefined && r.v.latest.outlook_id === undefined && r.v.latest.message === 'Light snow starts at 6 PM.' && Number(r.v.latest.snow_low) === 3 && Number(r.v.latest.snow_high) === 6 && r.v.latest.starts_at && r.v.latest.disclaimer === 'Brighton estimate, not an official forecast.');

// ── updates are new versions; the original is locked ──
r = await publish('authenticated', owner.u, { id: oid, head: 'Heavier snow than we thought', msg: 'Expect 6 to 10 inches.', lo: 6, hi: 10, dis: 'Updated wording of the disclaimer.', es: 'Espere 6 a 10 pulgadas.' });
check('16 posting an update makes version 2 of the same storm', r.ok && r.v.version_no === 2 && r.v.outlook_id === oid, JSON.stringify(r));
const hist = (await call('anon', null, HISTORY)).v;
const v = hist[0].versions;
check('17 history lists the storm with both versions, newest first, and the ORIGINAL is exactly as first published', hist.length === 1 && v.length === 2 && v[0].version_no === 2 && v[1].version_no === 1 && v[1].headline === 'Plan for snow Tuesday night' && v[1].message === 'Light snow starts at 6 PM.' && Number(v[1].snow_high) === 6 && v[1].disclaimer === 'Brighton estimate, not an official forecast.', JSON.stringify(v).slice(0, 300));
check('18 each version keeps its own disclaimer wording, and the Spanish version is only what the owner wrote', v[0].disclaimer === 'Updated wording of the disclaimer.' && v[0].message_es === 'Espere 6 a 10 pulgadas.' && v[1].message_es === null);
const cur = (await call('anon', null, CURRENT)).v;
check('19 the current storm is now version 2 with 2 versions', cur.latest.version_no === 2 && cur.version_count === 2);
for (const [what, sql] of [['update', `update public.storm_outlook_versions set headline = 'changed' where version_no = 1`], ['delete', `delete from public.storm_outlook_versions where version_no = 1`]]) {
  await asDb();
  let blocked = false; let msg = '';
  try { await db.query(sql); } catch (e) { blocked = true; msg = e.message; }
  check(`20 a published version cannot be ${what}d, even by the database itself`, blocked && /cannot be changed or deleted/.test(msg), msg);
}

// ── refusals ──
const bad = [
  ['21 a blank headline is refused', { id: oid, head: '   ' }, /Write a headline/],
  ['22 a blank message is refused', { id: oid, msg: '' }, /Write your message/],
  ['23 a blank disclaimer is refused', { id: oid, dis: ' ' }, /disclaimer/],
  ['24 a half range (only a low) is refused', { id: oid, lo: 3, hi: null }, /both a low and a high/],
  ['25 a high below the low is refused', { id: oid, lo: 8, hi: 4 }, /cannot be below/],
  ['26 actual snowfall with no source is refused', { id: oid, act: 4.5, src: '' }, /Say who or what measured/],
  ['27 an end before the start is refused', { id: oid, st: '2026-12-09T12:00:00Z', en: '2026-12-09T08:00:00Z' }, /after the start/],
];
for (const [name, o, re] of bad) { r = await publish('authenticated', owner.u, o); check(name, !r.ok && re.test(r.msg), JSON.stringify(r)); }
r = await publish('authenticated', owner.u, { id: oid, lo: null, hi: null });
check('28 "not sure yet" (no estimate at all) is allowed and is saved as nothing, never as 0', r.ok && (await one(`select snow_low, snow_high from public.storm_outlook_versions where version_no = 3 and outlook_id = $1`, [oid])).snow_low === null);

// ── a final update ends the storm; actual snowfall needs its source ──
r = await publish('authenticated', owner.u, { id: oid, head: 'Storm is over', msg: 'Final total 8.5 inches at our yard.', lo: null, hi: null, act: 8.5, src: 'Brighton crews, Lakewood yard, 7 AM', fin: true });
check('30 a final update with actual snowfall and its source is saved and ends the storm', r.ok && r.v.ended === true && (await one(`select status, ended_at is not null as done from public.storm_outlooks where id = $1`, [oid])).status === 'ended', JSON.stringify(r));
check('31 once ended, visitors see no active storm, but the history keeps it with the measured total and its source', (await call('anon', null, CURRENT)).v === null && (await call('anon', null, HISTORY)).v[0].versions[0].actual_snow !== null && (await call('anon', null, HISTORY)).v[0].versions[0].actual_source === 'Brighton crews, Lakewood yard, 7 AM');
r = await publish('authenticated', owner.u, { id: oid });
check('32 an ended storm cannot be updated', !r.ok && /not active/.test(r.msg));

// ── ending without a final update ──
r = await publish('authenticated', owner.u, { name: 'Third storm' });
const oid3 = r.v?.outlook_id;
check('33 a new storm can start after the last one ended', r.ok && r.v.version_no === 1);
r = await call('authenticated', owner.u, `select public.end_storm_outlook($1) as x`, [oid3]);
check('34 the owner can end a storm without another update, once', r.ok && !(await call('authenticated', owner.u, `select public.end_storm_outlook($1) as x`, [oid3])).ok);
check('35 an admin or a worker cannot end a storm', !(await call('authenticated', admin.u, `select public.end_storm_outlook($1) as x`, [oid3])).ok && !(await call('authenticated', worker.u, `select public.end_storm_outlook($1) as x`, [oid3])).ok && !(await call('anon', null, `select public.end_storm_outlook($1) as x`, [oid3])).ok);

// ── switching public Weather off hides everything again ──
r = await publish('authenticated', owner.u, { name: 'Fourth storm' });
await call('authenticated', owner.u, `select public.set_public_weather_enabled(false) as x`);
check('36 public Weather switched off again: visitors get nothing, even with an active storm', (await call('anon', null, CURRENT)).v === null && (await call('anon', null, HISTORY)).v.length === 0);

const failed = results.filter((x) => !x).length;
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
