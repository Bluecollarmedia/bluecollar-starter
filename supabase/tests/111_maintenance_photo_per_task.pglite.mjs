// Update 111: one photo per task when a maintenance stop requires photos. Real full schema on PGlite (not real Supabase).
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';
const repo = process.argv[2];
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
const { db, failures } = await buildFullSchema(repo);
check('0 the full schema including 111 loads', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/111_maintenance_photo_per_task.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 111 can be run a second time', again);
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await db.exec('reset role'); } };
const today = (await db.query(`select current_date::text as d`)).rows[0].d;
const co = (await one(`insert into public.companies (name) values ('Test Co') returning id`)).id;
const mk = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1,$2,$3,'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const owner = await mk('o@x.test', 'Owner');
const m1 = await mk('m1@x.test', 'Maint One');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'owner','active','landscaping'),($1,$3,'worker','active','maintenance')`, [co, owner.pid, m1.pid]);
const mp = (await one(`insert into public.maintenance_properties (company_id, name, address) values ($1,'Chase','1 St') returning id`, [co])).id;
const contract = (await one(`insert into public.maintenance_contracts (company_id, property_id, name) values ($1,$2,'2026') returning id`, [co, mp])).id;
const route = (await one(`insert into public.maintenance_routes (company_id, service_date, name) values ($1,$2,'Route 1') returning id`, [co, today])).id;
await db.query(`insert into public.maintenance_route_crew (company_id, route_id, person_id) values ($1,$2,$3)`, [co, route, m1.pid]);
const stopA = (await one(`insert into public.maintenance_stops (company_id, route_id, property_id, contract_id, sort_order, requires_photos, min_photos) values ($1,$2,$3,$4,1,true,1) returning id`, [co, route, mp, contract])).id;
const stopB = (await one(`insert into public.maintenance_stops (company_id, route_id, property_id, contract_id, sort_order, requires_photos, min_photos) values ($1,$2,$3,$4,2,false,1) returning id`, [co, route, mp, contract])).id;
const task = async (stop, title) => (await one(`insert into public.maintenance_stop_tasks (company_id, route_id, stop_id, title) values ($1,$2,$3,$4) returning id`, [co, route, stop, title])).id;
const t1 = await task(stopA, 'Mow'); const t2 = await task(stopA, 'Edge'); const t3 = await task(stopA, 'Blow');
const tb = await task(stopB, 'Mow B');
const photo = async (stop, taskId) => { await db.exec('reset role'); return db.query(`insert into public.maintenance_photos (company_id, route_id, stop_id, property_id, uploaded_by, file_url, file_key, task_id) values ($1,$2,$3,$4,$5,'https://x/p.jpg','m/' || gen_random_uuid() || '.jpg',$6)`, [co, route, stop, mp, m1.pid, taskId]); };
const tick = (u, t, done = true) => rpc(u, `select public.maintenance_set_task_done($1::uuid, $2) as x`, [t, done]);

let r = await tick(m1.u, t1);
check('1 with photos required, a task cannot be ticked with no photo', !r.ok && /own photo/.test(r.msg ?? ''), JSON.stringify(r));
await photo(stopA, t1);
r = await tick(m1.u, t1);
check('2 once that task has its photo it can be ticked', r.ok, r.msg);
r = await tick(m1.u, t2);
check('3 ONE photo no longer lets the worker tick the other tasks', !r.ok && /Edge/.test(r.msg ?? ''), JSON.stringify(r));
await photo(stopA, t2);
r = await tick(m1.u, t2);
check('4 each task needs its own photo, and with it the task can be ticked', r.ok, r.msg);
let bad = true;
try { await photo(stopB, t3); bad = false; } catch { bad = true; }
check('5 a photo cannot be tied to a task of a different stop', bad);
r = await tick(m1.u, t1, false);
check('6 unticking a task needs no photo', r.ok, r.msg);
r = await tick(m1.u, t1, true);
check('7 ticking it again works because its photo is still there', r.ok, r.msg);
r = await tick(owner.u, t3);
check('8 the owner is never blocked when correcting a task', r.ok, r.msg);
r = await tick(m1.u, tb);
check('9 a stop that does not require photos works as before (no photo needed)', r.ok, r.msg);
await db.exec('reset role');
const old = await one(`select count(*)::int c from public.maintenance_photos where stop_id = $1 and task_id is null`, [stopA]);
check('10 photos without a task (taken before this update) are allowed and untouched', old.c === 0);
let okInsert = true;
try { await db.query(`insert into public.maintenance_photos (company_id, route_id, stop_id, property_id, uploaded_by, file_url, file_key) values ($1,$2,$3,$4,$5,'https://x/o.jpg','m/o.jpg')`, [co, route, stopA, mp, m1.pid]); } catch { okInsert = false; }
check('11 a photo with no task can still be added to a stop', okInsert);

// the rule's photo count
let r1 = true, r2 = true;
const rule = (await one(`insert into public.maintenance_service_rules (company_id, contract_id, property_id, service_type, label, frequency) values ($1,$2,$3,'mowing','Mowing','weekly') returning id, min_photos`, [co, contract, mp]));
check('12 a service rule starts with 1 photo', rule.min_photos === 1, JSON.stringify(rule));
try { await db.query(`update public.maintenance_service_rules set min_photos = 0 where id = $1`, [rule.id]); } catch { r1 = false; }
try { await db.query(`update public.maintenance_service_rules set min_photos = 21 where id = $1`, [rule.id]); } catch { r2 = false; }
await db.query(`update public.maintenance_service_rules set min_photos = 5 where id = $1`, [rule.id]);
check('13 how many photos a service needs can be 1 to 20, nothing else', !r1 && !r2 && (await one(`select min_photos from public.maintenance_service_rules where id = $1`, [rule.id])).min_photos === 5);
console.log(results.every(Boolean) ? 'all passed' : 'FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
