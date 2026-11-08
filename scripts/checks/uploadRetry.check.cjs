// Run: node scripts/checks/uploadRetry.check.cjs
// A phone upload that fails because the connection dropped for a moment ("the network connection was lost") is tried again with a fresh
// upload, up to three times in all. A timeout or a refusal from the server (4xx) is never repeated. Also: every picture/file screen goes
// through the one shared uploader.
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + detail}`); };

function load(script) {
  let tasks = 0;
  const legacy = {
    getInfoAsync: async () => ({ exists: true, size: 5 }),
    createUploadTask: (url, fileUri, opts) => { const n = ++tasks; return { cancelAsync: async () => {}, uploadAsync: () => script(n) }; },
    FileSystemUploadType: { BINARY_CONTENT: 0 },
  };
  const fakes = { 'react-native': { Platform: { OS: 'ios' } }, './mediaQueue': { withTimeout: (p, ms, mk) => p }, 'expo-file-system/legacy': legacy, 'expo-file-system': {} };
  const m = { exports: {} };
  const realSet = global.setTimeout;
  new Function('module', 'exports', 'require', 'setTimeout', ts.transpileModule(read('src/lib/uploadFile.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports, (n) => fakes[n], (f) => realSet(f, 0));
  return { put: () => m.exports.putFile('file:///x.jpg', 'https://r2/put', 'image/jpeg', 1000), count: () => tasks, ex: m.exports };
}
(async () => {
  let t = load(async (n) => { if (n < 3) throw new Error('fetch failed: UnexpectedException: The network connection was lost.'); return { status: 200, body: '' }; });
  let r = await t.put();
  check('1 two dropped connections, then it works: the photo is saved without bothering anyone', r.status === 200 && t.count() === 3, JSON.stringify([r, t.count()]));
  t = load(async () => { throw new Error('The network connection was lost.'); });
  let err = ''; try { await t.put(); } catch (e) { err = e.message; }
  check('2 it gives up after three tries and says why', /Sending the file failed/.test(err) && /connection was lost/.test(err) && t.count() === 3, `${err} ${t.count()}`);
  t = load(async (n) => (n === 1 ? { status: 503, body: 'busy' } : { status: 200, body: '' }));
  r = await t.put();
  check('3 a hiccup on the storage server (503) is tried again', r.status === 200 && t.count() === 2, JSON.stringify([r, t.count()]));
  t = load(async () => ({ status: 403, body: '<Code>SignatureDoesNotMatch</Code>' }));
  r = await t.put();
  check('4 a refusal (403) is returned at once, never repeated, so the real reason reaches the screen', r.status === 403 && /SignatureDoesNotMatch/.test(r.body) && t.count() === 1, JSON.stringify([r, t.count()]));
  t = load(async () => { throw new Error('Sending the file timed out after 90 seconds'); });
  err = ''; try { await t.put(); } catch (e) { err = e.message; }
  check('5 a timeout is not repeated (it already waited long enough)', /timed out/.test(err) && t.count() === 1, `${err} ${t.count()}`);
  check('6 the words the phone uses for a dropped connection are recognised', ['The network connection was lost.', 'Network request failed', 'The Internet connection appears to be offline.', 'fetch failed'].every((s) => t.ex.isDroppedConnection(s)) && !t.ex.isDroppedConnection('The file is gone'));

  const media = read('src/lib/media.ts');
  const walk = (d) => fs.readdirSync(path.join(__dirname, '../..', d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${d}/${e.name}`] : []);
  const bypass = [...walk('src'), ...walk('app')].filter((f) => !/lib\/(media|snowMedia|uploadFile|storage)\.ts$|hooks\/useStorage\.ts$/.test(f) && /\.storage\.from\(|createUploadTask|uploadToPresignedUrl/.test(read(f)));
  check('7 no screen has its own upload: everything goes through the shared uploader (profile, license and ID photos, worker photos, projects, tasks, trucks, notes, issues, Snow)', bypass.length === 0, bypass.join(', '));
  check('8 the shared uploader sends through the phone\'s own upload, with the retry', /putFile\(localUri, data\.uploadUrl, contentType/.test(media) && /RETRY_DELAYS_MS/.test(read('src/lib/uploadFile.ts')));
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
