// Run: node scripts/checks/deletedFilesSweep.check.cjs
// Deleted files really leave storage: removal goes through the media function (owner/admin of that company, or the uploader), the app asks the
// storage-cleanup function to sweep after deletes, and the database (supabase/setup.sql) queues the file of every deleted row.
const fs = require('fs');
const path = require('path');
const sql = require('./_sql.cjs');   // supabase/setup.sql, the one file that builds the database
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
let n = 0;
const check = (name, ok, detail = '') => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}${ok ? '' : '  - ' + detail}`); };

check('files are removed through the media function (which only lets this company\'s owner and admins, or the person who uploaded the file, delete in their own company folder)', /action: 'delete', key/.test(read('src/lib/media.ts')) && /first in me\.roles && \(CAN_DELETE_ANY\.has\(me\.roles\[first\]\) \|\| uploadedBy\(key, me\.personId\)\)/.test(read('supabase/functions/media/index.ts')));

const sweep = read('src/lib/storageSweep.ts');
check('after any delete (and shortly after sign-in) the app asks the storage-cleanup function to delete the queued files: a few seconds later and again a little after, never throwing', /export function sweepStorageSoon/.test(sweep) && /storage-cleanup/.test(sweep) && /setTimeout\(\(\) => \{ void runBatches\(\); \}, 5000\)/.test(sweep) && /sweepStorageSoon\(\);\s*\}\s*\}/.test(read('src/data/store.ts')) && /sweepStorageSoon\(\)/.test(read('app/_layout.tsx')));
// Every table in setup.sql that keeps a stored file (a file_key column), apart from the clean-up queue itself.
const fileTables = [...sql.setup.matchAll(/^create table if not exists public\.([a-z0-9_]+) \(([\s\S]*?)^\);/gm)]
  .filter((m) => /^\s+file_key text\b/m.test(m[2]) && m[1] !== 'storage_cleanup_queue').map((m) => m[1]);
const missing = fileTables.filter((t) => !new RegExp(`^create trigger zz_enqueue_deleted_file AFTER DELETE ON public\\.${t} FOR EACH ROW EXECUTE FUNCTION public\\._enqueue_deleted_file\\(\\);`, 'm').test(sql.setup));
check(`setup.sql: every table with a stored file (${fileTables.join(', ')}) has the trigger that queues a deleted row's file`, fileTables.length >= 4 && missing.length === 0, missing.join(', '));
check('repeats are skipped, problem-report photos are queued too, and nobody can call the queue functions from the app',
  /on conflict \(file_key\) do nothing/.test(sql.fn('_enqueue_deleted_file'))
  && /AFTER DELETE ON public\.property_issues FOR EACH ROW EXECUTE FUNCTION public\._enqueue_deleted_issue_files\(\)/.test(sql.setup)
  && ['_enqueue_deleted_file', '_enqueue_deleted_issue_files'].every((f) => /^revoke all on function [^\n]* from public, anon, authenticated\b/m.test(sql.grants(f)) && sql.grantedTo(f).every((r) => r === 'service_role')));
console.log(bad ? `\n${bad} of ${n} FAILED` : `\nAll ${n} passed`);
process.exit(bad ? 1 : 0);
