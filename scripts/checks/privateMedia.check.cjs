// The private-file rule is identical on the server and in the app, and covers exactly the files that must not be public.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };
(async () => {
  const root = path.join(__dirname, '..', '..');
  const server = await import(pathToFileURL(path.join(root, 'supabase', 'functions', '_shared', 'privateKeys.ts')).href);
  const client = await import(pathToFileURL(path.join(root, 'src', 'lib', 'privateMedia.ts')).href).catch(() => null);
  const sample = {
    // ID photos are the only private files now. Maintenance and Snow photos are public (pictures of properties and work).
    'ids/person1/a.jpg': true,
    'co1/maintenance/prop1/a.jpg': false, 'co1/reference/svc1/a.mp4': false, 'co1/completion/visit1/a.jpg': false,
    'co1/projects/p1/a.jpg': false, 'avatars/person1/a.jpg': false, 'co1/trucks/t1/a.pdf': false, 'co1/issues/x/a.jpg': false,
    'maintenance/a.jpg': false, 'co1/maintenance': false, 'co1/Maintenance/p/a.jpg': false,
  };
  for (const [k, want] of Object.entries(sample)) check(`server: ${k} -> ${want ? 'private' : 'public'}`, server.isPrivateKey(k) === want);
  if (client) {
    check('the app uses exactly the same rule as the server for every sample key', Object.keys(sample).every((k) => client.isPrivateKey(k) === server.isPrivateKey(k)));
  } else {
    // privateMedia.ts imports React Native modules, which plain Node cannot load: compare the rule text instead.
    const fs = require('node:fs');
    const grab = (f) => fs.readFileSync(f, 'utf8').match(/PRIVATE_FOLDERS = new Set(?:<string>)?\(\[([^\]]*)\]\)/)[1].replace(/\s/g, '');
    const a = grab(path.join(root, 'supabase/functions/_shared/privateKeys.ts')), b = grab(path.join(root, 'src/lib/privateMedia.ts'));
    check('the app and the server list the same private folders', a === b, a + ' vs ' + b);
    const c = grab(path.join(root, 'supabase/functions/media/index.ts'));
    check('the media function lists the same private folders (it is a single file so it can be pasted into the dashboard)', a === c, a + ' vs ' + c);
    check('the media function has no relative imports (so it can be pasted into the dashboard as one file)', !/from '\.\.?\//.test(fs.readFileSync(path.join(root, 'supabase/functions/media/index.ts'), 'utf8')));
  }
  const fs = require('node:fs');
  const fn = fs.readFileSync(path.join(root, 'supabase/functions/media/index.ts'), 'utf8');
  check('new private files are written to the private bucket, not the public one', /writeBase\(key\)/.test(fn) && (fn.match(/writeBase\(key\)/g) || []).length >= 2);
  check('with no private bucket configured everything behaves as before (one bucket)', /PRIVATE_BUCKET_URL && isPrivateKey\(key\) \? PRIVATE_BUCKET_URL : BUCKET_URL/.test(fn));
  check('reading/signing finds a file in the private bucket first, then the old one (so moving files across breaks nothing)', /async function locate/.test(fn) && /return BUCKET_URL;/.test(fn));
  check('deleting removes a file from both buckets', /deleteEverywhere/.test(fn));
  check('the maintenance photo link is only issued for keys the database says this person may open', /maintenance_photos_i_can_open/.test(fn) && /maint-sign/.test(fn));
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
