// Run: node scripts/checks/workerDetails.check.cjs <path to typescript package>
// A worker's hoodie size and private ID photo: the helpers, and that sign-up, Edit Profile and the owner's screens are wired.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(read('src/lib/workerDetails.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const w = m.exports;
let bad = 0;
const check = (n, ok, detail) => { if (!ok) bad++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (ok ? '' : ' - ' + (detail || ''))); };

check('1 hoodie sizes are XS to 3XL and nothing else is accepted', w.HOODIE_SIZES.join() === 'XS,S,M,L,XL,2XL,3XL' && w.isHoodieSize('L') && !w.isHoodieSize('GIANT') && !w.isHoodieSize(null));
check('2 the ID folder is private and per person', w.idFolder('abc') === 'ids/abc');
check('3 a saved ID key must be inside that person\'s own folder', w.isIdKeyFor('abc', 'ids/abc/x.jpg') && !w.isIdKeyFor('abc', 'ids/other/x.jpg') && !w.isIdKeyFor('abc', 'ids/abc/../other/x.jpg') && !w.isIdKeyFor('abc', 'https://x.test/ids/abc/x.jpg'));

const join = read('app/invite/[token].tsx');
check('4 sign-up (workers, not the Snow request) offers hoodie size and ID and saves them right after joining',
  /<WorkerExtrasFields/.test(join) && /isWorker \? \(/.test(join) && /saveDetailsForCurrentUser\(\{ hoodieSize: hoodie, idUri \}\)/.test(join));
const edit = read('src/components/account/EditProfileScreen.tsx');
check('5 Edit Profile (workers) lets them add, replace or remove the ID and change the size later',
  /requireAll \? \(\s*<WorkerExtrasFields/.test(edit) && /saveMyId\(user\.id, newIdUri, savedIdKey\)/.test(edit) && /removeMyId\(user\.id, savedIdKey\)/.test(edit) && /saveMyHoodie\(user\.id, hoodie\)/.test(edit));
const data = read('src/data/workerDetails.ts');
check('6 the ID is uploaded to the private ids folder, saved as a key (never a public link) and viewed through a signed link',
  /uploadImage\(localUri, idFolder\(personId\)\)/.test(data) && /id_key: key/.test(data) && !/id_key: url/.test(data) && /action: 'id-sign'/.test(data));
const wk = read('app/(owner)/(tabs)/workers/[id].tsx');
check('7 the owner sees hoodie size and a private View ID on the worker page', /<OwnerWorkerExtras personId=\{personId\}/.test(wk));
check('8 the database update and its test exist', fs.existsSync(path.join(__dirname, '../../supabase/updates/058_worker_hoodie_and_id.sql')) && fs.existsSync(path.join(__dirname, '../../supabase/tests/058_worker_hoodie_and_id.pglite.mjs')));
console.log(bad ? '\n' + bad + ' failed' : '\nall passed');
process.exit(bad ? 1 : 0);
