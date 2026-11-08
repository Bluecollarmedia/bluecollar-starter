// Loads the REAL full schema (supabase/schema.sql) and every numbered update in order into an in-process Postgres (PGlite),
// with small stand-ins for Supabase-only pieces (auth, storage, vault). Used by tests that need the real tables and rules.
// NOT real Supabase: no real auth service, storage engine or network.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';

export async function buildFullSchema(repo, { upTo, extensions } = {}) {
  const db = new PGlite(extensions ? { extensions } : undefined);   // extensions: optional, e.g. { pgcrypto } for tests that need crypt()
  const failures = [];
  const read = (p) => fs.readFileSync(path.join(repo, p), 'utf8');
  const run = async (name, sql) => { try { await db.exec(sql); } catch (e) { failures.push([name, String(e.message).slice(0, 200)]); } };
  await run('stubs', read('supabase/tests/supabase_stubs.sql'));
  await run('storage.foldername', `create function storage.foldername(name text) returns text[] language sql immutable as $$
    select coalesce((string_to_array(name, '/'))[1:greatest(coalesce(array_length(string_to_array(name, '/'), 1), 1) - 1, 0)], '{}') $$;`);
  await run('schema.sql', read('supabase/schema.sql'));
  const files = fs.readdirSync(path.join(repo, 'supabase/updates')).filter((f) => /^\d+.*\.sql$/.test(f) && !f.startsWith('reset')).sort();
  for (const f of files) {
    if (upTo && parseInt(f, 10) > upTo) continue;
    let sql = read(`supabase/updates/${f}`);
    if (f.startsWith('006')) sql = sql.split('\n').filter((l) => !l.includes('supabase_vault')).join('\n');
    await run(f, sql);
  }
  return { db, failures };
}
