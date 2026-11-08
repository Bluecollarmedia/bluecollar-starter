// The shared media pipeline is really what the app's flows use (source-level checks; behaviour of the queue itself: mediaQueue.check.cjs).
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
let bad = 0;
const check = (n, ok) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); };

const actions = read('src/data/actions.ts'), maint = read('src/data/maintenance.ts'), task = read('src/data/taskMedia.ts');
const media = read('src/lib/media.ts'), snow = read('src/lib/snowMedia.ts'), targets = read('src/data/mediaTargets.ts');
const store = read('src/data/store.ts'), runtime = read('src/lib/mediaQueueRuntime.ts'), compress = read('src/lib/mediaCompress.ts');

check('1 project progress photos go through the shared queue (project_photo target), not their own uploader', /type: 'project_photo'/.test(actions) && /queueMedia\(/.test(actions) && !/uploadImage\(localUri, `\$\{db\.companyId\}\/projects/.test(actions));
check('2 maintenance stop photos go through the shared queue (maintenance_photo target)', /type: 'maintenance_photo'/.test(maint) && /queueMedia\(/.test(maint));
check('3 task photos and videos go through the shared queue (task_attachment target), videos marked as video', /type: 'task_attachment'/.test(task) && /kind: d\.mediaType === 'video' \? 'video' : 'image'/.test(task));
check('4 every other photo upload (profile, trucks, issues, ids, required start/finish photos) is compressed centrally in uploadImage, once (not again for queue output)', /prepareImage\(/.test(media) && /isPrepared\(localUri\)/.test(media));
check('5 Snow media photos are compressed too (its private-bucket upload path is otherwise unchanged)', /prepareImage\(/.test(snow) && /isPrepared\(localUri\)/.test(snow));
check('6 a maintenance photo is ALWAYS saved internal by the queue (compression/upload never changes sharing)', /row\.isCustomerVisible = false/.test(targets) && /maintenance_photo/.test(targets));
check('7 the record is saved by waiting for the database (confirmDeferredRow), and an already-saved record counts as saved (retry-safe)', /confirmDeferredRow\(/.test(targets) && /23505/.test(store) && /async function confirmDeferredRow/.test(store));
check('8 the record id is the job id, so a retry or restart can never create a second record', /id: row\.id/.test(actions) && /id: row\.id/.test(maint) && /id: row\.id/.test(task) && /\[pk\]: id/.test(store));
check('9 the local preview row is never saved to the database before the file is stored (insertRow deferSave stays)', /deferSave: needsUpload/.test(actions) && /deferSave: needsUpload/.test(maint) && /deferSave: needsUpload/.test(task));
check('10 pending uploads are saved to AsyncStorage and resumed when the person signs in / the app returns to the front', /AsyncStorage\.setItem\(KEY/.test(runtime) && /startMediaQueue\(\)/.test(store) && /AppState\.addEventListener/.test(runtime));
check('11 a pending item is never uploaded under a different company (folder must start with the signed-in company)', /startsWith\(`\$\{db\.companyId\}\/`\)/.test(runtime));
check('12 thumbnails say Preparing / Uploading / Not saved with Retry (task media and stop photos share one overlay)', /MediaJobOverlay/.test(read('src/components/tasks/TaskMedia.tsx')) && /MediaJobOverlay/.test(read('src/components/maintenance/StopPhotos.tsx')));
const pick = read('src/lib/videoPick.ts');
check('12b every video picker lets iOS hand the video over at 720p (never the medium 480x360 setting), and a 720p file is never encoded a second time', /H264_1280x720/.test(pick) && /QualityType\.High/.test(pick) && ['src/components/work/PostEditorScreen.tsx', 'src/components/work/StoriesManagerScreen.tsx', 'src/components/snow/pickSnowMedia.ts', 'src/data/taskMedia.ts'].every((f) => /\.\.\.VIDEO_PICK_OPTIONS/.test(read(f)) && !/QualityType\.Medium/.test(read(f))) && /if \(!plan\.resize\) return original;/.test(compress));
check('13 videos are shrunk to 720p before upload (owner order 2026-10-28), and the original goes up if that cannot be done', /compressor\.Video\.compress/.test(compress) && /return original/.test(compress) && !/Videos are never compressed/.test(compress));
check('14 pickers hand over the original (quality 1) so the shared compressor is the only lossy step', ['src/lib/stopPhotoPicker.ts', 'src/data/taskMedia.ts', 'src/components/snow/pickSnowMedia.ts'].every((f) => /quality: 1/.test(read(f))));
const pkg = JSON.parse(read('package.json')), app = JSON.parse(read('app.json')), lock = JSON.parse(read('package-lock.json'));
check('15 the video library is declared exactly (1.19.4, the non-Nitro line that supports the new architecture), autolinked (its Expo plugin does nothing, so it is not listed), and locked', pkg.dependencies['react-native-compressor'] === '1.19.4' && lock.packages['node_modules/react-native-compressor']?.version === '1.19.4');
check('16 a video that cannot be shrunk (no compressor, web, or not smaller) is sent as the original', /async function prepareVideo\(job: MediaJob\): Promise<Prepared> \{\s*const original: Prepared = \{ uri: job\.sourceUri/.test(compress) && /if \(!compressor\?\.Video\) return original/.test(compress));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
