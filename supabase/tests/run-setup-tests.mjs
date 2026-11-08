// Database tests for supabase/setup.sql and supabase/demo_data.sql.   Run: npm run test:db
// Each file in supabase/tests/setup/*.test.mjs gets its own fresh in-process Postgres (PGlite) with small Supabase stand-ins
// (supabase/tests/helpers/supabase_setup_stubs.sql), loads setup.sql (and demo_data.sql where needed) and checks the rules.
// NOT real Supabase: the real login service, storage engine, Vault encryption, pg_net and Realtime are stand-ins here.
// Exit code 0 = every check passed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reporter } from './helpers/setupDb.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'setup');
const only = process.argv[2];
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs') && (!only || f.includes(only))).sort();
let pass = 0; let fail = 0;
for (const f of files) {
  const r = reporter(f);
  try {
    const mod = await import(pathToFileURL(path.join(dir, f)).href);
    await mod.default({ check: r.check });
  } catch (e) {
    r.check(`${f} ran to the end`, false, e.stack || e.message);
  }
  const d = r.done();
  pass += d.pass; fail += d.fail;
}
console.log(`\n${files.length} test files, ${pass} passed, ${fail} failed`);
process.exit(fail || !files.length ? 1 : 0);
