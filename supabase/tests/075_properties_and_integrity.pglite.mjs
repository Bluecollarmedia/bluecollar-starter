// Update 75: customer links stay inside their company, deactivated customers lose access, project-code claims merge placeholders,
// address normalizing, and the new (empty) properties table with its guards.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 75) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/075_properties_and_integrity.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 75 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0], rows: r.rows }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
const login = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  let pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id;
  if (!pid) pid = (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  else await db.query(`update public.people set first_name = $2 where id = $1`, [pid, name]);
  return { u, pid };
};
const ok = async (u, sql, p) => { const r = await rpc(u, sql, p); return r.ok; };

const coA = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
await db.exec(`set session_replication_role = replica`);
const coB = (await one(`insert into public.companies (name) values ('Other Co') returning id`)).id;
await db.exec(`set session_replication_role = origin`);
const ownerA = await login('ownera@x.test', 'OwnerA');
const ownerB = await login('ownerb@x.test', 'OwnerB');
const custA = await login('custa@x.test', 'CustA');
const custB = await login('custb@x.test', 'CustB');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active'),($3,$4,'owner','active'),($1,$5,'customer','active'),($3,$6,'customer','active')`, [coA, ownerA.pid, coB, ownerB.pid, custA.pid, custB.pid]);

// ── 1. a customer link must stay inside its company ──
const projA = (await one(`insert into public.projects (company_id, name, status) values ($1,'A job','active') returning id`, [coA])).id;
let r = await rpc(ownerA.u, `update public.projects set customer_id = $2 where id = $1`, [projA, custB.pid]);
check('1 staff cannot link a project to a customer of ANOTHER company', !r.ok && /not a customer of this company/.test(r.msg), r.msg);
r = await rpc(ownerA.u, `update public.projects set customer_id = $2 where id = $1`, [projA, custA.pid]);
check('1b linking to their own company customer works', r.ok && (await one(`select customer_id from public.projects where id = $1`, [projA])).customer_id === custA.pid, r.msg);
r = await rpc(ownerA.u, `update public.projects set customer_id = $2 where id = $1`, [projA, ownerA.pid]);
check('1c a team member (not a customer) cannot be set as the customer either', !r.ok, r.msg);
const mpA = (await one(`insert into public.maintenance_properties (company_id, name, address) values ($1,'Lawn A','1 Main') returning id`, [coA])).id;
r = await rpc(ownerA.u, `update public.maintenance_properties set customer_id = $2 where id = $1`, [mpA, custB.pid]);
check('2 the same for a maintenance property (this was the gap: no check existed)', !r.ok && /not a customer of this company/.test(r.msg), r.msg);
r = await rpc(ownerA.u, `update public.maintenance_properties set source_project_id = $2 where id = $1`, [mpA, (await one(`insert into public.projects (company_id, name, status) values ($1,'B job','active') returning id`, [coB])).id]);
check('2b a maintenance property cannot point at another company project', !r.ok && /different company/.test(r.msg), r.msg);
const quoteRow = await rpc(ownerA.u, `insert into public.quotes (company_id, project_id, customer_id, number) values ($1,$2,$3,'Q-1') returning id`, [coA, projA, custB.pid]);
check('3 a quote cannot be created for another company customer', !quoteRow.ok && /not a customer of this company/.test(quoteRow.msg), quoteRow.msg);
const projBid = (await one(`select id from public.projects where company_id = $1`, [coB])).id;
const q2 = await rpc(ownerA.u, `insert into public.quotes (company_id, project_id, customer_id, number) values ($1,$2,$3,'Q-2') returning id`, [coA, projBid, custA.pid]);
check('3b nor attached to another company project (blocked: the database assigns the document to the project company, which the customer is not part of)', !q2.ok && /different company|not a customer of this company|row-level security/.test(q2.msg), q2.msg);
const q3 = await rpc(ownerA.u, `insert into public.quotes (company_id, project_id, customer_id, number) values ($1,$2,$3,'Q-3') returning id`, [coA, projA, custA.pid]);
check('3c a normal quote for its own customer and project still saves', q3.ok, q3.msg);
// legacy rows are not blocked from unrelated edits
await db.query(`insert into public.maintenance_properties (company_id, name, address, customer_id) values ($1,'Legacy','2 Main',$2)`, [coA, custB.pid]);   // bad legacy link written by the database role
r = await rpc(ownerA.u, `update public.maintenance_properties set notes = 'edited' where name = 'Legacy'`);
check('4 an existing row with an old bad link can still be edited for other fields (only NEW or CHANGED links are checked)', r.ok, r.msg);

// ── 2. a deactivated customer loses access ──
const stopCtx = async () => {
  const route = (await one(`insert into public.maintenance_routes (company_id, service_date, name) values ($1,current_date,'R') returning id`, [coA])).id;
  const contract = (await one(`insert into public.maintenance_contracts (company_id, property_id, name) values ($1,$2,'c') returning id`, [coA, mpA])).id;
  return (await one(`insert into public.maintenance_stops (company_id, route_id, property_id, contract_id, sort_order, status, completed_at) values ($1,$2,$3,$4,1,'completed', now()) returning id`, [coA, route, mpA, contract])).id;
};
const stop = await stopCtx();
await db.query(`update public.maintenance_properties set customer_id = $2 where id = $1`, [mpA, custA.pid]);
await db.query(`insert into public.maintenance_photos (company_id, route_id, stop_id, property_id, file_url, file_key, is_customer_visible) select company_id, route_id, id, property_id, 'https://x/a.jpg', 'a/maintenance/p/a.jpg', true from public.maintenance_stops where id = $1`, [stop]);
const mine = async () => (await rpc(custA.u, `select count(*)::int as x from public.maintenance_my_properties()`)).v;
const updates = async () => (await rpc(custA.u, `select count(*)::int as x from public.maintenance_customer_updates()`)).v;
const canOpen = async () => (await rpc(custA.u, `select cardinality(public.maintenance_photos_i_can_open(array['a/maintenance/p/a.jpg'])) as x`)).v;
check('5 an active customer sees their property, its finished visit, and may open the shared photo', (await mine()) === 1 && (await updates()) === 1 && (await canOpen()) === 1);
await db.query(`update public.company_members set status = 'inactive', deactivated_by = $3 where company_id = $1 and person_id = $2`, [coA, custA.pid, ownerA.pid]);
check('6 after the owner DEACTIVATES them, the link is still there but they see nothing: no property, no visits, no photo file', (await one(`select customer_id from public.maintenance_properties where id = $1`, [mpA])).customer_id === custA.pid
  && (await mine()) === 0 && (await updates()) === 0 && (await canOpen()) === 0);
await db.query(`update public.company_members set status = 'active', deactivated_by = null where company_id = $1 and person_id = $2`, [coA, custA.pid]);
check('6b reactivating them brings access back without re-linking anything', (await mine()) === 1 && (await updates()) === 1);
await db.query(`update public.company_members set status = 'invited' where company_id = $1 and person_id = $2`, [coA, custA.pid]);
check('6c an owner-invited customer (not yet signed in) keeps the access the owner set up', (await mine()) === 1);
await db.query(`update public.company_members set status = 'active' where company_id = $1 and person_id = $2`, [coA, custA.pid]);

// snow
const snowProp = (await one(`insert into public.snow_properties (company_id, name, address) values ($1,'Snow lot','9 Plow Rd') returning id`, [coA])).id;
await db.query(`insert into public.snow_property_contacts (company_id, property_id, name, person_id, is_primary) values ($1,$2,'CustA',$3,true)`, [coA, snowProp, custA.pid]);
const snowMine = async () => (await rpc(custA.u, `select count(*)::int as x from public.snow_my_properties()`)).v;
check('7 a snow contact who is an active customer sees the snow property', (await snowMine()) === 1);
await db.query(`update public.company_members set status = 'inactive', deactivated_by = $3 where company_id = $1 and person_id = $2`, [coA, custA.pid, ownerA.pid]);
check('7b a deactivated customer no longer sees it, although the contact row is unchanged', (await snowMine()) === 0);
await db.query(`update public.company_members set status = 'active', deactivated_by = null where company_id = $1 and person_id = $2`, [coA, custA.pid]);

// ── 3. a project-code claim merges the owner-created record ──
const ph = (await one(`insert into public.people (email, first_name, last_name) values ('', 'Placeholder', 'Pat') returning id`)).id;
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'customer','invited')`, [coA, ph]);
const projC = (await one(`insert into public.projects (company_id, name, status, customer_id) values ($1,'Pat job','active',$2) returning id`, [coA, ph])).id;
await db.query(`insert into public.quotes (company_id, project_id, customer_id, number) values ($1,$2,$3,'Q-9')`, [coA, projC, ph]);
await db.query(`update public.projects set customer_project_code = 'PCODE1234' where id = $1`, [projC]);
const code = 'PCODE1234';
const real = await login('pat@x.test', 'Pat');
const before = (await one(`select count(*)::int c from public.people`)).c;
const claim = (await one(`select public._claim_project($1::uuid, $2) as x`, [real.pid, code])).x;
check('8 claiming a PROJECT code links the real customer and merges the owner-created record: no duplicate person, the quote follows', claim.success === true
  && (await one(`select customer_id from public.projects where id = $1`, [projC])).customer_id === real.pid
  && (await one(`select customer_id from public.quotes where number = 'Q-9'`)).customer_id === real.pid
  && (await one(`select count(*)::int c from public.people where id = $1`, [ph])).c === 0 && (await one(`select count(*)::int c from public.people`)).c === before - 1, JSON.stringify(claim));

// ── 4. normalize_address ──
const n = async (a, c, s, z) => (await one(`select public.normalize_address($1,$2,$3,$4) as x`, [a, c, s, z])).x;
check('9 "123 Main St." and "123 MAIN STREET" are the same place', (await n('123 Main St.', 'Lakewood', 'NJ', '08701')) === (await n('123 MAIN STREET', 'lakewood', 'nj', '08701-1234')));
check('9b "North"/"N", "Avenue"/"Ave." are the same; a different number is a different place', (await n('55 North Park Avenue', '', '', '44107')) === (await n('55 N Park Ave.', '', '', '44107')) && (await n('55 N Park Ave', '', '', '44107')) !== (await n('56 N Park Ave', '', '', '44107')));
check('9c units are kept: "Apt 3", "#3" and "Unit 3" match each other but not unit 4', (await n('10 Oak St Apt 3', '', '', '08701')) === (await n('10 oak street #3', '', '', '08701')) && (await n('10 Oak St Unit 3', '', '', '08701')) === (await n('10 Oak St, Apt 3', '', '', '08701')) && (await n('10 Oak St Apt 3', '', '', '08701')) !== (await n('10 Oak St Apt 4', '', '', '08701')));
check('9d the same street in a different ZIP is a different place; with no ZIP the city and state decide', (await n('1 Main St', '', '', '08701')) !== (await n('1 Main St', '', '', '08702')) && (await n('1 Main St', 'Lakewood', 'NJ', '')) !== (await n('1 Main St', 'Toms River', 'NJ', '')));
check('9e a blank street never matches anything (key is empty)', (await n('  ', 'Lakewood', 'NJ', '08701')) === '');

// ── 5. the properties table ──
const pr = async (u, sql, p) => rpc(u, sql, p);
let r5 = await pr(ownerA.u, `insert into public.properties (company_id, customer_id, name, address, city, state, zip) values ($1,$2,'Home','5 Elm St','Lakewood','NJ','08701') returning id`, [coA, real.pid]);
check('10 the owner can add a property for their own customer', r5.ok, r5.msg);
const dup = await pr(ownerA.u, `insert into public.properties (company_id, customer_id, name, address, city, state, zip) values ($1,$2,'Again','5 Elm Street.','lakewood','nj','08701') returning id`, [coA, real.pid]);
check('10b the same place for the same customer cannot be saved twice (even typed differently)', !dup.ok && /duplicate|unique/i.test(dup.msg), dup.msg);
const other = await pr(ownerA.u, `insert into public.properties (company_id, customer_id, address, zip) values ($1,$2,'5 Elm St','08701') returning id`, [coA, custB.pid]);
check('10c a property cannot be given to another company customer', !other.ok && /not a customer of this company/.test(other.msg), other.msg);
const worker = await login('w@x.test', 'W');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'worker','active')`, [coA, worker.pid]);
const w = await pr(worker.u, `insert into public.properties (company_id, customer_id, address) values ($1,$2,'6 Elm St') returning id`, [coA, real.pid]);
check('10d a worker cannot create properties', !w.ok, w.msg);
check('10e a worker can read them; another company owner cannot; the customer has no direct access', (await pr(worker.u, `select count(*)::int as x from public.properties`)).v === 1
  && (await pr(ownerB.u, `select count(*)::int as x from public.properties`)).v === 0 && (await pr(real.u, `select count(*)::int as x from public.properties`)).v === 0);
const propId = (await one(`select id from public.properties where address = '5 Elm St'`)).id;
const projP = (await one(`insert into public.projects (company_id, name, status, customer_id) values ($1,'Elm job','active',$2) returning id`, [coA, real.pid])).id;
check('11 a project can be linked to a property of ITS OWN customer', (await rpc(ownerA.u, `update public.projects set property_id = $2 where id = $1`, [projP, propId])).ok);
const projQ = (await one(`insert into public.projects (company_id, name, status, customer_id) values ($1,'Other job','active',$2) returning id`, [coA, custA.pid])).id;
r = await rpc(ownerA.u, `update public.projects set property_id = $2 where id = $1`, [projQ, propId]);
check('11b but not to a property that belongs to a DIFFERENT customer', !r.ok && /different customer/.test(r.msg), r.msg);
const propB = (await one(`insert into public.properties (company_id, customer_id, address) values ($1,$2,'1 Other Rd') returning id`, [coB, custB.pid])).id;
r = await rpc(ownerA.u, `update public.projects set property_id = $2 where id = $1`, [projP, propB]);
check('11c nor to another company property', !r.ok && /different company/.test(r.msg), r.msg);
check('12 nothing existing was changed by adding the table: no project, maintenance or snow row was given a property automatically', (await one(`select count(*)::int c from public.projects where property_id is not null and id <> $1`, [projP])).c === 0
  && (await one(`select count(*)::int c from public.maintenance_properties where property_id is not null`)).c === 0 && (await one(`select count(*)::int c from public.snow_properties where property_id is not null`)).c === 0);

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
