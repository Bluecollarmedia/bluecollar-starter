// Finds old code/request-era functions that NOTHING live still uses, so they can be dropped safely.
// Run: node deadcode.mjs C:/lw-build   (prints the safe set, in drop order, and what keeps the others alive)
import fs from 'node:fs';
import path from 'node:path';
import { buildFullSchema } from './fullSchema.mjs';
const repo = process.argv[2];
const { db } = await buildFullSchema(repo);
const q = async (sql, p) => (await db.query(sql, p)).rows;

const CANDIDATES = [
  'approve_join_request', 'decline_join_request', 'request_join', 'join_with_code', 'lookup_any_code', 'lookup_team_code',
  'lookup_project_code', 'lookup_snow_code', 'claim_project', 'regenerate_project_code', 'regenerate_maintenance_code',
  'regenerate_snow_signup_code', 'disable_snow_signup_code', 'request_snow_access', 'approve_snow_access_request',
  'decline_snow_access_request', 'remove_snow_access_request', 'list_snow_access_requests', 'withdraw_my_snow_request',
  '_request_join', '_request_snow_access', '_claim_project', '_claim_maintenance', '_new_customer_code', '_maintenance_property_code',
  '_random_code', '_join_requests_guard', '_guard_requested_worker_type', 'handle_new_user_snow', 'regenerate_maintenance_code',
];

const all = await q(`select p.oid, p.proname as name, pg_get_function_identity_arguments(p.oid) as args, p.prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'`);
const byName = new Map();
for (const f of all) { if (!byName.has(f.name)) byName.set(f.name, []); byName.get(f.name).push(f); }
const triggers = await q(`select t.tgname, c.relname as tbl, p.proname as fn from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public' where not t.tgisinternal`);

// Client + edge function references (anything the app or an edge function can call by name)
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', '.git', '.expo'].includes(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name)) out.push(p); } return out; };
const clientFiles = [...walk(path.join(repo, 'src')), ...walk(path.join(repo, 'app')), ...walk(path.join(repo, 'supabase/functions'))].filter((f) => !/maintenanceCodes\.ts$/.test(f));
const clientText = clientFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

let dead = new Set(CANDIDATES.filter((n) => byName.has(n)));
let changed = true;
const why = {};
while (changed) {
  changed = false;
  for (const name of [...dead]) {
    const reasons = [];
    if (new RegExp(`['"\`.]${name}['"\`(]`).test(clientText)) reasons.push('the app or an edge function calls it');
    for (const f of all) {
      if (f.name === name || dead.has(f.name)) continue;
      if (new RegExp(`\\b${name}\\b`).test(f.src)) reasons.push(`function ${f.name}`);
    }
    for (const t of triggers) if (t.fn === name && !dead.has(t.fn)) reasons.push(`trigger ${t.tgname} on ${t.tbl}`);
    if (reasons.length) { dead.delete(name); why[name] = reasons; changed = true; }
  }
}
console.log('SAFE TO DROP (nothing live uses them):');
for (const n of dead) console.log('  ', n, byName.get(n).map((f) => `(${f.args})`).join(' '), triggers.filter((t) => t.fn === n).map((t) => `[trigger ${t.tgname} on ${t.tbl}]`).join(' '));
console.log('\nSTAY (something live still uses them):');
for (const [n, r] of Object.entries(why)) console.log('  ', n, '<-', [...new Set(r)].join('; '));
