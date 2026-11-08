// Update 95: a person's language is saved on their account (for the server's push notices).
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 95) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/095_push_language.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 95 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const rpc = async (u, sql, p) => { await asUser(u); try { await db.query(sql, p); return { ok: true }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await db.exec('reset role'); } };
await db.exec('reset role');
const u = (await one(`insert into auth.users (email, raw_user_meta_data) values ('w@x.test', '{"first_name":"Ana","last_name":"R"}'::jsonb) returning id`)).id;
const pid = (await one(`select id from public.people where user_id = $1`, [u])).id;
const lang = async () => (await one(`select language from public.people where id = $1`, [pid])).language;
check('1 everyone starts in English', (await lang()) === 'en');
let r = await rpc(u, `select public.set_my_language('es')`);
check('2 the person can save Español', r.ok && (await lang()) === 'es', r.msg);
r = await rpc(u, `select public.set_my_language('fr')`);
check('3 an unknown language is refused', !r.ok && (await lang()) === 'es', r.msg);
r = await rpc(u, `select public.set_my_language('en')`);
check('4 and can go back to English', r.ok && (await lang()) === 'en', r.msg);
console.log(results.every(Boolean) ? '\nall passed' : '\nsome failed');
process.exit(results.every(Boolean) ? 0 : 1);
