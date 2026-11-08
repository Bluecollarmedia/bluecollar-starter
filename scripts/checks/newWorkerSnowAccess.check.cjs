// A new worker gets every Snow service automatically (SQL 113) and the Snow notice no longer talks about landscaping or worker types.
const fs = require('fs');
const read = (p) => fs.readFileSync(p, 'utf8');
let bad = 0;
let n = 0;
const check = (name, ok) => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}`); };
const sql = read('supabase/updates/113_new_workers_get_snow_access.sql');
check('a worker who becomes active gets plowing, shoveling and salting, and never has it switched back on after the owner changed it', /array\['plowing', 'shoveling', 'salting'\]/.test(sql) && /already_exists|exists \(select 1 from public\.snow_staff s where s\.company_id = new\.company_id and s\.person_id = new\.person_id\)/.test(sql) && /on conflict \(company_id, person_id\) do nothing/.test(sql));
check('only workers (not customers or owners) and it never stops anyone from joining', /new\.role <> 'worker'/.test(sql) && /exception when others then/.test(sql));
const n2 = read('app/snow/notice.tsx');
check('the Snow notice says nothing about landscaping or what kind of worker someone is', !/landscaping/i.test(n2.replace(/\/\*[\s\S]*?\*\//, '')) && /Your route shows up here when the owner puts you on one/.test(n2));
process.exit(bad ? 1 : 0);
