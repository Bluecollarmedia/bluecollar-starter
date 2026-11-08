// Run: node scripts/checks/oldCodesDropped.check.cjs
// The old code / request functions are dropped by update 85, and nothing in the app or an edge function calls any of them.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const walk = (d, out = []) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (/\.(ts|tsx|js)$/.test(e.name)) out.push(p); } return out; };
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };

const dropped = ['approve_join_request', 'decline_join_request', 'request_join', 'join_with_code', 'lookup_any_code', 'lookup_team_code', 'lookup_project_code', 'lookup_snow_code',
  'claim_project', 'regenerate_project_code', 'regenerate_maintenance_code', 'regenerate_snow_signup_code', 'disable_snow_signup_code', 'request_snow_access',
  'approve_snow_access_request', 'decline_snow_access_request', 'remove_snow_access_request', 'list_snow_access_requests', 'withdraw_my_snow_request', 'handle_new_user_snow'];
const sql = read('supabase/updates/085_drop_old_code_functions.sql');
check('1 update 85 drops every one of the old functions, and only with "if exists"', dropped.every((n) => sql.includes('drop function if exists public.' + n + '(')) && !sql.includes('drop function public.'));
check('2 update 85 never drops a table, a column or any data', !/drop table|drop column|delete from|truncate/i.test(sql));
const files = [...walk('src'), ...walk('app'), ...walk('supabase/functions')];
const text = files.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
const used = dropped.filter((n) => text.includes("'" + n + "'") || text.includes('"' + n + '"') || text.includes('`' + n + '`'));
check('3 the app and the edge functions call none of them', used.length === 0, used.join(', '));
check('4 the old maintenance customer-code file is gone, and the property page no longer has a "Remove Customer\'s Access" button that used it', !fs.existsSync(path.join(root, 'src/data/maintenanceCodes.ts')) && !/regenerateMaintenanceCode|Remove Customer/.test(read('src/components/maintenance/CustomerAccessSection.tsx')));
check('5 the leftover tables are NOT dropped here (live functions still read them): the update is functions and triggers only', !/join_requests\b.*drop|drop.*team_codes|drop.*snow_signup_codes/i.test(sql.replace(/--.*$/gm, '')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
