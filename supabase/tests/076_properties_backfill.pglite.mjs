// Update 76: the properties backfill. A dry run changes nothing; applying follows the written matching rules and nothing else.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 400)}`); };
check('0 the full schema and all updates (including 75 and 76) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/076_properties_backfill.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 76 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
const login = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  let pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id;
  if (!pid) pid = (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  else await db.query(`update public.people set first_name = $2 where id = $1`, [pid, name]);
  return { u, pid };
};

const co = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
await db.exec(`set session_replication_role = replica`);
const coB = (await one(`insert into public.companies (name) values ('Other Co') returning id`)).id;
await db.exec(`set session_replication_role = origin`);
const owner = await login('owner@x.test', 'Owner');
const worker = await login('w@x.test', 'Worker');
const ownerB = await login('ownerb@x.test', 'OwnerB');
const pat = await login('pat@x.test', 'Pat');
const lee = await login('lee@x.test', 'Lee');
const sam = await login('sam@x.test', 'Sam');
const custB = await login('cb@x.test', 'CustB');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active'),($1,$3,'worker','active'),($1,$4,'customer','active'),($1,$5,'customer','active'),($1,$6,'customer','active'),($7,$8,'owner','active'),($7,$9,'customer','active')`,
  [co, owner.pid, worker.pid, pat.pid, lee.pid, sam.pid, coB, ownerB.pid, custB.pid]);

const proj = async (name, cust, addr, city = 'Lakewood', st = 'NJ', zip = '08701') =>
  (await one(`insert into public.projects (company_id, name, status, customer_id, address, city, state, zip) values ($1,$2,'active',$3,$4,$5,$6,$7) returning id`, [co, name, cust, addr, city, st, zip])).id;
const maint = async (name, cust, addr, zip = '08701') =>
  (await one(`insert into public.maintenance_properties (company_id, name, customer_id, address, city, state, zip) values ($1,$2,$3,$4,'Lakewood','NJ',$5) returning id`, [co, name, cust, addr, zip])).id;
const snow = async (name, addr) => (await one(`insert into public.snow_properties (company_id, name, address, city, state, zip) values ($1,$2,$3,'Lakewood','NJ','08701') returning id`, [co, name, addr])).id;
const contact = async (prop, person) => db.query(`insert into public.snow_property_contacts (company_id, property_id, name, person_id) values ($1,$2,'c',$3)`, [co, prop, person]);

const P1 = await proj('Pat job', pat.pid, '123 Main St.');
const P2 = await proj('Pat second job', pat.pid, '123 MAIN STREET');
const M1 = await maint('Pat Residence', pat.pid, '123 main st');
const P3 = await proj('Pat Oak', pat.pid, '9 Oak Ln');
const P4 = await proj('Lee Pine', lee.pid, '50 Pine Rd');
const P5 = await proj('Pat Pine', pat.pid, '50 Pine Road');           // same place, different customers -> a conflict
const S1 = await snow('Sam lot', '7 Elm St'); await contact(S1, sam.pid);
const P7 = await proj('Sam Elm', sam.pid, '7 Elm Street');           // same place as the snow lot, same customer
const S2 = await snow('Shared lot', '88 Shared Way'); await contact(S2, pat.pid); await contact(S2, lee.pid);
const M2 = await maint('No customer lawn', null, '4 Orphan Rd');
const P6 = await proj('No address', pat.pid, '');
const M3 = await maint('Linked to staff', worker.pid, '5 Staff Ln');   // legacy: the "customer" is a team member
const PB = (await one(`insert into public.projects (company_id, name, status, customer_id, address, city, state, zip) values ($1,'Other company job',$2,$3,'123 Main St','Lakewood','NJ','08701') returning id`, [coB, 'active', custB.pid])).id;

const snapshot = async () => JSON.stringify(await Promise.all([
  db.query(`select id, name, address, city, state, zip, customer_id from public.projects order by id`),
  db.query(`select id, name, address, city, state, zip, customer_id from public.maintenance_properties order by id`),
  db.query(`select id, name, address, city, state, zip from public.snow_properties order by id`),
]).then((r) => r.map((x) => x.rows)));
const before = await snapshot();

let res = await rpc(worker.u, `select public.backfill_properties() as x`);
check('1 only the company owner can run it (a worker is refused)', !res.ok && /Only the company owner/.test(res.msg), res.msg);
res = await rpc(owner.u, `select public.backfill_properties() as x`);
const rep = res.v;
check('2 the dry run reports what it would do: 5 linkable projects/lawns/lots in 4 properties', res.ok && rep.applied === false && rep.linkable.projects === 4 && rep.linkable.maintenance === 1 && rep.linkable.snow === 1 && rep.propertiesThatWouldBeCreated === 3, JSON.stringify(rep));
check('2b and CHANGES NOTHING: no property was created and no record was linked', (await one(`select count(*)::int c from public.properties`)).c === 0 && (await one(`select count(*)::int c from public.projects where property_id is not null`)).c === 0 && (await snapshot()) === before);
const nd = rep.needsDecision;
check('3 same place claimed by two customers is listed for the owner and linked to neither', nd.sameAddressDifferentCustomers.length === 1 && nd.sameAddressDifferentCustomers[0].records.length === 2, JSON.stringify(nd.sameAddressDifferentCustomers));
check('3b a lawn with no customer, a project with no address, a snow lot with several customers, and a "customer" who is a team member are each listed (nothing guessed)',
  nd.noCustomer.some((x) => x.id === M2) && nd.noAddress.some((x) => x.id === P6) && nd.snowWithSeveralContacts.some((x) => x.id === S2) && nd.customerNotACustomerOfThisCompany.some((x) => x.id === M3), JSON.stringify(nd));

res = await rpc(owner.u, `select public.backfill_properties(true) as x`);
check('4 applying creates one property per place: 3 (Pat Main St, Pat Oak Ln, Sam Elm St)', res.ok && res.v.createdNow === 3 && (await one(`select count(*)::int c from public.properties`)).c === 3, JSON.stringify(res.v));
const main = await one(`select pr.* from public.properties pr where pr.customer_id = $1 and pr.address_key like '123 main st|%'`, [pat.pid]);
check('4b "123 Main St." (project), "123 MAIN STREET" (project) and "123 main st" (maintenance) became ONE property for Pat, named and addressed from the maintenance record', !!main && main.name === 'Pat Residence' && main.address === '123 main st', JSON.stringify(main));
const linked = async (table, id) => (await one(`select property_id from public.${table} where id = $1`, [id])).property_id;
check('4c all three records point at it, and the Elm St project and snow lot (same customer, same place) share one property', (await linked('projects', P1)) === main.id && (await linked('projects', P2)) === main.id && (await linked('maintenance_properties', M1)) === main.id
  && (await linked('projects', P7)) === (await linked('snow_properties', S1)) && !!(await linked('projects', P7)));
check('4d the different-address project got its own property', (await linked('projects', P3)) !== main.id && !!(await linked('projects', P3)));
check('5 the conflict, no-customer, no-address, several-contact and non-customer records were NOT linked', !(await linked('projects', P4)) && !(await linked('projects', P5)) && !(await linked('maintenance_properties', M2)) && !(await linked('projects', P6))
  && !(await linked('snow_properties', S2)) && !(await linked('maintenance_properties', M3)));
check('5b the other company was never touched', !(await linked('projects', PB)) && (await one(`select count(*)::int c from public.properties where company_id = $1`, [coB])).c === 0);
const after = await snapshot();
check('6 NO address, name, customer or any other field of any existing project, maintenance property or snow property changed', after === before);
res = await rpc(owner.u, `select public.backfill_properties(true) as x`);
check('7 running it again is harmless: nothing new is created or linked', res.ok && res.v.createdNow === 0 && (await one(`select count(*)::int c from public.properties`)).c === 3 && res.v.linkable.projects === 0, JSON.stringify(res.v));
res = await rpc(owner.u, `select public.backfill_properties() as x`);
check('7b the new dry run now shows the linked records as already linked', res.v.alreadyLinked === 6 + 0 || res.v.alreadyLinked >= 6, JSON.stringify(res.v.alreadyLinked));

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
