-- ============================================================================
-- Snow access isolation tests (update 020). LOCAL TEST DATABASE ONLY: it
-- creates fake users (rolled back at the end). See README.md for how to run.
-- Prints "ok - ..." per check and stops at the first FAIL.
--
-- Cast: owner, landscaping-only worker, snow-only plower, snow-only shoveler,
-- dual-mode worker (landscaping + salting), pending applicant (no access yet),
-- revoked snow worker, landscaping customer.
-- ============================================================================
\set ON_ERROR_STOP 1
begin;

create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok - %', msg;
end $$;

-- Act as a signed-in user (or as nobody when uid is null).
create function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  perform set_config('role', case when uid is null then 'anon' else 'authenticated' end, true);
end $$;
create function pg_temp.as_admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- ── Seed ─────────────────────────────────────────────────────────────────────
create temp table cast_ids (who text primary key, uid uuid, pid uuid);
grant select on cast_ids to authenticated, anon;

do $$
declare
  w text;
  u uuid;
  p uuid;
begin
  foreach w in array array['owner','landscaper','plower','shoveler','dual','pending','revoked','customer'] loop
    insert into auth.users (email) values (w || '@snow.test') returning id into u;
    select id into p from public.people where user_id = u;
    if p is null then
      insert into public.people (user_id, email, first_name) values (u, w || '@snow.test', w) returning id into p;
    end if;
    insert into cast_ids values (w, u, p);
  end loop;
end $$;

-- The owner creates the company through the real function.
select pg_temp.as_user((select uid from cast_ids where who = 'owner'));
select public.create_company('{"name": "Brighton Test"}'::jsonb);
select pg_temp.as_admin();
create temp table co as select company_id as id from public.company_members
  where person_id = (select pid from cast_ids where who = 'owner');
grant select on co to authenticated, anon;

-- Landscaping memberships (as the existing approval flow would make them).
insert into public.company_members (company_id, person_id, role, status)
select (select id from co), pid, r, 'active'
from (values ('landscaper', 'worker'), ('dual', 'worker'), ('customer', 'customer')) v(w, r)
join cast_ids c on c.who = v.w;

-- Landscaping data a snow-only person must never see.
insert into public.projects (company_id, name)
  values ((select id from co), 'Smith backyard');
insert into public.project_tasks (company_id, project_id, title)
  select (select id from co), id, 'Lay sod' from public.projects;
insert into public.trucks (company_id, name) values ((select id from co), 'Truck 1');
insert into public.announcements (company_id, title, body, created_by)
  values ((select id from co), 'Crew meeting', 'Friday', (select pid from cast_ids where who = 'owner'));

-- Snow access granted by the owner through the real functions.
select pg_temp.as_user((select uid from cast_ids where who = 'owner'));
select public.snow_grant_access((select pid from cast_ids where who = 'plower'), array['plowing']);
select public.snow_grant_access((select pid from cast_ids where who = 'shoveler'), array['shoveling']);
select public.snow_grant_access((select pid from cast_ids where who = 'dual'), array['salting']);
select public.snow_grant_access((select pid from cast_ids where who = 'revoked'), array['plowing']);
select public.snow_revoke_access((select pid from cast_ids where who = 'revoked'));
-- 'pending' gets nothing: a signup request alone grants no access.

-- ── Snow-only workers see no landscaping data ───────────────────────────────
-- Every non-snow table in public, as each person. The snow-only plower and
-- shoveler, the pending applicant and the revoked worker must see zero rows
-- everywhere except their own people row (and, for active snow staff, the
-- company row and same-service teammates handled further down).
create function pg_temp.visible_landscaping_rows(who text) returns table (tbl text, n bigint)
language plpgsql as $$
declare t text; c bigint;
begin
  perform pg_temp.as_user((select uid from cast_ids where cast_ids.who = visible_landscaping_rows.who));
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename not like 'snow\_%' and tablename not in ('people', 'companies')
    order by 1
  loop
    begin
      execute format('select count(*) from public.%I', t) into c;
    exception when insufficient_privilege then c := 0;  -- no grant at all: also unreadable
    end;
    if c > 0 then tbl := t; n := c; return next; end if;
  end loop;
  perform pg_temp.as_admin();
end $$;

select pg_temp.ok(not exists (select 1 from pg_temp.visible_landscaping_rows('plower')),
  'snow-only plower sees no rows in any landscaping table');
select pg_temp.ok(not exists (select 1 from pg_temp.visible_landscaping_rows('shoveler')),
  'snow-only shoveler sees no rows in any landscaping table');
select pg_temp.ok(not exists (select 1 from pg_temp.visible_landscaping_rows('pending')),
  'pending applicant sees no rows in any landscaping table');
select pg_temp.ok(not exists (select 1 from pg_temp.visible_landscaping_rows('revoked')),
  'revoked snow worker sees no rows in any landscaping table');
-- Control: the same sweep is not vacuous.
select pg_temp.ok((select count(*) from pg_temp.visible_landscaping_rows('landscaper')) >= 3,
  'landscaping worker still sees landscaping data (sweep is not vacuous)');
select pg_temp.ok(exists (select 1 from pg_temp.visible_landscaping_rows('dual') where tbl = 'projects'),
  'dual-mode worker keeps landscaping access');

select pg_temp.as_user((select uid from cast_ids where who = 'plower'));
select pg_temp.ok(not public.is_member((select id from co)) and not public.is_crew((select id from co)),
  'snow-only plower is not a landscaping member or crew');
select pg_temp.ok((select count(*) from public.people) = 1,
  'snow-only plower sees only their own person record (no shoveler, no landscapers)');
select pg_temp.ok((select count(*) from public.companies) = 1,
  'snow-only plower can read their company row');

-- ── Service separation ──────────────────────────────────────────────────────
select pg_temp.ok(public.snow_has_service((select id from co), 'plowing'), 'plower has plowing');
select pg_temp.ok(not public.snow_has_service((select id from co), 'shoveling'), 'plower does not have shoveling');
select pg_temp.ok(not public.snow_has_service((select id from co), 'salting'), 'plower does not have salting');
select pg_temp.ok((select count(*) from public.snow_staff) = 1 and (select count(*) from public.snow_staff_services) = 1,
  'plower sees only their own snow access rows');
select pg_temp.ok((select count(*) from public.snow_access_log) = 0, 'plower cannot read the access log');

select pg_temp.as_user((select uid from cast_ids where who = 'shoveler'));
select pg_temp.ok(public.snow_has_service((select id from co), 'shoveling'), 'shoveler has shoveling');
select pg_temp.ok(not public.snow_has_service((select id from co), 'plowing'), 'shoveler does not have plowing');
select pg_temp.ok(not exists (select 1 from public.people where id = (select pid from cast_ids where who = 'plower')),
  'shoveler cannot see the plower');

select pg_temp.as_user((select uid from cast_ids where who = 'dual'));
select pg_temp.ok(public.snow_has_service((select id from co), 'salting')
  and not public.snow_has_service((select id from co), 'plowing'),
  'dual-mode worker has salting only on the snow side');

-- Teammates on the same service can see each other; adding a second plower.
select pg_temp.as_user((select uid from cast_ids where who = 'owner'));
select public.snow_grant_access((select pid from cast_ids where who = 'shoveler'), array['shoveling', 'plowing']);
select pg_temp.as_user((select uid from cast_ids where who = 'plower'));
select pg_temp.ok(exists (select 1 from public.people where id = (select pid from cast_ids where who = 'shoveler')),
  'plower can see a teammate once that person also plows');
select pg_temp.as_user((select uid from cast_ids where who = 'owner'));
select public.snow_grant_access((select pid from cast_ids where who = 'shoveler'), array['shoveling']);
select pg_temp.as_user((select uid from cast_ids where who = 'plower'));
select pg_temp.ok(not exists (select 1 from public.people where id = (select pid from cast_ids where who = 'shoveler')),
  'and loses sight of them when plowing is taken away');

-- ── Pending, revoked, customers, anonymous ──────────────────────────────────
select pg_temp.as_user((select uid from cast_ids where who = 'pending'));
select pg_temp.ok(not public.snow_is_active((select id from co)), 'pending applicant has no snow access');
select pg_temp.ok((select count(*) from public.companies) = 0, 'pending applicant cannot read the company');
select pg_temp.ok(public.get_my_snow_access() = '[]'::jsonb, 'get_my_snow_access is empty for a pending applicant');

select pg_temp.as_user((select uid from cast_ids where who = 'revoked'));
select pg_temp.ok(not public.snow_is_active((select id from co))
  and not public.snow_has_service((select id from co), 'plowing'), 'revoked worker lost all snow access');
select pg_temp.ok((select count(*) from public.companies) = 0, 'revoked worker cannot read the company');

select pg_temp.as_user((select uid from cast_ids where who = 'customer'));
select pg_temp.ok(not public.snow_is_active((select id from co))
  and not public.snow_has_service((select id from co), 'plowing'), 'landscaping customer has no snow employee access');
select pg_temp.ok((select count(*) from public.snow_staff) = 0, 'customer cannot list the snow team');

select pg_temp.as_user(null);
select pg_temp.ok((select count(*) from public.snow_staff) = 0 and (select count(*) from public.snow_staff_services) = 0,
  'anonymous sees no snow staff');

-- ── Only the owner can grant or revoke ──────────────────────────────────────
create function pg_temp.raises(stmt text) returns boolean language plpgsql as $$
begin execute stmt; return false; exception when others then return true; end $$;

select pg_temp.as_user((select uid from cast_ids where who = 'plower'));
select pg_temp.ok(pg_temp.raises(format('select public.snow_grant_access(%L, array[''shoveling''])',
  (select pid from cast_ids where who = 'plower'))), 'a snow worker cannot grant themselves another service');
select pg_temp.ok(pg_temp.raises(format('insert into public.snow_staff_services (company_id, person_id, service) values (%L, %L, ''shoveling'')',
  (select id from co), (select pid from cast_ids where who = 'plower'))), 'a snow worker cannot insert a service row directly');
select pg_temp.ok(pg_temp.raises(format('update public.snow_staff set status = ''active'' where person_id = %L',
  (select pid from cast_ids where who = 'revoked'))) or not exists (
    select 1 from public.snow_staff where person_id = (select pid from cast_ids where who = 'revoked')),
  'a snow worker cannot reactivate someone');
select pg_temp.as_user((select uid from cast_ids where who = 'landscaper'));
select pg_temp.ok(pg_temp.raises(format('select public.snow_grant_access(%L, array[''plowing''])',
  (select pid from cast_ids where who = 'landscaper'))), 'a landscaping worker cannot grant themselves snow access');
select pg_temp.as_admin();
select pg_temp.ok(not exists (select 1 from public.snow_staff where person_id = (select pid from cast_ids where who = 'landscaper')),
  'landscaping worker still has no snow access');

-- ── The company''s active mode grants nothing ───────────────────────────────
-- (Only meaningful once companies.active_mode exists; skipped before that.)
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'companies' and column_name = 'active_mode') then
    execute 'update public.companies set active_mode = ''snow''';
  end if;
end $$;
select pg_temp.as_user((select uid from cast_ids where who = 'landscaper'));
select pg_temp.ok(not public.snow_is_active((select id from co)) and public.get_my_snow_access() = '[]'::jsonb,
  'landscaping-only worker gets no snow access when the company is in Snow Mode');
select pg_temp.as_user((select uid from cast_ids where who = 'plower'));
select pg_temp.ok(not exists (select 1 from pg_temp.visible_landscaping_rows('plower')),
  'snow-only plower still sees no landscaping data in Snow Mode');

-- ── Audit trail and double taps ─────────────────────────────────────────────
select pg_temp.as_user((select uid from cast_ids where who = 'owner'));
create temp table log_before as select count(*) as n from public.snow_access_log;
select public.snow_grant_access((select pid from cast_ids where who = 'plower'), array['plowing']);
select public.snow_revoke_access((select pid from cast_ids where who = 'revoked'));
select pg_temp.ok((select count(*) from public.snow_access_log) = (select n from log_before),
  'repeating a grant or revoke changes nothing and logs nothing');
select pg_temp.ok((select array_agg(action order by created_at, action) from public.snow_access_log
                   where person_id = (select pid from cast_ids where who = 'revoked')) = array['granted', 'revoked'],
  'grant and revoke are both in the access log');
select pg_temp.ok((select count(*) from public.snow_staff) = 4, 'owner sees the whole snow team');

-- Re-grant after revoke restores access.
select public.snow_grant_access((select pid from cast_ids where who = 'revoked'), array['salting']);
select pg_temp.as_user((select uid from cast_ids where who = 'revoked'));
select pg_temp.ok(public.snow_has_service((select id from co), 'salting')
  and not public.snow_has_service((select id from co), 'plowing'),
  'a re-granted worker gets only the newly granted service');

\echo 'snow core access: all tests passed'
rollback;
