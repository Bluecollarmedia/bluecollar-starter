// Run: node scripts/checks/securityFixes.check.cjs
// The Step 0 security fixes that the other new checks do not cover:
//   R3  the old Supabase "media" bucket is closed to uploads/changes/deletes; listing only your own company's folders
//   R4  nobody inserts into people directly
//   R21 who may create an in-app notice (and the app's own notices still fit the rule)
//   R9  only owner/admin, or the uploader, may delete a company file; no unused role names
//   R19 R2 is required in the app: no quiet fallback to the public Supabase bucket
//   R18 the privacy policy lists every service that gets data
// SQL files are read in the order the database is built (schema.sql, then the numbered updates by name): the last word counts.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
let bad = 0;
let n = 0;
const check = (name, ok, detail = '') => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}${ok ? '' : '  - ' + detail}`); };

const files = ['supabase/schema.sql', ...fs.readdirSync(path.join(root, 'supabase/updates'))
  .filter((f) => /^\d+.*\.sql$/.test(f) && !f.startsWith('reset')).sort().map((f) => `supabase/updates/${f}`)];
const all = files.map((f) => ({ f, sql: read(f).replace(/--[^\n]*/g, '') }));
/** Position of the last create / drop of a policy, across the files in build order. */
function lastPolicyEvent(name) {
  let last = null;
  all.forEach(({ f, sql }, i) => {
    for (const m of sql.matchAll(new RegExp(`(create|drop) policy (?:if exists )?${name}\\b[^;]*;`, 'g'))) last = { kind: m[1], text: m[0], file: f, i, at: m.index };
  });
  return last;
}
const s200 = read('supabase/updates/200_security_fixes.sql');

// R3
for (const p of ['media_public_read', 'media_authenticated_upload', 'media_owner_delete']) {
  const e = lastPolicyEvent(p);
  check(`R3 the open "media" bucket rule ${p} ends up dropped`, e && e.kind === 'drop', JSON.stringify(e));
}
const i200 = all.findIndex(({ f }) => f.endsWith('200_security_fixes.sql'));
const writesFrom200 = all.slice(i200).some(({ sql }) => /create policy \w+ on storage\.objects for (insert|update|delete|all)[^;]*'media'/.test(sql));
check('R3 from update 200 on, no file gives signed-in people a write rule on the "media" bucket again', i200 >= 0 && !writesFrom200);
const read200 = lastPolicyEvent('media_company_read');
check('R3 listing the "media" bucket is limited to active members of the company whose folder it is (no cast of a non-id folder)', read200 && read200.kind === 'create' && /to authenticated/.test(read200.text) && /public\.is_member\(\(\(storage\.foldername\(name\)\)\[1\]\)::uuid\)/.test(read200.text) && /case\s+when \(storage\.foldername\(name\)\)\[1\] ~\*/.test(read200.text));

// R4
const pi = lastPolicyEvent('people_insert');
check('R4 the open people insert rule (check (true)) ends up dropped', pi && pi.kind === 'drop', JSON.stringify(pi));
const appPeopleInsert = (() => {
  const hits = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) { const t = fs.readFileSync(p, 'utf8'); if (/from\(['"]people['"]\)\s*\.(insert|upsert)\(/.test(t)) hits.push(p); } } };
  walk(path.join(root, 'src')); walk(path.join(root, 'app'));
  return hits;
})();
check('R4 the app never inserts people directly (people are made by database functions)', appPeopleInsert.length === 0, appPeopleInsert.join(', '));

// R21
const ni = lastPolicyEvent('notifications_insert');
check('R21 the final notice insert rule uses the role / recipient / event-type check', ni && ni.kind === 'create' && /with check \(public\._notification_insert_allowed\(company_id, recipient_id, event_type\)\)/.test(ni.text), JSON.stringify(ni));
const fn = s200.slice(s200.indexOf('function public._notification_insert_allowed'), s200.indexOf('$$;', s200.indexOf('function public._notification_insert_allowed')));
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
check('R21 the helper cannot be called by signed-out visitors', /revoke all on function public\._notification_insert_allowed\(uuid, uuid, text\) from public, anon;/.test(s200));

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
