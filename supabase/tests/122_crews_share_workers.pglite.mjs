// Update 122: a worker can be in several crews; approving a maintenance worker keeps their other crews.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`);
check('0 the full schema and all updates (including 122) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/122_crews_share_workers.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 122 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const co = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
const person = async (email, name) => (await one(`insert into public.people (email, first_name, last_name) values ($1,$2,'T') returning id`, [email, name])).id;
const john = await person('john@x.test', 'John');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'worker','active','landscaping')`, [co, john]);
const lawn = (await one(`insert into public.crews (company_id, name) values ($1,'Lawn') returning id`, [co])).id;
const snow = (await one(`insert into public.crews (company_id, name) values ($1,'Snow') returning id`, [co])).id;
const add = (crew, p) => db.query(`insert into public.crew_members (company_id, crew_id, person_id) values ($1,$2,$3)`, [co, crew, p]);

let ok = true; try { await add(lawn, john); await add(snow, john); } catch (e) { ok = false; console.log(e.message); }
check('1 one worker can be in two crews', ok && +(await one(`select count(*) from public.crew_members where person_id = $1`, [john])).count === 2);
let dup = false; try { await add(lawn, john); } catch { dup = true; }
check('2 the same worker cannot be in the same crew twice', dup);
const idx = await db.query(`select indexname from pg_indexes where tablename = 'crew_members' and indexname = 'uq_crew_members_person'`);
check('3 the old one-crew-per-worker index is gone', idx.rows.length === 0);
const third = (await one(`insert into public.crews (company_id, name) values ($1,'Third') returning id`, [co])).id;
let okThird = true; try { await add(third, john); } catch (e) { okThird = false; console.log(e.message); }
check('4 a worker who is in two crews can also join a third', okThird && +(await one(`select count(*) from public.crew_members where person_id = $1`, [john])).count === 3);
await db.query(`delete from public.crew_members where crew_id = $1 and person_id = $2`, [lawn, john]);
check('5 taking a worker out of one crew leaves the others', +(await one(`select count(*) from public.crew_members where person_id = $1`, [john])).count === 2);
