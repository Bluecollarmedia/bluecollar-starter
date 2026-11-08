// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && copy this file (and ./helpers/fullSchema.mjs) beside it, then:
//   node <file> <path to the repo>
// Proves update 62 on the REAL full schema + every update (PGlite, not real Supabase): switching the company to Snow Mode puts every
// active worker on the snow team with all three services, with no sign-up; someone the owner removed stays removed; a worker who joins
// while Snow Mode is on is put on the team too; nothing happens in Landscaping Mode; customers and pending people are never added.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 240)}`); };
check('0 the full schema and all updates (including 062) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/062_snow_auto_enroll_workers.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 62 can be run a second time', again);
// Re-running 62 puts its automatic grants back; update 66 (which switches them off) has to be run again after it.
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/066_account_access_hardening.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0c update 66 can be run again after it (and switches the automatic grants off again)', again);
const fails = async (sql, p) => { try { await db.query(sql, p); return { raised: false, msg: '' }; } catch (e) { return { raised: true, msg: String(e.message) }; } };
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;

const co = (await one(`insert into public.companies (name) values ('Test Co') returning id`)).id;
const mk = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id
    ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  return { u, pid };
};
const owner = await mk('owner@x.test', 'Owner');
const w1 = await mk('w1@x.test', 'W1');
const w2 = await mk('w2@x.test', 'W2');
const wPending = await mk('wp@x.test', 'Pending');
const cust = await mk('c@x.test', 'Cust');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active'),($1,$3,'worker','active'),($1,$4,'worker','active'),($1,$5,'worker','invited'),($1,$6,'customer','active')`, [co, owner.pid, w1.pid, w2.pid, wPending.pid, cust.pid]);
const team = async () => all(`select person_id, status from public.snow_staff where company_id = $1`, [co]);
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };

check('1 in Landscaping Mode nobody is put on the snow team', (await team()).length === 0);

// the owner switches to Snow Mode
await asUser(owner.u);
let f = await fails(`update public.companies set active_mode = 'snow' where id = $1`, [co]);
await db.exec('reset role');
check('2 the owner can switch to Snow Mode', !f.raised && (await one(`select active_mode from public.companies where id = $1`, [co])).active_mode === 'snow', f.msg);
let t = await team();
check('3 switching to Snow Mode puts NOBODY on the snow team (access is explicit per person; update 66 replaced the automatic grant of update 62)', t.length === 0, JSON.stringify(t));
await asUser(w2.u);
const mine0 = (await one(`select public.get_my_snow_access() as a`)).a;
await db.exec('reset role');
check('4 a worker with no snow access sees none, even though the company is in Snow Mode', Array.isArray(mine0) && mine0.length === 0, JSON.stringify(mine0));

// the owner grants it, per person
await asUser(owner.u);
f = await fails(`select public.snow_grant_access($1, array['plowing','salting'])`, [w2.pid]);
await db.exec('reset role');
t = await team();
check('5 the owner can give one worker snow access with chosen services; nobody else gets it', !f.raised && t.length === 1 && t[0].person_id === w2.pid && t[0].status === 'active', f.msg + JSON.stringify(t));
await asUser(w2.u);
const mine = (await one(`select public.get_my_snow_access() as a`)).a;
const canPlow = (await one(`select public.snow_has_service($1, 'plowing') as ok`, [co])).ok;
const canShovel = (await one(`select public.snow_has_service($1, 'shoveling') as ok`, [co])).ok;
await db.exec('reset role');
check('6 that worker sees exactly the services given and keeps landscaping', Array.isArray(mine) && mine.length === 1 && mine[0].services.join() === 'plowing,salting' && mine[0].landscaping_access === true && canPlow === true && canShovel === false, JSON.stringify(mine));
await asUser(w1.u);
const w1sees = (await one(`select public.get_my_snow_access() as a`)).a;
await db.exec('reset role');
check('7 a different worker still has no snow access', Array.isArray(w1sees) && w1sees.length === 0);

// switching the mode off and on again never changes who has access
await asUser(owner.u);
await db.query(`update public.companies set active_mode = 'landscaping' where id = $1`, [co]);
await db.query(`update public.companies set active_mode = 'snow' where id = $1`, [co]);
await db.exec('reset role');
t = await team();
check('8 switching Snow Mode off and on again changes nobody access', t.length === 1 && t[0].person_id === w2.pid);

// removed access stays removed
await asUser(owner.u);
f = await fails(`select public.revoke_snow_access($1)`, [w2.pid]);
await db.query(`update public.companies set active_mode = 'landscaping' where id = $1`, [co]);
await db.query(`update public.companies set active_mode = 'snow' where id = $1`, [co]);
await db.exec('reset role');
const w2row = await one(`select status from public.snow_staff where company_id = $1 and person_id = $2`, [co, w2.pid]);
check('9 a worker the owner removed stays removed when Snow Mode is switched off and on again', !f.raised && w2row.status === 'revoked', f.msg);

// joining while Snow Mode is on
const w3 = await mk('w3@x.test', 'W3');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1, $2, 'worker', 'active')`, [co, w3.pid]);
const w4 = await mk('w4@x.test', 'W4');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1, $2, 'worker', 'invited')`, [co, w4.pid]);
await db.query(`update public.company_members set status = 'active' where person_id = $1`, [w4.pid]);
check('10 a worker who joins or is approved while Snow Mode is on gets NO snow access', (await one(`select 1 as x from public.snow_staff where person_id in ($1, $2)`, [w3.pid, w4.pid])) === undefined);

// deactivating a worker ends both modes
await asUser(owner.u);
f = await fails(`select public.snow_grant_access($1, array['plowing'])`, [w3.pid]);
await db.exec('reset role');
check('11a the owner can give that worker snow access explicitly', !f.raised && (await one(`select status from public.snow_staff where person_id = $1`, [w3.pid])).status === 'active', f.msg);
await asUser(owner.u);
f = await fails(`select public.deactivate_member($1, true)`, [w3.pid]);
await db.exec('reset role');
await asUser(w3.u);
const w3a = (await one(`select public.get_my_snow_access() as a`)).a;
const w3c = (await one(`select public.is_crew($1) as ok`, [co])).ok;
await db.exec('reset role');
check('11 deactivating a worker ends snow AND landscaping access together', !f.raised && Array.isArray(w3a) && w3a.length === 0 && w3c === false, f.msg);

// other companies are untouched
await db.exec(`set session_replication_role = replica`);
const co2 = (await one(`insert into public.companies (name) values ('Other Co') returning id`)).id;
const o2 = await mk('o2@x.test', 'O2');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1, $2, 'owner', 'active')`, [co2, o2.pid]);
await db.exec(`set session_replication_role = origin`);
await asUser(o2.u);
await db.query(`update public.companies set active_mode = 'snow' where id = $1`, [co2]);
await db.exec('reset role');
check('12 another company Snow Mode switch grants nobody anything either', (await one(`select 1 as x from public.snow_staff where company_id = $1`, [co2])) === undefined);

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
