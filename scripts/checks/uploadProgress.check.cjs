// Run: node scripts/checks/uploadProgress.check.cjs
// While a photo or video is being sent, its tile shows a real progress bar with a percent (every screen that queues footage shares the
// one overlay: tasks, project photos, maintenance stops, Snow). The percent comes from the phone's own upload, end to end.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const up = read('src/lib/uploadFile.ts');
check('1 the phone upload reports how much has been sent', /onProgress\?: \(p: number\) => void/.test(up) && /totalBytesSent \/ sent\.totalBytesExpectedToSend/.test(up));
const media = read('src/lib/media.ts');
check('2 uploadImage passes the progress through to the upload', /uploadToR2\(localUri, folder, contentType, onProgress\)/.test(media) && /sendMs|90_000, onProgress\)/.test(media));
check('3 Snow uploads pass it through too', /putViaCloud\(localUri, key, contentType, onProgress\)/.test(read('src/lib/snowMedia.ts')));
const q = read('src/lib/mediaQueue.ts');
check('4 the queue carries progress on the job, live only (updated in memory, never written to storage)', /progress\?: number/.test(q) && /reportProgress\(id, p\)/.test(q) && !/persist\(\)/.test(q.slice(q.indexOf('private reportProgress'), q.indexOf('private fail'))));
check('5 small steps are skipped so the screen is not redrawn for every packet', /next - j\.progress < 0\.02/.test(q));
const runtime = read('src/lib/mediaQueueRuntime.ts');
check('6 the runtime hands the reporter to both uploaders', /uploadSnowMedia\(uri, job\.folder, snowMime, onProgress\)/.test(runtime) && /uploadImage\(uri, job\.folder, mime, onProgress\)/.test(runtime));
const overlay = read('src/components/media/MediaJobOverlay.tsx');
check('7 the tile shows a bar and a percent while sending, and a spinner before the first report', /width: `\$\{pct\}%`/.test(overlay) && /\{pct\}%/.test(overlay) && /ActivityIndicator/.test(overlay));
check('8 a retry starts the bar over instead of showing the old number', /progress: undefined/.test(q));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
