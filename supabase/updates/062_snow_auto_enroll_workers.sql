-- ============================================================================
-- Update 62 — run once in Supabase → SQL Editor (safe to run again).
--
-- Snow Mode no longer needs every landscaping worker to sign up for it. When the owner turns on Snow Mode, every active
-- worker of the company is put on the snow team automatically with all three services (plowing, shoveling, salting), so
-- they can be made a route lead or crew member without doing anything. A worker who joins while Snow Mode is already on is
-- put on the snow team the same way.
--  • The owner can still REMOVE anyone's snow access (More → Snow team → remove). A removed worker is never added back
--    automatically, not even the next time Snow Mode is switched on; the owner can give access again by hand.
--  • Owners and admins are unchanged (they always had snow access).
--  • Nothing is taken away from anyone, and nothing happens while the company is in Landscaping Mode.
--  • This replaces the old rule "switching to Snow Mode grants nobody anything" (update 20), on purpose.
-- ============================================================================

-- Puts one person on the snow team with every service, unless they already have a snow team row (active or removed).
create or replace function public._snow_enroll_person(p_company uuid, p_person uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare svcs text[] := array['plowing', 'shoveling', 'salting'];
begin
  if exists (select 1 from public.snow_staff where company_id = p_company and person_id = p_person) then
    return false;  -- already on the team, or removed on purpose: leave as it is
  end if;
  insert into public.snow_staff (company_id, person_id, status, granted_by, granted_at)
  values (p_company, p_person, 'active', null, now());
  insert into public.snow_staff_services (company_id, person_id, service, granted_by)
  select p_company, p_person, s, null from unnest(svcs) s
  on conflict do nothing;
  insert into public.snow_access_log (company_id, person_id, actor_id, action, services, previous_services)
  values (p_company, p_person, null, 'granted', svcs, '{}');
  return true;
end;
$$;
revoke all on function public._snow_enroll_person(uuid, uuid) from public, anon, authenticated;

-- Every active worker of a company. Returns how many were newly put on the team.
create or replace function public._snow_enroll_workers(p_company uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare m record; n integer := 0;
begin
  for m in
    select person_id from public.company_members
    where company_id = p_company and role = 'worker' and status = 'active'
  loop
    if public._snow_enroll_person(p_company, m.person_id) then n := n + 1; end if;
  end loop;
  return n;
end;
$$;
revoke all on function public._snow_enroll_workers(uuid) from public, anon, authenticated;

-- The owner switches the company to Snow Mode.
create or replace function public._snow_mode_enroll_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.active_mode = 'snow' and old.active_mode is distinct from new.active_mode then
    perform public._snow_enroll_workers(new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists companies_snow_enroll on public.companies;
create trigger companies_snow_enroll after update of active_mode on public.companies
  for each row execute function public._snow_mode_enroll_trigger();

-- A worker joins (or is approved) while the company is already in Snow Mode.
create or replace function public._snow_member_enroll_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'worker' and new.status = 'active'
     and exists (select 1 from public.companies c where c.id = new.company_id and c.active_mode = 'snow') then
    perform public._snow_enroll_person(new.company_id, new.person_id);
  end if;
  return null;
end;
$$;
drop trigger if exists company_members_snow_enroll on public.company_members;
create trigger company_members_snow_enroll after insert or update of role, status on public.company_members
  for each row execute function public._snow_member_enroll_trigger();

-- A company that is in Snow Mode right now: its workers are put on the team now.
do $$
declare c record;
begin
  for c in select id from public.companies where active_mode = 'snow' loop
    perform public._snow_enroll_workers(c.id);
  end loop;
end $$;
