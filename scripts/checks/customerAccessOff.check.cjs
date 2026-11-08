// Run: node scripts/checks/customerAccessOff.check.cjs
// A customer whose access was turned off must not read their old jobs (or anything on them). Every row rule that lets a customer
// read a job-related row must also require an ACTIVE membership: either is_project_customer() (which checks is_member) or an
// explicit public.is_member(company_id) next to the customer_id / customer_claimed_by match.
// Tested for real in supabase/tests/setup/13_leftovers.test.mjs (deactivated customer reads 0 jobs and 0 related rows).
const sql = require('./_sql.cjs');
let bad = 0;
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  - ' + d}`); };

const all = (sql.setup.match(/^create policy [\s\S]*?;\s*$/gm) || []).map((p) => p.replace(/\s+/g, ' '));
const direct = all.filter((p) => /\b(customer_id|customer_claimed_by) = public\.my_person_id\(\)/.test(p));
check('1 every row rule that matches a customer directly (customer_id / customer_claimed_by) also requires an active membership (is_member)',
  direct.length > 0 && direct.every((p) => /public\.is_member\(company_id\)/.test(p)), direct.filter((p) => !/is_member/.test(p)).join(' || '));
check('2 projects_select: the customer branch requires is_member(company_id)', /customer_claimed_by = public\.my_person_id\(\)\)\) AND public\.is_member\(company_id\)/.test(sql.policies('projects').replace(/\s+/g, ' ')));
const ipc = sql.fn('is_project_customer');
check('3 is_project_customer (used by tasks, photos, messages, updates, quotes, invoices, change orders, timeline, history, requests, settings, team) checks is_member',
  /public\.is_member\(p\.company_id\)/.test(ipc));
const customerBranches = all.filter((p) => /is_project_customer/.test(p));
check('4 those job-related tables read through is_project_customer', ['project_tasks', 'project_photos', 'project_messages', 'project_updates', 'quotes', 'invoices', 'change_orders', 'customer_timeline']
  .every((t) => customerBranches.some((p) => p.includes(`on public.${t} `))));
const memberRole = sql.fn('member_role');
check('5 is_member counts only ACTIVE memberships (status = active)', /status = 'active'/.test(memberRole) && /public\.member_role\(cid\) is not null/.test(sql.fn('is_member')));
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
