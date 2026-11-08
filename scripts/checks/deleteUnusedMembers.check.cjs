// Run: node scripts/checks/deleteUnusedMembers.check.cjs
// (1) The owner can delete a worker or customer who has no login and no records; anyone else is deactivated instead (history stays).
// (2) A deactivated worker is not offered "Schedule Work".
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const data = read('src/data/deleteMember.ts');
const worker = read('app/(owner)/(tabs)/workers/[id].tsx');
const customer = read('app/(owner)/customers/[id].tsx');
const sql = require('./_sql.cjs').fn('delete_unused_member');   // in supabase/setup.sql

check('1 the app asks the database to delete, and reports "has history" separately from other failures', /rpc\('delete_unused_member', \{ p_person_id: personId \}\)/.test(data) && /\^HAS_HISTORY:/.test(data) && /hasHistory: true/.test(data) && !/replace\(\/\^HAS_HISTORY/.test(data));
check('2 you can never delete yourself', /personId === db\.personId/.test(data));
check('3 the worker profile has Delete Worker, which offers Deactivate instead when there is history', /handleDelete/.test(worker) && /Delete Worker/.test(worker) && /Deactivate instead/.test(worker));
check('4 a deactivated worker is not offered Schedule Work', /\{isActive \? \(\s*<Pressable\s*style=\{\[styles\.scheduleWorkBtn/.test(worker));
check('5 the customer screen has Delete Customer and points to turning portal access off when there is history', /Delete Customer/.test(customer) && /turn their portal access off instead/.test(customer));
check('6 the database allows only the owner (or an allowed admin)', /role in \('owner', 'admin'\) and status = 'active'/.test(sql) && /admin_can\(m\.company_id, 'team'\)/.test(sql));
check('7 never someone with a login', /p\.user_id is not null/.test(sql) && /HAS_HISTORY: This person has a login/.test(sql));
check('8 never anyone with a record in any table other than the team-setup ones (found from the database itself)', /pg_constraint/.test(sql) && /confrelid = 'public\.people'::regclass/.test(sql) && /blocked := array_append/.test(sql));
check('9 the deletion is written to the history', /'member_deleted'/.test(sql));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
