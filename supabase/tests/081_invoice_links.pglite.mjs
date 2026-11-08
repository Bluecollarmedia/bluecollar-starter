// Update 81: an issued invoice has a private link like a quote: the public page can show it (read-only), drafts never show,
// and the link can never approve anything.
import fs from 'node:fs';
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates (including 81) load', failures.length === 0, JSON.stringify(failures));
let again = true;
try { await db.exec(fs.readFileSync(`${repo}/supabase/updates/081_invoice_links.sql`, 'utf8')); } catch (e) { again = false; console.log(e.message); }
check('0b update 81 can be run a second time', again);

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asAnon = async () => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;`); };
const asDb = async () => { await db.exec('reset role'); };
const anon = async (sql, p) => { await asAnon(); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0] }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };

const co = (await one(`insert into public.companies (name) values ('Acme') returning id`)).id;
const owner = (await one(`insert into auth.users (email) values ('o@x.test') returning id`)).id;
const pid = (await one(`select id from public.people where user_id = $1`, [owner])).id;
await db.query(`insert into public.company_members (company_id, person_id, role, status) values ($1,$2,'owner','active')`, [co, pid]);
const proj = (await one(`insert into public.projects (company_id, name, status) values ($1,'Oak job','active') returning id`, [co])).id;

const inv = await one(`insert into public.invoices (company_id, project_id, number, status, total, issued_at) values ($1,$2,'INV-1','issued',250,now()) returning id, share_token`, [co, proj]);
check('1 an invoice gets a private token on its own (no app change needed)', typeof inv.share_token === 'string' && inv.share_token.length >= 32, JSON.stringify(inv));
const draft = await one(`insert into public.invoices (company_id, project_id, number, status, total) values ($1,$2,'INV-2','draft',99) returning share_token`, [co, proj]);

let r = await anon(`select public.get_shared_document($1) as x`, [inv.share_token]);
check('2 the public page can show an issued invoice by its link, with the project name and no private columns', r.ok && r.v.kind === 'invoice' && r.v.document.number === 'INV-1' && r.v.project_name === 'Oak job' && !('created_by' in r.v.document), JSON.stringify(r).slice(0, 200));
check('3 a DRAFT invoice never shows, even with its token', (await anon(`select public.get_shared_document($1) as x`, [draft.share_token])).v === null);
r = await anon(`select public.respond_by_link($1, true, 'Sneaky Customer', null) as x`, [inv.share_token]);
check('4 the invoice link can never approve anything (respond_by_link does not know invoices)', !r.ok || r.v?.success === false || /not_found/.test(JSON.stringify(r.v)), JSON.stringify(r).slice(0, 160));
check('5 the invoice is untouched afterwards', (await one(`select status from public.invoices where id = $1`, [inv.id])).status === 'issued');

// quotes keep working exactly as before
const q = await one(`insert into public.quotes (company_id, project_id, number, status, total, sent_at, customer_id) values ($1,$2,'Q-1','sent',100,now(),null) returning share_token`, [co, proj]);
r = await anon(`select public.get_shared_document($1) as x`, [q.share_token]);
check('6 a sent quote still shows by its link', r.ok && r.v.kind === 'quote' && r.v.document.number === 'Q-1');
const inv3 = await one(`insert into public.invoices (company_id, project_id, quote_id, number, status, total, issued_at) values ($1,$2,(select id from public.quotes where number='Q-1'),'INV-3','issued',100,now()) returning share_token`, [co, proj]);
r = await anon(`select public.get_shared_document($1) as x`, [inv3.share_token]);
check('7 an invoice made from a quote names that quote on the page', r.ok && r.v.quote_number === 'Q-1', JSON.stringify(r.v).slice(0, 160));
check('8 every token is unique (the database refuses a copy)', !(await anon(`insert into public.invoices (company_id, project_id, number, status, total, share_token) values ('${co}','${proj}','INV-X','draft',1,'${inv.share_token}')`)).ok);

const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
