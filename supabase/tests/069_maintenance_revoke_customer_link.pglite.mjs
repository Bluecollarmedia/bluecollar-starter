// Update 69, kept up to date: unlinking a maintenance customer (now by editing the property) removes their view of it.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 280)}`); };
check('0 the full schema and all updates (including 69) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/069_maintenance_revoke_customer_link.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 69 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
const mk = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  let pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id;
  if (!pid) pid = (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const co = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
const owner = await mk('owner@x.test', 'Owner');
const cust = await mk('cust@x.test', 'Customer');
const worker = await mk('w@x.test', 'Worker');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active'),($1,$3,'customer','active'),($1,$4,'worker','active')`, [co, owner.pid, cust.pid, worker.pid]);
const mkProp = async (name) => (await one(`insert into public.maintenance_properties (company_id, name, address, customer_id) values ($1,$2,'1 Main',$3) returning id`, [co, name, cust.pid])).id;
const linked = async (id) => (await one(`select customer_id from public.maintenance_properties where id = $1`, [id])).customer_id;

// The old "revoke with a code" function is gone (update 85). What this test protected still matters: the owner can unlink a customer from
// a maintenance property (by editing the property: Customer > No customer), a worker cannot, and an unlinked customer stops seeing it.
const clear = async (u, id) => { await asUser(u); try { await db.query(`update public.maintenance_properties set customer_id = null where id = $1`, [id]); } catch { /* refused */ } finally { await asDb(); } };

const p1 = await mkProp('Hand linked');
let r = await rpc(cust.u, `select count(*)::int as x from public.maintenance_my_properties()`);
check('1 a linked customer sees their property through the customer function (the link they were given works)', r.ok && r.v === 1, JSON.stringify(r));
await clear(worker.u, p1);
check('2 a worker cannot unlink the customer', (await linked(p1)) === cust.pid);
await clear(owner.u, p1);
check('3 the owner unlinks the customer by editing the property', (await linked(p1)) === null);
r = await rpc(cust.u, `select count(*)::int as x from public.maintenance_my_properties()`);
check('4 after unlinking, that customer no longer sees the property', r.ok && r.v === 0, JSON.stringify(r));
const p2 = await mkProp('Second');
r = await rpc(cust.u, `select count(*)::int as x from public.maintenance_my_properties()`);
check('5 linking again (the owner picks the customer on the property) gives the customer their property back', r.ok && r.v === 1, JSON.stringify(r));

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
