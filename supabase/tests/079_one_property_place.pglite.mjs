// Update 79: a property is entered once (ensure_property), Snow turns on for it without retyping anything, and an address change follows everywhere.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 79) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/079_one_property_place.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 79 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
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

const coA = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
await db.exec(`set session_replication_role = replica`);
const coB = (await one(`insert into public.companies (name) values ('Other Co') returning id`)).id;
await db.exec(`set session_replication_role = origin`);
const owner = await login('o@x.test', 'Owner');
const worker = await login('w@x.test', 'Worker');
const ownerB = await login('ob@x.test', 'OwnerB');
const cust = await login('c@x.test', 'Cathy');
const custB = await login('cb@x.test', 'Other');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active'),($1,$3,'worker','active'),($1,$4,'customer','active'),($5,$6,'owner','active'),($5,$7,'customer','active')`,
  [coA, owner.pid, worker.pid, cust.pid, coB, ownerB.pid, custB.pid]);
await db.query(`update public.people set last_name = 'Client' where id = $1`, [cust.pid]);

const ens = (u, c, addr, extra = {}) => rpc(u, `select public.ensure_property($1::uuid, $2, $3, $4, $5, $6) as x`, [c, extra.name ?? null, addr, extra.city ?? null, extra.state ?? null, extra.zip ?? null]);

// ── 1. entered once ──
let r = await ens(owner.u, cust.pid, '12 Oak Street', { city: 'Lakewood', state: 'NJ', zip: '08701' });
check('1 the owner adds a property for a customer: it is created', r.ok && r.v.created === true, r.msg);
const pid = r.v.property_id;
r = await ens(owner.u, cust.pid, '12 oak st.', { city: 'Lakewood', state: 'NJ', zip: '08701' });
check('2 the same customer + the same address typed differently gives the SAME property, not a second one', r.ok && r.v.created === false && r.v.property_id === pid && (await one(`select count(*)::int c from public.properties where company_id = $1`, [coA])).c === 1, r.msg);
r = await ens(owner.u, cust.pid, '14 Oak Street', { city: 'Lakewood', state: 'NJ', zip: '08701' });
check('3 a different address for the same customer is a second property of theirs', r.ok && r.v.created === true && (await one(`select count(*)::int c from public.properties where customer_id = $1`, [cust.pid])).c === 2);
check('4 a worker cannot add properties', !(await ens(worker.u, cust.pid, '1 Main St')).ok);
check('5 a customer from another company cannot be used, and a customer is required', !(await ens(owner.u, custB.pid, '1 Main St')).ok && !(await rpc(owner.u, `select public.ensure_property(null, null, '1 Main St') as x`)).ok);
check('6 the street address is required', !(await ens(owner.u, cust.pid, '  ')).ok);
check('7 another company\'s owner cannot add to our customer', !(await ens(ownerB.u, cust.pid, '5 Elm St')).ok);

// ── 2. Snow turns on for it, retyping nothing ──
const w = await rpc(owner.u, `select public.snow_enable_for_property($1::uuid) as x`, [pid]);
check('8 Snow on: a Snow property is made from the same property (address copied, linked by property_id)', w.ok && w.v.created === true
  && (await one(`select address, property_id from public.snow_properties where id = $1`, [w.v.snow_property_id])).property_id === pid, w.msg);
const contact = await one(`select person_id, is_primary, name from public.snow_property_contacts where property_id = $1`, [w.v.snow_property_id]);
check('9 the customer is linked as the Snow contact (their account sees it); no second customer was typed', contact.person_id === cust.pid && contact.is_primary === true && /Cathy/.test(contact.name));
const w2 = await rpc(owner.u, `select public.snow_enable_for_property($1::uuid) as x`, [pid]);
check('10 doing it again changes nothing (no duplicate Snow property or contact)', w2.ok && w2.v.created === false && w2.v.snow_property_id === w.v.snow_property_id
  && (await one(`select count(*)::int c from public.snow_property_contacts where property_id = $1`, [w.v.snow_property_id])).c === 1);
check('11 only the owner/admin of that company can turn Snow on', !(await rpc(worker.u, `select public.snow_enable_for_property($1::uuid) as x`, [pid])).ok && !(await rpc(ownerB.u, `select public.snow_enable_for_property($1::uuid) as x`, [pid])).ok);

// ── 3. the same property used by landscaping and maintenance ──
const proj = await rpc(owner.u, `insert into public.projects (company_id, name, status, customer_id, property_id, address) values ($1,'Oak job','active',$2,$3,'12 Oak Street') returning id`, [coA, cust.pid, pid]);
const maint = await rpc(owner.u, `insert into public.maintenance_properties (company_id, name, customer_id, property_id, address) values ($1,'Oak lawn',$2,$3,'12 Oak Street') returning id`, [coA, cust.pid, pid]);
check('12 a landscaping project and a maintenance property can both use the same property', proj.ok && maint.ok, proj.msg || maint.msg);

// ── 4. change the address once ──
r = await rpc(owner.u, `update public.properties set address = '12 Oak Avenue' where id = $1`, [pid]);
const addr = async (t, id) => (await one(`select address from public.${t} where id = $1`, [id])).address;
check('13 changing the address once changes it in landscaping, maintenance and snow', r.ok && (await addr('projects', proj.v)) === '12 Oak Avenue' && (await addr('maintenance_properties', maint.v)) === '12 Oak Avenue' && (await addr('snow_properties', w.v.snow_property_id)) === '12 Oak Avenue', r.msg);

// ── 5. the customer sees their property list; a worker only reads ──
check('14 workers can read properties but cannot change them', (await rpc(worker.u, `select count(*)::int c from public.properties`)).v === 2 && !(await rpc(worker.u, `update public.properties set address = 'x' where id = $1`, [pid])).ok
  || (await one(`select address from public.properties where id = $1`, [pid])).address === '12 Oak Avenue');

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
