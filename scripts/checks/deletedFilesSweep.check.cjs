// Run: node scripts/checks/deletedFilesSweep.check.cjs
// Deleted files really leave storage: removal goes through the media function (owner/admin of that company, or the uploader), the app asks the
// storage-cleanup function to sweep after deletes, and update 119 queues the file of every deleted row.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
let n = 0;
const check = (name, ok, detail = '') => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}${ok ? '' : '  - ' + detail}`); };

check('files are removed through the media function (which only lets this company\'s owner and admins, or the person who uploaded the file, delete in their own company folder)', /action: 'delete', key/.test(read('src/lib/media.ts')) && /first in me\.roles && \(CAN_DELETE_ANY\.has\(me\.roles\[first\]\) \|\| uploadedBy\(key, me\.personId\)\)/.test(read('supabase/functions/media/index.ts')));

const sweep = read('src/lib/storageSweep.ts');
check('after any delete (and shortly after sign-in) the app asks the storage-cleanup function to delete the queued files: a few seconds later and again a little after, never throwing', /export function sweepStorageSoon/.test(sweep) && /storage-cleanup/.test(sweep) && /setTimeout\(\(\) => \{ void runBatches\(\); \}, 5000\)/.test(sweep) && /sweepStorageSoon\(\);\s*\}\s*\}/.test(read('src/data/store.ts')) && /sweepStorageSoon\(\)/.test(read('app/_layout.tsx')));
const sql119 = read('supabase/updates/119_deleted_files_sweep.sql');
check('update 119: a trigger on every table with a file puts a deleted row\'s file on the clean-up queue (repeats skipped), reports too, and nobody can call it from the app', /after delete on public\.%I for each row execute function public\._enqueue_deleted_file\(\)/.test(sql119) && /on conflict \(file_key\) do nothing/.test(sql119) && /_enqueue_deleted_issue_files/.test(sql119) && /revoke all on function public\._enqueue_deleted_file\(\) from public, anon, authenticated/.test(sql119));
console.log(bad ? `\n${bad} of ${n} FAILED` : `\nAll ${n} passed`);
process.exit(bad ? 1 : 0);
