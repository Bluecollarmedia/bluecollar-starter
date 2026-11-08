// Run: node scripts/checks/uploadBars.check.cjs <path to typescript package>
// Every Our Work upload shows one real progress bar: a post with many pictures, a reel, a story. The bar moves with the bytes, file by file.
const fs = require('fs');
const path = require('path');
const ts = require(process.argv[2] || 'typescript');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
let bad = 0;
let n = 0;
const check = (name, ok, detail = '') => { n += 1; if (!ok) bad += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${name}${ok ? '' : '  - ' + detail}`); };
const mod = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(read('src/lib/uploadProgress.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(mod, mod.exports, require);
const L = mod.exports;

check('1 ten pictures: the bar is at 0 before the first, and each finished picture is a tenth', L.overallProgress(0, 10, 0) === 0 && L.overallProgress(3, 10, 0) === 0.3 && L.overallProgress(10, 10, 0) === 1);
check('2 the picture being sent moves the bar through its own tenth as its bytes go up', L.overallProgress(3, 10, 0.5) === 0.35 && L.overallProgress(9, 10, 1) === 1);
check('3 a single file fills the whole bar by itself', L.overallProgress(0, 1, 0.42) === 0.42);
check('4 odd numbers never push the bar outside 0 to 100', L.overallProgress(0, 0, 0.5) === 0 && L.overallProgress(5, 3, 2) === 1 && L.overallProgress(0, 4, NaN) === 0 && L.percentOf(0.356) === 36 && L.percentOf(-1) === 0 && L.percentOf(7) === 100);
check('5 the label counts the files when there is more than one', L.uploadLabel(2, 10) === 'Uploading 2 of 10' && L.uploadLabel(1, 1) === 'Uploading');

const up = read('src/data/portfolioUpload.ts');
check('6 a portfolio photo and a portfolio video report their bytes as they go (the video from 5% to 90%, the still frame last)', /uploadPortfolioPhoto\(localUri: string, companyId: string, kind: PortfolioFolder = 'posts', onProgress\?: \(p: number\) => void\)/.test(up) && /\(p\) => onProgress\?\.\(p \* 0\.9\)/.test(up) && /\(p\) => onProgress\?\.\(0\.05 \+ p \* 0\.85\)/.test(up));
check('7 the music track and a story upload report too', /uploadTrack\(track: PickedTrack, companyId: string, onProgress\?: \(p: number\) => void, part\?:/.test(read('src/data/portfolioMusic.ts')) && /addMediaStory\(input: \{[^}]*\}, onProgress\?: \(p: number\) => void\)/.test(read('src/data/portfolioStoriesOwner.ts')) && /input\.mimeType, onProgress\)/.test(read('src/data/portfolioStoriesOwner.ts')));
const editor = read('src/components/work/PostEditorScreen.tsx');
check('7b the video size reported by the phone reaches the compressor (a 720p file is sent as it is), and an unknown size is planned as 1920x1080, never a square', /uploadPortfolioVideo\(i\.uri, companyId, 'posts', 0\.5, report, \{ width: i\.width, height: i\.height \}\)/.test(read('src/components/work/PostEditorScreen.tsx')) && /shrinkVideoUri\(localUri, size\)/.test(up) && /shrinkVideoUri\(input\.localUri, \{ width: input\.width, height: input\.height \}\)/.test(read('src/data/portfolioStoriesOwner.ts')) && /width: a\.width, height: a\.height/.test(read('src/components/work/StoriesManagerScreen.tsx')) && /VIDEO_FALLBACK_W = 1920;\s*const VIDEO_FALLBACK_H = 1080;/.test(read('src/lib/mediaCompress.ts')) && !/VIDEO_FALLBACK, height: job\.height \?\? VIDEO_FALLBACK/.test(read('src/lib/mediaCompress.ts')));
check('8 a post or reel shows ONE bar for the whole save: every file (and the music, the cover, the save itself) is an equal step', /const totalSteps = toSend \+ \(music\?\.track \? 1 : 0\) \+ \(coverLocal \? 1 : 0\) \+ 1/.test(editor) && /const report = \(f: number\) => setProgress\(overallProgress\(done, totalSteps, f\)\)/.test(editor) && /uploadPortfolioPhoto\(i\.uri, companyId, 'posts', report\)/.test(editor) && /uploadPortfolioVideo\(i\.uri, companyId, 'posts', 0\.5, report, \{ width: i\.width, height: i\.height \}\)/.test(editor) && /uploadTrack\(music\.track, companyId, report, \{ startS: music\.startS, endS: music\.endS \}\)/.test(editor) && /<ProgressBar progress=\{percentOf\(progress \?\? 0\)\} showLabel \/>/.test(editor));
check('9 the bar is gone once the save ends, however it ends', /finally \{\s*setBusy\(null\);\s*setProgress\(null\);/.test(editor));
const stories = read('src/components/work/StoriesManagerScreen.tsx');
check('10 a story photo or video shows a bar while it is sent', /addMediaStory\(\{[^}]*\}, setProgress\)/.test(stories) && /<ProgressBar progress=\{percentOf\(progress\)\} showLabel \/>/.test(stories) && /setProgress\(null\)/.test(stories));
const music = read('src/data/portfolioMusic.ts');
const swift = read('modules/audio-trim/ios/AudioTrimModule.swift');
check('12 a music track is shrunk on the phone (128 kbps AAC) before it goes up, and goes up as it is if that fails', /compressor\.Audio\.compress\(track\.uri, \{ bitrate: 128000 \}\)/.test(music) && /const small = await shrinkTrack\(track\)/.test(music) && /return \{ uri: track\.uri, mimeType: track\.mimeType \}/.test(music));
const L2 = (() => { const m = { exports: {} }; const req = (n) => (n.startsWith('@/') || n.startsWith('./') ? {} : require(n)); new Function('module', 'exports', 'require', ts.transpileModule(read('src/lib/portfolio.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports, req); return m.exports; })();
check('12b music is cut to just the chosen part on the phone (a native AudioTrim module, in build 25 and later; a build without it sends the whole track), and a cut track plays from 0 to its own length', /AVAssetExportSession\(asset: asset, presetName: AVAssetExportPresetAppleM4A\)/.test(swift) && /session\.timeRange = CMTimeRange/.test(swift) && /Name\("AudioTrim"\)/.test(swift) && /"apple": \{\s*"modules": \["AudioTrimModule"\]/.test(read('modules/audio-trim/expo-module.config.json')) && /requireOptionalNativeModule/.test(music) && /clip: \{ startS: 0, endS: Math\.max\(1, part\.endS - part\.startS\) \}/.test(music) && /if \(up\.clip\) \{ partS = up\.clip\.startS; partE = up\.clip\.endS; \}/.test(read('src/components/work/PostEditorScreen.tsx')));
check('13 the website on the profile opens as a link: a bare name gets https, a full address is kept, nothing gives nothing', L2.websiteHref('brightonlawn.com') === 'https://brightonlawn.com' && L2.websiteHref('http://x.com/a') === 'http://x.com/a' && L2.websiteHref(' ') === '' && /Linking\.openURL\(websiteHref\(data\.profile\.website\)\)/.test(read('app/weather/(tabs)/work.tsx')));
const comp = read('src/lib/mediaCompress.ts');
check('14 a shrunk video is copied with the legacy file API and checked to be a real file; a missing result means the original goes up (never "the file is gone")', /legacy\.copyAsync\(\{ from: made, to: dest\.uri \}\)/.test(comp) && /const bytes = \(await exists\(uri\)\) \|\| undefined;\s*if \(!bytes\) return original;/.test(comp) && !/new File\(uri\)\.copy\(dest\)/.test(comp));
const coverEd = read('src/components/work/CoverEditor.tsx');
check('15 the cover editor closes its crop sheet before handing the result on (no blank white sheet), for a cropped picture and for "automatic" alike', /function finish\(croppedUri: string \| null\)/.test(coverEd) && /setStep\('choose'\);\s*setTimeout\(\(\) => onDone\(croppedUri\), 450\)/.test(coverEd) && /onPress=\{\(\) => finish\(null\)\}/.test(coverEd) && /onDone=\{finish\}/.test(coverEd) && !/onDone=\{\(uri\) => onDone\(uri\)\}/.test(coverEd));
check('16 a reel whose video has no still frame gets a cover made from the video when it is saved', /if \(!cover && reel\)/.test(read('src/components/work/PostEditorScreen.tsx')) && /videoFrameToFile\(first\.url, 0\.5\)/.test(read('src/components/work/PostEditorScreen.tsx')));
check('11 task, maintenance and Snow photos already had their own bar on each tile (unchanged)', /width: `\$\{pct\}%`/.test(read('src/components/media/MediaJobOverlay.tsx')));

console.log(bad ? `\n${bad} of ${n} FAILED` : `\nAll ${n} passed`);
process.exit(bad ? 1 : 0);
