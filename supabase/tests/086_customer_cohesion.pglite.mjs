// End to end: ONE customer record, ONE link. Snow, maintenance and landscaping all hang off the same customer, so once they sign up with
// their link everything is already in their portal, and anything added later shows up without any new code or link.
import { buildFullSchema } from './helpers/fullSchema.mjs';

const repo = process.argv[2];
const { db, failures } = await buildFullSchema(repo);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  - ' + String(detail).slice(0, 300)}`); };
check('0 the full schema and all updates load', failures.length === 0, JSON.stringify(failures));

const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const asUser = async (u) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${u}', false); set role authenticated;`); };
const asDb = async () => { await db.exec('reset role'); };
const rpc = async (u, sql, p) => { await asUser(u); try { const r = await db.query(sql, p); return { ok: true, v: Object.values(r.rows[0] ?? {})[0], rows: r.rows }; } catch (e) { return { ok: false, msg: String(e.message) }; } finally { await asDb(); } };
const signUp = async (email, meta) => {
  const u = (await one(`insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`, [email, JSON.stringify(meta)])).id;
  const pid = (await one(`select id from public.people where user_id = $1`, [u])).id;
  return { u, pid };
};
const countAs = async (u, sql) => { const r = await rpc(u, `select count(*)::int as x from ${sql}`); return r.ok ? r.v : `ERR ${r.msg}`; };

const owner = await signUp('o@x.test', { first_name: 'Owner', last_name: 'O', company_name: 'Acme' });
const co = (await one(`select company_id from public.company_members where person_id = $1 and role = 'owner'`, [owner.pid])).company_id;

// 1. The owner adds ONE customer (no login yet) and gives them a Snow property, a maintenance property and a project.
const cust = (await rpc(owner.u, `select public.add_customer('Cathy', 'Client', 'cathy@x.test', '7325550404') as x`)).v.person_id;
const home = (await rpc(owner.u, `select public.ensure_property($1::uuid, 'Cathy Home', '12 Elm St', 'Lakewood', 'NJ', '08701') as x`, [cust])).v;
const homeId = home.id ?? home.property_id;
check('1 the property is entered once and belongs to the customer', !!homeId && (await one(`select customer_id from public.properties where id = $1`, [homeId])).customer_id === cust, JSON.stringify(home));
const snowOn = await rpc(owner.u, `select public.snow_enable_for_property($1::uuid) as x`, [homeId]);
check('2 Snow turns on for that same property, linked to the same customer (nothing retyped)', snowOn.ok, snowOn.msg);
const snowProp = await one(`select sp.id, sp.property_id from public.snow_properties sp where sp.property_id = $1`, [homeId]);
const contact = await one(`select person_id from public.snow_property_contacts where property_id = $1 and removed_at is null`, [snowProp?.id]);
check('3 the Snow property\'s customer is that same person', contact?.person_id === cust, JSON.stringify(contact));
await db.query(`insert into public.projects (company_id, name, customer_id, property_id, status) values ($1,'Patio',$2,$3,'active')`, [co, cust, homeId]);
await db.query(`insert into public.maintenance_properties (company_id, name, customer_id, property_id, is_active) values ($1,'Cathy Home lawn',$2,$3,true)`, [co, cust, homeId]);

// 2. One link. The customer signs up with it.
const link = (await rpc(owner.u, `select public.invite_send($1::uuid) as x`, [cust]));
check('4 the owner makes the customer ONE link (from the customer, not from a project)', link.ok && typeof link.v.token === 'string', link.msg);
const cathy = await signUp('some.other.email@x.test', { first_name: 'Katherine', last_name: 'Clientele', invite_token: link.v.token });
check('5 signing up with the link attaches the login to that same customer, even with a different email', cathy.pid === cust, `${cathy.pid} vs ${cust}`);
const row = await one(`select first_name, last_name, email from public.people where id = $1`, [cust]);
check('6 the name the owner typed stays; the email on file is the one they signed up with', row.first_name === 'Cathy' && row.last_name === 'Client' && row.email === 'some.other.email@x.test', JSON.stringify(row));

// 3. Everything is in the portal at once.
check('7 she sees her Snow property', (await countAs(cathy.u, 'public.snow_my_properties()')) === 1);
check('8 she sees her maintenance property', (await countAs(cathy.u, 'public.maintenance_my_properties()')) === 1);
check('9 she sees her project', (await countAs(cathy.u, 'public.projects')) === 1);

// 4. Someone else's things never show up for her.
const other = (await rpc(owner.u, `select public.add_customer('Dan', 'Dealer', 'dan@x.test', '7325550606') as x`)).v.person_id;
const danHome = (await rpc(owner.u, `select public.ensure_property($1::uuid, 'Dan Home', '9 Oak Ave', 'Lakewood', 'NJ', '08701') as x`, [other])).v;
await rpc(owner.u, `select public.snow_enable_for_property($1::uuid) as x`, [danHome.id ?? danHome.property_id]);
await db.query(`insert into public.projects (company_id, name, customer_id, property_id, status) values ($1,'Dan job',$2,$3,'active')`, [co, other, danHome.id ?? danHome.property_id]);
check('10 another customer\'s Snow property and project stay invisible to her', (await countAs(cathy.u, 'public.snow_my_properties()')) === 1 && (await countAs(cathy.u, 'public.projects')) === 1);

// 5. Things added AFTER she joined show up with no new code or link.
await db.query(`insert into public.projects (company_id, name, customer_id, property_id, status) values ($1,'Tree removal',$2,$3,'active')`, [co, cust, homeId]);
const lot = (await rpc(owner.u, `select public.ensure_property($1::uuid, 'Cathy Rental', '4 Pine Rd', 'Lakewood', 'NJ', '08701') as x`, [cust])).v;
const lotId = lot.id ?? lot.property_id;
await rpc(owner.u, `select public.snow_enable_for_property($1::uuid) as x`, [lotId]);
await db.query(`insert into public.maintenance_properties (company_id, name, customer_id, property_id, is_active) values ($1,'Cathy Rental lawn',$2,$3,true)`, [co, cust, lotId]);
check('11 a second project added later is there', (await countAs(cathy.u, 'public.projects')) === 2);
check('12 a second Snow property added later is there', (await countAs(cathy.u, 'public.snow_my_properties()')) === 2);
check('13 maintenance added to a Snow property later is there too', (await countAs(cathy.u, 'public.maintenance_my_properties()')) === 2);

// 6. No project codes, no second link needed.
const codeFns = await one(`select count(*)::int c from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public' where p.proname in ('claim_project', 'lookup_project_code', 'join_with_code')`);
check('14 there are no project codes: the code functions do not exist (after update 85 they are dropped)', codeFns.c === 0, String(codeFns.c));
const links = await one(`select count(*)::int c from public.invites where person_id = $1`, [cust]);
check('15 exactly one link was ever made for this customer', links.c === 1, String(links.c));

console.log(results.every(Boolean) ? '\nall passed' : '\nsome failed');
process.exit(results.every(Boolean) ? 0 : 1);
