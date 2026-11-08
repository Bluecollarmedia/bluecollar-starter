// Run: node scripts/checks/portfolioFiles.check.cjs <path to typescript package>
// Deleting an Our Work item deletes its files from storage too, and ONLY files inside this company's own portfolio folder.
const fs = require('fs');
const path = require('path');
const ts = require(process.argv[2] || 'typescript');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
let n = 0;
const check = (name, ok, detail = '') => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}${ok ? '' : '  - ' + detail}`); };
const mod = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(read('src/lib/portfolioFiles.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(mod, mod.exports, require);
const F = mod.exports;
const BASE = 'https://pub-abc.r2.dev';
const CO = 'co-1';
const u = (k) => `${BASE}/${k}`;

check('1 a public address becomes its storage key, only inside this company\'s portfolio folder', F.portfolioKeyFromUrl(u('co-1/portfolio/posts/a.jpg'), BASE, CO) === 'co-1/portfolio/posts/a.jpg' && F.portfolioKeyFromUrl(u('co-2/portfolio/posts/a.jpg'), BASE, CO) === null && F.portfolioKeyFromUrl(u('co-1/projects/p.jpg'), BASE, CO) === null && F.portfolioKeyFromUrl('https://elsewhere.com/co-1/portfolio/posts/a.jpg', BASE, CO) === null && F.portfolioKeyFromUrl(null, BASE, CO) === null && F.portfolioKeyFromUrl(u('co-1/portfolio/../x.jpg'), BASE, CO) === null);

const post = {
  media: [
    { url: u('co-1/portfolio/posts/a.jpg'), thumb_url: u('co-1/portfolio/posts/thumbs/a-t.jpg'), storage_key: 'co-1/portfolio/posts/a.jpg' },
    { url: u('co-1/portfolio/posts/v.mp4'), thumb_url: u('co-1/portfolio/posts/thumbs/v-t.jpg'), storage_key: 'co-1/portfolio/posts/v.mp4' },
    { url: u('co-1/projects/borrowed-project-photo.jpg'), thumb_url: null, storage_key: null },
  ],
  cover_url: u('co-1/portfolio/covers/c.jpg'), cover_thumb_url: u('co-1/portfolio/covers/thumbs/c-t.jpg'),
  music_url: u('co-1/portfolio/music/song.m4a'),
};
const keys = F.postFileKeys(post, BASE, CO).sort();
check('2 deleting a post removes every file of it: photos and videos, their small copies and still frames, its cover and its song', JSON.stringify(keys) === JSON.stringify(['co-1/portfolio/covers/c.jpg', 'co-1/portfolio/covers/thumbs/c-t.jpg', 'co-1/portfolio/music/song.m4a', 'co-1/portfolio/posts/a.jpg', 'co-1/portfolio/posts/thumbs/a-t.jpg', 'co-1/portfolio/posts/thumbs/v-t.jpg', 'co-1/portfolio/posts/v.mp4']), JSON.stringify(keys));
check('3 a project photo borrowed into a post (it lives outside the portfolio folder) is never deleted with it', !keys.some((k) => k.includes('borrowed')));
check('4 a story removes its picture or video and its still frame; a shared card (no file) removes nothing', JSON.stringify(F.storyFileKeys({ media_url: u('co-1/portfolio/stories/s.mp4'), media_thumb_url: u('co-1/portfolio/stories/thumbs/s.jpg') }, BASE, CO)) === JSON.stringify(['co-1/portfolio/stories/s.mp4', 'co-1/portfolio/stories/thumbs/s.jpg']) && F.storyFileKeys({ media_url: null, media_thumb_url: null }, BASE, CO).length === 0);
check('5 a highlight removes its circle picture only when the owner uploaded one (covers folder); a post photo used as the circle stays', F.highlightFileKeys({ cover_url: u('co-1/portfolio/covers/thumbs/h.jpg') }, BASE, CO).length === 1 && F.highlightFileKeys({ cover_url: u('co-1/portfolio/posts/a.jpg') }, BASE, CO).length === 0 && F.highlightFileKeys({ cover_url: null }, BASE, CO).length === 0);
check('6 a replaced cover or song is found: only what is no longer used', JSON.stringify(F.replacedFileKeys(['a', 'b', 'c'], ['b'])) === JSON.stringify(['a', 'c']) && F.replacedFileKeys(['a'], ['a']).length === 0);
check('7 a removed picture takes its small copy with it', JSON.stringify(F.mediaFileKeys({ url: u('co-1/portfolio/posts/a.jpg'), thumb_url: u('co-1/portfolio/posts/thumbs/a-t.jpg'), storage_key: 'co-1/portfolio/posts/a.jpg' }, BASE, CO).sort()) === JSON.stringify(['co-1/portfolio/posts/a.jpg', 'co-1/portfolio/posts/thumbs/a-t.jpg']));

const owner = read('src/data/portfolioOwner.ts');
const stories = read('src/data/portfolioStoriesOwner.ts');
const editor = read('src/components/work/PostEditorScreen.tsx');
check('8 the owner screens use it: delete post, remove a picture, delete highlight, delete story, replace cover or song', /removeStoredFiles\(postFileKeys\(post, config\.r2PublicUrl, companyId\)\)/.test(owner) && /mediaFileKeys\(\{ url: \(m as PortfolioMedia\)\.url/.test(owner) && /highlightFileKeys\(row as/.test(owner) && /storyFileKeys\(row as/.test(stories) && /await deletePost\(post\.id, post\)/.test(editor) && /removeStoredFiles\(replacedFileKeys\(before, after\)\)/.test(editor));
check('9 stories older than 24 hours are deleted for good (row and files) whenever the owner looks at the stories', /export async function purgeExpiredStories/.test(stories) && /\.lte\('expires_at', new Date\(\)\.toISOString\(\)\)/.test(stories) && /void purgeExpiredStories\(\);/.test(stories));
check('10 files are removed through the media function (which only lets this company\'s owner and admins delete their own folder)', /action: 'delete', key/.test(read('src/lib/media.ts')) && /first in me\.roles && CAN_DELETE\.has\(me\.roles\[first\]\)/.test(read('supabase/functions/media/index.ts')));

const sweep = read('src/lib/storageSweep.ts');
check('11 after any delete (and shortly after sign-in) the app asks the storage-cleanup function to delete the queued files: a few seconds later and again a little after, never throwing', /export function sweepStorageSoon/.test(sweep) && /storage-cleanup/.test(sweep) && /setTimeout\(\(\) => \{ void runBatches\(\); \}, 5000\)/.test(sweep) && /sweepStorageSoon\(\);\s*\}\s*\}/.test(read('src/data/store.ts')) && /sweepStorageSoon\(\)/.test(read('src/data/snowStorms.ts')) && /sweepStorageSoon\(\)/.test(read('src/data/snowMediaReview.ts')) && /sweepStorageSoon\(\)/.test(read('app/_layout.tsx')));
const sql119 = read('supabase/updates/119_deleted_files_sweep.sql');
check('12 update 119: a trigger on every table with a file puts a deleted row\'s file on the clean-up queue (repeats skipped), reports too, and nobody can call it from the app', /after delete on public\.%I for each row execute function public\._enqueue_deleted_file\(\)/.test(sql119) && /on conflict \(file_key\) do nothing/.test(sql119) && /_enqueue_deleted_issue_files/.test(sql119) && /revoke all on function public\._enqueue_deleted_file\(\) from public, anon, authenticated/.test(sql119));
check('13 customer Snow photos open even when a signed link is not given: the public file address is used, and the history says "1 photo" not "1 photos"', /export function snowPublicUrl/.test(read('src/lib/snowMedia.ts')) && /urls\[m\.file_key\] \?\? \(withUrls \? snowPublicUrl\(m\.file_key\) : undefined\)/.test(read('src/data/snowCustomer.ts')) && /v\.photos === 1 \? t\('1 photo'\)/.test(read('src/components/customerHome/CustomerHistoryScreen.tsx')));
check('14 Snow is blue and Lawn is green on the customer home and history (stats, quiet card, see-all, chosen season)', /<Stats accent=\{semantic\.info\} items=/.test(read('src/components/customerHome/PropertyHome.tsx')) && /accent = service === 'snow' \? semantic\.info : colors\.primary/.test(read('src/components/customerHome/CustomerHistoryScreen.tsx')));
console.log(bad ? `\n${bad} of ${n} FAILED` : `\nAll ${n} passed`);
process.exit(bad ? 1 : 0);
