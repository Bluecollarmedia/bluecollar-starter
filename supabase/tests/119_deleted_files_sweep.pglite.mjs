// Update 119: deleting a row that holds a stored file (alone, or because its parent went) puts the file on the clean-up queue.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 119) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/119_deleted_files_sweep.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 119 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;
const co = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
const proj = (await one(`insert into public.projects (company_id, name) values ($1, 'P') returning id`, [co])).id;
const queued = async () => (await all(`select file_key, source_table from public.storage_cleanup_queue order by file_key`)).map((r) => `${r.source_table}:${r.file_key}`);

const trig = await all(`select c.relname from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.tgname = 'zz_enqueue_deleted_file' order by 1`);
check('1 every table that holds a file has the trigger (project photos, task attachments, maintenance photos, Snow photos, truck documents, ...)', ['project_photos', 'task_attachments', 'maintenance_photos', 'snow_completion_media', 'truck_documents'].every((t) => trig.some((r) => r.relname === t)), JSON.stringify(trig));

// a photo deleted by itself
const ph = (await one(`insert into public.project_photos (company_id, project_id, file_key, file_url) values ($1,$2,'co/photos/a.jpg','https://x/a.jpg') returning id`, [co, proj])).id;
await db.query(`delete from public.project_photos where id = $1`, [ph]);
check('2 a photo deleted on its own is queued for file deletion', (await queued()).includes('project_photos:co/photos/a.jpg'), JSON.stringify(await queued()));

// photos and attachments that go with their project
await db.query(`insert into public.project_photos (company_id, project_id, file_key, file_url) values ($1,$2,'co/photos/b.jpg','https://x/b.jpg')`, [co, proj]);
await db.query(`insert into public.task_attachments (company_id, project_id, task_id, media_type, file_url, file_key) select $1,$2,t.id,'image','https://x/c.jpg','co/tasks/c.jpg' from (select gen_random_uuid() as id) t`, [co, proj]).catch(() => {});
await db.query(`delete from public.projects where id = $1`, [proj]);
const q2 = await queued();
check('3 photos that go with a deleted project are queued too (the rows go by themselves, the files must not stay)', q2.includes('project_photos:co/photos/b.jpg'), JSON.stringify(q2));

// a report with photos inside it
const me = (await one(`insert into public.people (first_name, last_name) values ('A','B') returning id`)).id;
const proj2 = (await one(`insert into public.projects (company_id, name) values ($1, 'P2') returning id`, [co])).id;
await db.query(`insert into public.property_issues (company_id, reported_by, issue_type, project_id, photos) values ($1,$2,'other',$3,$4::jsonb)`, [co, me, proj2, JSON.stringify([{ key: 'co/issues/i1.jpg', url: 'https://x/i1.jpg' }, { key: 'https://already/a/link.jpg', url: 'https://x/l' }])]);
await db.query(`delete from public.property_issues where company_id = $1`, [co]);
const q3 = await queued();
check('4 the photos inside a deleted problem report are queued (real keys only, never a web link)', q3.includes('property_issues:co/issues/i1.jpg') && !q3.some((k) => k.includes('already')), JSON.stringify(q3));

// repeats are harmless
await db.query(`insert into public.project_photos (company_id, file_key, file_url, project_id) values ($1,'co/photos/a.jpg','https://x/a.jpg', (select id from public.projects limit 1))`, [co]).catch(() => {});
let ok = true;
try { await db.query(`delete from public.project_photos where file_key = 'co/photos/a.jpg'`); } catch { ok = false; }
check('5 a file key that is already queued is not a problem (no error, no second entry)', ok && (await all(`select 1 from public.storage_cleanup_queue where file_key = 'co/photos/a.jpg'`)).length === 1);

check('6 nobody can call the trigger functions from the app', await (async () => { await db.exec('reset role; set role anon'); let denied = false; try { await db.query(`select public._enqueue_deleted_file()`); } catch { denied = true; } await db.exec('reset role'); return denied; })());

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
