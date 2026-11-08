-- Update 80: snow permissions and leftovers from the removed code era.
--
--  * Admins could not open Snow Team or Team Access unless the owner had left them the "invites" power: _my_staff_company
--    (update 66) required it because the old request functions used it. The requests are gone (update 78), so the helper goes
--    back to plain owner/admin, and the snow WRITE functions now check the "snow access" power explicitly, like snow_grant_access
--    always did.
--  * snow_grant_access no longer accepts a pending request as a reason to grant access (requests cannot exist any more).
--  * Deleting a company now also deletes the accounts and files of its Snow-ONLY workers (they had no company_members row,
--    so update 74 missed them and left logins opening onto "Finish setting up").
--  * get_my_snow_status (the sign-in call of the request era) is revoked; the app now uses get_my_snow_access.
--  * Grant hygiene: older snow updates revoked only "public" or only "anon"; both are revoked here, and internal helpers
--    can no longer be called by signed-in users. Changes nothing for the app.
--
-- Safe to run more than once. No tables are touched (dropping the dead code-era tables waits for a later update).

-- 1. The staff-company helper is owner/admin again (no invites power needed just to LOOK at the team).
create or replace function public._my_staff_company()
returns uuid language sql stable security definer set search_path = public as $$
  select m.company_id from public.company_members m
  where m.person_id = public.my_person_id() and m.role in ('owner','admin') and m.status = 'active'
  order by m.created_at limit 1
$$;
revoke all on function public._my_staff_company() from public, anon, authenticated;

-- 2. Changing or removing snow access follows the owner's "snow access" switch for admins (reads stay plain owner/admin).
create or replace function public.set_snow_member_services(p_person_id uuid, p_services text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public._my_staff_company();
  me uuid := public.my_person_id();
  before text[];
begin
  if cid is null then raise exception 'not allowed'; end if;
  if not public.admin_can(cid, 'snow_access') then raise exception 'The owner has not allowed admins to change snow access.'; end if;
  if not public._snow_valid_services(p_services) then raise exception 'pick at least one snow service'; end if;
  if not exists (select 1 from public.snow_staff where company_id = cid and person_id = p_person_id) then
    raise exception 'not on the snow team';
  end if;
  before := public._snow_services_of(cid, p_person_id);

  perform public.snow_grant_access(p_person_id, p_services);
  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
  values (cid, 'snow_access_changed', me, p_person_id,
          jsonb_build_object('before', to_jsonb(before), 'after', to_jsonb(p_services)));
end;
$$;

create or replace function public.revoke_snow_access(p_person_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public._my_staff_company();
  me uuid := public.my_person_id();
begin
  if cid is null then raise exception 'not allowed'; end if;
  if not public.admin_can(cid, 'snow_access') then raise exception 'The owner has not allowed admins to change snow access.'; end if;
  if public._snow_is_active_member(cid, p_person_id) then
    perform public.snow_revoke_access(p_person_id);
    insert into public.membership_audit_log (company_id, event_type, actor_id, target_id)
    values (cid, 'snow_access_revoked', me, p_person_id);
  end if;
end;
$$;

-- 3. Granting access no longer looks at the dead requests table.
create or replace function public.snow_grant_access(p_person_id uuid, p_services text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  cid uuid;
  prev text[];
  was_active boolean;
  svcs text[];
begin
  select company_id into cid from public.company_members
  where person_id = me and role in ('owner', 'admin') and status = 'active' and public.admin_can(company_id, 'snow_access')
  order by created_at limit 1;
  if cid is null then raise exception 'Only the owner can change snow access.'; end if;
  if p_person_id is null or not exists (select 1 from public.people where id = p_person_id) then
    raise exception 'Person not found.';
  end if;
  if not (
    exists (select 1 from public.company_members m
             where m.company_id = cid and m.person_id = p_person_id
               and m.status = 'active' and m.role in ('owner', 'admin', 'worker'))
    or exists (select 1 from public.snow_staff s where s.company_id = cid and s.person_id = p_person_id)
  ) then
    raise exception 'This person isn''t on your team, so they can''t be given snow access.';
  end if;

  select coalesce(array_agg(distinct s order by s), '{}') into svcs
  from unnest(coalesce(p_services, '{}')) s;
  if cardinality(svcs) = 0 then raise exception 'Pick at least one snow service.'; end if;
  if exists (select 1 from unnest(svcs) s where s not in ('plowing', 'shoveling', 'salting')) then
    raise exception 'Unknown snow service.';
  end if;

  select status = 'active' into was_active from public.snow_staff
  where company_id = cid and person_id = p_person_id for update;
  select coalesce(array_agg(service order by service), '{}') into prev
  from public.snow_staff_services where company_id = cid and person_id = p_person_id;

  insert into public.snow_staff (company_id, person_id, status, granted_by, granted_at)
  values (cid, p_person_id, 'active', me, now())
  on conflict (company_id, person_id) do update
    set status = 'active', revoked_by = null, revoked_at = null,
        granted_by = case when public.snow_staff.status = 'active' then public.snow_staff.granted_by else me end,
        granted_at = case when public.snow_staff.status = 'active' then public.snow_staff.granted_at else now() end;

  delete from public.snow_staff_services
  where company_id = cid and person_id = p_person_id and service <> all (svcs);
  insert into public.snow_staff_services (company_id, person_id, service, granted_by)
  select cid, p_person_id, s, me from unnest(svcs) s
  on conflict do nothing;

  if coalesce(was_active, false) and prev = svcs then return; end if;
  insert into public.snow_access_log (company_id, person_id, actor_id, action, services, previous_services)
  values (cid, p_person_id, me,
          case when coalesce(was_active, false) then 'services_changed' else 'granted' end,
          svcs, case when coalesce(was_active, false) then prev else '{}' end);
end;
$$;

-- 4. Deleting a company takes its Snow-only people (and their files) with it.
create or replace function public.delete_my_company(p_confirm_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  pid uuid := public.my_person_id();
  cid uuid;
  cname text;
  t text;
  prev jsonb;
  who text;
  gone_people uuid[];
  gone_users uuid[];
begin
  if pid is null then raise exception 'not signed in'; end if;

  select m.company_id into cid
    from public.company_members m
   where m.person_id = pid and m.role = 'owner' and m.status = 'active'
   limit 1;
  if cid is null then raise exception 'Only the company owner can delete the company.'; end if;

  select name into cname from public.companies where id = cid;
  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(coalesce(cname, ''))) then
    raise exception 'Type the company name exactly to confirm.';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.one_company'));

  prev := public.company_closure_preview();
  if (prev ->> 'on_the_clock')::int > 0 or (prev ->> 'timing_a_property')::int > 0 then
    raise exception 'Someone is still clocked in. Clock them out (Hours & Labor) before closing the company.';
  end if;
  if (prev ->> 'dispatched_storms')::int > 0 then
    raise exception 'A snow storm is still dispatched. End it before closing the company.';
  end if;

  -- Close every way back in first (if anything below fails, all of this is rolled back too).
  update public.team_codes set is_active = false where company_id = cid;
  update public.snow_signup_codes set is_active = false where company_id = cid;
  update public.join_requests set status = 'cancelled', reviewed_by = pid, reviewed_at = now() where company_id = cid and status = 'pending';
  update public.snow_access_requests set status = 'removed', reviewed_by = pid, reviewed_at = now() where company_id = cid and status = 'pending';

  select trim(first_name || ' ' || last_name) into who from public.people where id = pid;
  insert into public.company_closure_log (company_id, company_name, closed_by, closed_by_name, counts)
  values (cid, cname, pid, who, prev);

  -- The company's stored files (photos, documents) live outside the database. Their names are written to a cleanup list BEFORE the rows
  -- are deleted, in this same all-or-nothing step, so nothing is left unlisted. A separate job must delete the files from storage.
  perform public._enqueue_company_files(cid);

  -- Deleting a company deletes everything inside it, including the accounts of the people who belonged ONLY to it (owner included), so
  -- nobody is left with a login that opens onto "Finish setting up". Anyone who also belongs to (or has Snow access in) another company
  -- keeps their account. Decided now, before the memberships disappear.
  select coalesce(array_agg(distinct x.person_id), '{}') into gone_people
    from (select m.person_id from public.company_members m where m.company_id = cid
          union
          select s.person_id from public.snow_staff s where s.company_id = cid) x
   where not exists (select 1 from public.company_members m2 where m2.person_id = x.person_id and m2.company_id <> cid)
     and not exists (select 1 from public.snow_staff s2 where s2.person_id = x.person_id and s2.company_id <> cid);

  -- Everything stored for this company and for the people whose accounts go with it (every file key starts with the company id;
  -- ID photos and avatars start with the person id). A background job empties these folders in storage, in both buckets.
  perform public._enqueue_company_prefixes(cid, gone_people);

  for t in
    select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r'
       and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
  loop
    execute format('alter table public.%I disable trigger user', t);
  end loop;

  perform set_config('app.allow_company_delete', 'on', true);
  delete from public.companies where id = cid;
  perform set_config('app.allow_company_delete', 'off', true);

  for t in
    select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r'
       and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
  loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;

  if exists (select 1 from public.companies where id = cid) then
    raise exception 'The company could not be deleted.';
  end if;

  -- Same all-or-nothing step: remove those people and their logins. If any of this fails, the company is NOT deleted either.
  select coalesce(array_agg(user_id) filter (where user_id is not null), '{}') into gone_users from public.people where id = any(gone_people);
  delete from public.people where id = any(gone_people);
  delete from auth.users where id = any(gone_users);
  update public.company_closure_log
     set counts = coalesce(counts, '{}'::jsonb) || jsonb_build_object('accounts_deleted', coalesce(array_length(gone_people, 1), 0))
   where company_id = cid;
end;
$$;

-- 5. The sign-in call of the request era is closed; the app reads get_my_snow_access instead.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'get_my_snow_status') then
    revoke all on function public.get_my_snow_status() from public, anon, authenticated;
  end if;
end $$;
revoke all on function public.get_my_snow_access() from public, anon;
grant execute on function public.get_my_snow_access() to authenticated;

-- 6. Grant hygiene. User-facing snow functions: callable by signed-in users only.
do $$
declare sig text;
begin
  foreach sig in array array[
    'public.list_snow_members()', 'public.set_snow_member_services(uuid, text[])', 'public.revoke_snow_access(uuid)',
    'public.snow_grant_access(uuid, text[])', 'public.delete_my_company(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', sig);
    execute format('grant execute on function %s to authenticated', sig);
  end loop;
end $$;

-- Internal helpers: nobody calls these from the app; they run inside other functions.
do $$
declare sig text;
begin
  foreach sig in array array[
    'public.snow_revoke_access(uuid)', 'public._snow_my_company()', 'public._snow_visit_for_lead(uuid)', 'public._snow_purging(uuid)'
  ] loop
    begin
      execute format('revoke all on function %s from public, anon, authenticated', sig);
    exception when undefined_function then null;
    end;
  end loop;
end $$;

-- Older snow updates that revoked only "public": close the anon side too (each function already rejects a caller
-- with no person, so this changes nothing for real users).
do $$
declare f text; sig text;
begin
  foreach f in array array[
    'snow_create_storm', 'snow_storm_eligible_properties', 'snow_storm_end_preview', 'snow_dispatch_storm', 'snow_end_storm',
    'snow_reopen_storm', 'snow_reorder_route', 'snow_arrive_visit', 'snow_complete_visit', 'snow_set_route_crew',
    'snow_clock_in', 'snow_clock_out', 'snow_correct_shift', 'snow_set_storm_services', 'snow_my_routes', 'snow_my_properties',
    'snow_activity_feed', 'snow_activity_filter_options', 'snow_activity_years', 'snow_delete_storm', 'snow_clear_activity',
    'snow_save_route_template', 'snow_apply_route_template', 'snow_add_completion_media', 'snow_owner_add_media',
    'snow_review_media', 'snow_withdraw_media', 'snow_send_customer_update', 'snow_customer_updates',
    'snow_instructions_as_of', 'snow_reference_media_as_of', 'snow_route_lead_history', 'snow_set_notify_prefs'
  ] loop
    for sig in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = f loop
      execute format('revoke all on function %s from public, anon', sig);
      execute format('grant execute on function %s to authenticated', sig);
    end loop;
  end loop;
end $$;

notify pgrst, 'reload schema';
