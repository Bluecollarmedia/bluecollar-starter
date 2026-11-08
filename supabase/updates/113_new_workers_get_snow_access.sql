-- ============================================================================
-- Update 113 — run once in Supabase → SQL Editor, AFTER 112. Safe to run again.
--
-- A new worker gets ALL Snow services (plowing, shoveling, salting) automatically when they sign up, so they are on the snow team from the
-- first minute (their Route and Time Clock appear, with a Clock In) without the owner having to turn anything on.
--   * The Snow access feature stays exactly as it is: the owner can still take a service away from anyone, or revoke access, in the Snow team
--     screens. This only decides what a NEW worker starts with. Someone the owner has already revoked is never switched back on.
--   * Also applied once to workers who joined in the last 14 days and have no Snow access yet (so a worker added moments ago is not stranded).
--   * ADDITIVE: one trigger and one function. Nothing existing is changed.
-- ============================================================================

create or replace function public._snow_new_worker_access()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role <> 'worker' or new.status <> 'active' then return new; end if;
  if exists (select 1 from public.snow_staff s where s.company_id = new.company_id and s.person_id = new.person_id) then return new; end if;
  insert into public.snow_staff (company_id, person_id, status, granted_at) values (new.company_id, new.person_id, 'active', now())
  on conflict (company_id, person_id) do nothing;
  insert into public.snow_staff_services (company_id, person_id, service)
  select new.company_id, new.person_id, s from unnest(array['plowing', 'shoveling', 'salting']) s
  on conflict do nothing;
  return new;
exception when others then
  return new;   -- never stops someone from joining
end;
$$;
revoke all on function public._snow_new_worker_access() from public, anon, authenticated;

drop trigger if exists company_members_snow_access on public.company_members;
create trigger company_members_snow_access after insert or update of status, role on public.company_members
  for each row execute function public._snow_new_worker_access();

-- Workers who joined recently and have no Snow access row yet.
insert into public.snow_staff (company_id, person_id, status, granted_at)
select m.company_id, m.person_id, 'active', now()
  from public.company_members m
 where m.role = 'worker' and m.status = 'active' and m.created_at >= now() - interval '14 days'
   and not exists (select 1 from public.snow_staff s where s.company_id = m.company_id and s.person_id = m.person_id)
on conflict (company_id, person_id) do nothing;

insert into public.snow_staff_services (company_id, person_id, service)
select s.company_id, s.person_id, x
  from public.snow_staff s
  cross join unnest(array['plowing', 'shoveling', 'salting']) x
 where s.status = 'active' and s.granted_by is null and s.granted_at >= now() - interval '1 minute'
   and not exists (select 1 from public.snow_staff_services v where v.company_id = s.company_id and v.person_id = s.person_id)
on conflict do nothing;

notify pgrst, 'reload schema';
