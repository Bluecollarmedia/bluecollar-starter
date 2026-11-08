// Run: node scripts/checks/oldCodesDropped.check.cjs
// The old code / request functions are not in the database (supabase/setup.sql), and nothing in the app or an edge function calls any of them.
const fs = require('fs');
const path = require('path');
const sql = require('./_sql.cjs');   // supabase/setup.sql, the one file that builds the database
const root = path.join(__dirname, '../..');
const walk = (d, out = []) => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (/\.(ts|tsx|js)$/.test(e.name)) out.push(p); } return out; };
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };

const dropped = ['approve_join_request', 'decline_join_request', 'request_join', 'join_with_code', 'lookup_any_code', 'lookup_team_code', 'lookup_project_code',
  'claim_project', 'regenerate_project_code', 'regenerate_maintenance_code', '_request_join', '_claim_project', '_join_requests_guard'];
const defined = dropped.filter((n) => sql.hasFn(n));
check('1 setup.sql defines none of the old code / join-request functions', defined.length === 0, defined.join(', '));
check('2 setup.sql does not grant or attach any of them either (no grant line, no trigger)', dropped.every((n) => sql.grants(n) === '' && !new RegExp(`EXECUTE FUNCTION public\\.${n}\\(`).test(sql.setup)));
const files = [...walk('src'), ...walk('app'), ...walk('supabase/functions')];
const text = files.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
const used = dropped.filter((n) => text.includes("'" + n + "'") || text.includes('"' + n + '"') || text.includes('`' + n + '`'));
check('3 the app and the edge functions call none of them', used.length === 0, used.join(', '));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
