// Update 116 (beside the older functions, which must stay as they were): snow history with the arrival time, maintenance history with arrival time / property / task names, and the next planned lawn visit.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 116) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/116_customer_portal_history.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 116 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, rows: r.rows }; } catch (e) { return { ok: false, msg: String(e.message), rows: [] }; } finally { await asDb(); } };
const login = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  let pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id;
  if (!pid) pid = (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};

const co = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
const owner = await login('owner@x.test', 'Owner');
const cathy = await login('cathy@x.test', 'Cathy');
const dan = await login('dan@x.test', 'Dan');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active'),($1,$3,'customer','active'),($1,$4,'customer','active')`, [co, owner.pid, cathy.pid, dan.pid]);

// Cathy has a lawn property; Dan has another.
const mpC = (await one(`insert into public.maintenance_properties (company_id, name, address, customer_id) values ($1,'Cathy Lawn','12 Elm St',$2) returning id`, [co, cathy.pid])).id;
const mpD = (await one(`insert into public.maintenance_properties (company_id, name, address, customer_id) values ($1,'Dan Lawn','9 Oak Ave',$2) returning id`, [co, dan.pid])).id;
const contract = async (mp) => (await one(`insert into public.maintenance_contracts (company_id, property_id, name) values ($1,$2,'c') returning id`, [co, mp])).id;
const route = async (day, status) => (await one(`insert into public.maintenance_routes (company_id, service_date, name, status) values ($1, ${day}, 'R', $2) returning id`, [co, status])).id;
const stop = async (rt, mp, status, extra = '') => (await one(`insert into public.maintenance_stops (company_id, route_id, property_id, contract_id, sort_order, status ${extra ? ', arrived_at, completed_at' : ''}) values ($1,$2,$3,$4,1,$5 ${extra ? ', ' + extra : ''}) returning id`, [co, rt, mp, await contract(mp), status])).id;

// A finished visit for Cathy: arrived 8:00, finished 9:00, one shared photo tied to a task, one hidden photo.
const rDone = await route(`current_date - 7`, 'completed');
const sDone = await stop(rDone, mpC, 'completed', `now() - interval '7 days 1 hour', now() - interval '7 days'`);
const task = (await one(`insert into public.maintenance_stop_tasks (company_id, route_id, stop_id, title) values ($1,$2,$3,'Edging') returning id`, [co, rDone, sDone])).id;
await db.query(`insert into public.maintenance_photos (company_id, route_id, stop_id, property_id, file_url, file_key, is_customer_visible, task_id) values ($1,$2,$3,$4,'https://x/a.jpg','k/a',true,$5)`, [co, rDone, sDone, mpC, task]);
await db.query(`insert into public.maintenance_photos (company_id, route_id, stop_id, property_id, file_url, file_key, is_customer_visible) values ($1,$2,$3,$4,'https://x/b.jpg','k/b',false)`, [co, rDone, sDone, mpC]);
// A finished visit for Dan (Cathy must never see it).
await stop(await route(`current_date - 3`, 'completed'), mpD, 'completed', `now() - interval '3 days 1 hour', now() - interval '3 days'`);

let r = await rpc(cathy.u, `select * from public.maintenance_customer_history()`);
check('1 Cathy sees only her own finished visit', r.ok && r.rows.length === 1 && r.rows[0].property_id === mpC && r.rows[0].property_name === 'Cathy Lawn', JSON.stringify(r));
check('2 it now carries when the crew arrived, and that is before it finished', r.rows[0].arrived_at && new Date(r.rows[0].arrived_at) < new Date(r.rows[0].completed_at), JSON.stringify(r.rows[0]));
const photos = r.rows[0].photos;
check('3 only the shared photo is shown, with the name of the task it was taken for', photos.length === 1 && photos[0].task === 'Edging' && photos[0].key === 'k/a', JSON.stringify(photos));
r = await rpc(dan.u, `select count(*)::int as n from public.maintenance_customer_history()`);
check('4 Dan sees only his own visit', r.ok && r.rows[0].n === 1);

// Next visits
r = await rpc(cathy.u, `select count(*)::int as n from public.maintenance_customer_next_visits()`);
check('5 no planned visit yet: nothing', r.ok && r.rows[0].n === 0, JSON.stringify(r));
const rSoon = await route(`current_date + 5`, 'planned');
const rLater = await route(`current_date + 12`, 'planned');
const sSoon = await stop(rSoon, mpC, 'pending');
await stop(rLater, mpC, 'pending');
await db.query(`insert into public.maintenance_stop_services (company_id, route_id, stop_id, service_type, label) values ($1,$2,$3,'mowing','Mowing'), ($1,$2,$3,'edging','Edging')`, [co, rSoon, sSoon]);
r = await rpc(cathy.u, `select property_id, to_char(service_date,'YYYY-MM-DD') as d, services from public.maintenance_customer_next_visits()`);
const want = (await one(`select to_char(current_date + 5,'YYYY-MM-DD') as d`)).d;
check('6 the NEXT planned visit is the nearest one, with the services planned for it', r.ok && r.rows.length === 1 && r.rows[0].property_id === mpC && r.rows[0].d === want && r.rows[0].services === 'Edging, Mowing', JSON.stringify(r));
r = await rpc(dan.u, `select count(*)::int as n from public.maintenance_customer_next_visits()`);
check('7 Dan sees none of Cathy\'s planned visits', r.ok && r.rows[0].n === 0);

// A cancelled route and a past planned date are not "next".
await db.query(`update public.maintenance_routes set status = 'cancelled' where id = $1`, [rSoon]);
r = await rpc(cathy.u, `select to_char(service_date,'YYYY-MM-DD') as d from public.maintenance_customer_next_visits()`);
const wantLater = (await one(`select to_char(current_date + 12,'YYYY-MM-DD') as d`)).d;
check('8 a cancelled route is skipped, so the next one after it is shown', r.ok && r.rows.length === 1 && r.rows[0].d === wantLater, JSON.stringify(r));

// Deactivated customer loses it all.
await db.query(`update public.company_members set status = 'inactive' where person_id = $1`, [cathy.pid]);
r = await rpc(cathy.u, `select (select count(*) from public.maintenance_customer_history())::int as a, (select count(*) from public.maintenance_customer_next_visits())::int as b`);
check('9 a customer whose access was turned off sees nothing', r.ok && r.rows[0].a === 0 && r.rows[0].b === 0, JSON.stringify(r));

// Not callable by the public.
await db.exec('reset role; set role anon');
let anonOk = true;
try { await db.query(`select * from public.maintenance_customer_next_visits()`); } catch { anonOk = false; }
await db.exec('reset role');
check('10 signed-out visitors cannot call the next-visit function', !anonOk);

// The older functions are untouched and the new snow one carries the arrival time.
const sig = async (name) => (await one(`select pg_get_function_result(p.oid) as r from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [name]))?.r ?? '';
check('11 the older snow timeline and maintenance updates functions keep their old columns (installed app builds still work)', !/arrived_at/.test(await sig('snow_customer_timeline')) && !/arrived_at/.test(await sig('maintenance_customer_updates')) && !/property_id/.test(await sig('maintenance_customer_updates')));
check('12 the new snow history function has the arrival time and the same rows shape otherwise', /arrived_at timestamp/.test(await sig('snow_customer_history')) && /media jsonb/.test(await sig('snow_customer_history')));

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
