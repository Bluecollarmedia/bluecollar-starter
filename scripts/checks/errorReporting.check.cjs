// Run: node scripts/checks/errorReporting.check.cjs <path to typescript package>
// The "don't crash silently" safety net: describes the error, shows it once in a while, never rethrows a fatal one.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

const alerts = [];
const mod = { exports: {} };
const req = (n) => (n === 'react-native' ? { Alert: { alert: (...a) => alerts.push(a) }, Platform: { OS: 'ios' } } : {});
new Function('module', 'exports', 'require', ts.transpileModule(read('src/lib/errorReporting.ts'), { compilerOptions: { module: 'commonjs' } }).outputText)(mod, mod.exports, req);
const { describeError, installGlobalErrorHandler, _resetErrorHandlerForTests, ERROR_ALERT_COOLDOWN_MS } = mod.exports;

let bad = 0;
const check = (name, ok, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  — ' + detail}`); };

const d = describeError(Object.assign(new Error('Cannot convert undefined value to object'), { stack: 'Error: Cannot convert undefined value to object\n  at Object.entries (native)\n  at fromDb (app.js:1:1)\n  at map (native)\n  at load (app.js:2:2)' }));
check('1 the real message is kept and the first stack lines are shown', d.message === 'Cannot convert undefined value to object' && /fromDb/.test(d.where) && d.where.split('\n').length <= 3, JSON.stringify(d));
check('2 strings, empty and odd values are handled', describeError('boom').message === 'boom' && describeError(null).message === 'Unknown error' && describeError({}).message === 'Unknown error');
check('3 very long messages are cut', describeError(new Error('x'.repeat(1000))).message.length === 300);

let handler = null; let previousCalls = [];
globalThis.ErrorUtils = { getGlobalHandler: () => (e, f) => previousCalls.push([e, f]), setGlobalHandler: (h) => { handler = h; } };
let t = 0;
installGlobalErrorHandler(() => t);
check('4 the handler is installed once', typeof handler === 'function');
t = 100000; handler(new Error('first'), true);
check('5 a fatal error shows an alert with the message and does NOT reach the crashing handler', alerts.length === 1 && /first/.test(alerts[0][1]) && previousCalls.length === 0);
t = 100000 + 1000; handler(new Error('second'), true);
check('6 a burst of errors does not spam alerts (cooldown)', alerts.length === 1);
t = 100000 + ERROR_ALERT_COOLDOWN_MS + 1; handler(new Error('third'), true);
check('7 after the cooldown it shows again', alerts.length === 2 && /third/.test(alerts[1][1]));
handler(new Error('soft'), false);
check('8 a non-fatal error goes to the normal handler (no alert)', previousCalls.length === 1 && alerts.length === 2);
check('9 the root layout installs it', /installGlobalErrorHandler\(\)/.test(read('app/_layout.tsx')));
const src = read('src/lib/errorReporting.ts');
check('10 the last fatal error is remembered and shown on the next launch, and the handler is put back if something replaced it', /rememberError\(/.test(src) && /showLastErrorIfAny/.test(src) && /ensureGlobalErrorHandler/.test(src) && /showLastErrorIfAny\(\)/.test(read('app/_layout.tsx')) && /ensureGlobalErrorHandler\(\)/.test(read('app/_layout.tsx')));
check('11 a breadcrumb before a risky step is wiped 8 seconds later if the app lives, and shown on the next launch if it died', /export function markStep/.test(src) && /STEP_TTL_MS = 8000/.test(src) && /It closed right after: /.test(src));
check('12 a story or highlight closes before it opens a project or reel, with a breadcrumb first', /markStep\(what\);\s*goBack\(\);\s*setTimeout\(\(\) => router\.push\(href as any\), 150\)/.test(read('app/weather/work-story.tsx')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
