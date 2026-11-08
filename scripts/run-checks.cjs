// Runs every scripts/checks/*.check.cjs in its own Node process and prints one PASS/FAIL line per file and a total.
// Pass/fail comes from each check's exit code (0 = pass), never from what it prints.
// Run: npm run check            (or: node scripts/run-checks.cjs [part-of-a-name] [--verbose])
// `npm run verify` = typecheck + these checks + the database tests. The typecheck needs FRESH Expo Router types in .expo/types:
// after adding, renaming or removing a screen, delete .expo/types and start Expo once (`npx expo start`, then stop it).
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(__dirname, 'checks');
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const only = args.find((a) => !a.startsWith('--'));

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.check.cjs') && (!only || f.includes(only))).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const ok = r.status === 0 && !r.error && !r.signal;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${f}`);
  if (!ok || verbose) {
    const out = `${r.stdout || ''}${r.stderr || ''}${r.error ? String(r.error) : ''}`.trim();
    if (out) console.log(out.split('\n').map((l) => `      ${l}`).join('\n'));
  }
}
console.log(`\n${files.length} checks, ${files.length - failed} passed, ${failed} failed`);
process.exit(failed || !files.length ? 1 : 0);
