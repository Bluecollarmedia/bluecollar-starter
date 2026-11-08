-- ============================================================================
-- Update 78 — private one-time invite links replace team codes, Snow codes, project codes and customer codes.
-- Run once in Supabase → SQL Editor, AFTER update 77 (safe to run again). NOT run yet; read it before running.
--
-- How it works now
--   * The owner adds a worker (name + phone) or a customer. The database makes ONE private link for that person. The link can be copied or
--     texted from the owner's phone. It works once, only for that person, and expires after 7 days; the owner can send a fresh one (the old
--     one stops) or cancel it.
--   * The person opens the link, makes a login, and fills in their details (they may correct their name). Creating the login uses the link
--     to attach it to the record the owner made. That all happens in one step inside the database, so it works with email confirmation on or off,
--     and the link is used up at the same moment.
--   * Nothing is matched by email address or name any more. Only the link connects a login to a person.
--   * There is no "maintenance worker" or "regular worker". Every worker starts the same; the owner then chooses what each worker works on
--     (Landscaping, Maintenance) and gives Snow access separately (existing Snow access).
--   * The old code paths (team codes, Snow codes, project codes, join requests, email invitations) are switched OFF: the app functions behind them
--     can no longer be called and the sign-up no longer reads them. The tables are left as they are (nothing is dropped); they can be removed later.
--
-- Links are stored only as a one-way hash, so the database cannot show a link again; "Send again" makes a new one.
-- ============================================================================

-- ── 1. What each worker works on ──────────────────────────────────────────────
alter table public.company_members add column if not exists works_landscaping boolean not null default true;
alter table public.company_members add column if not exists works_maintenance boolean not null default false;
-- Existing maintenance workers keep working on Maintenance only (run once; safe to repeat).
update public.company_members set works_maintenance = true, works_landscaping = false where worker_type = 'maintenance' and not works_maintenance;

-- The older single "worker type" column is kept in step with the two switches so older screens and functions keep reading something sensible.
create or replace function public._sync_worker_areas()
returns trigger language plpgsql as $$
begin
  -- A row inserted the older way (worker_type 'maintenance' and nothing else said) means "works on Maintenance only".
  if tg_op = 'INSERT' and new.worker_type = 'maintenance' and not new.works_maintenance then
    new.works_maintenance := true;
    new.works_landscaping := false;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.worker_type is distinct from old.worker_type and new.works_landscaping is not distinct from old.works_landscaping and new.works_maintenance is not distinct from old.works_maintenance then
      new.works_maintenance := (new.worker_type = 'maintenance');
      new.works_landscaping := (new.worker_type <> 'maintenance');
      return new;
    end if;
  end if;
  new.worker_type := case when new.works_maintenance and not new.works_landscaping then 'maintenance' else 'landscaping' end;
  return new;
end;
$$;
drop trigger if exists company_members_sync_areas on public.company_members;
create trigger company_members_sync_areas before insert or update of works_landscaping, works_maintenance, worker_type on public.company_members
  for each row execute function public._sync_worker_areas();

-- Only the database function below changes the switches (so every change is logged), not a plain edit from a phone.
create or replace function public._guard_worker_areas()
returns trigger language plpgsql as $$
begin
  if (new.works_landscaping is distinct from old.works_landscaping or new.works_maintenance is distinct from old.works_maintenance)
     and current_user in ('authenticated', 'anon') and coalesce(current_setting('brighton.worker_type_change', true), '') <> 'on' then
    new.works_landscaping := old.works_landscaping;
    new.works_maintenance := old.works_maintenance;
  end if;
  return new;
end;
$$;
drop trigger if exists company_members_guard_areas on public.company_members;
create trigger company_members_guard_areas before update of works_landscaping, works_maintenance on public.company_members
  for each row execute function public._guard_worker_areas();

-- Everything that used to ask "is this a maintenance worker?" now asks "does this worker work on Maintenance?".
create or replace function public.is_maintenance_worker(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_members
    where company_id = cid and person_id = public.my_person_id()
      and status = 'active' and role = 'worker' and works_maintenance
  )
$$;

create or replace function public.person_is_maintenance_worker(cid uuid, pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_members
    where company_id = cid and person_id = pid
      and status = 'active' and role = 'worker' and works_maintenance
  )
$$;

create or replace function public._check_maintenance_crew_member()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.crews c where c.id = new.crew_id and c.is_maintenance)
     and not exists (
       select 1 from public.company_members m
       where m.company_id = new.company_id and m.person_id = new.person_id
         and m.role = 'worker' and m.works_maintenance)
  then
    raise exception 'Only workers who work on Maintenance can be in the Maintenance Crew';
  end if;
  return new;
end;
$$;

create or replace function public._check_maintenance_crew()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.is_maintenance and not coalesce(old.is_maintenance, false) and exists (
    select 1 from public.crew_members cm
    join public.company_members m on m.company_id = cm.company_id and m.person_id = cm.person_id
    where cm.crew_id = new.id and (m.role <> 'worker' or not m.works_maintenance)
  ) then
    raise exception 'This crew has workers who do not work on Maintenance. Take them out before making it the Maintenance Crew.';
  end if;
  return new;
end;
$$;

create or replace function public._time_attendance_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if exists (select 1 from public.company_members m where m.company_id = new.company_id and m.person_id = new.person_id and m.works_maintenance) then
    select r.id into rid from public.maintenance_routes r join public.maintenance_route_crew c on c.route_id = r.id
     where c.person_id = new.person_id and r.service_date = new.work_date and r.status <> 'cancelled' order by r.created_at limit 1;
    -- A day the owner adds by hand (the worker forgot to clock in) is recorded as an owner correction, not as the worker's arrival.
    insert into public.maintenance_day_attendance (company_id, person_id, service_date, route_id, started_at, source, location_status)
    values (new.company_id, new.person_id, new.work_date, rid,
            new.clock_in_at, case when public.my_person_id() is not distinct from new.person_id then 'worker' else 'owner_correction' end, 'unavailable')
    on conflict (company_id, person_id, service_date) do nothing;
  end if;
  return null;
end;
$$;
revoke all on function public._time_attendance_sync() from public, anon, authenticated;

-- Owner/admin choose what a worker works on. Snow is separate (snow_grant_access / snow_revoke_access).
create or replace function public.set_worker_areas(p_person_id uuid, p_landscaping boolean, p_maintenance boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  m record;
begin
  select * into m from public.company_members
   where person_id = p_person_id and role = 'worker'
     and company_id in (select company_id from public.company_members where person_id = me and role in ('owner', 'admin') and status = 'active')
   limit 1;
  if m.id is null then raise exception 'not allowed'; end if;
  if not public.admin_can(m.company_id, 'team') then raise exception 'Only the owner (or an admin the owner allows) can do that.'; end if;
  if m.works_landscaping = coalesce(p_landscaping, false) and m.works_maintenance = coalesce(p_maintenance, false) then return; end if;

  perform set_config('brighton.worker_type_change', 'on', true);
  update public.company_members set works_landscaping = coalesce(p_landscaping, false), works_maintenance = coalesce(p_maintenance, false) where id = m.id;
  perform set_config('brighton.worker_type_change', '', true);

  -- A worker who no longer works on Maintenance leaves the Maintenance Crew.
  if not coalesce(p_maintenance, false) then
    delete from public.crew_members cm using public.crews c
     where cm.crew_id = c.id and c.is_maintenance and cm.company_id = m.company_id and cm.person_id = p_person_id;
  end if;

  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
  values (m.company_id, 'worker_areas_changed', me, p_person_id,
          jsonb_build_object('landscaping', coalesce(p_landscaping, false), 'maintenance', coalesce(p_maintenance, false),
                             'was_landscaping', m.works_landscaping, 'was_maintenance', m.works_maintenance));
end;
$$;
revoke all on function public.set_worker_areas(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_worker_areas(uuid, boolean, boolean) to authenticated;

-- The Team screen's list now also says what each worker works on.
create or replace function public.team_access_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public._my_staff_company();
begin
  if cid is null then raise exception 'not allowed'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(t)::jsonb order by t.last_name, t.first_name) from (
      select p.id as person_id, p.first_name, p.last_name, coalesce(nullif(p.email, ''), '') as email, p.avatar_url, p.phone,
             m.role, m.status as member_status, m.worker_type, m.works_landscaping, m.works_maintenance,
             (m.status = 'active' and m.role in ('owner', 'admin', 'worker')) as landscaping,
             coalesce((select array_agg(ss.service order by ss.service) from public.snow_staff_services ss
                        join public.snow_staff s on s.company_id = ss.company_id and s.person_id = ss.person_id and s.status = 'active'
                       where ss.company_id = cid and ss.person_id = p.id), '{}') as snow_services,
             (m.role in ('owner', 'admin') and m.status = 'active') as is_staff,
             false as pending_team_request,
             false as pending_snow_request,
             m.deactivated_at, (select trim(d.first_name || ' ' || d.last_name) from public.people d where d.id = m.deactivated_by) as deactivated_by_name,
             p.id = public.my_person_id() as is_me
        from public.people p
        left join public.company_members m on m.person_id = p.id and m.company_id = cid
       where m.id is not null
          or exists (select 1 from public.snow_staff s where s.company_id = cid and s.person_id = p.id)
    ) t
  ), '[]'::jsonb);
end;
$$;

-- ── 2. Invite links ───────────────────────────────────────────────────────────
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- The record the owner created (a worker or a customer with no login yet). The link attaches the new login to it.
  person_id uuid not null references public.people(id) on delete cascade,
  kind text not null check (kind in ('worker', 'customer')),
  -- Only a one-way hash of the link is stored.
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'used', 'revoked')),
  expires_at timestamptz not null,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists idx_invites_person on public.invites (person_id);
create index if not exists idx_invites_company on public.invites (company_id, status);
alter table public.invites enable row level security;   -- no policies: only the functions below read or write it
revoke all on public.invites from anon, authenticated;

create or replace function public._invite_hash(p_token text)
returns text language sql immutable as $$ select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') $$;
revoke all on function public._invite_hash(text) from public, anon, authenticated;

-- Owner (or an admin the owner allows to send invites).
create or replace function public._invite_staff_company()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.company_members
   where person_id = public.my_person_id() and role in ('owner', 'admin') and status = 'active' and public.admin_can(company_id, 'invites')
   order by created_at limit 1
$$;
revoke all on function public._invite_staff_company() from public, anon, authenticated;

-- Makes a fresh link for one person and cancels any earlier unused one. Returns the link's secret part (shown once, never stored).
create or replace function public._invite_issue(p_company uuid, p_person uuid, p_kind text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare tok text; inv public.invites;
begin
  update public.invites set status = 'revoked', revoked_at = now() where person_id = p_person and status = 'pending';
  tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.invites (company_id, person_id, kind, token_hash, expires_at, created_by, last_sent_at)
  values (p_company, p_person, p_kind, public._invite_hash(tok), now() + interval '7 days', p_actor, now())
  returning * into inv;
  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
  values (p_company, 'invite_created', p_actor, p_person, jsonb_build_object('kind', p_kind, 'invite_id', inv.id));
  return jsonb_build_object('invite_id', inv.id, 'token', tok, 'expires_at', inv.expires_at, 'person_id', p_person);
end;
$$;
revoke all on function public._invite_issue(uuid, uuid, text, uuid) from public, anon, authenticated;

-- Add a worker: name and phone only. Creates their record and their private link.
create or replace function public.add_worker(p_first text, p_last text, p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public._invite_staff_company();
  me uuid := public.my_person_id();
  first text := btrim(coalesce(p_first, ''));
  last text := btrim(coalesce(p_last, ''));
  phone text := btrim(coalesce(p_phone, ''));
  digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  pid uuid;
begin
  if cid is null then raise exception 'Only the owner (or an admin the owner allows) can add workers.'; end if;
  if first = '' then raise exception 'Enter the worker''s first name.'; end if;
  if length(digits) < 7 then raise exception 'Enter the worker''s phone number.'; end if;
  -- The same phone number twice in one company is almost certainly the same person: send that worker a new link instead.
  if exists (select 1 from public.company_members m join public.people p on p.id = m.person_id
              where m.company_id = cid and m.role = 'worker' and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = digits) then
    raise exception 'A worker with that phone number is already on your team. Open them to send a new link.';
  end if;
  insert into public.people (email, first_name, last_name, phone) values ('', first, last, phone) returning id into pid;
  insert into public.company_members (company_id, person_id, role, status, join_method, approved_by, approved_at)
  values (cid, pid, 'worker', 'invited', 'invitation_link', me, now());
  return public._invite_issue(cid, pid, 'worker', me) || jsonb_build_object('created', true);
end;
$$;
revoke all on function public.add_worker(text, text, text) from public, anon;
grant execute on function public.add_worker(text, text, text) to authenticated;

-- A new link for someone already added (a worker or a customer who has not signed up yet). The old link stops working.
create or replace function public.invite_send(p_person uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cid uuid := public._invite_staff_company(); me uuid := public.my_person_id(); m record; has_login boolean;
begin
  if cid is null then raise exception 'Only the owner (or an admin the owner allows) can send invites.'; end if;
  select cm.role, cm.status, p.user_id is not null as has_login into m
    from public.company_members cm join public.people p on p.id = cm.person_id
   where cm.company_id = cid and cm.person_id = p_person and cm.role in ('worker', 'customer');
  if not found then raise exception 'Person not found.'; end if;
  if m.has_login then raise exception 'This person already has a login.'; end if;
  if m.status = 'inactive' then raise exception 'This person''s access was removed. Reactivate them first.'; end if;
  return public._invite_issue(cid, p_person, m.role, me);
end;
$$;
revoke all on function public.invite_send(uuid) from public, anon;
grant execute on function public.invite_send(uuid) to authenticated;

create or replace function public.invite_revoke(p_invite uuid)
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid := public._invite_staff_company(); me uuid := public.my_person_id();
begin
  if cid is null then raise exception 'not allowed'; end if;
  update public.invites set status = 'revoked', revoked_at = now() where id = p_invite and company_id = cid and status = 'pending';
  if found then
    insert into public.membership_audit_log (company_id, event_type, actor_id, metadata) values (cid, 'invite_revoked', me, jsonb_build_object('invite_id', p_invite));
  end if;
end;
$$;
revoke all on function public.invite_revoke(uuid) from public, anon;
grant execute on function public.invite_revoke(uuid) to authenticated;

-- The owner's list of links that have not been used: who, when it expires. (Never the link itself.)
create or replace function public.invites_pending()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public._invite_staff_company();
begin
  if cid is null then raise exception 'not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', i.id, 'person_id', i.person_id, 'kind', i.kind, 'first_name', p.first_name, 'last_name', p.last_name,
             'phone', p.phone, 'expires_at', i.expires_at, 'expired', i.expires_at <= now(), 'created_at', i.created_at, 'last_sent_at', i.last_sent_at)
           order by i.created_at desc)
      from public.invites i join public.people p on p.id = i.person_id
     where i.company_id = cid and i.status = 'pending'
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.invites_pending() from public, anon;
grant execute on function public.invites_pending() to authenticated;

-- What the invite page shows before the person signs up. Works without being signed in. Nothing private is returned.
create or replace function public.invite_lookup(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare inv public.invites; r record;
begin
  select * into inv from public.invites where token_hash = public._invite_hash(p_token);
  if not found then return jsonb_build_object('valid', false, 'reason', 'invalid'); end if;
  if inv.status = 'used' then return jsonb_build_object('valid', false, 'reason', 'used'); end if;
  if inv.status = 'revoked' then return jsonb_build_object('valid', false, 'reason', 'invalid'); end if;
  if inv.expires_at <= now() then return jsonb_build_object('valid', false, 'reason', 'expired'); end if;
  select p.first_name, p.last_name, p.phone, c.name as company_name into r
    from public.people p, public.companies c where p.id = inv.person_id and c.id = inv.company_id;
  return jsonb_build_object('valid', true, 'kind', inv.kind, 'company_name', r.company_name, 'first_name', r.first_name, 'last_name', r.last_name, 'phone', coalesce(r.phone, ''));
end;
$$;
revoke all on function public.invite_lookup(text) from public;
grant execute on function public.invite_lookup(text) to anon, authenticated;

-- For someone who ALREADY has a login (for example a customer of another company): attach this company's record to their existing account.
create or replace function public.invite_accept(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  inv public.invites;
  cname text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  update public.invites set status = 'used', used_at = now()
   where token_hash = public._invite_hash(p_token) and status = 'pending' and expires_at > now()
  returning * into inv;
  if not found then return jsonb_build_object('success', false, 'error', 'invalid_or_used'); end if;

  if inv.person_id <> me then
    if exists (select 1 from public.company_members where company_id = inv.company_id and person_id = me) then
      raise exception 'You are already part of this company.';
    end if;
    if inv.kind = 'customer' then
      -- The owner may already have attached projects to the record; everything moves to this account.
      insert into public.company_members (company_id, person_id, role, status, join_method)
        values (inv.company_id, me, 'customer', 'active', 'invitation_link') on conflict do nothing;
      perform public._merge_placeholder_customer(inv.company_id, inv.person_id, me);
    else
      update public.company_members set person_id = me, status = 'active', join_method = 'invitation_link'
       where company_id = inv.company_id and person_id = inv.person_id and role = 'worker';
      begin
        delete from public.people where id = inv.person_id and user_id is null;
      exception when foreign_key_violation then null;
      end;
    end if;
  end if;
  select name into cname from public.companies where id = inv.company_id;
  return jsonb_build_object('success', true, 'company_name', cname, 'kind', inv.kind);
end;
$$;
revoke all on function public.invite_accept(text) from public, anon;
grant execute on function public.invite_accept(text) to authenticated;

-- ── 3. Sign-up: the link (and only the link) connects a new login to an owner-made record ─────
-- Replaces the old sign-up function: no matching by email address, no team codes, no project codes, no email invitations.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  pid uuid;
  inv public.invites;
begin
  if coalesce(meta->>'invite_token', '') <> '' then
    begin
      -- Using the link and making the login are one step: the link is marked used first, so it cannot be used twice.
      update public.invites set status = 'used', used_at = now()
       where token_hash = public._invite_hash(meta->>'invite_token') and status = 'pending' and expires_at > now()
      returning * into inv;
      if found then
        update public.people set
          user_id = new.id,
          email = coalesce(new.email, ''),
          -- A worker can correct their own name here. A customer keeps the name the owner typed (the form only fills in a part the owner left empty).
          first_name = case when inv.kind = 'customer' then coalesce(nullif(btrim(first_name), ''), nullif(btrim(meta->>'first_name'), ''), first_name)
                            else coalesce(nullif(btrim(meta->>'first_name'), ''), first_name) end,
          last_name = case when inv.kind = 'customer' then coalesce(nullif(btrim(last_name), ''), nullif(btrim(meta->>'last_name'), ''), last_name)
                           else coalesce(nullif(btrim(meta->>'last_name'), ''), last_name) end,
          phone = coalesce(nullif(btrim(meta->>'phone'), ''), phone)
        where id = inv.person_id and user_id is null
        returning id into pid;
        if pid is not null then
          update public.company_members set status = 'active' where person_id = pid and company_id = inv.company_id and status = 'invited';
          insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
          values (inv.company_id, 'invite_used', pid, pid, jsonb_build_object('kind', inv.kind, 'invite_id', inv.id));
        end if;
      end if;
    exception when others then raise warning 'invite link failed: %', sqlerrm;
    end;
  end if;

  if pid is null then
    insert into public.people (user_id, email, first_name, last_name, phone)
    values (new.id, coalesce(new.email, ''), coalesce(meta->>'first_name', ''), coalesce(meta->>'last_name', ''), nullif(meta->>'phone', ''))
    returning id into pid;
  end if;

  -- Someone starting their own company (unchanged).
  begin
    if coalesce(meta->>'company_name', '') <> '' then
      perform public._create_company(pid, meta);
    end if;
  exception when others then raise warning 'create company failed: %', sqlerrm;
  end;

  return new;
end;
$$;

-- Snow codes at sign-up are gone.
drop trigger if exists on_auth_user_created_snow on auth.users;

-- ── 4. The old code paths are switched off (the tables are kept) ─────────────────
do $$
declare f text; sig text;
begin
  foreach f in array array[
    'lookup_team_code', 'lookup_snow_code', 'lookup_any_code', 'lookup_project_code', 'join_with_code', 'request_join', 'claim_project',
    'approve_join_request', 'decline_join_request', 'request_snow_access', 'withdraw_my_snow_request', 'list_snow_access_requests',
    'approve_snow_access_request', 'decline_snow_access_request', 'remove_snow_access_request', 'regenerate_snow_signup_code',
    'disable_snow_signup_code', 'regenerate_project_code', 'set_worker_type'
  ] loop
    for sig in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f loop
      execute format('revoke all on function %s from public, anon, authenticated', sig);
    end loop;
  end loop;
end $$;

notify pgrst, 'reload schema';
