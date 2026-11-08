// Run: node scripts/checks/friendlyServerErrors.check.cjs <path to typescript package>
// A Cloudflare/HTML error page from the server becomes one plain sentence; normal answers pass through untouched.
const ts = require(process.argv[2] || 'typescript');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../src/lib/supabase.ts'), 'utf8');
const m = src.match(/const SERVER_DOWN[\s\S]*?\r?\n}\r?\n/);
const js = ts.transpileModule(m[0].replace('export async function', 'async function') + '\nmodule.exports = friendlyFetch;', { compilerOptions: { module: 'commonjs' } }).outputText;
let bad = 0;
const check = (n, ok) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); };
(async () => {
  const run = (res) => { const mod = { exports: {} }; new Function('module', 'fetch', 'Response', js)(mod, async () => res, Response); return mod.exports('x'); };
  const html = await run(new Response('<!doctype html><title>DNS resolution error</title>', { status: 530, headers: { 'content-type': 'text/html; charset=UTF-8' } }));
  const body = await html.json();
  check('1 an HTML error page becomes one plain sentence, same status', html.status === 530 && /Can't reach the server/.test(body.message) && !/doctype|html/i.test(body.message));
  const ok = await run(new Response('{"a":1}', { status: 200, headers: { 'content-type': 'text/html' } }));
  check('2 a successful answer is never touched', ok.status === 200 && (await ok.text()) === '{"a":1}');
  const json = await run(new Response('{"message":"nope"}', { status: 400, headers: { 'content-type': 'application/json' } }));
  check('3 a normal JSON error passes through unchanged', (await json.json()).message === 'nope');
  check('4 the client uses it', /global: \{ fetch: friendlyFetch \}/.test(src));
  console.log(bad ? `\n${bad} failed` : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
