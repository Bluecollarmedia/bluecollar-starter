// A fresh in-process Postgres (PGlite) with small Supabase stand-ins, loaded with supabase/setup.sql (and, if asked, demo_data.sql).
// NOT real Supabase: no real auth service, storage engine, Vault encryption, pg_net, pg_cron or Realtime.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
export const TEST_DEMO_PASSWORD = 'Test-Demo-Password-123';

/** demo_data.sql with the password line filled in (the file itself ships with CHANGE-ME and refuses to run). */
export function demoSql(password = TEST_DEMO_PASSWORD) {
  const sql = read('supabase/demo_data.sql');
  const re = /^  demo_password text := 'CHANGE-ME';/m;
  if (!re.test(sql)) throw new Error('demo_data.sql: the CHANGE-ME password line was not found');
  return sql.replace(re, `  demo_password text := '${password}';`);
}

export async function freshDb({ demo = false, setupRuns = 1 } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(read('supabase/tests/helpers/supabase_setup_stubs.sql'));
  for (let i = 0; i < setupRuns; i++) await db.exec(read('supabase/setup.sql'));
  if (demo) await db.exec(demoSql());
  return withHelpers(db);
}

export function withHelpers(db) {
  const one = async (sql, p) => (await db.query(sql, p)).rows[0];
  const all = async (sql, p) => (await db.query(sql, p)).rows;
  const asDb = async () => { await db.exec('reset role'); };
  const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
  const asAnon = async () => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;`); };
  /** Runs one statement as a signed-in user (u = auth user id), as a signed-out visitor (u = null), and returns {ok, v, rows, msg}. */
  const as = async (u, sql, p) => {
    if (u) await asUser(u); else await asAnon();
    try { const r = await db.query(sql, p); return { ok: true, rows: r.rows, v: Object.values(r.rows[0] ?? {})[0] }; }
    catch (e) { return { ok: false, msg: String(e.message) }; }
    finally { await asDb(); }
  };
  /** A sign-up through the real sign-up trigger (auth.users insert), with the app's metadata. */
  const signUp = async (email, meta = {}) => {
    const u = (await one(`insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`, [email, JSON.stringify(meta)])).id;
    const person = await one(`select * from public.people where user_id = $1`, [u]);
    return { u, pid: person?.id, person };
  };
  /** Allows a second company in this test database (the app allows one per database). */
  const extraCompany = async (name) => {
    await db.exec(`select set_config('app.allow_company_create', 'on', false)`);
    const id = (await one(`insert into public.companies (name) values ($1) returning id`, [name])).id;
    await db.exec(`select set_config('app.allow_company_create', '', false)`);
    return id;
  };
  /** Owner + company the way the app does it: a sign-up carrying company_name. */
  const ownerWithCompany = async (email = 'owner@example.com', company = 'Test Co') => {
    const s = await signUp(email, { first_name: 'Olive', last_name: 'Owner', company_name: company });
    const cid = (await one(`select company_id from public.company_members where person_id = $1 and role = 'owner'`, [s.pid])).company_id;
    return { ...s, cid };
  };
  /** A person with a login who is a member of a company (added directly, as the database would after an invite). */
  const member = async (cid, email, role, first = 'Pat') => {
    const s = await signUp(email, { first_name: first, last_name: 'Test' });
    await db.query(`insert into public.company_members (company_id, person_id, role, status, join_method) values ($1, $2, $3, 'active', 'invitation_link')`, [cid, s.pid, role]);
    return s;
  };
  return { db, one, all, as, asDb, asUser, asAnon, signUp, extraCompany, ownerWithCompany, member };
}

/** A tiny test reporter: check(name, ok, detail). */
export function reporter(title) {
  let pass = 0; let fail = 0;
  console.log(`\n== ${title}`);
  const check = (name, ok, detail = '') => {
    if (ok) pass += 1; else fail += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 400)}`);
  };
  return { check, done: () => ({ pass, fail }) };
}
