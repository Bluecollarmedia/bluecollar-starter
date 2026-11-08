// Run: node scripts/checks/snowPhotoUploadRobust.check.cjs
// Snow photos: a worker never waits on uploads, no upload step can hang forever, a failing cloud storage falls back to the private
// bucket, every failure says which step failed and what the server answered, and every pending photo can be seen and removed.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const media = read('src/lib/snowMedia.ts');
const queue = read('src/lib/mediaQueue.ts');
const status = read('src/components/snow/SnowUploadStatus.tsx');
const screen = read('src/components/snow/routes/MyRouteScreen.tsx');
const sql = read('supabase/updates/088_complete_stop_without_waiting_for_photos.sql');

check('1 every network step of a Snow upload has a time limit (reserve, link, send)', ['Reserving the file', 'Asking for the upload link'].every((w) => media.includes(`'${w}'`)) && /putFile\(localUri, link\.data\.uploadUrl, contentType, sendMs\(contentType\), onProgress\)/.test(media) && /timed out after/.test(read('src/lib/uploadFile.ts')));
check('2 if cloud storage fails, the file goes to the private bucket directly (a cloud problem never stops a photo)', /putViaBackup\(/.test(media) && /cloudWhy = reasonOf\(err\)/.test(media) && /putViaCloud\(/.test(media));
check('3 a failed function call reports the status and the server\'s own reason (not "non-2xx status code")', /functionFailure\(link\.error, link\.data\)/.test(media) && /res\.status\}: \$\{body\?\.error/.test(media));
check('4 cloud storage\'s own answer is shown (status and error code), not "check your connection"', /Cloud storage answered \$\{sent\.status\}/.test(media) && /<Code>/.test(media) && !/Please check your connection and try again/.test(media));
check('5 when both routes fail the message says what each one said', /Cloud storage: \$\{cloudWhy\}\. Backup: /.test(media));
check('6 the shared queue cannot hang: preparing, uploading and saving each have a limit', /withTimeout\(this\.d\.prepare\(j\), PREPARE_LIMIT_MS/.test(queue) && /withTimeout\(this\.d\.upload\(j, uri, \(p\) => this\.reportProgress\(id, p\)\), UPLOAD_LIMIT_MS/.test(queue) && /withTimeout\(this\.d\.complete\(j, j\.uploaded\), RECORD_LIMIT_MS/.test(queue));
check('7 a photo that is still going up can be removed (not only failed ones), and shows what it is doing and the last reason', /t\('Remove this photo'\)/.test(status) && /t\('Remove this video'\)/.test(status) && /uploading\.map\(\(j\)/.test(status) && /Trying again \(\{n\} of 4\)/.test(status));
check('8 Complete Stop never waits for photos and is never disabled by them', !/waitForMediaJobs\(/.test(screen) && /never waits for photos/.test(screen) && !/disabled=\{needMedia/.test(screen));
check('9 photos for other / completed stops stay visible on the route screen (retry or remove)', /const elsewhere = snowUploadState\(/.test(screen) && /<SnowUploadStatus uploading=\{elsewhere\.uploading\} failed=\{elsewhere\.failed\}/.test(screen));
check('10 the database no longer blocks completing a stop for missing photos, and takes photos after completion',
  !/more photo/.test(sql) && /v\.status not in \('pending', 'arrived', 'completed'\)/.test(sql) && /v\.status in \('pending', 'arrived', 'completed'\)/.test(sql));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
