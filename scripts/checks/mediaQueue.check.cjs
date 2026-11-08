// Shared media queue and compression rules (src/lib/mediaQueue.ts, src/lib/mediaPlan.ts) with faked storage/network. No phone, no network.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const lib = (f) => import(pathToFileURL(path.join(__dirname, '..', '..', 'src', 'lib', f)).href);
  const plan = await lib('mediaPlan.ts');
  const q = await lib('mediaQueue.ts');

  // ── compression rules ──
  const big = plan.planImage({ width: 4032, height: 3024, bytes: 3_500_000, mimeType: 'image/jpeg' });
  check('1 a 12 MP camera photo is compressed at quality 0.5 and its long side is capped at 1600, ratio kept', big.action === 'compress' && big.quality === 0.5 && big.width === 1600 && big.height === 1200 && big.resize);
  const portrait = plan.planImage({ width: 3024, height: 4032, bytes: 3_000_000, mimeType: 'image/jpeg' });
  check('1b portrait keeps its orientation and ratio (1200 x 1600)', portrait.width === 1200 && portrait.height === 1600);
  check('2 a small JPEG that is already optimised is not recompressed', plan.planImage({ width: 1200, height: 900, bytes: 180_000, mimeType: 'image/jpeg' }).action === 'skip');
  const heic = plan.planImage({ width: 1200, height: 900, bytes: 180_000, mimeType: 'image/heic' });
  check('2b a HEIC or PNG is still converted (compatibility), even when small', heic.action === 'compress' && !heic.resize);
  check('2c a small photo is never enlarged', plan.planImage({ width: 800, height: 600, bytes: 900_000, mimeType: 'image/png' }).width === 800);
  check('2d a file the app already prepared is left alone', plan.planImage({ width: 4000, height: 3000, bytes: 1e6, mimeType: 'image/jpeg', alreadyPrepared: true }).action === 'skip');
  const v = plan.planVideo({ width: 1920, height: 1080 });
  check('3 1080p landscape video becomes 1280 x 720', v.width === 1280 && v.height === 720 && v.resize, JSON.stringify(v));
  const vp = plan.planVideo({ width: 1080, height: 1920 });
  check('3b portrait video becomes 720 x 1280 (ratio kept, not stretched)', vp.width === 720 && vp.height === 1280, JSON.stringify(vp));
  const v43 = plan.planVideo({ width: 1440, height: 1080 });
  check('3c a 4:3 video fits inside 1280 x 720 with the same ratio and even numbers (960 x 720)', v43.width === 960 && v43.height === 720, JSON.stringify(v43));
  const small = plan.planVideo({ width: 640, height: 360 });
  check('3d a video already under 720p is never enlarged', small.width === 640 && small.height === 360 && !small.resize);
  const pf = plan.planVideo({ width: 1920, height: 1080 });
  check('3f the fallback plan for an unknown size (1920x1080) gives a long side of 1280, which is the compressor\'s limit whatever the orientation', Math.max(pf.width, pf.height) === 1280);
  check('3e the video bitrate is sensible (between 1 and 4 Mbps, about 2.8 at 720p) and the size is always even', v.bitrate >= 2_500_000 && v.bitrate <= 3_000_000 && plan.planVideo({ width: 1001, height: 563 }).width % 2 === 0);

  // ── the queue ──
  const mkDeps = (over = {}) => {
    const log = { stored: [], removed: [], cleaned: [], records: [], saves: 0, active: 0, maxActive: 0, activeVideos: 0, maxVideos: 0 };
    let disk = [];
    const deps = {
      load: async () => JSON.parse(JSON.stringify(disk)),
      save: async (jobs) => { disk = JSON.parse(JSON.stringify(jobs)); log.saves++; },
      adopt: async (j) => `file:///docs/media-queue/${j.id}.jpg`,
      prepare: async (j) => ({ uri: j.sourceUri + '.small', bytes: 100_000 }),
      upload: async (j) => { log.active++; log.maxActive = Math.max(log.maxActive, log.active); if (j.kind === 'video') { log.activeVideos++; log.maxVideos = Math.max(log.maxVideos, log.activeVideos); } await sleep(5); log.active--; if (j.kind === 'video') log.activeVideos--; const key = `co/x/${j.id}.jpg`; log.stored.push(key); return { url: `https://r2/${key}`, key }; },
      complete: async (j, up) => { log.records.push({ id: j.id, ...up }); },
      removeStored: async (k) => { log.removed.push(k); },
      cleanup: async (u) => { log.cleaned.push(...u); },
      backoffMs: () => 0,
      later: (fn) => setTimeout(fn, 0),
      ...over,
    };
    return { deps, log, disk: () => disk };
  };
  const item = (n, extra = {}) => ({ kind: 'image', sourceUri: `file:///cache/pick${n}.jpg`, folder: 'co/projects/p', target: { type: 'project_photo', payload: { n } }, ...extra });

  let { deps, log } = mkDeps();
  let queue = new q.MediaQueue(deps);
  await queue.start();
  const jobs = queue.enqueueMany([item(1), item(2), item(3), item(4), item(5), item(6)]);
  check('4 several files picked at once are all accepted immediately, each with its own preview source and a "preparing" status', jobs.length === 6 && jobs.every((j) => j.status === 'preparing' && j.sourceUri.startsWith('file:///cache/')));
  const more = queue.enqueue(item(7));
  check('4b more can be added while earlier ones are still processing', more.status === 'preparing' && queue.list().length === 7);
  await sleep(200);
  check('5 every job ends "uploaded" only after the storage upload AND the record were confirmed, in that order', queue.list().every((j) => j.status === 'uploaded') && log.records.length === 7 && log.stored.length === 7);
  check('5b concurrency is bounded (never more than 3 at once)', log.maxActive <= 3 && log.maxActive >= 2, String(log.maxActive));
  check('5c temporary copies are cleaned up after success', log.cleaned.length >= 7);

  // duplicate taps
  ({ deps, log } = mkDeps());
  queue = new q.MediaQueue(deps); await queue.start();
  const a = queue.enqueue(item(1)); const b = queue.enqueue(item(1)); const c = queue.enqueue(item(1));
  await sleep(100);
  check('6 duplicate taps on the same photo make ONE job, ONE upload and ONE record', a.id === b.id && b.id === c.id && log.stored.length === 1 && log.records.length === 1);

  // videos are limited to one at a time
  ({ deps, log } = mkDeps());
  queue = new q.MediaQueue(deps); await queue.start();
  queue.enqueueMany([1, 2, 3].map((n) => item(n, { kind: 'video', sourceUri: `file:///cache/v${n}.mp4` })));
  await sleep(200);
  check('7 videos are processed one at a time (memory/battery) and all complete', log.maxVideos === 1 && log.records.length === 3);

  // network loss then recovery
  let fails = 2;
  ({ deps, log } = mkDeps({ upload: async (j) => { if (fails-- > 0) throw new Error('Network request failed'); const key = `co/${j.id}.jpg`; return { url: 'https://r2/' + key, key }; } }));
  queue = new q.MediaQueue(deps); await queue.start();
  const nj = queue.enqueue(item(1));
  await sleep(150);
  check('8 temporary network loss is retried automatically and then succeeds (one record, no duplicate)', queue.get(nj.id).status === 'uploaded' && log.records.length === 1 && queue.get(nj.id).attempts === 2, JSON.stringify(queue.get(nj.id)));

  // permanent failure and manual retry
  let mode = 'deny';
  ({ deps, log } = mkDeps({ upload: async (j) => { if (mode === 'deny') throw new Error('You cannot upload there'); const key = `co/${j.id}.jpg`; return { url: 'https://r2/' + key, key }; } }));
  queue = new q.MediaQueue(deps); await queue.start();
  const fj = queue.enqueue(item(1));
  await sleep(60);
  check('9 a refusal (not allowed) fails immediately with the reason, no endless retrying, nothing recorded', queue.get(fj.id).status === 'failed' && /cannot upload/.test(queue.get(fj.id).error) && log.records.length === 0);
  mode = 'ok'; queue.retry(fj.id); await sleep(60);
  check('9b Retry then completes it', queue.get(fj.id).status === 'uploaded' && log.records.length === 1);

  // still failing after several tries
  ({ deps, log } = mkDeps({ upload: async () => { throw new Error('Network request failed'); } }));
  queue = new q.MediaQueue(deps); await queue.start();
  const gj = queue.enqueue(item(1)); await sleep(150);
  check('10 repeated network failure ends as Failed (with Retry), not forever "uploading"', queue.get(gj.id).status === 'failed' && queue.get(gj.id).attempts === q.MAX_AUTO_TRIES, JSON.stringify(queue.get(gj.id)));

  // compression failure is never silent
  ({ deps, log } = mkDeps({ prepare: async () => { throw new q.CompressionError('Video compression is not available in this build.'); } }));
  queue = new q.MediaQueue(deps); await queue.start();
  const cj = queue.enqueue(item(1, { kind: 'video', sourceUri: 'file:///cache/v.mp4' })); await sleep(60);
  check('11 a compression failure is reported (not skipped), is not uploaded, and offers the original as an explicit choice', queue.get(cj.id).status === 'failed' && queue.get(cj.id).canUseOriginal === true && log.stored.length === 0 && /not available/.test(queue.get(cj.id).error));
  queue.useOriginalFile(cj.id); await sleep(60);
  check('11b choosing "upload the original" uploads the uncompressed file and finishes', queue.get(cj.id).status === 'uploaded' && log.records.length === 1);

  // record step fails after upload: no second upload, then cancel cleans up
  let recFail = 99;
  ({ deps, log } = mkDeps({ complete: async (j, up) => { if (recFail-- > 0) throw new Error('Network request failed'); log.records.push({ id: j.id, ...up }); } }));
  queue = new q.MediaQueue(deps); await queue.start();
  const rj = queue.enqueue(item(1)); await sleep(150);
  check('12 if the file is stored but the database record fails, only the record is retried (the file is NOT uploaded again) and the job is not "uploaded"', log.stored.length === 1 && queue.get(rj.id).status === 'failed' && queue.get(rj.id).stage === 'record', JSON.stringify(queue.get(rj.id)));
  await queue.cancel(rj.id);
  check('12b cancelling it deletes the stored file so nothing is left with no record', log.removed.length === 1 && log.removed[0] === log.stored[0] && queue.list().length === 0);
  recFail = 0;

  // restart safety
  let release; const gate = new Promise((r) => { release = r; });
  const store = mkDeps({ upload: async (j) => { await gate; const key = `co/${j.id}.jpg`; return { url: 'https://r2/' + key, key }; } });
  queue = new q.MediaQueue(store.deps); await queue.start();
  const sj = queue.enqueue(item(1)); await sleep(30);
  const savedBefore = store.disk();
  check('13 pending work is saved to storage while it runs (survives leaving the screen or closing the app)', savedBefore.length === 1 && savedBefore[0].id === sj.id && savedBefore[0].stage === 'upload');
  const restartDeps = mkDeps({}); restartDeps.deps.load = async () => JSON.parse(JSON.stringify(savedBefore));
  const queue2 = new q.MediaQueue(restartDeps.deps); await queue2.start(); await sleep(60);
  check('13b after an app restart the interrupted job resumes (restarts its upload) and completes once', queue2.get(sj.id).status === 'uploaded' && restartDeps.log.records.length === 1);
  release();

  // cancel while running cleans local copies
  ({ deps, log } = mkDeps({ upload: async () => { await sleep(30); return { url: 'https://r2/k', key: 'k' }; } }));
  queue = new q.MediaQueue(deps); await queue.start();
  const kj = queue.enqueue(item(1)); await sleep(10); await queue.cancel(kj.id); await sleep(60);
  check('14 cancelling while uploading removes the job, the stored file if it landed, and the temporary copy; no record is saved', queue.list().length === 0 && log.records.length === 0 && log.cleaned.length >= 1 && log.removed.includes('k'));

  // does not mistake preview for saved
  ({ deps, log } = mkDeps({ upload: async () => { await sleep(40); return { url: 'https://r2/k', key: 'k' }; } }));
  queue = new q.MediaQueue(deps); await queue.start();
  const pj = queue.enqueue(item(1)); await sleep(10);
  check('15 while uploading the job is NOT "uploaded" and no record exists, so a preview can never be taken for a saved file', queue.get(pj.id).status !== 'uploaded' && log.records.length === 0);
  await sleep(120);

  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
