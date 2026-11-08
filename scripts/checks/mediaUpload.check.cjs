// Run: node scripts/checks/mediaUpload.check.cjs <path to typescript package>
// Checks every way a photo upload can succeed or fail, with a FAKE Supabase: R2 is required (no address = a clear
// "Photo storage is not set up" failure, never the old Supabase bucket), the R2 path, and what the person is told in each failure.
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
    // The real timeout helper, so any time limits work in this harness too.
    if (name === './mediaQueue') return { withTimeout: (work, ms, onTimeout) => new Promise((res, rej) => { const t = setTimeout(() => rej(onTimeout()), ms); work.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); }) };
    // Compression is not what this check is about: treat every picture as already prepared.
    if (name === './mediaCompress') return { isPrepared: () => true, prepareImage: async (j) => ({ uri: j.sourceUri }) };
    return {};
  };
  req.env = r2 ? { EXPO_PUBLIC_R2_PUBLIC_URL: 'https://r2.test' } : {};
  const media = compile(read('src/lib/media.ts'), req);
  return { media };
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

  // R2 is required (no Supabase Storage fallback any more)
  const { media } = load(false);
  check('3 R2 is OFF when the build has no R2 address', media.r2Enabled === false);
  calls.length = 0;
  let m = await msgOf(media.uploadImage('file:///a/b.png', 'co/projects/p1'));
  check('4 with no R2 address an upload FAILS with "Photo storage is not set up", and nothing is sent anywhere (no Supabase bucket, no function)', m && /Photo storage is not set up/.test(m) && calls.length === 0, JSON.stringify({ m, calls }));
  check('5 a web link is returned unchanged, nothing uploaded', (calls.length = 0, (await media.uploadImage('https://x.test/a.jpg', 'f')).url === 'https://x.test/a.jpg' && calls.length === 0));
  calls.length = 0;
  await media.removeMedia('co/projects/p1/a.jpg');
  check('6 with no R2 address removeMedia asks nobody (no Supabase bucket delete)', calls.length === 0, JSON.stringify(calls));

  const on = load(true);
  calls.length = 0;
  let r = await on.media.uploadImage('file:///a/b.png', 'co/projects/p1');
  check('7 success: asks the media function for an upload link for the folder, returns its link and key; the Supabase bucket is never used', calls.length === 1 && calls[0].fn === 'media' && calls[0].args.body.action === 'put' && calls[0].args.body.folder === 'co/projects/p1' && calls[0].args.body.contentType === 'image/png' && r.url === 'https://r2.test/k' && r.key === 'k' && !calls.some((c) => c.bucket), JSON.stringify({ calls, r }));
  calls.length = 0;
  await on.media.uploadImage('file:///x.heic', 'f'); await on.media.uploadImage('file:///x', 'f', 'video/quicktime'); await on.media.uploadImage('file:///x.jpg', 'f');
  check('8 file types: heic, mov video, jpeg', calls.map((c) => c.args.body.contentType).join() === 'image/heic,video/quicktime,image/jpeg', JSON.stringify(calls.map((c) => c.args.body.contentType)));
  const okFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => '<Error><Code>AccessDenied</Code></Error>' });
  m = await msgOf(on.media.uploadImage('file:///a.jpg', 'f'));
  check('9 storage refused (403): explained, raw text kept', m && /^Upload failed:/.test(m) && /refused this upload/.test(m) && /403/.test(m), m);
  globalThis.fetch = async () => ({ ok: false, status: 413, text: async () => '' });
  m = await msgOf(on.media.uploadImage('file:///a.mov', 'f'));
  check('10 too large (413): explained', m && /bigger than the server allows/.test(m), m);
  globalThis.fetch = async () => { throw new TypeError('Network request failed'); };
  m = await msgOf(on.media.uploadImage('file:///a.jpg', 'f'));
  check('11 a thrown network failure is caught and explained (not a raw crash)', m && /^Upload failed:/.test(m) && /connection/.test(m), m);
  globalThis.fetch = okFetch;

  session = null; calls.length = 0;
  m = await msgOf(on.media.uploadImage('file:///a.jpg', 'f'));
  check('12 signed out: clear message, and the server is never asked', m && /signed out/.test(m) && calls.length === 0, m);
  session = { access_token: 't' };

  const said = { error: 'ID photo storage is not set up yet (the private bucket, R2_PRIVATE_BUCKET_NAME, is missing). Ask the company to finish setup.' };
  invokeResult = { data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { clone: () => ({ json: async () => said }) } } };
  m = await msgOf(on.media.uploadImage('file:///a.jpg', 'ids/p1'));
  check('13 the media function\'s own refusal (no private bucket for ID photos) reaches the person, not the generic "non-2xx" text', m && /ID photo storage is not set up/.test(m) && !/non-2xx/.test(m), m);
  invokeResult = { data: { uploadUrl: 'https://r2.test/put', key: 'k', publicUrl: 'https://r2.test/k' }, error: null };

  // R2 path
  const r2 = load(true);
  check('14 with an R2 address in the build, R2 is ON', r2.media.r2Enabled === true);
  invokeResult = { data: null, error: { message: 'Failed to send a request to the Edge Function' } };
  m = await msgOf(r2.media.uploadImage('file:///a.jpg', 'f'));
  check('15 R2 on but the function is not deployed: says so, raw text kept', m && /isn't reachable/.test(m) && /Edge Function/.test(m), m);
  invokeResult = { data: { error: 'R2 is not set up yet.' }, error: null };
  m = await msgOf(r2.media.uploadImage('file:///a.jpg', 'f'));
  check('16 R2 on but secrets missing: says R2 is not set up', m && /R2/.test(m), m);

  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
