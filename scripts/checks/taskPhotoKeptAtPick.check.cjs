// Run: node scripts/checks/taskPhotoKeptAtPick.check.cjs
// Anything a person picks (photo library or camera) is copied into the app's own folder the moment it is picked, so the phone clearing the
// picker's temporary copy can no longer leave an upload with "the file is gone". Every screen that picks a photo or video does it.
// Videos are never compressed.
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

const helper = read('src/lib/keepPickedFile.ts');
check('1 the helper copies a picked file into the media-queue folder, falls back to re-saving the picture, and says why when both fail', /new File\(uri\)\.copy\(dest\)/.test(helper) && /'media-queue'/.test(helper) && /ImageManipulator\.manipulate\(uri\)/.test(helper) && /return \{ why:/.test(helper));
check('2 the original address is the fallback for screens that never failed before', /\(await keepPickedFileAsync\(uri, kind\)\)\.uri \?\? uri/.test(helper));
check('3 old copies are swept after 3 days, never one a pending upload still needs', /KEEP_MS = 3 \* 24/.test(helper) && /needed\.has\(item\.uri\)/.test(helper) && /sweepKeptFiles\(mediaQueue\.pending\(\)/.test(read('src/lib/mediaQueueRuntime.ts')));

const sites = {
  'src/data/taskMedia.ts': /keepPickedFileAsync\(asset\.uri, mediaType\)/,
  'src/components/snow/pickSnowMedia.ts': /keepPicked\(asset\.uri, mediaType\)/,
  'src/components/issues/ReportIssueScreen.tsx': /keepPicked\(a\.uri\)/,
  'src/components/media/HeaderPhotoField.tsx': /keepPicked\(asset\.uri\)/,
  'src/lib/profilePhoto.ts': /keepPicked\(result\.assets\[0\]\.uri\)/,
  'src/lib/stopPhotoPicker.ts': /keepPicked\(a\.uri\)/,
  'src/lib/pickImage.ts': /keepPicked\(a\.uri\)/,
  'src/data/timePhotos.ts': /keepPicked\(shot\.assets\[0\]\.uri\)/,
  'app/(owner)/(tabs)/projects/[id].tsx': /keepPicked\(result\.assets\[0\]\.uri\)/,
  'app/(owner)/project-new.tsx': /keepPicked\(result\.assets\[0\]\.uri\)/,
  'app/(worker)/task/[id].tsx': /keepPicked\(result\.assets\[0\]\.uri\)/,
};
for (const [file, re] of Object.entries(sites)) check(`4 ${file} keeps the picked file at once`, re.test(read(file)));

// No picker anywhere is left without it.
const walk = (d, out = []) => { for (const e of fs.readdirSync(path.join(__dirname, '../..', d), { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(e.name)) out.push(p); } return out; };
const pickers = [...walk('src'), ...walk('app')].filter((f) => /launch(ImageLibrary|Camera)Async\(/.test(read(f)));
const missing = pickers.filter((f) => !/keepPicked|copyPickedFile/.test(read(f)));
check('5 every file that opens the photo library or camera uses it', missing.length === 0, missing.join(', '));

const tm = read('src/data/taskMedia.ts');
check('6 on a task, the copy happens before the storage check, and an unreadable file is turned away with a message', tm.indexOf('keepPickedFileAsync(asset.uri') < tm.indexOf('await storageProblem(') && /couldn't be read from your phone \(\$\{kept\.why\}\)/.test(tm));
check('7 the "file is gone" error says which file', /\.\.\.\$\{localUri\.slice\(-48\)\}/.test(read('src/lib/uploadFile.ts')));
check('9 the legacy file API makes the copy first (the new File API cannot read picker files on some phones)', helper.indexOf("expo-file-system/legacy") > -1 && helper.indexOf('legacy.copyAsync') < helper.indexOf('new File(uri).copy(dest)'));
const up = read('src/lib/uploadFile.ts');
check('10 the upload itself reads and sends the file with the legacy API too', /legacy\.getInfoAsync\(localUri\)/.test(up) && /legacy\.createUploadTask\(url, localUri/.test(up) && /BINARY_CONTENT/.test(up));
check('11 the queue adopts picked files through the same keeper', /keepPickedFileAsync\(job\.sourceUri/.test(read('src/lib/mediaQueueRuntime.ts')));
const comp = read('src/lib/mediaCompress.ts');
check('8 videos are shrunk to 720p before upload, and fall back to the original', /compressor\.Video\.compress/.test(comp) && /return original/.test(comp));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
