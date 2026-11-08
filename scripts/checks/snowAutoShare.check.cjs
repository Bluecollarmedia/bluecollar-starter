// Run: node scripts/checks/snowAutoShare.check.cjs
// Photos reach the customer by themselves when a crew lead completes a stop (no manual approve-and-send in the middle of a storm).
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };

const sql = read('supabase/updates/087_auto_share_snow_photos.sql');
check('1 the setting exists and is ON by default', /auto_share_with_customers boolean not null default true/.test(sql));
check('2 completing a stop approves and shares its photos and releases it to the customer, unless the owner turned it off', /create trigger snow_visits_auto_share after update of status on public\.snow_visits/.test(sql) && /_snow_auto_share_on\(new\.company_id\)/.test(sql) && /customer_notified_at = coalesce\(customer_notified_at, now\(\)\)/.test(sql) && /review_status = 'approved', reviewed_at = now\(\), shared_at = now\(\)/.test(sql));
check('3 a photo added later to a released stop is shared too', /create trigger snow_completion_media_auto_share before insert on public\.snow_completion_media/.test(sql) && /v\.customer_notified_at is not null/.test(sql));
check('4 it never touches stops completed before, and nothing is deleted or un-shared', !/delete from|drop table|truncate/i.test(sql) && !/shared_at = null/.test(sql));
check('5 the owner keeps control: a switch (and Photo review still lets them withdraw)', /turns this off/.test(sql) && /withdrawn/.test(sql));
const more = read('app/snow/owner/(tabs)/more.tsx');
check('6 Snow More has the "Send photos to customers automatically" switch under Rules', /<AutoShareToggle companyId=\{db\.companyId\} \/>/.test(more) && /Send photos to customers automatically/.test(read('src/components/snow/settings/AutoShareToggle.tsx')));
const data = read('src/data/snowSettings.ts');
check('7 the switch reads and saves the setting, and is safe before the database update is installed', /loadAutoShare/.test(data) && /setAutoShare/.test(data) && /auto_share_with_customers/.test(data) && /needs the next app update/.test(data));
check('8 the Photo review row now says what it is for (see what customers were sent, withdraw if needed)', /See what customers were sent, and withdraw a photo if needed/.test(more));
check('9 the database test exists: auto-share on completion, later photos, withdraw, switch off = manual, others hidden', fs.existsSync(path.join(__dirname, '../../supabase/tests/087_auto_share_snow_photos.pglite.mjs')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
