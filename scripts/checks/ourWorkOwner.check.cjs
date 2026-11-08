// Run: node scripts/checks/ourWorkOwner.check.cjs <path to typescript package>
// Our Work, the owner's side: how pictures are made and uploaded (high-quality photos, small grid copies, original videos) and how posts are saved.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const compile = (src) => {
  const m = { exports: {} };
  new Function('module', 'exports', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', esModuleInterop: true } }).outputText)(m, m.exports, () => ({}));
  return m.exports;
};
const M = compile(read('src/lib/portfolioMedia.ts'));
let bad = 0;
let n = 0;
const check = (name, ok, detail = '') => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}${ok ? '' : '  - ' + detail}`); };

check('1 a big phone photo is saved with its long side at 1600, keeping its shape', JSON.stringify(M.fitLongSide(4032, 3024)) === JSON.stringify({ width: 1600, height: 1200 }) && JSON.stringify(M.fitLongSide(3024, 4032)) === JSON.stringify({ width: 1200, height: 1600 }));
check('2 a photo that is already small is never enlarged, and a missing size is handled', JSON.stringify(M.fitLongSide(1200, 800)) === JSON.stringify({ width: 1200, height: 800 }) && M.fitLongSide(0, 10).width === 0);
check('3 the grid copy is a centred square cut', JSON.stringify(M.squareCrop(4000, 3000)) === JSON.stringify({ originX: 500, originY: 0, size: 3000 }) && JSON.stringify(M.squareCrop(3000, 4000)) === JSON.stringify({ originX: 0, originY: 500, size: 3000 }) && M.THUMB_SIZE === 400);
check('4 photos are high quality (0.85, the app\'s usual is 0.5) and the grid copy is small and light', M.FULL_QUALITY === 0.85 && M.THUMB_QUALITY < M.FULL_QUALITY && M.FULL_LONG_SIDE === 1600);
check('5 files go in the company\'s own portfolio folder, and the small copies in a thumbs folder under it', M.portfolioFolder('c1', 'posts') === 'c1/portfolio/posts' && M.thumbFolder('c1', 'posts') === 'c1/portfolio/posts/thumbs');
check('6 a reel may be up to 3 minutes, and videos are sent at 720p', M.MAX_VIDEO_SECONDS === 180 && M.VIDEO_IS_COMPRESSED === true);

const media = read('src/lib/media.ts');
check('7 the shared uploader can skip its own compression (raw) so Our Work\'s quality is kept, and every other screen still compresses as before', /opts\?: \{ raw\?: boolean \}/.test(media) && /startsWith\('image\/'\) && !opts\?\.raw/.test(media));
const up = read('src/data/portfolioUpload.ts');
check('8 a photo uploads as a high-quality copy plus a small square copy, both without the app\'s usual compression', /FULL_QUALITY/.test(up) && /squareCrop\(full\.width, full\.height\)/.test(up) && (up.match(/\{ raw: true \}/g) || []).length >= 4);
check('9 a video is shrunk to 720p first (the original if that fails), with a best-effort still frame for the grid that never stops the post', /uploadImage\(source, portfolioFolder\(companyId, kind\), 'video\/mp4', \(p\) => onProgress\?\.\(0\.05 \+ p \* 0\.85\), \{ raw: true \}\)/.test(up) && /const source = await shrinkVideoUri\(localUri, size\)/.test(up) && /catch \{\s*onProgress\?\.\(1\);\s*return \{ url: up\.url, key: up\.key, thumbUrl: null/.test(up));

const own = read('src/data/portfolioOwner.ts');
check('10 a post that cannot save its pictures is not left behind half made', /portfolio_posts'\)\.delete\(\)\.eq\('id', postId\)/.test(own) && /if \(ins\.error\) \{/.test(own));
check('11 a post is checked (one video of up to 60 seconds for a reel, tags from the list) before it is sent', /postProblem\(\{ kind: input\.kind/.test(own));
check('12 removing a picture from a post (or deleting a post) deletes its files only when they sit in the company\'s own portfolio folder; a project\'s photo is only taken out of the post', /removeStoredFiles\(\[\.\.\.keys\]\)/.test(own) && /removeStoredFiles\(postFileKeys\(post, config\.r2PublicUrl, companyId\)\)/.test(own) && /startsWith\(`\$\{companyId\}\/portfolio\/`\)/.test(read('src/lib/portfolioFiles.ts')));
check('13 the profile text is saved by updating the row, or creating it the first time', /\.update\(\{ bio, website/.test(own) && /\.insert\(\{ company_id: companyId, bio, website/.test(own));
check('14 a reel\'s "also show in the grid" choice is kept, and a project post is always in the grid', /show_in_grid: input\.kind === 'video' \? input\.showInGrid : true/.test(own));
check('15 every owner read and write goes through the database rules (owner and admin only) and never throws', /export async function loadOwnerPortfolio/.test(own) && !/service_role|serviceRole/.test(own));
// ── the owner screens (3b and 3c) ──
const P = compile(read('src/lib/portfolio.ts'));
check('16 a post holds up to 10 photos and videos; a reel is exactly one video', P.MAX_POST_MEDIA === 10 && !!P.postProblem({ kind: 'post', caption: '', town: '', tags: [], media: Array.from({ length: 11 }, () => ({ kind: 'photo', duration_s: null })) }) && P.postProblem({ kind: 'post', caption: '', town: '', tags: [], media: Array.from({ length: 10 }, () => ({ kind: 'photo', duration_s: null })) }) === null && P.postProblem({ kind: 'video', caption: '', town: '', tags: [], media: [{ kind: 'video', duration_s: 30 }] }) === null);
check('17 a highlight needs a short name, and either a tag to follow or at least one picked post', !!P.highlightProblem({ name: '', mode: 'tag', tag: 'Pavers', postIds: [] }) && !!P.highlightProblem({ name: 'x'.repeat(15), mode: 'tag', tag: 'Pavers', postIds: [] }) && !!P.highlightProblem({ name: 'Patios', mode: 'tag', tag: null, postIds: [] }) && !!P.highlightProblem({ name: 'Patios', mode: 'manual', tag: null, postIds: [] }) && P.highlightProblem({ name: 'Patios', mode: 'tag', tag: 'Pavers', postIds: [] }) === null && P.highlightProblem({ name: 'Mine', mode: 'manual', tag: null, postIds: ['a'] }) === null);

const mgr = read('src/components/work/OurWorkManagerScreen.tsx');
check('18 the manager has the master switch (starts off, only the owner can flip it, asks first), the bio and website, links to the story and Highlights, and New post / New reel', /isOwner = db\.role === 'owner'/.test(mgr) && /disabled=\{!isOwner \|\| busy\}/.test(mgr) && /confirmAction\('Show Our Work\?'/.test(mgr) && /confirmAction\('Hide Our Work\?'/.test(mgr) && /saveProfile\(/.test(mgr) && /our-work-stories/.test(mgr) && /our-work-highlights/.test(mgr) && /\+ New post/.test(mgr) && /\+ New reel/.test(mgr));
check('19 every post is listed with its own show/hide switch and an Edit button, reels marked with a play badge and their length', /setPostVisible\(p\.id, visible\)/.test(mgr) && /Edit \$\{p\.caption/.test(mgr) && /playBadge/.test(mgr) && /formatDuration\(len\)/.test(mgr));

const ed = read('src/components/work/PostEditorScreen.tsx');
check('20 a post takes up to 10 photos and videos, a reel one video of up to 60 seconds, picked from the phone (copied to a safe place at once) or from one of the owner\'s projects', /MAX_POST_MEDIA/.test(ed) && /reel \? \['videos'\] : \['images', 'videos'\]/.test(ed) && /seconds \?\? 0\) > MAX_VIDEO_S/.test(ed) && /keepPicked\(a\.uri/.test(ed) && /ProjectPhotoPicker/.test(ed) && /rowsOf\('project_photos'\)/.test(ed));
check('21 the pictures can be put in order and any removed, and the first is the cover', /moveItem\(cur, from, to\)/.test(ed) && /Move earlier/.test(ed) && /first one is the cover/.test(ed) && /accessibilityLabel="Remove"/.test(ed));
check('22 saving sends photos with a small copy and videos shrunk, shows "Uploading 2 of 5…" with one bar, then creates or updates the post', /uploadPortfolioPhoto\(i\.uri, companyId, 'posts', report\)/.test(ed) && /uploadPortfolioVideo\(i\.uri, companyId, 'posts', 0\.5, report, \{ width: i\.width, height: i\.height \}\)/.test(ed) && /uploadLabel\(n, toSend\)/.test(ed) && /createPost\(/.test(ed) && /saveMedia\(post\.id/.test(ed) && /postProblem\(/.test(ed));
check('23 a reel is always in the photo grid (no switch for it any more); every post has "Show on Our Work"; the editor can take a post down, show it again, and delete it (asked first)', !/Also show in the photo grid/.test(ed) && /useState\(true\)/.test(ed) && /Show on Our Work/.test(ed) && /Take down from Our Work/.test(ed) && /Show on Our Work again/.test(ed) && /confirmAction\('Delete this post\?'/.test(ed));
check('24 the words say post and reel, and say that posts are shown square and centred', /'New reel'/.test(ed) && /'New post'/.test(ed) && /shown as a square, centred automatically/.test(ed) && /Only the town shows/.test(ed));

const hs = read('src/components/work/HighlightsScreen.tsx');
check('25 Highlights: name (short), circle picture from the owner\'s photos or the first post, automatic by tag or hand-picked, reorder, delete (asked first)', /HIGHLIGHT_NAME_MAX/.test(hs) && /Choose the circle picture/.test(hs) && /Automatic, by tag/.test(hs) && /I pick the posts/.test(hs) && /saveHighlightOrder\(ids\)/.test(hs) && /confirmAction\('Delete this highlight\?'/.test(hs) && /uploadPortfolioPhoto\(kept, db\.companyId, 'covers'\)/.test(hs));
const exists = (p) => fs.existsSync(path.join(__dirname, '../..', p));
const rows = [['app/(owner)', '_layout.tsx', '(tabs)/more/index.tsx'], ['app/snow/owner', '_layout.tsx', '(tabs)/more.tsx']];
check('26 the three owner screens exist in both owner areas, are registered, and More has an "Our Work" row', rows.every(([d, l, m]) => ['our-work', 'our-work-post', 'our-work-highlights'].every((s) => exists(`${d}/${s}.tsx`) && new RegExp(`name="${s}"`).test(read(`${d}/${l}`))) && /label="Our Work"|title="Our Work"/.test(read(`${d}/${m}`))));

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
