-- ============================================================================
-- Update 19 — run once in Supabase → SQL Editor, AFTER update 18 (safe to run again).
-- Update 18 added worker_type ('landscaping' / 'maintenance') and the
-- Maintenance Crew flag. This one handles signing up and reclassifying:
--  • The owner gets a second team code for maintenance workers. A request made
--    with it is marked "applied as maintenance", but it still waits for the
--    owner to approve it, exactly like the regular code.
--  • When approving, the owner picks the type (pre-set from the code). New
--    maintenance workers join the Maintenance Crew, if one is set up.
--  • Only the owner/admin can change a worker's type later, through
--    set_worker_type(), and every change is written to the audit log. A plain
--    row update can't reclassify anyone.
--  • Only maintenance workers can be in the Maintenance Crew.
-- Customer project codes are not touched.
-- ============================================================================

-- ── Columns ─────────────────────────────────────────────────────────────────

alter table public.team_codes
  add column if not exists worker_type text not null default 'landscaping';
alter table public.join_requests
  add column if not exists requested_worker_type text not null default 'landscaping';
alter table public.join_requests
  add column if not exists assigned_worker_type text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'team_codes_worker_type_check') then
    alter table public.team_codes add constraint team_codes_worker_type_check
      check (worker_type in ('landscaping','maintenance'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'join_requests_requested_worker_type_check') then
    alter table public.join_requests add constraint join_requests_requested_worker_type_check
      check (requested_worker_type in ('landscaping','maintenance'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'join_requests_assigned_worker_type_check') then
    alter table public.join_requests add constraint join_requests_assigned_worker_type_check
      check (assigned_worker_type is null or assigned_worker_type in ('landscaping','maintenance'));
  end if;
end $$;

-- ── Worker type can only change through set_worker_type / approval ─────────

create or replace function public._guard_worker_type()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.worker_type is distinct from old.worker_type
     and coalesce(current_setting('brighton.worker_type_change', true), '') <> 'on' then
    -- A plain update can't reclassify anyone; keep the old type.
    new.worker_type := old.worker_type;
  end if;
  return new;
end;
$$;
drop trigger if exists company_members_guard_worker_type on public.company_members;
create trigger company_members_guard_worker_type before update of worker_type on public.company_members
  for each row execute function public._guard_worker_type();

-- The applicant can't change which type they applied as after filing.
create or replace function public._guard_requested_worker_type()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.requested_worker_type is distinct from old.requested_worker_type then
    new.requested_worker_type := old.requested_worker_type;
  end if;
  if new.assigned_worker_type is distinct from old.assigned_worker_type
     and not public.is_staff(new.company_id) then
    new.assigned_worker_type := old.assigned_worker_type;
  end if;
  return new;
end;
$$;
drop trigger if exists join_requests_guard_worker_type on public.join_requests;
create trigger join_requests_guard_worker_type before update on public.join_requests
  for each row execute function public._guard_requested_worker_type();

-- ── Maintenance Crew holds maintenance workers only ─────────────────────────

create or replace function public._check_maintenance_crew_member()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.crews c where c.id = new.crew_id and c.is_maintenance)
     and not exists (
       select 1 from public.company_members m
       where m.company_id = new.company_id and m.person_id = new.person_id
         and m.role = 'worker' and m.worker_type = 'maintenance')
  then
    raise exception 'Only maintenance workers can be in the Maintenance Crew';
  end if;
  return new;
end;
$$;
drop trigger if exists crew_members_maintenance_only on public.crew_members;
create trigger crew_members_maintenance_only before insert or update on public.crew_members
  for each row execute function public._check_maintenance_crew_member();

create or replace function public._check_maintenance_crew()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.is_maintenance and not coalesce(old.is_maintenance, false) and exists (
    select 1 from public.crew_members cm
    join public.company_members m on m.company_id = cm.company_id and m.person_id = cm.person_id
    where cm.crew_id = new.id and (m.role <> 'worker' or m.worker_type <> 'maintenance')
  ) then
    raise exception 'This crew has landscaping workers in it. Take them out before making it the Maintenance Crew.';
  end if;
  return new;
end;
$$;
drop trigger if exists crews_maintenance_check on public.crews;
create trigger crews_maintenance_check before insert or update of is_maintenance on public.crews
  for each row execute function public._check_maintenance_crew();

-- ── Team codes carry the worker type ────────────────────────────────────────

create or replace function public.lookup_team_code(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object('valid', coalesce(s.join_by_code_enabled, true),
                              'company_id', c.id, 'company_name', c.name,
                              'worker_type', t.worker_type)
    from public.team_codes t
    join public.companies c on c.id = t.company_id
    left join public.company_join_settings s on s.company_id = c.id
    where upper(t.code) = upper(trim(p_code)) and t.is_active
  ), jsonb_build_object('valid', false))
$$;

-- Same as before, plus: the request remembers which kind of code was used.
-- It is still only a pending request; nothing is granted here.
create or replace function public._request_join(pid uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tc record;
  rid uuid;
begin
  select t.*, s.join_by_code_enabled into tc
  from public.team_codes t
  left join public.company_join_settings s on s.company_id = t.company_id
  where upper(t.code) = upper(trim(p_code)) and t.is_active;

  if tc.id is null then
    return jsonb_build_object('success', false, 'error', 'invalid_code');
  end if;
  if tc.join_by_code_enabled is false then
    return jsonb_build_object('success', false, 'error', 'code_disabled');
  end if;
  if exists (select 1 from public.company_members where company_id = tc.company_id and person_id = pid and status = 'active') then
    return jsonb_build_object('success', false, 'error', 'already_member');
  end if;

  select id into rid from public.join_requests
  where company_id = tc.company_id and person_id = pid and status = 'pending';
  if rid is null then
    insert into public.join_requests (company_id, person_id, join_method, requested_role, requested_worker_type)
    values (tc.company_id, pid, 'team_code', 'worker', coalesce(tc.worker_type, 'landscaping')) returning id into rid;
    insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
    values (tc.company_id, 'join_request_submitted', pid, pid,
            jsonb_build_object('worker_type', coalesce(tc.worker_type, 'landscaping')));
  end if;

  return jsonb_build_object('success', true, 'request_id', rid, 'company_id', tc.company_id);
end;
$$;

-- ── Approval: the owner decides the type ────────────────────────────────────

-- Replaces the two-argument version. p_worker_type null = what they applied as.
drop function if exists public.approve_join_request(uuid, text);
create or replace function public.approve_join_request(p_request_id uuid, p_role text, p_worker_type text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  jr record;
  me uuid := public.my_person_id();
  wtype text;
  mcrew uuid;
begin
  select * into jr from public.join_requests where id = p_request_id;
  if jr.id is null then raise exception 'request not found'; end if;
  if not public.is_staff(jr.company_id) then raise exception 'not allowed'; end if;
  if p_role not in ('worker','customer','admin') then raise exception 'bad role'; end if;
  if p_worker_type is not null and p_worker_type not in ('landscaping','maintenance') then raise exception 'bad worker type'; end if;

  wtype := case when p_role = 'worker' then coalesce(p_worker_type, jr.requested_worker_type, 'landscaping') else 'landscaping' end;

  update public.join_requests
  set status = 'approved', assigned_role = p_role, assigned_worker_type = wtype, reviewed_by = me, reviewed_at = now()
  where id = p_request_id;

  perform set_config('brighton.worker_type_change', 'on', true);
  insert into public.company_members (company_id, person_id, role, status, join_method, join_request_id, approved_by, approved_at, worker_type)
  values (jr.company_id, jr.person_id, p_role, 'active', jr.join_method, jr.id, me, now(), wtype)
  on conflict (company_id, person_id) do update
    set role = excluded.role, status = 'active', approved_by = me, approved_at = now(), join_request_id = jr.id,
        worker_type = excluded.worker_type;
  perform set_config('brighton.worker_type_change', '', true);

  -- New maintenance workers join the Maintenance Crew, if the owner set one up.
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

-- ── Owner-only reclassification ─────────────────────────────────────────────

create or replace function public.set_worker_type(p_person_id uuid, p_type text)
returns void language plpgsql security definer set search_path = public as $$
declare
  m record;
  me uuid := public.my_person_id();
begin
  if p_type not in ('landscaping','maintenance') then raise exception 'bad worker type'; end if;
  select * into m from public.company_members
  where person_id = p_person_id and company_id in (
    select company_id from public.company_members where person_id = me and role in ('owner','admin') and status = 'active')
  limit 1;
  if m.id is null then raise exception 'not allowed'; end if;
  if m.role <> 'worker' then raise exception 'only workers have a worker type'; end if;
  if m.worker_type = p_type then return; end if;

  perform set_config('brighton.worker_type_change', 'on', true);
  update public.company_members set worker_type = p_type where id = m.id;
  perform set_config('brighton.worker_type_change', '', true);

  -- A worker who is no longer maintenance leaves the Maintenance Crew.
  if p_type = 'landscaping' then
    delete from public.crew_members cm using public.crews c
    where cm.crew_id = c.id and c.is_maintenance and cm.company_id = m.company_id and cm.person_id = p_person_id;
  end if;

  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
  values (m.company_id, 'worker_type_changed', me, p_person_id,
          jsonb_build_object('from', m.worker_type, 'to', p_type));
end;
$$;

grant execute on function public.lookup_team_code(text) to anon, authenticated;
grant execute on function
  public.approve_join_request(uuid, text, text), public.set_worker_type(uuid, text)
  to authenticated;
revoke execute on function public._request_join(uuid, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
