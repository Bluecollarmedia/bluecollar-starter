// The private-file rule is identical on the server and in the app, and covers exactly the files that must not be public.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };
(async () => {
  const root = path.join(__dirname, '..', '..');
  const server = await import(pathToFileURL(path.join(root, 'supabase', 'functions', '_shared', 'privateKeys.ts')).href);
  const sample = {
    // ID photos are the only private files now. Work photos are public (pictures of properties and work).
    'ids/person1/a.jpg': true,
    'co1/maintenance/prop1/a.jpg': false, 'co1/reference/svc1/a.mp4': false, 'co1/completion/visit1/a.jpg': false,
    'co1/projects/p1/a.jpg': false, 'avatars/person1/a.jpg': false, 'co1/trucks/t1/a.pdf': false, 'co1/issues/x/a.jpg': false,
    'maintenance/a.jpg': false, 'co1/maintenance': false, 'co1/Maintenance/p/a.jpg': false,
  };
  for (const [k, want] of Object.entries(sample)) check(`server: ${k} -> ${want ? 'private' : 'public'}`, server.isPrivateKey(k) === want);
  {
    const fs = require('node:fs');
    const grab = (f) => fs.readFileSync(f, 'utf8').match(/PRIVATE_FOLDERS = new Set(?:<string>)?\(\[([^\]]*)\]\)/)[1].replace(/\s/g, '');
    const a = grab(path.join(root, 'supabase/functions/_shared/privateKeys.ts'));
    const c = grab(path.join(root, 'supabase/functions/media/index.ts'));
    check('the media function lists the same private folders (it is a single file so it can be pasted into the dashboard)', a === c, a + ' vs ' + c);
    check('the media function has no relative imports (so it can be pasted into the dashboard as one file)', !/from '\.\.?\//.test(fs.readFileSync(path.join(root, 'supabase/functions/media/index.ts'), 'utf8')));
  }
  const fs = require('node:fs');
  const fn = fs.readFileSync(path.join(root, 'supabase/functions/media/index.ts'), 'utf8');
  check('new private files are written to the private bucket, not the public one', /writeBase\(key\)/.test(fn) && (fn.match(/writeBase\(key\)/g) || []).length >= 1);
  // R17: no private bucket = ID photo uploads are REFUSED (never written to the public bucket).
  check('with no private bucket configured an ID photo upload is refused with a clear error, never sent to the public bucket',
    /if \(isPrivateKey\(`\$\{folder\}\/x`\) && !PRIVATE_BUCKET_URL\) return reply\(\{ error: NO_PRIVATE_BUCKET \}, 503\)/.test(fn) &&
    /if \(!isPrivateKey\(key\)\) return BUCKET_URL;\s*if \(!PRIVATE_BUCKET_URL\) throw new Error\(NO_PRIVATE_BUCKET\);\s*return PRIVATE_BUCKET_URL;/.test(fn) &&
    !/PRIVATE_BUCKET_URL && isPrivateKey\(key\) \? PRIVATE_BUCKET_URL : BUCKET_URL/.test(fn) &&
    /ID photo storage is not set up/.test(fn));
  check('reading/signing finds a file in the private bucket first, then the old one (so moving files across breaks nothing)', /async function locate/.test(fn) && /return BUCKET_URL;/.test(fn));
  check('deleting removes a file from both buckets', /deleteEverywhere/.test(fn));
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
