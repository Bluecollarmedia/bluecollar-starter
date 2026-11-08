// setup.sql on a brand-new database: loads, loads again, nothing landscape-only left, grants and switches as intended.
import { freshDb, read } from '../helpers/setupDb.mjs';

export default async function run({ check }) {
  let h;
  try { h = await freshDb({ setupRuns: 1 }); check('1 setup.sql runs top to bottom on a new database without an error', true); }
  catch (e) { check('1 setup.sql runs top to bottom on a new database without an error', false, e.message); return; }
  const { db, one, all, as } = h;

  let again = true; let msg = '';
  try { await db.exec(read('supabase/setup.sql')); } catch (e) { again = false; msg = e.message; }
  check('2 running setup.sql a second time is safe (no error)', again, msg);

  const counts = await one(`select
      (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r') tables,
      (select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace) functions,
      (select count(*)::int from pg_policies where schemaname = 'public') policies,
      (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname = 'public') triggers`);
  console.log('      (setup.sql made', JSON.stringify(counts) + ')');
  check('3 the database has its tables, functions, rules and triggers', counts.tables >= 80 && counts.functions >= 150 && counts.policies >= 150 && counts.triggers >= 100, JSON.stringify(counts));

  const bad = '(snow|portfolio|storm_outlook|maintenance_|worker_type|works_landscaping|works_maintenance|is_maintenance|crew_level|customer_project_code|active_mode|route_id|brighton)';
  // (truck_maintenance = truck service records: a kept feature, not lawn maintenance.)
  const leftoversAll = await all(`
    select 'table ' || c.relname x from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname ~ $1
    union all select 'column ' || c.relname || '.' || a.attname from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped and a.attname ~ $1
    union all select 'function ' || p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname ~ $1 or p.prosrc ~* $1)
    union all select 'policy ' || policyname from pg_policies where policyname ~ $1 or coalesce(qual, '') ~ $1 or coalesce(with_check, '') ~ $1
    union all select 'trigger ' || tgname from pg_trigger where tgname ~ $1
    union all select 'bucket ' || id from storage.buckets where id ~ $1`, [bad]);
  const leftovers = leftoversAll.filter((r) => new RegExp(bad).test(r.x.replace(/truck_maintenance/g, '')));
  check('4 nothing from Snow, lawn maintenance, crew routes, Our Work or storm outlooks is left (tables, columns, functions, rules, triggers, buckets)', leftovers.length === 0, JSON.stringify(leftovers));
  const text = read('supabase/setup.sql');
  check('5 setup.sql never names Brighton and needs no pg_cron', !/brighton/i.test(text) && !/cron\./i.test(text));
  check('6 the column defaults asked for: crews are #2B2B2B, the public weather switch is OFF, a company time zone exists',
    (await one(`select column_default d from information_schema.columns where table_name = 'crews' and column_name = 'color'`)).d.includes('#2B2B2B')
    && (await one(`select column_default d from information_schema.columns where table_name = 'public_weather_settings' and column_name = 'enabled'`)).d === 'false'
    && (await one(`select column_default d from information_schema.columns where table_name = 'time_settings' and column_name = 'timezone'`)).d.includes('America/New_York'));

  const noRls = await all(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
  check('7 every table has row level security switched on', noRls.length === 0, JSON.stringify(noRls));

  // Internal helpers (names starting with _) and trigger functions cannot be called from the app. A helper keeps its rights only when
  // a security rule or a function that runs with the caller's own rights uses it.
  const fl = await all(`select p.proname, p.prosecdef, p.prosrc, pg_get_function_result(p.oid) res,
      has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') callable
    from pg_proc p where p.pronamespace = 'public'::regnamespace`);
  const polText = (await all(`select coalesce(qual,'') || ' ' || coalesce(with_check,'') e from pg_policies`)).map((r) => r.e).join(' ');
  const needed = (f) => { const re = new RegExp(`\\b${f.proname}\\s*\\(`); return re.test(polText) || fl.some((g) => g.proname !== f.proname && !g.prosecdef && re.test(g.prosrc)); };
  const openHelpers = fl.filter((f) => f.callable && (f.res === 'trigger' || (f.proname.startsWith('_') && !needed(f)))).map((f) => f.proname);
  check('8 trigger functions and internal helpers (names starting with _) cannot be called by the app, unless a security rule needs them', openHelpers.length === 0, JSON.stringify(openHelpers));
  const anonOk = (await all(`select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute') order by 1`)).map((r) => r.proname);
  const publicFns = ['company_slot_open', 'get_shared_document', 'invite_lookup', 'public_weather_config', 'respond_by_link', 'submit_service_request'];
  const actions = ['delete_my_company', 'add_worker', 'add_customer', 'invite_send', 'time_clock_in', 'time_clock_out', 'set_admin_permissions', 'reactivate_member',
    'deactivate_member', 'send_customer_announcement', 'set_public_weather_enabled', 'team_access_overview', 'delete_unused_member', 'list_accounts', 'set_member_role'];
  check('9 signed-out visitors can call the public functions (request form, invite page, quote approval, weather switch), but none of the team, time clock or company actions',
    publicFns.every((f) => anonOk.includes(f)) && !actions.some((f) => anonOk.includes(f)), JSON.stringify(anonOk));
  check('10 old email-matching helper _accept_invitations exists but nobody in the app can call it', !(await as(null, `select public._accept_invitations(gen_random_uuid())`)).ok);

  const s = await one(`select value from public.app_settings where key = 'functions_url'`);
  check('11 FILL IN: functions_url starts as the placeholder, and the app roles cannot read app_settings', /YOUR-PROJECT-REF/.test(s.value)
    && (await as(null, `select count(*)::int n from public.app_settings`)).v !== 1);
  const b = await one(`select * from storage.buckets where id = 'media'`);
  check('12 the old "media" bucket exists and is private', b && b.public === false);
  const pub = await one(`select count(*)::int n from pg_publication_tables where pubname = 'supabase_realtime'`);
  check('13 the app\'s tables are on the live-update (Realtime) list', pub.n >= 40, pub.n);
  const fns = (await all(`select proname from pg_proc where pronamespace = 'public'::regnamespace`)).map((r) => r.proname);
  check('14 the code-generating project-code functions and the project code column are gone',
    !fns.some((f) => /project_code|lookup_.*code|_random_code/.test(f))
    && !(await one(`select count(*)::int n from information_schema.columns where table_name = 'projects' and column_name like '%code%'`)).n);
  const sig = (await all(`select pg_get_function_identity_arguments(p.oid) a from pg_proc p where proname = 'set_admin_permissions'`)).map((r) => r.a);
  check('15 set_admin_permissions has no Snow argument', sig.length === 1 && !/snow/.test(sig[0]), JSON.stringify(sig));

  // setup.sql turns body checking off so the order of functions does not matter. Here every function is made again
  // WITH checking on: SQL bodies must name only things that exist, plpgsql bodies must at least be valid plpgsql.
  const sqlFns = await all(`select p.proname, pg_get_functiondef(p.oid) d from pg_proc p where p.pronamespace = 'public'::regnamespace
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`);
  const broken = [];
  await db.exec(`set check_function_bodies = on`);
  for (const f of sqlFns) { try { await db.exec(f.d); } catch (e) { broken.push(`${f.proname}: ${e.message}`); } }
  check(`16 every function (${sqlFns.length}) passes the body check (SQL ones only name things that exist)`, sqlFns.length > 150 && broken.length === 0, JSON.stringify(broken));
  // plpgsql bodies are only checked when they run; scan them for tables that do not exist.
  const tables = new Set((await all(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','v')`)).map((r) => r.relname));
  const plp = await all(`select p.proname, p.prosrc from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prolang = (select oid from pg_language where lanname = 'plpgsql')`);
  const missing = [];
  for (const f of plp) for (const m of f.prosrc.matchAll(/\b(?:from|join|into|update|table)\s+public\.([a-z_0-9]+)\b(?!\s*\()/gi)) if (!tables.has(m[1])) missing.push(`${f.proname}: ${m[1]}`);
  check('17 no plpgsql function reads or writes a table that does not exist', missing.length === 0, JSON.stringify([...new Set(missing)]));
}
