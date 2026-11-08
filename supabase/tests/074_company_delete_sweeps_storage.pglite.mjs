// Update 74: deleting a company queues whole storage folders (company, ID photos, avatars) so everything stored is removed.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 74) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/074_company_delete_sweeps_storage.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 74 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
const login = async (email, name) => {
  const u = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id;
  let pid = (await one(`select id from public.people where user_id = $1`, [u]))?.id;
  if (!pid) pid = (await one(`insert into public.people (user_id, email, first_name, last_name) values ($1, $2, $3, 'T') returning id`, [u, email, name])).id;
  else await db.query(`update public.people set first_name = $2 where id = $1`, [pid, name]);
  return { u, pid };
};

const keep = (await one(`insert into public.companies (name) values ('Keeper') returning id`)).id;
await db.exec(`set session_replication_role = replica`);
const gone = (await one(`insert into public.companies (name) values ('Closing Co') returning id`)).id;
await db.exec(`set session_replication_role = origin`);
const owner = await login('owner@x.test', 'Owner');
const onlyHere = await login('only@x.test', 'OnlyHere');
const shared = await login('shared@x.test', 'Shared');
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active'),($1,$3,'worker','active'),($1,$4,'worker','active'),($5,$4,'worker','active')`, [gone, owner.pid, onlyHere.pid, shared.pid, keep]);
const proj = (await one(`insert into public.projects (company_id, name, status) values ($1,'P','active') returning id`, [gone])).id;
await db.query(`insert into public.project_photos (company_id, project_id, uploaded_by, file_url, file_key) values ($1,$2,$3,'https://x/a.jpg',$4)`, [gone, proj, owner.pid, `${gone}/projects/${proj}/a.jpg`]);

const r = await rpc(owner.u, `select public.delete_my_company('closing co') as x`);
check('1 the company deletion still works', r.ok, r.msg);
const q = await all(`select kind, file_key, status from public.storage_cleanup_queue where company_id = $1 order by file_key`, [gone]);
const keys = q.map((x) => x.file_key);
check('2 the whole company folder is queued (everything stored for it, whatever table it came from)', q.some((x) => x.kind === 'prefix' && x.file_key === `${gone}/` && x.status === 'pending'), JSON.stringify(q));
check('3 the file listed by a table row is queued as a file as well', q.some((x) => x.kind === 'file' && x.file_key.endsWith('/a.jpg')));
check('4 ID photos and avatars of the people whose accounts were deleted are queued', keys.includes(`ids/${owner.pid}/`) && keys.includes(`avatars/${owner.pid}/`) && keys.includes(`ids/${onlyHere.pid}/`) && keys.includes(`avatars/${onlyHere.pid}/`), JSON.stringify(keys));
check('5 a person who also belongs to another company keeps their account, so their folders are NOT queued', !keys.includes(`ids/${shared.pid}/`) && !keys.includes(`avatars/${shared.pid}/`));
check('6 the other company is untouched: nothing queued for it', (await one(`select count(*)::int c from public.storage_cleanup_queue where file_key like $1`, [`${keep}/%`])).c === 0);

// the job side
const claimed = await all(`select * from public.storage_cleanup_claim(50)`);
check('7 the job claims items with their kind (file or prefix)', claimed.length === q.length && claimed.every((x) => x.kind === 'file' || x.kind === 'prefix') && claimed.some((x) => x.kind === 'prefix'));
const pre = claimed.find((x) => x.kind === 'prefix' && x.file_key === `${gone}/`);
await db.query(`select public.storage_cleanup_finish($1::uuid, false, null, true)`, [pre.id]);
let row = await one(`select status, attempts, next_attempt_at <= now() as due, locked_until from public.storage_cleanup_queue where id = $1`, [pre.id]);
check('8 a folder with files still left stays pending, due immediately, WITHOUT counting a failed try', row.status === 'pending' && row.due && row.attempts === pre.attempts - 1 && row.locked_until === null, JSON.stringify(row));
const again2 = await all(`select * from public.storage_cleanup_claim(50)`);
check('9 and is claimed again at once to continue emptying it', again2.length === 1 && again2[0].id === pre.id);
await db.query(`select public.storage_cleanup_finish($1::uuid, true)`, [pre.id]);
row = await one(`select status, processed_at from public.storage_cleanup_queue where id = $1`, [pre.id]);
check('10 only when the folder is really empty is it marked done', row.status === 'done' && row.processed_at !== null);
check('11 the app (any signed-in user) cannot claim or finish cleanup items', !(await rpc(owner.u, `select count(*) as x from public.storage_cleanup_claim(5)`)).ok);

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
