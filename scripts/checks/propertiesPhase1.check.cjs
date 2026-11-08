// Customers and job sites (properties): the link guards are in the database (supabase/setup.sql) and the document email goes to the right
// customer. (Behaviour is tested in supabase/tests/setup/11_customers_jobs.test.mjs.)
const fs = require('node:fs');
const path = require('node:path');
const sql = require('./_sql.cjs').setup;   // supabase/setup.sql, the one file that builds the database
const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
let bad = 0;
const check = (n, ok) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); };
const email = read('supabase/functions/send-document-email/index.ts');

check('5 the guards run only for changes made from the app (the database functions are exempt), and only for new or changed links', (sql.match(/current_user not in \('authenticated', 'anon'\)/g) || []).length >= 4 && /is distinct from old\.customer_id/.test(sql));
check('9 the document email goes to the customer the document was made for', /doc\.customer_id \?\? project\?\.customer_id/.test(email) && /project_id, company_id, status, customer_id/.test(email));
check('10 the rules are written down for the owner', fs.existsSync(path.join(__dirname, '..', '..', 'docs', 'customers-and-properties.md')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
