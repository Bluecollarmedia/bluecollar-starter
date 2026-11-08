// Phase 1 of customers and properties: the SQL is additive and guarded, and the two small fixes are in place. (Behaviour is tested in
// supabase/tests/075_properties_and_integrity.pglite.mjs and 076_properties_backfill.pglite.mjs.)
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
let bad = 0;
const check = (n, ok) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); };
const s75 = read('supabase/updates/075_properties_and_integrity.sql');
const s76 = read('supabase/updates/076_properties_backfill.sql');
const edit = read('app/(owner)/maintenance-property-edit.tsx');
const email = read('supabase/functions/send-document-email/index.ts');
const strip = (s) => s.replace(/--.*$/gm, '');
// Statements that run when the file is run (function bodies between $$ ... $$ only run later, when the function is called).
const topLevel = (s) => strip(s).replace(/\$\$[\s\S]*?\$\$/g, '$$$$');

check('1 running update 75 never deletes, truncates, drops tables/columns, or updates/inserts existing data (function bodies only run later, when called)',
  !/\b(delete\s+from|truncate|drop\s+table|drop\s+column)\b/i.test(topLevel(s75)) && !/^\s*update\s+public\./im.test(topLevel(s75))
  && !/^\s*insert\s+into\s+public\.(projects|maintenance_properties|snow_properties|quotes|invoices|people|company_members)\b/im.test(topLevel(s75)));
check('2 update 76 only DEFINES the function (nothing runs when the file is run)', !/^\s*select\s+public\.backfill_properties/im.test(strip(s76)) && /create or replace function public\.backfill_properties/.test(s76));
check('3 the backfill is a dry run unless told "true", and only the company owner can run it', /p_apply boolean default false/.test(s76) && /m\.role = 'owner'/.test(s76) && /Only the company owner can run this/.test(s76));
check('4 the backfill never updates address, name or customer columns (it only sets property_id)', !/update public\.(projects|maintenance_properties|snow_properties)[^;]*set\s+(?!property_id)/is.test(s76.replace(/--.*$/gm, '')));
check('5 the guards run only for changes made from the app (the database functions are exempt), and only for new or changed links', (s75.match(/current_user not in \('authenticated', 'anon'\)/g) || []).length >= 4 && /is distinct from old\.customer_id/.test(s75));
check('6 a deactivated customer is blocked in all four customer-access functions', (s75.match(/_customer_in_good_standing\(/g) || []).length >= 5);
check('7 a project-code claim merges the owner-created record', /_merge_placeholder_customer\(pr\.company_id, pr\.old_customer, pid\)/.test(s75));
check('8 choosing a different customer in the maintenance form clears the old project link', /if \(id !== customerId\) \{ setSourceProjectId\(undefined\); setLinkedPropertyId\(undefined\); \}/.test(edit));
check('9 the document email goes to the customer the document was made for', /doc\.customer_id \?\? project\?\.customer_id/.test(email) && /project_id, company_id, status, customer_id/.test(email));
check('10 the rules are written down for the owner', fs.existsSync(path.join(__dirname, '..', '..', 'docs', 'customers-and-properties.md')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
