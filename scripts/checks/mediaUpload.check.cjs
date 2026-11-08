// Run: node scripts/checks/mediaUpload.check.cjs <path to typescript package>
// Checks every way a photo upload can succeed or fail, with a FAKE Supabase: the Supabase Storage fallback (used
// before R2 is set up), the R2 path, the private Snow bucket, and what the person is told in each failure.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const compile = (src, req) => {
  const m = { exports: {} };
  new Function('module', 'exports', 'require', 'process', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', esModuleInterop: true } }).outputText)(m, m.exports, req, { env: req.env || {} });
  return m.exports;
};

let session = { access_token: 't' };
let uploadResult = { error: null };
let uploadThrows = null;
let invokeResult = { data: { uploadUrl: 'https://r2.test/put', key: 'k', publicUrl: 'https://r2.test/k' }, error: null };
const calls = [];
const fakeSupabase = {
  auth: { getSession: async () => ({ data: { session } }) },
  storage: {
    from: (bucket) => ({
      upload: async (key, body, opts) => { calls.push({ bucket, key, opts }); if (uploadThrows) throw uploadThrows; return uploadResult; },
      getPublicUrl: (key) => ({ data: { publicUrl: `https://sb.test/${bucket}/${key}` } }),
      remove: async () => ({ error: null }),
      createSignedUrls: async () => ({ data: [], error: null }),
    }),
  },
  functions: { invoke: async (name, args) => { calls.push({ fn: name, args }); return invokeResult; } },
};

const errors = compile(read('src/lib/uploadErrors.ts'), (n) => (n === '@/i18n' ? { tr: (t) => t } : {}));
const load = (r2) => {
  const req = (name) => {
    if (name === 'react-native') return { Platform: { OS: 'ios' } };
    if (name === './supabase') return { supabase: fakeSupabase, isSupabaseConfigured: true };
    if (name === './ids') return { uuid: () => 'uuid-1' };
    if (name === './uploadErrors') return errors;
    if (name === './uploadLimit') return { tooLargeMessage: () => null };
    // The shared file-format rules (audio and video names), real.
    if (name === './mediaFormats') return compile(read('src/lib/mediaFormats.ts'), () => ({}));
    // The phone's file upload is faked with the fake fetch (the harness has no phone): same answer shape as the real one.
    if (name === './uploadFile') return { putFile: async (uri, url, ct) => { const r = await globalThis.fetch(url, { method: 'PUT', headers: { 'Content-Type': ct }, body: {} }); return { status: r.status, body: typeof r.text === 'function' ? await r.text() : '' }; }, localFileSize: async () => 10 };
    // The real timeout helper, so the time limits in snowMedia work in this harness too.
    if (name === './mediaQueue') return { withTimeout: (work, ms, onTimeout) => new Promise((res, rej) => { const t = setTimeout(() => rej(onTimeout()), ms); work.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); }) };
    // Compression is not what this check is about: treat every picture as already prepared.
    if (name === './mediaCompress') return { isPrepared: () => true, prepareImage: async (j) => ({ uri: j.sourceUri }) };
    return {};
  };
  req.env = r2 ? { EXPO_PUBLIC_R2_PUBLIC_URL: 'https://r2.test' } : {};
  const media = compile(read('src/lib/media.ts'), req);
  const req2 = (name) => (name === './media' ? media : req(name));
  req2.env = req.env;
  const snow = compile(read('src/lib/snowMedia.ts'), req2);
  return { media, snow };
};

globalThis.fetch = async () => ({ ok: true, status: 200, blob: async () => ({ size: 10 }) });
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };
const msgOf = async (p) => { try { await p; return null; } catch (e) { return e.message; } };

(async () => {
  const { explainUploadError } = errors;
  const cases = [
    ['Bucket not found', /storage bucket is missing/],
    ['new row violates row-level security policy', /refused this upload/],
    ['The object exceeded the maximum allowed size', /bigger than the server allows/],
    ['mime type video/x is not supported', /kind of file/],
    ['Network request failed', /connection/],
    ['jwt expired', /sign-in has expired/],
    ['R2 is not set up yet.', /R2/],
    ['Failed to send a request to the Edge Function', /isn't reachable/],
  ];
  const allMapped = cases.every(([raw, re]) => re.test(explainUploadError(raw)) && explainUploadError(raw).includes(raw));
  check('1 each known cause gets a plain sentence AND keeps the raw text in brackets', allMapped, JSON.stringify(cases.map(([r]) => explainUploadError(r))));
  check('2 an unknown error is shown as it is (never hidden)', explainUploadError('weird thing 42') === 'weird thing 42' && explainUploadError(new Error('boom')) === 'boom');

  // Supabase Storage fallback (R2 not set up)
  const { media, snow } = load(false);
  check('3 R2 is OFF when the build has no R2 address (the fallback is the Supabase "media" bucket)', media.r2Enabled === false);
  calls.length = 0;
  let r = await media.uploadImage('file:///a/b.png', 'co/projects/p1');
  check('4 success: uploads to the "media" bucket under the folder, returns the public link', calls.length === 1 && calls[0].bucket === 'media' && calls[0].key === 'co/projects/p1/uuid-1.png' && r.url === 'https://sb.test/media/co/projects/p1/uuid-1.png' && r.key === 'co/projects/p1/uuid-1.png', JSON.stringify({ calls, r }));
  check('5 file types: jpeg default, heic, mov video', (await media.uploadImage('file:///x.heic', 'f')).key.endsWith('.heic') && (await media.uploadImage('file:///x', 'f', 'video/quicktime')).key.endsWith('.mov') && (await media.uploadImage('file:///x.jpg', 'f')).key.endsWith('.jpg'));
  check('6 a web link is returned unchanged, nothing uploaded', (calls.length = 0, (await media.uploadImage('https://x.test/a.jpg', 'f')).url === 'https://x.test/a.jpg' && calls.length === 0));

  uploadResult = { error: { message: 'Bucket not found' } };
  let m = await msgOf(media.uploadImage('file:///a.jpg', 'f'));
  check('7 missing bucket: says storage is not set up AND shows the raw error', m && /^Upload failed:/.test(m) && /bucket is missing/.test(m) && /Bucket not found/.test(m), m);
  uploadResult = { error: { message: 'new row violates row-level security policy' } };
  m = await msgOf(media.uploadImage('file:///a.jpg', 'f'));
  check('8 permission refusal: explained, raw text kept', m && /refused this upload/.test(m) && /row-level security/.test(m), m);
  uploadResult = { error: { message: 'The object exceeded the maximum allowed size' } };
  m = await msgOf(media.uploadImage('file:///a.mov', 'f'));
  check('9 too large: explained', m && /bigger than the server allows/.test(m), m);
  uploadResult = { error: null }; uploadThrows = new TypeError('Network request failed');
  m = await msgOf(media.uploadImage('file:///a.jpg', 'f'));
  check('10 a thrown network failure is caught and explained (not a raw crash)', m && /^Upload failed:/.test(m) && /connection/.test(m), m);
  uploadThrows = null;

  session = null; calls.length = 0;
  m = await msgOf(media.uploadImage('file:///a.jpg', 'f'));
  check('11 signed out: clear message, and the server is never asked', m && /signed out/.test(m) && calls.length === 0, m);
  session = { access_token: 't' };

  // Snow private bucket
  calls.length = 0; uploadResult = { error: null };
  let key = await snow.uploadSnowMedia('file:///a.jpg', 'co/completion/v1');
  check('12 Snow: uploads to the private "snow-media" bucket and returns the key', key === 'co/completion/v1/uuid-1.jpg' && calls[0].bucket === 'snow-media', JSON.stringify(calls));
  uploadResult = { error: { message: 'new row violates row-level security policy' } };
  m = await msgOf(snow.uploadSnowMedia('file:///a.jpg', 'co/completion/v1'));
  check('13 Snow: a refused upload (not the lead, or stop already finished) is explained with the raw text', m && /refused this upload/.test(m) && /row-level security/.test(m), m);
  uploadResult = { error: null }; session = null;
  m = await msgOf(snow.uploadSnowMedia('file:///a.jpg', 'f'));
  check('14 Snow: signed out gives the clear message', m && /signed out/.test(m), m);
  session = { access_token: 't' };

  // R2 path
  const r2 = load(true);
  check('15 with an R2 address in the build, R2 is ON', r2.media.r2Enabled === true);
  invokeResult = { data: null, error: { message: 'Failed to send a request to the Edge Function' } };
  m = await msgOf(r2.media.uploadImage('file:///a.jpg', 'f'));
  check('16 R2 on but the function is not deployed: says so, raw text kept', m && /isn't reachable/.test(m) && /Edge Function/.test(m), m);
  invokeResult = { data: { error: 'R2 is not set up yet.' }, error: null };
  m = await msgOf(r2.media.uploadImage('file:///a.jpg', 'f'));
  check('17 R2 on but secrets missing: says R2 is not set up', m && /R2/.test(m), m);

  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
