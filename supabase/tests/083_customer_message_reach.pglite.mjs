// Update 83: the Message Customers counts equal exactly who a send reaches; only owner/admin can read them; update re-runs.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 83) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/083_customer_message_reach.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 83 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
const login = async (email, name, account = true) => {
  if (!account) return { pid: (await one(`insert into public.people (email, first_name, last_name) values ($1,$2,'T') returning id`, [email, name])).id };
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  let pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id;
  if (!pid) pid = (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1,$2,$3,'T') returning id`, [u, email, name])).id;
  return { u, pid };
};

const co = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
const owner = await login('o@x.test', 'Owner');
const worker = await login('w@x.test', 'Worker');
const snowC = await login('s@x.test', 'SnowC');
const snowNoAcct = await login('s2@x.test', 'SnowNoAcct', false);
const maintC = await login('m@x.test', 'MaintC');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active'),($1,$3,'worker','active')`, [co, owner.pid, worker.pid]);
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'customer','active'),($1,$3,'customer','active')`, [co, snowC.pid, snowNoAcct.pid]);
const sp = (await one(`insert into public.snow_properties (company_id, name, address) values ($1,'Oak','1 Oak') returning id`, [co])).id;
const sp2 = (await one(`insert into public.snow_properties (company_id, name, address) values ($1,'Pine','2 Pine') returning id`, [co])).id;
await db.query(`insert into public.snow_property_contacts (company_id, property_id, name, person_id, is_primary) values ($1,$2,'A',$3,true),($1,$4,'B',$5,true)`, [co, sp, snowC.pid, sp2, snowNoAcct.pid]);
await db.query(`insert into public.maintenance_properties (company_id, name, customer_id, is_active) values ($1,'Elm',$2,true)`, [co, maintC.pid]);

const r = await rpc(owner.u, `select public.customer_message_reach() as x`);
check('1 the owner gets counts; people without an account are not counted', r.ok && r.v.customers_snow === 1 && r.v.customers_maintenance === 1 && r.v.customers_landscaping === 0 && r.v.customers_all === 2, JSON.stringify(r));
const s = await rpc(owner.u, `select public.send_customer_announcement('Hi','There','customers_snow') as x`);
check('2 a send reaches exactly the counted number', s.ok && s.v.recipients === r.v.customers_snow, JSON.stringify(s));
const s2 = await rpc(owner.u, `select public.send_customer_announcement('Hi','There','customers_all') as x`);
check('3 "all" send matches its count too', s2.ok && s2.v.recipients === r.v.customers_all, JSON.stringify(s2));
const w = await rpc(worker.u, `select public.customer_message_reach() as x`);
check('4 a worker cannot read the counts', !w.ok && /owner or an admin/i.test(w.msg ?? ''), JSON.stringify(w));
const h = await rpc(owner.u, `select public._customer_audience($1::uuid, 'customers_all') as x`, [co]);
check('5 the helper is not callable by signed-in users', !h.ok, JSON.stringify(h));
console.log(results.every(Boolean) ? '\nall passed' : '\nsome failed');
process.exit(results.every(Boolean) ? 0 : 1);
