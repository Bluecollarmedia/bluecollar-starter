// Run: node scripts/checks/nativeUploadNoBlob.check.cjs
// Photos and videos uploaded from the website but never from the phone app. The website sends a Blob with fetch (fine there); on a phone
// that path is unreliable, so a phone now sends the file through the operating system's own file upload, straight from disk.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const up = read('src/lib/uploadFile.ts');
const snow = read('src/lib/snowMedia.ts');
const media = read('src/lib/media.ts');

check('1 on a phone the file is sent with the native file upload (legacy createUploadTask + PUT), never fetch + Blob', /legacy\.createUploadTask\(url, localUri/.test(up) && /httpMethod: 'PUT'/.test(up) && /BINARY_CONTENT/.test(up) && /Platform\.OS === 'web'/.test(up));
check('2 the phone path has a time limit that cancels the native request', /withTimeout\(task\.uploadAsync\(\)/.test(up) && /task\.cancelAsync\(\)/.test(up));
check('3 the phone checks the file exists (with the legacy API, which can read picker files) and says so plainly if it does not', /legacy\.getInfoAsync\(localUri\)/.test(up) && /could not read the file/.test(up));
check('4 the server\'s real answer comes back (status and body) so the screen can show its reason', /return \{ status: res\.status, body: res\.body/.test(up));
check('5 Snow photos and videos use it', /putFile\(localUri, link\.data\.uploadUrl/.test(snow) && !/await fetch\(link\.data\.uploadUrl/.test(snow) && !/fetch\(localUri\)\.then\(\(r\) => r\.blob\(\)\)/.test(snow));
check('6 every other photo, video and PDF (profile, projects, maintenance...) uses it too', /putFile\(localUri, data\.uploadUrl/.test(media) && !/new Blob|\.blob\(\)/.test(media.slice(media.indexOf('async function uploadToR2'), media.indexOf('export async function removeMedia'))));
check('7 the size check reads the size from disk on a phone', /localFileSize\(localUri\)/.test(media) && /info\.size/.test(up));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
