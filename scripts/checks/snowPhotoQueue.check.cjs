// Run: node scripts/checks/snowPhotoQueue.check.cjs
// Every Snow photo (a lead's stop photos, an owner's property reference photos, an owner's photos in Photo review) uses the shared background queue: adding them returns at once (nothing spins), they upload and save in the
// background, a failure shows Retry/Remove, and Finish Stop waits (a little) for photos that are still uploading.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('node:url');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const q = await import(pathToFileURL(path.join(__dirname, '..', '..', 'src', 'lib', 'mediaQueue.ts')).href);

  // The real queue engine with a Snow job and fake storage / network.
  const calls = { upload: [], record: [] };
  let failRecord = false;
  const queue = new q.MediaQueue({
    load: async () => [], save: async () => {},
    adopt: async (j) => j.sourceUri,
    prepare: async (j) => ({ uri: j.sourceUri, bytes: 300_000 }),
    upload: async (j, uri) => { calls.upload.push([j.target.type, j.folder, uri]); return { url: '', key: `${j.folder}/k1.jpg` }; },
    complete: async (j, up) => { if (failRecord) throw new Error('Network request failed'); calls.record.push([j.target.payload.visitId, up.key]); },
    removeStored: async () => {}, cleanup: async () => {},
    backoffMs: () => 5, later: (fn, ms) => setTimeout(fn, ms),
  });
  const job = queue.enqueue({ kind: 'image', sourceUri: 'file:///a.jpg', mimeType: 'image/jpeg', folder: 'co1/completion/v1', target: { type: 'snow_completion', payload: { visitId: 'v1' } } });
  check('1 adding a Snow photo returns at once, before anything has uploaded', job.status === 'preparing' && calls.upload.length === 0);
  await queue.idle();
  check('2 it then uploads to the stop\'s completion folder and saves the record on that stop', queue.get(job.id).status === 'uploaded' && calls.upload[0][1] === 'co1/completion/v1' && calls.record[0][0] === 'v1' && calls.record[0][1].startsWith('co1/completion/v1/'), JSON.stringify(calls));
  const dup = queue.enqueue({ kind: 'image', sourceUri: 'file:///a.jpg', mimeType: 'image/jpeg', folder: 'co1/completion/v1', target: { type: 'snow_completion', payload: { visitId: 'v1' } } });
  check('3 a double tap on the same photo does not make a second job', dup.id === job.id && queue.list().length === 1);

  // A bad connection is retried by itself, then offers Retry; it never hangs.
  failRecord = true;
  const j2 = queue.enqueue({ kind: 'image', sourceUri: 'file:///b.jpg', mimeType: 'image/jpeg', folder: 'co1/completion/v2', target: { type: 'snow_completion', payload: { visitId: 'v2' } } });
  for (let i = 0; i < 60 && queue.get(j2.id).status !== 'failed'; i++) await sleep(10);
  check('4 with no connection it retries itself, then shows Failed (so the screen can offer Retry)', queue.get(j2.id).status === 'failed' && !!queue.get(j2.id).error, JSON.stringify(queue.get(j2.id)));
  failRecord = false; queue.retry(j2.id); await queue.idle();
  check('5 Retry saves it once the connection is back, without uploading the file twice', queue.get(j2.id).status === 'uploaded' && calls.upload.filter((u) => u[1] === 'co1/completion/v2').length === 1, JSON.stringify(calls.upload));

  // Wiring in the app.
  const routes = read('src/data/snowRoutes.ts');
  const runtime = read('src/lib/mediaQueueRuntime.ts');
  const screen = read('src/components/snow/routes/MyRouteScreen.tsx');
  const add = routes.slice(routes.indexOf('export async function addCompletionMedia'), routes.indexOf('export { SNOW_COMPLETION_TARGET }'));
  check('6 addCompletionMedia only queues: no upload or record call inside it, so it cannot spin', /queueMedia\(/.test(add) && !/await uploadSnowMedia|supabase\.rpc|await /.test(add.replace('export async function', '')), add.slice(0, 200));
  const targets = read('src/data/snowMediaTargets.ts');
  check('7 the queue sends every Snow photo to the private snow bucket, and cleans up a stored one with the Snow remover', /isSnowTarget\(job\.target\.type\)/.test(runtime) && /uploadSnowMedia\(uri, job\.folder/.test(runtime) && /completeSnowTarget/.test(runtime) && /isSnowKey\(key\)/.test(runtime) && /discardSnowUpload/.test(runtime));
  check('8 the stop screen does not wait on the upload when photos are added', !/act\(\(\) => addCompletionMedia/.test(screen) && /await addCompletionMedia\(/.test(screen));
  const status = read('src/components/snow/SnowUploadStatus.tsx');
  check('9 the stop screen shows the background status, which says photos are uploading and offers Retry and Remove on a failure', /<SnowUploadStatus uploading=\{uploading\} failed=\{failedJobs\}/.test(screen) && /uploading in the background/.test(status) && /mediaQueue\.retry/.test(status) && /mediaQueue\.cancel/.test(status));
  check('10 photos still uploading count as added, and NOTHING about photos blocks Finish Stop (the owner\'s rule: a worker never waits on uploads)', /addedCount = \(current\?\.mediaCount \?\? 0\) \+ uploading\.length/.test(screen) && !/disabled=\{needMedia > 0/.test(screen) && !/failedJobs\.length > 0\}/.test(screen.split('title="Complete Stop"')[1] || ''));
  check('11 Finish Stop does not wait for uploads: it completes at once and the photos keep going in the background', !/waitForMediaJobs\(/.test(screen) && !/90_000/.test(screen) && /never waits for photos/.test(screen));
  check('12 the three queue names live in one place and are not retyped', /snow_completion/.test(targets) && /snow_reference/.test(targets) && /snow_owner_media/.test(targets) && !/'snow_completion'|'snow_reference'|'snow_owner_media'/.test(runtime + screen));

  // The owner's property reference photos
  const props = read('src/data/snowProperties.ts');
  const propScreen = read('app/(owner)/snow-property.tsx');
  const addRef = props.slice(props.indexOf('export async function addReferenceMedia'), props.indexOf('export async function saveReferenceRecord'));
  check('13 reference photos only queue (no upload or record call inside addReferenceMedia), so adding them cannot spin', /queueMedia\(/.test(addRef) && !/uploadSnowMedia|supabase\./.test(addRef));
  check('14 a reference photo\'s record is saved once the file is stored, and a file that already has a row is not saved twice', /snow_reference_media/.test(props) && /\.eq\('file_key', key\)/.test(props) && /completeSnowTarget/.test(targets) && /saveReferenceRecord/.test(targets));
  check('15 the property screen no longer blocks while reference photos upload, and shows the background status with Retry/Remove', !/setUploading/.test(propScreen) && /SnowUploadStatus/.test(propScreen) && /useSnowUploads\(SNOW_REFERENCE_TARGET/.test(propScreen) && /onAdd=\{add\}/.test(propScreen));

  // The owner's photos in Photo review
  const review = read('src/data/snowMediaReview.ts');
  const reviewScreen = read('src/components/snow/review/SnowReviewScreens.tsx');
  const addOwner = review.slice(review.indexOf('export async function addOwnerMedia'), review.indexOf('export async function saveOwnerMediaRecord'));
  check('16 owner photos only queue (no upload or record call inside addOwnerMedia)', /queueMedia\(/.test(addOwner) && !/uploadSnowMedia|supabase\./.test(addOwner));
  check('17 Photo review does not hold the stop busy while owner photos upload, and shows the background status', !/setBusy\(s\.visitId\);\s*const res = await addOwnerMedia/.test(reviewScreen) && /SnowUploadStatus/.test(reviewScreen) && /useSnowUploads\(SNOW_OWNER_MEDIA_TARGET/.test(reviewScreen));
  check('18 the stop screen calls its upload hook before any early return (rules of hooks): one useMediaJobs at the top, the split after', screen.indexOf('useMediaJobs()') > -1 && screen.indexOf('useMediaJobs()') < screen.indexOf('if (loading)') && screen.indexOf('snowUploadState(mediaJobs, SNOW_COMPLETION_TARGET, (p)') > screen.indexOf('if (loading)'));

  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
