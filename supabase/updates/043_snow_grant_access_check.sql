-- ============================================================================
-- Update 43 — run once in Supabase → SQL Editor, AFTER 020 and 023
-- (safe to run again). NOT run yet; read it before running.
--
-- Tighter check on giving someone snow access. snow_grant_access() (update 20)
-- only checked that the person exists, so an owner could, by mistake or through a
-- crafted call, give snow access to a customer, a stranger, or someone who works
-- for another company. It now requires that the person is on THIS company's team:
--  • an active owner, admin or worker of the company, or
--  • already on the snow team (so a worker whose access was removed can be restored), or
--  • someone with a snow signup request that is waiting or approved (approving a
--    signup calls this function while the request is still pending).
-- Everything else about the function is unchanged: owner/admin only, services are
-- validated, a repeated call changes nothing, and grants/changes are logged.
-- Existing snow team members and the normal approval and permission-edit paths
-- keep working. No data is changed.
-- ============================================================================

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
  where person_id = me and role in ('owner', 'admin') and status = 'active'
  order by created_at limit 1;
  if cid is null then raise exception 'Only the owner can change snow access.'; end if;
  if p_person_id is null or not exists (select 1 from public.people where id = p_person_id) then
    raise exception 'Person not found.';
  end if;
  -- The person must actually belong to this company's team: an active owner/admin/worker, someone
  -- already on the snow team (including someone whose access was removed), or someone with a snow
  -- request waiting or approved (approving a signup calls this function while the request is still
  -- pending). A customer, a stranger, or a person from another company can't be given snow access.
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

  if coalesce(was_active, false) and prev = svcs then return; end if;  -- double tap: nothing changed
  insert into public.snow_access_log (company_id, person_id, actor_id, action, services, previous_services)
  values (cid, p_person_id, me,
          case when coalesce(was_active, false) then 'services_changed' else 'granted' end,
          svcs, case when coalesce(was_active, false) then prev else '{}' end);
end;
$$;

-- Same permission as before (update 20): not callable by anonymous visitors.
revoke execute on function public.snow_grant_access(uuid, text[]) from anon;
