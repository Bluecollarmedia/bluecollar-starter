// Update 113: a new worker gets every Snow service automatically. Real full schema on PGlite (not real Supabase).
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';
const repo = process.argv[2];
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
const { db, failures } = await buildFullSchema(repo);
check('0 the full schema including 113 loads', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/113_new_workers_get_snow_access.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 113 can be run a second time', again);
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const signUp = async (email, meta) => {
  const u = (await one(`insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`, [email, JSON.stringify(meta)])).id;
  return { u, pid: (await one(`select id from public.people where user_id = $1`, [u])).id };
};
const owner = await signUp('o@x.test', { first_name: 'Owner', last_name: 'O', company_name: 'Acme Snow' });
const co = (await one(`select company_id from public.company_members where person_id = $1 and role = 'owner'`, [owner.pid])).company_id;
const services = async (pid) => (await db.query(`select service from public.snow_staff_services where company_id = $1 and person_id = $2 order by service`, [co, pid])).rows.map((r) => r.service);
const staff = async (pid) => (await db.query(`select status from public.snow_staff where company_id = $1 and person_id = $2`, [co, pid])).rows[0]?.status;

const w = await signUp('w@x.test', { first_name: 'New', last_name: 'Worker' });
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'worker','invited')`, [co, w.pid]);
check('1 an invited worker (not signed up yet) has no Snow access', (await staff(w.pid)) === undefined);
await db.query(`update public.company_members set status = 'active' where company_id = $1 and person_id = $2`, [co, w.pid]);
check('2 when they sign up (become active) they are on the snow team', (await staff(w.pid)) === 'active');
check('3 with all three services', JSON.stringify(await services(w.pid)) === JSON.stringify(['plowing', 'salting', 'shoveling']), JSON.stringify(await services(w.pid)));

// the owner can still change it, and it is never switched back on
await db.query(`delete from public.snow_staff_services where person_id = $1 and service = 'salting'`, [w.pid]);
await db.query(`update public.company_members set status = 'active' where person_id = $1`, [w.pid]);
check('4 an owner\'s change (a service taken away) is not undone when the member row is touched again', JSON.stringify(await services(w.pid)) === JSON.stringify(['plowing', 'shoveling']), JSON.stringify(await services(w.pid)));
const r = await signUp('r@x.test', { first_name: 'Rev', last_name: 'Oked' });
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'worker','active')`, [co, r.pid]);
await db.query(`update public.snow_staff set status = 'revoked' where person_id = $1`, [r.pid]);
await db.query(`update public.company_members set status = 'inactive' where person_id = $1`, [r.pid]);
await db.query(`update public.company_members set status = 'active' where person_id = $1`, [r.pid]);
check('5 someone the owner revoked is never switched back on', (await staff(r.pid)) === 'revoked');
const cust = await signUp('c@x.test', { first_name: 'Cust', last_name: 'C' });
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'customer','active')`, [co, cust.pid]);
check('6 customers never get Snow access', (await staff(cust.pid)) === undefined);
check('7 the owner is not added to the staff list by this (owners already have access)', (await staff(owner.pid)) === undefined);

// the one-time catch-up for someone who joined recently
await db.query(`alter table public.company_members disable trigger company_members_snow_access`);
const late = await signUp('l@x.test', { first_name: 'Late', last_name: 'Joiner' });
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'worker','active')`, [co, late.pid]);
await db.query(`alter table public.company_members enable trigger company_members_snow_access`);
check('8 (set up) a recent worker with no Snow access exists', (await staff(late.pid)) === undefined);
await db.exec(fs.readFileSync(`${repo}/supabase/updates/113_new_workers_get_snow_access.sql`, 'utf8'));
check('9 running the update catches them up with all three services', (await staff(late.pid)) === 'active' && JSON.stringify(await services(late.pid)) === JSON.stringify(['plowing', 'salting', 'shoveling']), JSON.stringify([await staff(late.pid), await services(late.pid)]));
check('10 and the catch-up does not give services back to a worker whose services the owner changed', JSON.stringify(await services(w.pid)) === JSON.stringify(['plowing', 'shoveling']));
console.log(results.every(Boolean) ? 'all passed' : 'FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
