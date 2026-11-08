-- ============================================================================
-- Update 66 — run once in Supabase → SQL Editor, AFTER 065 (safe to run again). NOT run yet; read it first.
--
-- Account, admin and access management, made dependable at the DATABASE (not only in the screens):
--
--  • Admin powers are explicit: the owner makes someone an admin (or takes it away), and can switch off five sensitive admin
--    powers (team management, invitations, snow access, time corrections, pay rates). Everything is ON by default, so no
--    existing admin loses anything today. Owners are never limited.
--  • A signed-in app user can no longer edit company_members directly to make themselves (or anyone) an owner/admin, delete the
--    owner's row, or bring someone back. Role changes, deactivation and reactivation go through the functions below.
--  • Deactivating a worker ends ALL their company access in one step: landscaping, snow, pending requests, push tokens. It is
--    refused while they are on the clock or timing a property. Their history is never touched.
--  • Reactivating is an explicit decision (landscaping and/or which snow services). It never brings back an old admin role.
--  • Approving a join request now requires it to still be pending (a declined / cancelled / old request can't be replayed).
--  • Snow access is explicit per person: the automatic "everyone gets snow when Snow Mode is on" of update 62 is switched off.
--  • One code box: join_with_code() works out whether a code is a team code or a snow code (on the server).
--  • Closing a company: a preview of what is still happening, a refusal while people are on the clock or a storm is
--    dispatched, codes and pending requests closed first, and a closure record that survives the company.
-- If update 62 is ever run again, run 66 again after it (62 would otherwise switch the automatic snow grants back on).
-- Nothing here deletes or rewrites existing data.
-- ============================================================================

-- ── 1. Admin permissions (all ON by default) ────────────────────────────────
create table if not exists public.company_admin_permissions (
  company_id uuid primary key references public.companies(id) on delete cascade,
  team boolean not null default true,             -- deactivate / reactivate / change access of team members
  invites boolean not null default true,          -- team codes, snow codes, join requests
  snow_access boolean not null default true,      -- grant / change / remove snow access
  time_corrections boolean not null default true, -- correct and approve workdays and property times
  pay_rates boolean not null default true,        -- see and change hourly rates and overtime terms
  updated_by uuid references public.people(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.company_admin_permissions enable row level security;
drop policy if exists company_admin_permissions_staff_select on public.company_admin_permissions;
create policy company_admin_permissions_staff_select on public.company_admin_permissions for select using (public.is_staff(company_id));
revoke insert, update, delete, truncate on public.company_admin_permissions from anon, authenticated;
revoke all on public.company_admin_permissions from anon;

-- May the CALLER do this? The owner always may; an admin only if the owner left that power on; nobody else.
create or replace function public.admin_can(cid uuid, perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.member_role(cid)
    when 'owner' then true
    when 'admin' then coalesce((select (to_jsonb(p) ->> perm)::boolean from public.company_admin_permissions p where p.company_id = cid), true)
    else false
  end
$$;
revoke all on function public.admin_can(uuid, text) from public, anon;
grant execute on function public.admin_can(uuid, text) to authenticated;

create or replace function public.get_admin_permissions()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public._my_staff_company(); r public.company_admin_permissions;
begin
  if cid is null then raise exception 'not allowed'; end if;
  select * into r from public.company_admin_permissions where company_id = cid;
  return jsonb_build_object('team', coalesce(r.team, true), 'invites', coalesce(r.invites, true), 'snow_access', coalesce(r.snow_access, true),
                            'time_corrections', coalesce(r.time_corrections, true), 'pay_rates', coalesce(r.pay_rates, true));
end;
$$;

create or replace function public.set_admin_permissions(p_team boolean, p_invites boolean, p_snow_access boolean, p_time_corrections boolean, p_pay_rates boolean)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_person_id(); cid uuid;
begin
  select company_id into cid from public.company_members where person_id = me and role = 'owner' and status = 'active' limit 1;
  if cid is null then raise exception 'Only the owner can change what admins may do.'; end if;
  insert into public.company_admin_permissions (company_id, team, invites, snow_access, time_corrections, pay_rates, updated_by, updated_at)
  values (cid, coalesce(p_team, true), coalesce(p_invites, true), coalesce(p_snow_access, true), coalesce(p_time_corrections, true), coalesce(p_pay_rates, true), me, now())
  on conflict (company_id) do update set team = excluded.team, invites = excluded.invites, snow_access = excluded.snow_access,
    time_corrections = excluded.time_corrections, pay_rates = excluded.pay_rates, updated_by = me, updated_at = now();
  insert into public.membership_audit_log (company_id, event_type, actor_id, metadata)
  values (cid, 'admin_permissions_changed', me, jsonb_build_object('team', p_team, 'invites', p_invites, 'snow_access', p_snow_access,
                                                                  'time_corrections', p_time_corrections, 'pay_rates', p_pay_rates));
end;
$$;
revoke all on function public.get_admin_permissions(), public.set_admin_permissions(boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.get_admin_permissions(), public.set_admin_permissions(boolean, boolean, boolean, boolean, boolean) to authenticated;

-- The staff company, but only when the caller is allowed to manage invitations/requests (used by the snow request functions).
create or replace function public._my_staff_company()
returns uuid language sql stable security definer set search_path = public as $$
  select m.company_id from public.company_members m
  where m.person_id = public.my_person_id() and m.role in ('owner','admin') and m.status = 'active'
    and public.admin_can(m.company_id, 'invites')
  order by m.created_at limit 1
$$;

-- Pay rates and overtime terms follow the "pay rates" power.
drop policy if exists hourly_rates_staff on public.worker_hourly_rates;
create policy hourly_rates_staff on public.worker_hourly_rates for all
  using (public.admin_can(company_id, 'pay_rates')) with check (public.admin_can(company_id, 'pay_rates'));
drop policy if exists worker_pay_settings_staff on public.worker_pay_settings;
create policy worker_pay_settings_staff on public.worker_pay_settings for all
  using (public.admin_can(company_id, 'pay_rates')) with check (public.admin_can(company_id, 'pay_rates'));
-- Team codes follow the "invitations" power.
drop policy if exists team_codes_staff on public.team_codes;
create policy team_codes_staff on public.team_codes for all
  using (public.admin_can(company_id, 'invites')) with check (public.admin_can(company_id, 'invites'));

-- Time corrections and pay-rate changes (update 64) follow their powers too.
create or replace function public._time_need_staff(p_company uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_company is null or not public.is_staff(p_company) then raise exception 'Only the owner can do that.'; end if;
  if not public.admin_can(p_company, 'time_corrections') then raise exception 'The owner has not allowed admins to correct time.'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Enter a reason for this change.'; end if;
end;
$$;
revoke all on function public._time_need_staff(uuid, text) from public, anon, authenticated;

create or replace function public.time_set_hourly_rate(p_person uuid, p_rate numeric, p_effective date, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid := public._time_company(p_person); latest date; prev numeric; n_days integer; n_visits integer;
begin
  if cid is null or not public.is_staff(cid) then raise exception 'Only the owner can do that.'; end if;
  if not public.admin_can(cid, 'pay_rates') then raise exception 'The owner has not allowed admins to change pay rates.'; end if;
  if p_rate is null or p_rate <= 0 or p_rate > 1000 then raise exception 'Enter an hourly rate above zero.'; end if;
  if p_effective is null then raise exception 'Enter the date the new rate starts.'; end if;
  select max(effective_date) into latest from public.worker_hourly_rates where company_id = cid and person_id = p_person;
  if latest is not null and p_effective <= latest then
    raise exception 'The new rate has to start after the current rate''s start date (%).', latest;
  end if;
  select hourly_rate into prev from public.worker_hourly_rates where company_id = cid and person_id = p_person and end_date is null order by effective_date desc limit 1;
  update public.worker_hourly_rates set end_date = p_effective - 1 where company_id = cid and person_id = p_person and end_date is null;
  insert into public.worker_hourly_rates (company_id, person_id, hourly_rate, effective_date, set_by) values (cid, p_person, p_rate, p_effective, public.my_person_id());
  perform public._time_audit(cid, 'rate', null, p_person, null, null, 'rate_set', 'hourly_rate', to_jsonb(prev), to_jsonb(p_rate), p_reason, false);

  update public.time_workday_rates r set hourly_rate = p_rate
    from public.time_workdays w
   where r.workday_id = w.id and r.hourly_rate is null and w.person_id = p_person and w.company_id = cid
     and w.work_date >= p_effective and w.status <> 'approved';
  get diagnostics n_days = row_count;
  update public.time_interval_rates r set hourly_rate = p_rate
    from public.time_intervals i join public.time_workdays w on w.id = i.workday_id
   where r.interval_id = i.id and r.hourly_rate is null and i.person_id = p_person and i.company_id = cid
     and w.work_date >= p_effective and w.status <> 'approved';
  get diagnostics n_visits = row_count;
  if n_days + n_visits > 0 then
    perform public._time_audit(cid, 'rate', null, p_person, null, null, 'rate_filled', 'hourly_rate', null,
                               jsonb_build_object('rate', p_rate, 'workdays', n_days, 'property_times', n_visits), 'Filled in the blank rate on time recorded before a rate was set', false);
  end if;
end;
$$;

-- Snow access follows the "snow access" power (owner/admin only, as before).
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
    or exists (select 1 from public.snow_access_requests r
                where r.company_id = cid and r.person_id = p_person_id and r.status in ('pending', 'approved'))
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
revoke execute on function public.snow_grant_access(uuid, text[]) from anon;

create or replace function public.snow_revoke_access(p_person_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  cid uuid;
  prev text[];
begin
  select company_id into cid from public.company_members
  where person_id = me and role in ('owner', 'admin') and status = 'active' and public.admin_can(company_id, 'snow_access')
  order by created_at limit 1;
  if cid is null then raise exception 'Only the owner can change snow access.'; end if;

  select coalesce(array_agg(service order by service), '{}') into prev
  from public.snow_staff_services where company_id = cid and person_id = p_person_id;

  update public.snow_staff set status = 'revoked', revoked_by = me, revoked_at = now()
  where company_id = cid and person_id = p_person_id and status = 'active';
  if not found then return; end if;

  delete from public.snow_staff_services where company_id = cid and person_id = p_person_id;
  insert into public.snow_access_log (company_id, person_id, actor_id, action, services, previous_services)
  values (cid, p_person_id, me, 'revoked', '{}', prev);
end;
$$;
revoke execute on function public.snow_revoke_access(uuid) from anon;

-- Nobody can forge a history row in someone else's name.
drop policy if exists audit_insert on public.membership_audit_log;
create policy audit_insert on public.membership_audit_log for insert with check (public.is_member(company_id) and actor_id = public.my_person_id());

-- ── 2. The app can't edit company_members directly to change who is in charge ──
-- (Functions below run as the table owner, so they are not affected. Only a direct call from a signed-in app user is checked.)
create or replace function public._company_members_guard()
returns trigger language plpgsql as $$
declare actor_role text; me uuid;
begin
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  me := public.my_person_id();
  if tg_op = 'DELETE' then
    raise exception 'Team members can''t be deleted. Deactivate them instead.';
  elsif tg_op = 'INSERT' then
    if new.role <> 'customer' or not public.is_staff(new.company_id) then
      raise exception 'People join the team through a code and an approval.';
    end if;
    return new;
  end if;
  -- UPDATE
  if new.company_id is distinct from old.company_id or new.person_id is distinct from old.person_id or new.role is distinct from old.role then
    raise exception 'Roles are changed with Make admin / Remove admin, not by editing the team list.';
  end if;
  if new.status is distinct from old.status then
    actor_role := public.member_role(old.company_id);
    if actor_role not in ('owner', 'admin') or not public.admin_can(old.company_id, 'team') then
      raise exception 'Only the owner (or an admin the owner allows) can do that.';
    end if;
    if not (old.status = 'active' and new.status = 'inactive') then
      raise exception 'Use Reactivate to bring someone back.';
    end if;
    if old.role = 'owner' then raise exception 'The owner can''t be deactivated.'; end if;
    if old.person_id = me then raise exception 'You can''t deactivate yourself here.'; end if;
    if old.role = 'admin' and actor_role <> 'owner' then raise exception 'Only the owner can deactivate an admin.'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists company_members_guard on public.company_members;
create trigger company_members_guard before insert or update or delete on public.company_members
  for each row execute function public._company_members_guard();
revoke all on function public._company_members_guard() from public, anon, authenticated;

-- Join requests can't be forged or revived from a phone. People ask with a code (join_with_code / sign-up); the owner decides.
-- A direct call from the app may only: let the applicant withdraw their own OPEN request, or mirror a decision the owner just made.
create or replace function public._join_requests_guard()
returns trigger language plpgsql as $$
declare me uuid;
begin
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  me := public.my_person_id();
  if tg_op = 'INSERT' then raise exception 'To join a team, enter the code your employer gave you.'; end if;
  if tg_op = 'DELETE' then raise exception 'Requests are kept for the history.'; end if;
  if new.company_id is distinct from old.company_id or new.person_id is distinct from old.person_id
     or new.join_method is distinct from old.join_method or new.requested_role is distinct from old.requested_role
     or new.requested_worker_type is distinct from old.requested_worker_type then
    raise exception 'A request can''t be rewritten.';
  end if;
  if new.status is distinct from old.status then
    if old.status <> 'pending' then raise exception 'That request is closed. They need to ask again with a code.'; end if;
    if public.is_staff(old.company_id) and public.admin_can(old.company_id, 'invites') then
      if new.status not in ('approved', 'declined', 'cancelled') then raise exception 'bad status'; end if;
    elsif old.person_id = me then
      if new.status <> 'cancelled' then raise exception 'You can only withdraw your own request.'; end if;
    else
      raise exception 'not allowed';
    end if;
  elsif old.person_id = me and not public.is_staff(old.company_id)
        and (new.assigned_role is distinct from old.assigned_role or new.assigned_worker_type is distinct from old.assigned_worker_type) then
    raise exception 'not allowed';
  end if;
  return new;
end;
$$;
revoke all on function public._join_requests_guard() from public, anon, authenticated;
drop trigger if exists join_requests_guard on public.join_requests;
create trigger join_requests_guard before insert or update or delete on public.join_requests
  for each row execute function public._join_requests_guard();

-- ── 3. Deactivation ends ALL access, whichever way it happens ────────────────
create or replace function public._member_deactivated()
returns trigger language plpgsql security definer set search_path = public as $$
declare prev text[]; me uuid := public.my_person_id();
begin
  if new.status = 'inactive' and old.status is distinct from 'inactive' then
    if coalesce(current_setting('brighton.keep_snow', true), '') <> 'on' then
      select coalesce(array_agg(service order by service), '{}') into prev
        from public.snow_staff_services where company_id = new.company_id and person_id = new.person_id;
      update public.snow_staff set status = 'revoked', revoked_by = me, revoked_at = now()
       where company_id = new.company_id and person_id = new.person_id and status = 'active';
      if found then
        delete from public.snow_staff_services where company_id = new.company_id and person_id = new.person_id;
        insert into public.snow_access_log (company_id, person_id, actor_id, action, services, previous_services)
        values (new.company_id, new.person_id, me, 'revoked', '{}', prev);
      end if;
      update public.snow_access_requests set status = 'removed', reviewed_by = me, reviewed_at = now()
       where company_id = new.company_id and person_id = new.person_id and status = 'pending';
      update public.join_requests set status = 'cancelled', reviewed_by = me, reviewed_at = now()
       where company_id = new.company_id and person_id = new.person_id and status = 'pending';
      delete from public.push_tokens where person_id = new.person_id;
      insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
      values (new.company_id, 'member_deactivated', me, new.person_id, jsonb_build_object('role', new.role, 'snow_services_removed', to_jsonb(prev)));
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public._member_deactivated() from public, anon, authenticated;
drop trigger if exists company_members_deactivated on public.company_members;
create trigger company_members_deactivated after update of status on public.company_members
  for each row execute function public._member_deactivated();

-- Never take someone off the company while they are on the clock (their time must be closed by a person who can see it).
create or replace function public._member_deactivation_block()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'inactive' and old.status is distinct from 'inactive' and new.person_id is distinct from public.my_person_id() then
    if exists (select 1 from public.time_workdays w where w.person_id = new.person_id and w.company_id = new.company_id and w.clock_out_at is null) then
      raise exception 'They are clocked in. Set their clock-out in Hours & Labor first, then deactivate them.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public._member_deactivation_block() from public, anon, authenticated;
drop trigger if exists company_members_deactivation_block on public.company_members;
create trigger company_members_deactivation_block before update of status on public.company_members
  for each row execute function public._member_deactivation_block();

-- Snow access is EXPLICIT, per person (decision: Snow Mode being switched on grants nobody anything). Update 62 used to put every
-- worker on the snow team when Snow Mode was switched on, and when a worker joined or was approved during Snow Mode. Both automatic
-- grants are switched off here. Nobody who already has snow access loses it; nobody new gets it unless the owner (or an admin allowed
-- "snow access") gives it, or approves their Snow request. (_snow_enroll_person / _snow_enroll_workers are left in place, unused.)
create or replace function public._snow_mode_enroll_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  return null;
end;
$$;
create or replace function public._snow_member_enroll_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  return null;
end;
$$;

-- ── 4. Who can do what to a team member ─────────────────────────────────────
-- The caller's company when they may manage team members (owner, or an admin the owner allows).
create or replace function public._team_manager_company()
returns uuid language sql stable security definer set search_path = public as $$
  select m.company_id from public.company_members m
  where m.person_id = public.my_person_id() and m.role in ('owner', 'admin') and m.status = 'active' and public.admin_can(m.company_id, 'team')
  order by m.created_at limit 1
$$;
revoke all on function public._team_manager_company() from public, anon, authenticated;

-- Shared checks for the actions below. Returns the company.
create or replace function public._check_member_target(p_person_id uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public._team_manager_company(); trole text; arole text;
begin
  if cid is null then raise exception 'Only the owner (or an admin the owner allows) can manage the team.'; end if;
  if p_person_id = public.my_person_id() then raise exception 'You can''t change your own access here.'; end if;
  select role into trole from public.company_members where company_id = cid and person_id = p_person_id;
  if trole = 'owner' then raise exception 'The owner''s account can''t be changed here.'; end if;
  arole := public.member_role(cid);
  if trole = 'admin' and arole <> 'owner' then raise exception 'Only the owner can change an admin.'; end if;
  return cid;
end;
$$;
revoke all on function public._check_member_target(uuid) from public, anon, authenticated;

-- What is still going on for this person (blocking = must be resolved first; warnings = kept as they are, but you should look).
create or replace function public.member_deactivation_check(p_person_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public._check_member_target(p_person_id); blocking jsonb := '[]'; warnings jsonb := '[]'; n integer;
begin
  if exists (select 1 from public.time_workdays w where w.person_id = p_person_id and w.company_id = cid and w.clock_out_at is null) then
    blocking := blocking || to_jsonb('They are clocked in right now. Set their clock-out in Hours & Labor first.'::text);
  end if;
  select count(*) into n from public.time_workdays w where w.person_id = p_person_id and w.company_id = cid and w.status in ('closed', 'reopened');
  if n > 0 then warnings := warnings || to_jsonb(n || ' workday(s) still need your approval. They stay in Hours & Labor.'); end if;
  select count(*) into n from public.assignments a where a.person_id = p_person_id and a.company_id = cid and a.scheduled_date >= current_date and a.status not in ('completed', 'cancelled', 'reassigned');
  if n > 0 then warnings := warnings || to_jsonb(n || ' upcoming job(s) are assigned to them. Reassign them.'); end if;
  select count(*) into n from public.maintenance_route_crew c join public.maintenance_routes r on r.id = c.route_id
   where c.person_id = p_person_id and r.company_id = cid and r.service_date >= current_date and r.status <> 'cancelled';
  if n > 0 then warnings := warnings || to_jsonb(n || ' upcoming maintenance route(s) include them. Reassign them.'); end if;
  select count(*) into n from public.snow_route_crew sc join public.snow_storms s on s.id = sc.storm_id
   where sc.person_id = p_person_id and s.company_id = cid and s.status = 'dispatched';
  if n > 0 then warnings := warnings || to_jsonb('They are on ' || n || ' dispatched storm route(s). Reassign them.'); end if;
  select count(*) into n from public.time_skip_requests q where q.requested_by = p_person_id and q.company_id = cid and q.status = 'pending';
  if n > 0 then warnings := warnings || to_jsonb(n || ' skip request(s) from them are waiting for a decision.'); end if;
  return jsonb_build_object('blocking', blocking, 'warnings', warnings);
end;
$$;

-- Deactivate: all company access ends (landscaping, snow, requests, push). History is kept.
create or replace function public.deactivate_member(p_person_id uuid, p_acknowledge boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid := public._check_member_target(p_person_id); chk jsonb; me uuid := public.my_person_id(); had boolean := false;
begin
  chk := public.member_deactivation_check(p_person_id);
  if jsonb_array_length(chk -> 'blocking') > 0 then raise exception '%', chk -> 'blocking' ->> 0; end if;
  if jsonb_array_length(chk -> 'warnings') > 0 and not coalesce(p_acknowledge, false) then
    raise exception 'Please read the warnings and confirm: %', chk -> 'warnings' ->> 0;
  end if;
  -- Landscaping side (the trigger also ends snow access and pending requests).
  update public.company_members set status = 'inactive', deactivated_at = now(), deactivated_by = me
   where company_id = cid and person_id = p_person_id and status <> 'inactive';
  had := found;
  -- A snow-only person has no membership row: end their snow access directly.
  if not had and exists (select 1 from public.snow_staff where company_id = cid and person_id = p_person_id and status = 'active') then
    perform set_config('brighton.snow_actor', me::text, true);
    declare prev text[]; begin
      select coalesce(array_agg(service order by service), '{}') into prev from public.snow_staff_services where company_id = cid and person_id = p_person_id;
      update public.snow_staff set status = 'revoked', revoked_by = me, revoked_at = now() where company_id = cid and person_id = p_person_id and status = 'active';
      delete from public.snow_staff_services where company_id = cid and person_id = p_person_id;
      insert into public.snow_access_log (company_id, person_id, actor_id, action, services, previous_services) values (cid, p_person_id, me, 'revoked', '{}', prev);
      update public.snow_access_requests set status = 'removed', reviewed_by = me, reviewed_at = now() where company_id = cid and person_id = p_person_id and status = 'pending';
      delete from public.push_tokens where person_id = p_person_id;
      insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
      values (cid, 'member_deactivated', me, p_person_id, jsonb_build_object('role', 'snow_only', 'snow_services_removed', to_jsonb(prev)));
    end;
    had := true;
  end if;
  if not had then raise exception 'This person has no access to deactivate.'; end if;
end;
$$;

-- Reactivate: an explicit decision. Never brings back admin; never dispatches work.
create or replace function public.reactivate_member(p_person_id uuid, p_landscaping boolean, p_worker_type text default 'landscaping', p_snow_services text[] default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid := public._check_member_target(p_person_id); me uuid := public.my_person_id(); svcs text[] := coalesce(p_snow_services, '{}'); m record;
begin
  if p_worker_type not in ('landscaping', 'maintenance') then raise exception 'bad worker type'; end if;
  if not coalesce(p_landscaping, false) and cardinality(svcs) = 0 then raise exception 'Choose landscaping access, snow access, or both.'; end if;
  if cardinality(svcs) > 0 and not public._snow_valid_services(svcs) then raise exception 'Unknown snow service.'; end if;
  if cardinality(svcs) > 0 and not public.admin_can(cid, 'snow_access') then raise exception 'The owner has not allowed admins to change snow access.'; end if;
  select * into m from public.company_members where company_id = cid and person_id = p_person_id;
  if m.id is null and not exists (select 1 from public.snow_staff where company_id = cid and person_id = p_person_id) then
    raise exception 'This person was never on your team. Use a code and approve their request.';
  end if;
  if m.id is not null and m.status = 'active' then raise exception 'They are already active.'; end if;
  if m.id is null and exists (select 1 from public.snow_staff where company_id = cid and person_id = p_person_id and status = 'active') then
    raise exception 'They are already active.';
  end if;
  perform set_config('brighton.no_snow_enroll', 'on', true);
  perform set_config('brighton.worker_type_change', 'on', true);
  if p_landscaping then
    update public.company_members
       set status = 'active', role = 'worker', worker_type = p_worker_type, deactivated_at = null, deactivated_by = null, approved_by = me, approved_at = now()
     where id = m.id;
  end if;
  perform set_config('brighton.worker_type_change', '', true);
  if cardinality(svcs) > 0 then perform public.snow_grant_access(p_person_id, svcs); end if;
  perform set_config('brighton.no_snow_enroll', '', true);
  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
  values (cid, 'member_reactivated', me, p_person_id, jsonb_build_object('landscaping', p_landscaping, 'worker_type', p_worker_type, 'snow_services', to_jsonb(svcs), 'previous_role', m.role));
end;
$$;

-- Owner only: admin <-> worker. Admin is never given by signing up, and never restored by reactivating.
create or replace function public.set_member_role(p_person_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_person_id(); cid uuid; m record;
begin
  select company_id into cid from public.company_members where person_id = me and role = 'owner' and status = 'active' limit 1;
  if cid is null then raise exception 'Only the owner can make or remove an admin.'; end if;
  if p_role not in ('admin', 'worker') then raise exception 'bad role'; end if;
  if p_person_id = me then raise exception 'You can''t change your own role.'; end if;
  select * into m from public.company_members where company_id = cid and person_id = p_person_id;
  if m.id is null or m.status <> 'active' then raise exception 'Only active team members can be made an admin.'; end if;
  if m.role = 'owner' then raise exception 'The owner''s role can''t be changed.'; end if;
  if m.role not in ('worker', 'admin') then raise exception 'Only employees can be made an admin.'; end if;
  if m.role = p_role then return; end if;
  perform set_config('brighton.role_change', 'on', true);
  update public.company_members set role = p_role where id = m.id;
  perform set_config('brighton.role_change', '', true);
  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
  values (cid, case when p_role = 'admin' then 'admin_granted' else 'admin_removed' end, me, p_person_id, jsonb_build_object('from', m.role, 'to', p_role));
end;
$$;

-- Change which modes an ACTIVE person works in, without deactivating them. At least one mode must remain.
create or replace function public.set_member_modes(p_person_id uuid, p_landscaping boolean, p_snow_services text[])
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid := public._check_member_target(p_person_id); me uuid := public.my_person_id(); svcs text[] := coalesce(p_snow_services, '{}'); m record; snow_on boolean; had_land boolean;
begin
  if cardinality(svcs) > 0 and not public._snow_valid_services(svcs) then raise exception 'Unknown snow service.'; end if;
  if not public.admin_can(cid, 'snow_access') and exists (select 1 from public.snow_staff where company_id = cid and person_id = p_person_id) then
    raise exception 'The owner has not allowed admins to change snow access.';
  end if;
  select * into m from public.company_members where company_id = cid and person_id = p_person_id;
  if m.id is not null and m.role not in ('worker') then raise exception 'Only workers have separate modes. Owners and admins work in both.'; end if;
  had_land := m.id is not null and m.status = 'active';
  snow_on := exists (select 1 from public.snow_staff where company_id = cid and person_id = p_person_id and status = 'active');
  if not had_land and not snow_on then raise exception 'This person isn''t active. Use Reactivate.'; end if;
  if not p_landscaping and cardinality(svcs) = 0 then raise exception 'That would remove all their access. Use Deactivate worker instead.'; end if;

  perform set_config('brighton.keep_snow', 'on', true);
  perform set_config('brighton.no_snow_enroll', 'on', true);
  if p_landscaping and not had_land then
    if m.id is null then raise exception 'They have no landscaping record. Ask them to join with a team code.'; end if;
    update public.company_members set status = 'active', deactivated_at = null, deactivated_by = null, approved_by = me, approved_at = now() where id = m.id;
  elsif not p_landscaping and had_land then
    update public.company_members set status = 'inactive', deactivated_at = now(), deactivated_by = me where id = m.id;
  end if;
  perform set_config('brighton.keep_snow', '', true);
  if cardinality(svcs) > 0 then
    perform public.snow_grant_access(p_person_id, svcs);
  elsif snow_on then
    perform public.snow_revoke_access(p_person_id);
  end if;
  perform set_config('brighton.no_snow_enroll', '', true);
  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
  values (cid, 'member_modes_changed', me, p_person_id, jsonb_build_object('landscaping', p_landscaping, 'snow_services', to_jsonb(svcs)));
end;
$$;

-- One list for the Team screen: every person with a place in this company, with their mode access and state.
create or replace function public.team_access_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public._my_staff_company();
begin
  if cid is null then raise exception 'not allowed'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(t)::jsonb order by t.last_name, t.first_name) from (
      select p.id as person_id, p.first_name, p.last_name, coalesce(nullif(p.email, ''), '') as email, p.avatar_url,
             m.role, m.status as member_status, m.worker_type,
             (m.status = 'active' and m.role in ('owner', 'admin', 'worker')) as landscaping,
             coalesce((select array_agg(ss.service order by ss.service) from public.snow_staff_services ss
                        join public.snow_staff s on s.company_id = ss.company_id and s.person_id = ss.person_id and s.status = 'active'
                       where ss.company_id = cid and ss.person_id = p.id), '{}') as snow_services,
             (m.role in ('owner', 'admin') and m.status = 'active') as is_staff,
             exists (select 1 from public.join_requests r where r.company_id = cid and r.person_id = p.id and r.status = 'pending') as pending_team_request,
             exists (select 1 from public.snow_access_requests r where r.company_id = cid and r.person_id = p.id and r.status = 'pending') as pending_snow_request,
             m.deactivated_at, (select trim(d.first_name || ' ' || d.last_name) from public.people d where d.id = m.deactivated_by) as deactivated_by_name,
             p.id = public.my_person_id() as is_me
        from public.people p
        left join public.company_members m on m.person_id = p.id and m.company_id = cid
       where m.id is not null
          or exists (select 1 from public.snow_staff s where s.company_id = cid and s.person_id = p.id)
          or exists (select 1 from public.join_requests r where r.company_id = cid and r.person_id = p.id and r.status = 'pending')
          or exists (select 1 from public.snow_access_requests r where r.company_id = cid and r.person_id = p.id and r.status = 'pending')
    ) t
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.member_deactivation_check(uuid), public.deactivate_member(uuid, boolean), public.reactivate_member(uuid, boolean, text, text[]),
  public.set_member_role(uuid, text), public.set_member_modes(uuid, boolean, text[]), public.team_access_overview() from public, anon;
grant execute on function public.member_deactivation_check(uuid), public.deactivate_member(uuid, boolean), public.reactivate_member(uuid, boolean, text, text[]),
  public.set_member_role(uuid, text), public.set_member_modes(uuid, boolean, text[]), public.team_access_overview() to authenticated;

-- The older "Remove access / Restore access" buttons: removing now follows the same safe path; restoring needs an explicit decision.
create or replace function public.remove_account_access(p_person_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.deactivate_member(p_person_id, true);
end;
$$;
create or replace function public.restore_account_access(p_person_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Choose what they can do again: use Reactivate and pick landscaping and/or snow access.';
end;
$$;

-- ── 5. Join requests can only be decided while they are pending ─────────────
create or replace function public.approve_join_request(p_request_id uuid, p_role text, p_worker_type text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  jr record;
  me uuid := public.my_person_id();
  wtype text;
  mcrew uuid;
  existing record;
begin
  select * into jr from public.join_requests where id = p_request_id for update;
  if jr.id is null then raise exception 'request not found'; end if;
  if not public.is_staff(jr.company_id) or not public.admin_can(jr.company_id, 'invites') then raise exception 'not allowed'; end if;
  if jr.status = 'approved' then return; end if;  -- a double tap
  if jr.status <> 'pending' then raise exception 'That request is no longer open. They need to ask again with a code.'; end if;
  if p_role not in ('worker','customer','admin') then raise exception 'bad role'; end if;
  if p_role = 'admin' and public.member_role(jr.company_id) <> 'owner' then raise exception 'Only the owner can make someone an admin.'; end if;
  if p_worker_type is not null and p_worker_type not in ('landscaping','maintenance') then raise exception 'bad worker type'; end if;
  select * into existing from public.company_members where company_id = jr.company_id and person_id = jr.person_id;
  if existing.id is not null and existing.role = 'owner' then raise exception 'The owner''s account can''t be changed.'; end if;

  wtype := case when p_role = 'worker' then coalesce(p_worker_type, jr.requested_worker_type, 'landscaping') else 'landscaping' end;

  update public.join_requests
  set status = 'approved', assigned_role = p_role, assigned_worker_type = wtype, reviewed_by = me, reviewed_at = now()
  where id = p_request_id;

  perform set_config('brighton.worker_type_change', 'on', true);
  insert into public.company_members (company_id, person_id, role, status, join_method, join_request_id, approved_by, approved_at, worker_type)
  values (jr.company_id, jr.person_id, p_role, 'active', jr.join_method, jr.id, me, now(), wtype)
  on conflict (company_id, person_id) do update
    set role = excluded.role, status = 'active', approved_by = me, approved_at = now(), join_request_id = jr.id,
        worker_type = excluded.worker_type, deactivated_at = null, deactivated_by = null;
  perform set_config('brighton.worker_type_change', '', true);

  if wtype = 'maintenance' then
    select id into mcrew from public.crews where company_id = jr.company_id and is_maintenance;
    if mcrew is not null then
      insert into public.crew_members (company_id, crew_id, person_id)
      values (jr.company_id, mcrew, jr.person_id)
      on conflict (company_id, person_id) do update set crew_id = excluded.crew_id;
    end if;
  else
    delete from public.crew_members cm using public.crews c
    where cm.crew_id = c.id and c.is_maintenance and cm.company_id = jr.company_id and cm.person_id = jr.person_id;
  end if;

  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
  values (jr.company_id, 'join_request_approved', me, jr.person_id,
          jsonb_build_object('role', p_role, 'worker_type', wtype, 'requested_worker_type', jr.requested_worker_type));
end;
$$;

create or replace function public.decline_join_request(p_request_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  jr record;
  me uuid := public.my_person_id();
begin
  select * into jr from public.join_requests where id = p_request_id for update;
  if jr.id is null then raise exception 'request not found'; end if;
  if not public.is_staff(jr.company_id) or not public.admin_can(jr.company_id, 'invites') then raise exception 'not allowed'; end if;
  if jr.status = 'declined' then return; end if;
  if jr.status <> 'pending' then raise exception 'That request is no longer open.'; end if;

  update public.join_requests
  set status = 'declined', decline_reason = p_reason, reviewed_by = me, reviewed_at = now()
  where id = p_request_id;

  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id)
  values (jr.company_id, 'join_request_declined', me, jr.person_id);
end;
$$;

-- ── 6. One code box ──────────────────────────────────────────────────────────
-- Public: which kind of code is this? (Says only whether it works, the company's name and the kind.)
create or replace function public.lookup_any_code(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t jsonb; s jsonb;
begin
  t := public.lookup_team_code(p_code);
  if coalesce((t ->> 'valid')::boolean, false) then return t || jsonb_build_object('kind', 'team'); end if;
  s := public.lookup_snow_code(p_code);
  if coalesce((s ->> 'valid')::boolean, false) then return s || jsonb_build_object('kind', 'snow'); end if;
  return jsonb_build_object('valid', false);
end;
$$;
grant execute on function public.lookup_any_code(text) to anon, authenticated;

-- Signed-in: file the right pending request for this code (the server decides the kind; the phone can't).
create or replace function public.join_with_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pid uuid := public.my_person_id(); r jsonb;
begin
  if pid is null then raise exception 'not signed in'; end if;
  r := public._request_join(pid, p_code);
  if coalesce((r ->> 'success')::boolean, false) then return r || jsonb_build_object('kind', 'team'); end if;
  if r ->> 'error' = 'invalid_code' then
    r := public._request_snow_access(pid, p_code);
    if coalesce((r ->> 'success')::boolean, false) then return r || jsonb_build_object('kind', 'snow'); end if;
  end if;
  return r;
end;
$$;
revoke all on function public.join_with_code(text) from public, anon;
grant execute on function public.join_with_code(text) to authenticated;

-- ── 7. Closing a company ────────────────────────────────────────────────────
-- The record that a company was closed outlives the company (no link to it). Nobody reads it through the app.
create table if not exists public.company_closure_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  company_name text,
  closed_by uuid,
  closed_by_name text,
  counts jsonb not null default '{}',
  closed_at timestamptz not null default now()
);
alter table public.company_closure_log enable row level security;
revoke all on public.company_closure_log from anon, authenticated;

create or replace function public.company_closure_preview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.my_person_id(); cid uuid;
begin
  select company_id into cid from public.company_members where person_id = me and role = 'owner' and status = 'active' limit 1;
  if cid is null then raise exception 'Only the company owner can do that.'; end if;
  return jsonb_build_object(
    'on_the_clock', (select count(*) from public.time_workdays where company_id = cid and clock_out_at is null),
    'timing_a_property', (select count(*) from public.time_intervals where company_id = cid and ended_at is null and status = 'active'),
    'dispatched_storms', (select count(*) from public.snow_storms where company_id = cid and status = 'dispatched'),
    'days_awaiting_approval', (select count(*) from public.time_workdays where company_id = cid and status in ('closed', 'reopened')),
    'pending_join_requests', (select count(*) from public.join_requests where company_id = cid and status = 'pending'),
    'pending_snow_requests', (select count(*) from public.snow_access_requests where company_id = cid and status = 'pending'),
    'open_codes', (select count(*) from public.team_codes where company_id = cid and is_active) + (select count(*) from public.snow_signup_codes where company_id = cid and is_active),
    'team_members', (select count(*) from public.company_members where company_id = cid and status = 'active')
  );
end;
$$;
revoke all on function public.company_closure_preview() from public, anon;
grant execute on function public.company_closure_preview() to authenticated;

-- Same all-or-nothing delete as update 36, with: a refusal while people are on the clock or a storm is dispatched,
-- every code and pending request closed first, and a closure record that is kept.
create or replace function public.delete_my_company(p_confirm_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  pid uuid := public.my_person_id();
  cid uuid;
  cname text;
  t text;
  prev jsonb;
  who text;
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
end;
$$;
revoke execute on function public.delete_my_company(text) from public, anon;
grant execute on function public.delete_my_company(text) to authenticated;

notify pgrst, 'reload schema';
