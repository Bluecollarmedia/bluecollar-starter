// Shared helper for the checks (not a check itself: the runner runs only *.check.cjs).
// Reads supabase/setup.sql, the ONE file that builds the database, and cuts out the final definition of a piece of it,
// so a check can assert on exactly the function, table, rule or grant it cares about.
//   setup             the whole of setup.sql
//   fn(name)          every `create or replace function public.<name>(...)` in it, joined (all overloads); '' if none
//   hasFn(name)       true when setup.sql defines public.<name>
//   fnNames()         the names of every public function setup.sql defines
//   table(name)       the `create table if not exists public.<name> (...)` block; '' if none
//   policies(name)    every `create policy ... on public.<name> ...;` statement, joined
//   grants(name)      every revoke/grant line on public.<name> (function or table), joined
//   triggers(name)    every `create trigger ... on public.<name> ...;` line, joined
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const setup = fs.readFileSync(path.join(root, 'supabase/setup.sql'), 'utf8');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function fn(name) {
  const re = new RegExp(`^create or replace function public\\.${esc(name)}\\([\\s\\S]*?^\\$function\\$;`, 'gm');
  return (setup.match(re) || []).join('\n');
}
const hasFn = (name) => fn(name) !== '';
const fnNames = () => [...new Set([...setup.matchAll(/^create or replace function public\.([a-z0-9_]+)\(/gm)].map((m) => m[1]))];

function table(name) {
  const m = setup.match(new RegExp(`^create table if not exists public\\.${esc(name)} \\([\\s\\S]*?^\\);`, 'm'));
  return m ? m[0] : '';
}
const statements = (re) => (setup.match(re) || []).join('\n');
const policies = (name) => statements(new RegExp(`^create policy \\S+ on public\\.${esc(name)} [\\s\\S]*?;\\s*$`, 'gm'));
const grants = (name) => statements(new RegExp(`^(?:revoke|grant) [^\\n]* on (?:function|table) public\\.${esc(name)}\\b[^\\n]*$`, 'gm'));
const triggers = (name) => statements(new RegExp(`^create trigger [^\\n]* ON public\\.${esc(name)} [^\\n]*$`, 'gmi'));
/** The roles a `grant ... on function|table public.<name>` line gives access to (every overload / line), e.g. ['authenticated', 'service_role']. */
const grantedTo = (name) => [...new Set(grants(name).split('\n').filter((l) => l.startsWith('grant '))
  .flatMap((l) => (l.match(/ to ([^;]+);/) || ['', ''])[1].split(',').map((r) => r.trim()).filter(Boolean)))];

/** True when the table has row rules and EVERY one of them is limited to the company owner (is_company_owner), with no wider helper. */
function ownerOnly(name) {
  const rules = policies(name).split(/\n(?=create policy )/).filter(Boolean);
  return rules.length > 0 && rules.every((r) => /public\.is_company_owner\(company_id\)/.test(r)
    && !/is_crew|is_staff|is_member|is_project_customer|member_role|\(true\)/.test(r));
}

module.exports = { root, setup, fn, hasFn, fnNames, table, policies, grants, grantedTo, triggers, ownerOnly };
