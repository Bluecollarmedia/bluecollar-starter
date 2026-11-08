// Run: mkdir /tmp/pg && cd /tmp/pg && npm i @electric-sql/pglite && copy this file (and ./helpers/fullSchema.mjs) beside it, then:
//   node <file> <path to the repo>
// Proves update 54 on the REAL full schema + every update (PGlite, not real Supabase): a customer with only the approval link
// can approve with a drawn signature (saved and readable through get_shared_document), the signature must be plain path text,
// declining ("Request changes") keeps its note, and the old rules (name required, only sent documents) still hold.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 240)}`); };
check('0 the full schema and all updates (including 054) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/054_quote_signature.sql`, 'utf8')); } catch (e) { again = false; }
check('0b update 54 can be run a second time', again);
const one = async (sql, p) => (await db.query(sql, p)).rows[0];

const co = (await one(`insert into public.companies (name) values ('Test Co') returning id`)).id;
const proj = (await one(`insert into public.projects (company_id, name) values ($1, 'Wyndham 2') returning id`, [co])).id;
let n = 0;
const quote = async (status = 'sent') => {
  await db.exec(`reset role`);
  n++;
  const token = `tok${String(n).padStart(2, '0')}` + 'x'.repeat(40);
  const id = (await one(`insert into public.quotes (company_id, project_id, number, status, total, share_token, sent_at) values ($1, $2, $3, $4, 100, $5, now()) returning id`, [co, proj, `Q-${n}`, status, token])).id;
  return { id, token };
};

await db.exec(`reset role; set role anon`);
const SIG = 'M 10 20 L 30 40 L 55.5 60 M 70 80 L 90 100';

let q = await quote();
let r = (await one(`select public.respond_by_link($1, true, 'Eli Semah', null, $2) r`, [q.token, SIG])).r;
await db.exec(`reset role`);
let row = await one(`select status, approved_name, approved_signature from public.quotes where id = $1`, [q.id]);
check('1 approving with a drawn signature works and saves it', r.success === true && row.status === 'approved' && row.approved_name === 'Eli Semah' && row.approved_signature === SIG, JSON.stringify({ r, row }));

await db.exec(`set role anon`);
const shared = (await one(`select public.get_shared_document($1) d`, [q.token])).d;
check('2 the shared document returns the signature to whoever holds the link', shared?.document?.approved_signature === SIG, JSON.stringify(shared?.document?.approved_signature));

q = await quote();
r = (await one(`select public.respond_by_link($1, true, 'Eli Semah', null, $2) r`, [q.token, `M 0 0 L 1 1"><script>alert(1)</script>`])).r;
await db.exec(`reset role`);
row = await one(`select status, approved_signature from public.quotes where id = $1`, [q.id]);
check('3 a signature with anything but path text is refused and nothing is approved', r.success === false && r.error === 'bad_signature' && row.status === 'sent' && row.approved_signature === null, JSON.stringify({ r, row }));

q = await quote();
await db.exec(`set role anon`);
r = (await one(`select public.respond_by_link($1, true, 'Eli Semah', null, $2) r`, [q.token, 'M 1 1 ' + 'L 1 1 '.repeat(4000)])).r;
check('4 an oversized signature is refused', r.success === false && r.error === 'bad_signature', JSON.stringify(r));

r = (await one(`select public.respond_by_link($1, true, 'E', null, $2) r`, [q.token, SIG])).r;
check('5 a name is still required to approve', r.success === false && r.error === 'name_required', JSON.stringify(r));

r = (await one(`select public.respond_by_link($1, false, null, 'Please add the back yard', null) r`, [q.token])).r;
await db.exec(`reset role`);
row = await one(`select status, decline_reason, approved_signature from public.quotes where id = $1`, [q.id]);
check('6 "Request changes" (decline) keeps the customer\'s note and needs no signature', r.success === true && row.status === 'declined' && row.decline_reason === 'Please add the back yard' && row.approved_signature === null, JSON.stringify({ r, row }));

await db.exec(`set role anon`);
r = (await one(`select public.respond_by_link($1, true, 'Eli Semah', null, $2) r`, [q.token, SIG])).r;
check('7 an already-answered quote can\'t be answered again', r.success === false && r.error === 'not_open', JSON.stringify(r));

q = await quote();
r = (await one(`select public.respond_by_link($1, true, 'Eli Semah') r`, [q.token])).r;
await db.exec(`reset role`);
row = await one(`select status, approved_signature from public.quotes where id = $1`, [q.id]);
check('8 an older website with no signature still works (signature is optional in the database)', r.success === true && row.status === 'approved' && row.approved_signature === null, JSON.stringify({ r, row }));

const draft = await quote('draft');
await db.exec(`set role anon`);
r = (await one(`select public.respond_by_link($1, true, 'Eli Semah', null, $2) r`, [draft.token, SIG])).r;
check('9 a draft can\'t be approved', r.success === false, JSON.stringify(r));
r = (await one(`select public.respond_by_link('short', true, 'Eli Semah', null, $1) r`, [SIG])).r;
check('10 a made-up link opens nothing', r.success === false && r.error === 'not_found', JSON.stringify(r));

await db.exec('reset role');
console.log(results.every(Boolean) ? '\nall passed' : `\n${results.filter((x) => !x).length} failed`);
process.exit(results.every(Boolean) ? 0 : 1);
