// Run: node scripts/checks/maxFileSize.check.cjs <path to typescript package>
// The owner sets the max file size; it is shown, saved on the company, checked before upload and again by the upload function.
const ts = require(process.argv[2] || 'typescript'); const fs = require('fs'); const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const m = { exports: {} }; new Function('module', 'exports', ts.transpileModule(read('src/lib/uploadLimit.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports);
const u = m.exports;
let bad = 0; const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : ' — ' + d}`); };
check('1 nothing saved = the server maximum (200 MB); saved values are kept within 1..200', u.effectiveMaxFileMb(undefined) === 200 && u.effectiveMaxFileMb(0) === 200 && u.effectiveMaxFileMb(25) === 25 && u.effectiveMaxFileMb(999) === 200);
check('2 typed values: whole MB from 1 to 200 only', u.parseMaxFileMb('25') === 25 && u.parseMaxFileMb(' 200 ') === 200 && u.parseMaxFileMb('0') === null && u.parseMaxFileMb('201') === null && u.parseMaxFileMb('2.5') === null && u.parseMaxFileMb('') === null && u.parseMaxFileMb('abc') === null);
const MB = 1024 * 1024;
check('3 a file within the limit passes; over it is refused with a plain sentence naming both sizes', u.tooLargeMessage(24 * MB, 25) === null && u.tooLargeMessage(undefined, 25) === null && /This file is 34 MB, and the largest file allowed is 25 MB/.test(u.tooLargeMessage(34 * MB, 25)) && /More → Storage/.test(u.tooLargeMessage(34 * MB, 25)));
check('4 exactly at the limit is allowed', u.tooLargeMessage(25 * MB, 25) === null);
const screen = read('app/(owner)/(tabs)/more/storage.tsx'), media = read('src/lib/media.ts'), fn = read('supabase/functions/media/index.ts'), sql = read('supabase/updates/053_max_file_size.sql');
check('5 the Storage screen lets the owner pick or type the size and shows the saved one (no longer a fixed 10 MB)', /MAX_FILE_PRESETS_MB\.map/.test(screen) && /accessibilityLabel="Custom max file size in MB"/.test(screen) && /setMaxMb\(typedMax\)/.test(screen) && !/formatBytes\(settings\?\.maxFileSizeBytes/.test(screen));
check('6 it is saved on the company row (follows the owner across devices) and the column is in the store', /maxFileSizeMb: next/.test(read('src/hooks/useStorage.ts')) && /'maxFileSizeMb'/.test(read('src/data/store.ts')) && /max_file_size_mb/.test(sql) && /between 1 and 200/.test(sql));
check('7 uploads are checked against it before anything is sent', /tooLargeMessage\(size, db\?\.company\?\.maxFileSizeMb\)/.test(media) && /localFileSize\(localUri\)/.test(media) && /if \(tooBig\) throw new Error\(tooBig\)/.test(media));
check('8 the upload function checks it again for company folders', /max_file_size_mb/.test(fn) && /body\.size > limitMb \* 1024 \* 1024/.test(fn));
console.log(bad ? `\n${bad} failed` : '\nall passed'); process.exit(bad ? 1 : 0);
