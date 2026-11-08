// Update 106: the owner can delete a storm update or a whole storm. Real full schema on PGlite (not real Supabase).
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';
const repo = process.argv[2];
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
const { db, failures } = await buildFullSchema(repo);
check('0 the full schema including 104, 105 and 106 loads', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/106_storm_delete.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('1 update 106 can be run a second time', again);
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asRole = async (role, u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u ?? ''}', false); set role ${role};`); };
const call = async (role, u, sql, p) => { await asRole(role, u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: e.message }; } };
const mkCo = async (name) => (await one(`insert into public.companies (name) values ($1) returning id`, [name])).id;
const mkUser = async (email) => {
  await db.exec('reset role');
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id ?? (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1,$2,'T','T') returning id`, [u, email])).id;
  return { u, pid };
};
await db.exec('reset role');
const co = await mkCo('Acme');
const owner = await mkUser('o@x.test');
const admin = await mkUser('a@x.test');
const worker = await mkUser('w@x.test');
await db.query(`insert into public.company_members (company_id, person_id, role, status, worker_type) values ($1,$2,'owner','active','landscaping'),($1,$3,'admin','active','landscaping'),($1,$4,'worker','active','landscaping')`, [co, owner.pid, admin.pid, worker.pid]);
const pub = (id, head = 'Head') => call('authenticated', owner.u, `select public.publish_storm_outlook($1,'S',$2,'Msg',null,3,6,null,null,'Dis',null,null,false) as x`, [id, head]);
const hist = () => call('authenticated', owner.u, `select public.owner_storm_history() as x`);

let r = await pub(null, 'First');
const oid = r.v.outlook_id;
await pub(oid, 'Second');
await pub(oid, 'Third');
r = await hist();
check('2 the owner sees all three updates in their own history', r.ok && r.v.length === 1 && r.v[0].versions.length === 3, JSON.stringify(r));
const vid = (n) => r.v[0].versions.find((v) => v.version_no === n).id;
const v2 = vid(2);
const v3 = vid(3);

for (const [who, u] of [['an admin', admin.u], ['a worker', worker.u]]) {
  const x = await call('authenticated', u, `select public.delete_storm_update($1) as x`, [v2]);
  const y = await call('authenticated', u, `select public.delete_storm_outlook($1) as x`, [oid]);
  const z = await call('authenticated', u, `select public.owner_storm_history() as x`);
  check(`3 ${who} cannot delete or list`, !x.ok && !y.ok && !z.ok, JSON.stringify([x, y, z]));
}
const anon = await call('anon', null, `select public.delete_storm_update($1) as x`, [v2]);
check('4 a signed-out caller cannot delete', !anon.ok, JSON.stringify(anon));

await db.exec('reset role');
let direct = true;
try { await db.query(`delete from public.storm_outlook_versions where id = $1`, [v2]); } catch { direct = false; }
let edit = true;
try { await db.query(`update public.storm_outlook_versions set headline = 'x' where id = $1`, [v2]); } catch { edit = false; }
check('5 outside the owner functions a published update still cannot be deleted or changed', !direct && !edit);

r = await call('authenticated', owner.u, `select public.delete_storm_update($1) as x`, [v3]);
check('6 the owner deletes the latest update', r.ok && r.v.deleted === true && r.v.storm_deleted === false, JSON.stringify(r));
r = await call('authenticated', owner.u, `select public.owner_storm_current() as x`);
check('7 the update before it becomes the current one', r.ok && r.v?.latest?.version_no === 2 && r.v.version_count === 2, JSON.stringify(r.v));
r = await pub(oid, 'Fourth');
check('8 a new update after a delete still numbers correctly', r.ok && r.v.version_no === 3, JSON.stringify(r));
r = await call('authenticated', owner.u, `select public.delete_storm_outlook($1) as x`, [oid]);
check('9 the owner deletes the whole storm', r.ok && r.v.deleted === true, JSON.stringify(r));
await db.exec('reset role');
const left = await one(`select (select count(*) from public.storm_outlooks)::int as o, (select count(*) from public.storm_outlook_versions)::int as v`);
check('10 the storm and all its updates are gone', left.o === 0 && left.v === 0, JSON.stringify(left));

r = await pub(null, 'Again');
const o3 = r.v.outlook_id;
await db.exec('reset role');
const vAgain = (await one(`select id from public.storm_outlook_versions where outlook_id = $1`, [o3])).id;
let flagStillOn = true;
try { await db.query(`delete from public.storm_outlook_versions where id = $1`, [vAgain]); } catch { flagStillOn = false; }
check('11 the delete permission does not stay switched on after the owner functions finish', !flagStillOn);

r = await hist();
const only = r.v[0].versions[0].id;
r = await call('authenticated', owner.u, `select public.delete_storm_update($1) as x`, [only]);
check('12 deleting the only update removes the storm', r.ok && r.v.storm_deleted === true, JSON.stringify(r));
r = await call('authenticated', owner.u, `select public.delete_storm_update($1) as x`, [only]);
check('13 deleting something already gone says it was not found', !r.ok && /not found/.test(r.msg ?? ''), JSON.stringify(r));

console.log(results.every(Boolean) ? 'all passed' : 'FAILED');
process.exit(results.every(Boolean) ? 0 : 1);
