-- ============================================================================
-- Update 65 — run once in Supabase → SQL Editor (safe to run again). Run it AFTER 064.
--
-- Time tracking, small follow-ups:
--  • Landscaping job order now matches what the worker sees on Today: full-day jobs last, then by start time, then the owner's
--    order. (Update 63 compared the owner's order first.)
--  • A maintenance worker who clocks in is also recorded as having started the day on today's route, so the existing maintenance
--    route review keeps showing "start of day" (with the location marked "not available": the workday clock has no GPS check).
-- ============================================================================

create or replace function public._time_blocking_stop(p_source text, p_ref uuid, p_person uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare s public.maintenance_stops; a public.assignments; r text;
begin
  if p_source = 'maintenance_stop' then
    select * into s from public.maintenance_stops where id = p_ref;
    select (select p.name from public.maintenance_properties p where p.id = e.property_id) into r
      from public.maintenance_stops e
     where e.route_id = s.route_id and e.sort_order < s.sort_order and e.status not in ('completed', 'skipped')
       and not exists (select 1 from public.time_visits v join public.time_intervals i on i.visit_id = v.id
                        where v.maintenance_stop_id = e.id and i.person_id = p_person and i.status = 'completed')
     order by e.sort_order limit 1;
    return r;
  end if;
  select * into a from public.assignments where id = p_ref;
  select (select pr.name from public.projects pr where pr.id = e.project_id) into r
    from public.assignments e
   where e.person_id = a.person_id and e.scheduled_date = a.scheduled_date and e.id <> a.id
     and e.status not in ('completed', 'cancelled', 'reassigned')
     and (e.is_full_day, coalesce(e.start_time, ''), e.sort_order, e.created_at) < (a.is_full_day, coalesce(a.start_time, ''), a.sort_order, a.created_at)
   order by e.is_full_day, coalesce(e.start_time, ''), e.sort_order, e.created_at limit 1;
  return r;
end;
$$;
revoke all on function public._time_blocking_stop(text, uuid, uuid) from public, anon, authenticated;

create or replace function public._time_attendance_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if exists (select 1 from public.company_members m where m.company_id = new.company_id and m.person_id = new.person_id and m.worker_type = 'maintenance') then
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
drop trigger if exists time_workdays_attendance on public.time_workdays;
create trigger time_workdays_attendance after insert on public.time_workdays
  for each row execute function public._time_attendance_sync();

-- ── Project labor estimates (for "estimated vs actual") ─────────────────────
-- An estimate in LABOR-HOURS (the total person-hours a project is expected to take) and, optionally, the labor cost estimate.
-- It is compared with the project's actual crew labor-hours (never with a visit's elapsed time). Owner only.
create table if not exists public.time_project_estimates (
  project_id uuid primary key references public.projects(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  labor_hours numeric(8,2) not null check (labor_hours > 0 and labor_hours <= 100000),
  labor_cost numeric(10,2) check (labor_cost is null or labor_cost >= 0),
  updated_by uuid references public.people(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.time_project_estimates enable row level security;
drop policy if exists time_project_estimates_staff on public.time_project_estimates;
create policy time_project_estimates_staff on public.time_project_estimates for all using (public.is_staff(company_id)) with check (public.is_staff(company_id));
revoke all on public.time_project_estimates from anon;
-- The project has to be in the same company as the estimate row (the policy only checks the company_id column).
drop trigger if exists time_project_estimates_same_company on public.time_project_estimates;
create trigger time_project_estimates_same_company before insert or update on public.time_project_estimates
  for each row execute function public._time_check_same_company();
