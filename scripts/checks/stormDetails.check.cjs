// Run: node scripts/checks/stormDetails.check.cjs <path to typescript package>
// Storm Details screen: the date/history helpers, and that the redesign kept every action and uses the bundled picture.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const m = { exports: {} };
new Function('module', 'exports', 'require', ts.transpileModule(read('src/lib/snowStormView.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(m, m.exports, () => ({ snowStatus: {} }));
const { longWhen } = m.exports;

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };
const at = (mo, d, h, mi) => new Date(2026, mo, d, h, mi).toISOString();

check('1 dates read like "October 19 at 9:43 AM" (from the stored time, in local time)', longWhen(at(9, 19, 9, 43)) === 'October 19 at 9:43 AM' && longWhen(at(0, 5, 15, 5)) === 'January 5 at 3:05 PM' && longWhen(at(11, 31, 0, 0)) === 'December 31 at 12:00 AM', longWhen(at(9, 19, 9, 43)));
check('2 a missing or bad date shows nothing instead of "Invalid Date"', longWhen(undefined) === '' && longWhen('nope') === '');
const base = { status: 'dispatched', createdAt: at(9, 19, 9, 43), dispatchedAt: at(9, 19, 9, 44), endedAt: undefined, reopenedCount: 0, lastReopenedAt: undefined };

const src = read('src/components/snow/storms/StormDetailScreen.tsx');
check('8 the winter picture is bundled in the app and exists (not loaded from the internet)', /require\('\.\.\/\.\.\/\.\.\/\.\.\/assets\/images\/snow-storm-header\.jpg'\)/.test(src) && fs.existsSync(path.join(root, 'assets/images/snow-storm-header.jpg')) && !/uri:\s*['"]http/.test(src));
check('9 the picture sits behind the header only (an ImageBackground around the back button, badge and title)', /<ImageBackground[\s\S]*GlassIconButton[\s\S]*storm\.name[\s\S]*<\/ImageBackground>/.test(src));
check('10 the lifecycle actions are still there with their handlers (the route itself is edited right on this screen now)', ['onDispatch', 'onDelete', 'onEnd', 'onReopen', '<RouteEditor'].every((k) => src.includes(k)));
check('11 the lifecycle actions: End storm, Reopen storm, and on a draft Dispatch Storm, Save Draft and Delete draft', ['title="End storm"', 'title="Dispatch Storm"', 'title="Save Draft"', 'accessibilityLabel="Delete draft"', 'title="Reopen storm"'].every((k) => src.includes(k)));
check('12 the crew lead is shown on the route editor, never cut off (no line limit on the lead text)', (() => { const e = fs.readFileSync(path.join(root, 'src/components/snow/routes/RouteEditScreen.tsx'), 'utf8'); return /Crew lead/.test(e) && !/Crew lead[^\n]*numberOfLines/.test(e); })());
check('13 the numbers come from the loaded summary, not fixed values', /s\.completed/.test(src) && /s\.skipped/.test(src) && /s\.pending \+ s\.arrived/.test(src) && /s\.routes/.test(src));
check('14 the content clears the bottom edge (safe-area padding on the scroll view and on the draft action bar)', /paddingBottom: storm\.status === 'draft' \? spacing\['2xl'\] : insets\.bottom \+ spacing\['4xl'\]/.test(src) && /paddingBottom: insets\.bottom \+ spacing\.sm/.test(src));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
