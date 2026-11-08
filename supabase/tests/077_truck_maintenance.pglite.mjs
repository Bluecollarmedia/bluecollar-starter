// Update 77: the truck maintenance log is private to the company owner, belongs to the owner's own trucks, and rejects bad dates.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 240)}`); };
check('0 the full schema and all updates (including 77) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/077_truck_maintenance.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 77 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const fails = async (u, sql, p) => { await asUser(u); try { await db.query(sql, p); return { raised: false, msg: '' }; } catch (e) { return { raised: true, msg: String(e.message) }; } finally { await asDb(); } };
const count = async (u, sql, p) => { await asUser(u); try { return (await db.query(sql, p)).rows.length; } catch { return -1; } finally { await asDb(); } };
const mk = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};

const co = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
await db.exec(`set session_replication_role = replica`);
const co2 = (await one(`insert into public.companies (name) values ('Other') returning id`)).id;
await db.exec(`set session_replication_role = origin`);
const owner = await mk('owner@x.test', 'Owner');
const admin = await mk('admin@x.test', 'Admin');
const worker = await mk('worker@x.test', 'Worker');
const customer = await mk('cust@x.test', 'Cust');
const stranger = await mk('stranger@x.test', 'Stranger');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active'),($1,$3,'admin','active'),($1,$4,'worker','active'),($1,$5,'customer','active')`, [co, owner.pid, admin.pid, worker.pid, customer.pid]);
const truck = (await one(`insert into public.trucks (company_id, name) values ($1, 'Truck 5') returning id`, [co])).id;
const otherTruck = (await one(`insert into public.trucks (company_id, name) values ($1, 'Their truck') returning id`, [co2])).id;

let f = await fails(owner.u, `insert into public.truck_maintenance (company_id, truck_id, title, serviced_on, due_on, notes) values ($1,$2,'Oil change','2026-10-01','2027-04-01','Oil and filter')`, [co, truck]);
check('1 the owner can add a maintenance record: title, date serviced, next due date, notes', !f.raised, f.msg);
f = await fails(owner.u, `insert into public.truck_maintenance (company_id, truck_id, title, serviced_on) values ($1,$2,'Tires','2026-09-15')`, [co, truck]);
check('1b the next due date is optional', !f.raised, f.msg);
f = await fails(owner.u, `insert into public.truck_maintenance (company_id, truck_id, title, serviced_on, due_on) values ($1,$2,'Bad dates','2026-10-01','2026-09-01')`, [co, truck]);
check('2 a next-due date before the service date is refused', f.raised, f.msg);
f = await fails(owner.u, `insert into public.truck_maintenance (company_id, truck_id, title, serviced_on) values ($1,$2,'   ','2026-10-01')`, [co, truck]);
check('2b a blank title is refused', f.raised, f.msg);
f = await fails(owner.u, `insert into public.truck_maintenance (company_id, truck_id, title, serviced_on) values ($1,$2,'Sneaky','2026-10-01')`, [co, otherTruck]);
check('3 the owner cannot attach a record to another company truck', f.raised, f.msg);
check('4 the owner sees their records', (await count(owner.u, `select 1 from public.truck_maintenance`)) === 2);
for (const [who, u] of [['an admin', admin.u], ['a worker', worker.u], ['a customer', customer.u], ['a stranger', stranger.u]]) {
  check(`5 ${who} sees nothing`, (await count(u, `select 1 from public.truck_maintenance`)) === 0);
  const w = await fails(u, `insert into public.truck_maintenance (company_id, truck_id, title, serviced_on) values ($1,$2,'Nope','2026-10-01')`, [co, truck]);
  check(`5b ${who} cannot add a record`, w.raised, w.msg);
}
await asUser(admin.u);
await db.query(`update public.truck_maintenance set title = 'Hacked'`);
await db.query(`delete from public.truck_maintenance`);
await asDb();
check('5c an admin cannot change or delete records (nothing was touched)', (await one(`select count(*)::int c from public.truck_maintenance where title = 'Hacked'`)).c === 0 && (await one(`select count(*)::int c from public.truck_maintenance`)).c === 2);
f = await fails(owner.u, `update public.truck_maintenance set title = 'Oil and filter change', due_on = null where title = 'Oil change'`);
check('6 the owner can change and clear the due date', !f.raised && (await one(`select due_on from public.truck_maintenance where title = 'Oil and filter change'`)).due_on === null, f.msg);
f = await fails(owner.u, `delete from public.truck_maintenance where title = 'Tires'`);
check('7 the owner can delete a record', !f.raised && (await one(`select count(*)::int c from public.truck_maintenance`)).c === 1, f.msg);

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
