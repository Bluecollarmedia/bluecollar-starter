// Run: node <file> <path to the repo>  (needs @electric-sql/pglite beside it and ./helpers/fullSchema.mjs)
// Proves update 59 on the REAL full schema + every update (PGlite): a maintenance service can be "a set number of visits" on saved
// dates; it needs at least one date; the older frequencies still work; the update can be run twice.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 240)}`); };
check('0 the full schema and all updates (including 059) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/059_maintenance_set_visits.sql`, 'utf8')); } catch (e) { again = false; }
check('0b update 59 can be run a second time', again);
const fails = async (sql, p) => { try { await db.query(sql, p); return { raised: false, msg: '' }; } catch (e) { return { raised: true, msg: String(e.message) }; } };
const one = async (sql, p) => (await db.query(sql, p)).rows[0];

const co = (await one(`insert into public.companies (name) values ('Test Co') returning id`)).id;
const prop = (await one(`insert into public.maintenance_properties (company_id, name, address) values ($1, 'Mitchell', '1 Main St') returning id`, [co])).id;
const con = (await one(`insert into public.maintenance_contracts (company_id, property_id, name, season_start, season_end) values ($1, $2, '2026 season', '2026-07-19', '2026-10-19') returning id`, [co, prop])).id;
let f;
f = await fails(`insert into public.maintenance_service_rules (company_id, contract_id, property_id, service_type, label, frequency, scheduled_dates, season_quantity) values ($1, $2, $3, 'basin_cuts', 'Basin cuts', 'fixed_dates', ARRAY['2026-07-19','2026-08-06','2026-08-25','2026-09-12','2026-10-01','2026-10-19']::date[], 6)`, [co, con, prop]);
check('1 a service with six set visit dates can be saved', !f.raised, f.msg);
const back = await one(`select scheduled_dates, season_quantity from public.maintenance_service_rules where frequency = 'fixed_dates'`);
check('2 the six dates come back in order', back && back.season_quantity === 6 && back.scheduled_dates.length === 6, JSON.stringify(back));
f = await fails(`insert into public.maintenance_service_rules (company_id, contract_id, property_id, service_type, label, frequency) values ($1, $2, $3, 'basin_cuts', 'No dates', 'fixed_dates')`, [co, con, prop]);
check('3 a set-visits service with no dates is refused', f.raised, f.msg);
f = await fails(`insert into public.maintenance_service_rules (company_id, contract_id, property_id, service_type, label, frequency, scheduled_dates) values ($1, $2, $3, 'basin_cuts', 'Empty', 'fixed_dates', ARRAY[]::date[])`, [co, con, prop]);
check('4 an empty list of dates is refused too', f.raised, f.msg);
f = await fails(`insert into public.maintenance_service_rules (company_id, contract_id, property_id, service_type, label, frequency) values ($1, $2, $3, 'lawn_cut', 'Lawn', 'weekly')`, [co, con, prop]);
check('5 a weekly service still saves with no dates', !f.raised, f.msg);
f = await fails(`insert into public.maintenance_service_rules (company_id, contract_id, property_id, service_type, label, frequency, interval_days) values ($1, $2, $3, 'lawn_cut', 'Every 10', 'every_n_days', 10)`, [co, con, prop]);
check('6 every N days still works', !f.raised, f.msg);
f = await fails(`insert into public.maintenance_service_rules (company_id, contract_id, property_id, service_type, label, frequency) values ($1, $2, $3, 'x', 'Bad', 'sometimes')`, [co, con, prop]);
check('7 a made-up frequency is still refused', f.raised, f.msg);

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
