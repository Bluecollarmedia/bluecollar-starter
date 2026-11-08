// Run: node scripts/checks/securityFixes.check.cjs
// The Step 0 security fixes that the other new checks do not cover:
//   R3  the old Supabase "media" bucket is closed to uploads/changes/deletes; listing only your own company's folders
//   R4  nobody inserts into people directly
//   R21 who may create an in-app notice (and the app's own notices still fit the rule)
//   R9  only owner/admin, or the uploader, may delete a company file; no unused role names
//   R19 R2 is required in the app: no quiet fallback to the public Supabase bucket
//   R18 the privacy policy lists every service that gets data
// The database is supabase/setup.sql (one file, the final definitions), read here without its comments.
const fs = require('fs');
const path = require('path');
const sqlHelper = require('./_sql.cjs');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
let bad = 0;
let n = 0;
const check = (name, ok, detail = '') => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}${ok ? '' : '  - ' + detail}`); };

const setup = sqlHelper.setup.replace(/\r\n/g, '\n').replace(/--[^\n]*/g, '');
const createdPolicy = (name) => (setup.match(new RegExp(`create policy ${name}\\b[^;]*;`)) || [null])[0];

// R3
for (const p of ['media_public_read', 'media_authenticated_upload', 'media_owner_delete']) {
  check(`R3 the open "media" bucket rule ${p} is dropped and never made again`, new RegExp(`drop policy if exists ${p} on storage\\.objects;`).test(setup) && !createdPolicy(p));
}
check('R3 setup.sql gives signed-in people no write rule on file storage (no insert/update/delete/all rule on storage.objects)', !/create policy \w+ on storage\.objects for (insert|update|delete|all)/.test(setup));
const mediaRead = createdPolicy('media_company_read');
check('R3 listing the "media" bucket is limited to active members of the company whose folder it is (no cast of a non-id folder)', mediaRead && /to authenticated/.test(mediaRead) && /public\.is_member\(\(\(storage\.foldername\(name\)\)\[1\]\)::uuid\)/.test(mediaRead) && /case\s+when \(storage\.foldername\(name\)\)\[1\] ~\*/.test(mediaRead));

// R4
check('R4 there is no open people insert rule: nobody may insert into people directly (no insert/all rule on people)', !createdPolicy('people_insert') && !/create policy \w+ on public\.people for (insert|all)\b/.test(setup));
const appPeopleInsert = (() => {
  const hits = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) { const t = fs.readFileSync(p, 'utf8'); if (/from\(['"]people['"]\)\s*\.(insert|upsert)\(/.test(t)) hits.push(p); } } };
  walk(path.join(root, 'src')); walk(path.join(root, 'app'));
  return hits;
})();
check('R4 the app never inserts people directly (people are made by database functions)', appPeopleInsert.length === 0, appPeopleInsert.join(', '));

// R21
const ni = createdPolicy('notifications_insert');
check('R21 the notice insert rule uses the role / recipient / event-type check (and it is the only insert rule on notices)', ni && /with check \(public\._notification_insert_allowed\(company_id, recipient_id, event_type\)\)/.test(ni)
  && (setup.match(/create policy \w+ on public\.app_notifications for (insert|all)\b/g) || []).length === 1, String(ni));
const fn = sqlHelper.fn('_notification_insert_allowed');
const listOf = (role) => { const m = fn.match(new RegExp(`if my_role = '${role}' then\\s*return ev in \\(([^)]*)\\)`)); return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : []; };
const workerList = listOf('worker');
const customerList = listOf('customer');
check('R21 the recipient must be an ACTIVE member of the same company', /where company_id = cid and person_id = recipient and status = 'active'/.test(fn) && /if to_role is null then return false;/.test(fn));
check('R21 owner/admin may send any notice; workers and customers only to the owner/admins', /if my_role in \('owner', 'admin'\) then return true;/.test(fn) && /if to_role not in \('owner', 'admin'\) then return false;/.test(fn));
check('R21 customers may only send customer_message and customer_request_submitted', customerList.sort().join() === 'customer_message,customer_request_submitted', customerList.join());
const workerApp = [...read('src/providers/WorkerProvider.tsx').matchAll(/notifyStaff\('([a-z_]+)'/g)].map((m) => m[1]);
check('R21 every notice the worker app writes is on the workers\' list (so clocking in, task done, photos still notify the owner)', workerApp.length > 0 && workerApp.every((e) => workerList.includes(e)), `${workerApp} vs ${workerList}`);
const customerApp = [
  ...[...read('src/hooks/useProject.ts').matchAll(/notifyStaff\('([a-z_]+)'/g)].map((m) => m[1]),
  ...[...read('src/hooks/useProjectMessages.ts').matchAll(/notifyStaff\('([a-z_]+)'/g)].map((m) => m[1]),
];
check('R21 every notice the customer app writes is on the customers\' list', customerApp.length > 0 && customerApp.every((e) => customerList.includes(e)), customerApp.join());
const actions = read('src/data/actions.ts');
check('R21 notifyStaff only writes to ACTIVE owner/admins', /m\.role === 'owner' \|\| m\.role === 'admin'\) && m\.status === 'active'/.test(actions));
check('R21 notifyPeople skips anyone who is not an active member (instead of failing the save)', /const to = db\.demo \? personIds : personIds\.filter\(\(id\) => active\.has\(id\)\);/.test(actions) && /insertRows\('app_notifications', to\.map\(/.test(actions));
const niGrants = sqlHelper.grants('_notification_insert_allowed');
check('R21 the helper cannot be called by signed-out visitors (revoked from public and anon, granted only to signed-in people and the server)',
  /^revoke all on function public\._notification_insert_allowed\([^)]*\) from public, anon\b/m.test(niGrants)
  && sqlHelper.grantedTo('_notification_insert_allowed').every((r) => ['authenticated', 'service_role'].includes(r)), niGrants);

// R9 + R17 (the media function)
const media = read('supabase/functions/media/index.ts');
check('R9 only owner/admin may delete ANY company file (the unused "manager", "lead" and the "worker" role are gone)', /const CAN_DELETE_ANY = new Set\(\['owner', 'admin'\]\);/.test(media) && !/'manager'|'lead'/.test(media) && !/CAN_DELETE = /.test(media));
check('R9 everyone else may delete only the files they uploaded (the uploader\'s id is in the file name the server makes)',
  /first in me\.roles && \(CAN_DELETE_ANY\.has\(me\.roles\[first\]\) \|\| uploadedBy\(key, me\.personId\)\)/.test(media) &&
  /const name = first === 'avatars' \|\| first === 'ids' \? crypto\.randomUUID\(\) : `\$\{me\.personId\}_\$\{crypto\.randomUUID\(\)\}`;/.test(media) &&
  /\(key\.split\('\/'\)\.pop\(\) \?\? ''\)\.startsWith\(`\$\{personId\}_`\)/.test(media));
check('R9 avatars/ and ids/ can still be deleted only by that person', /first === 'avatars' \|\| first === 'ids'\s*\? second === me\.personId/.test(media));

// R19 (the app)
const m = read('src/lib/media.ts');
check('R19 the app never writes to or deletes from the Supabase "media" bucket', !/storage\.from\(/.test(m) && !/MEDIA_BUCKET/.test(m));
check('R19 with no R2 address an upload fails with "Photo storage is not set up" (the shared upload message)', /if \(!r2Enabled\) throw new Error\(PHOTO_STORAGE_NOT_SET_UP_MESSAGE\);/.test(m) && /PHOTO_STORAGE_NOT_SET_UP_MESSAGE = "Photo storage is not set up/.test(read('src/lib/uploadErrors.ts')));
check('R19 .env.example marks the R2 address and the private ID-photo bucket as required', /REQUIRED: R2 is the only photo storage/.test(read('.env.example')) && /REQUIRED for worker ID photos[\s\S]*R2_PRIVATE_BUCKET_NAME=/.test(read('.env.example')));

// R18
const legal = read('src/legal/legalContent.ts');
check('R18 the privacy policy lists OpenStreetMap Nominatim (clock-in location -> street address)', /OpenStreetMap \(Nominatim\)[^']*clock-in location/.test(legal));
check('R18 the privacy policy lists the US National Weather Service (api.weather.gov)', /National Weather Service \(api\.weather\.gov\)/.test(legal));
check('R18 the Resend line names clock-in location alerts, quote/invoice emails and service-request emails (no Snow arrival/completion wording)', /Resend:[^']*clock-in location alerts[^']*quote and invoice emails[^']*service request/.test(legal) && !/arrival or completion/i.test(legal));
check('R18 the public privacy page was rebuilt from it', /National Weather Service/.test(read('public/legal/privacy.html')) && /Nominatim/.test(read('public/legal/privacy.html')));

console.log(bad ? `\n${bad} of ${n} FAILED` : `\nAll ${n} passed`);
process.exit(bad ? 1 : 0);
