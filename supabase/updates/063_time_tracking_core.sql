-- ============================================================================
-- Update 63 — run once in Supabase → SQL Editor (safe to run again). Run it AFTER 062.
--
-- Workday + property-visit time tracking for the landscaping crews AND the maintenance crews (core).
--
--  • time_workdays:   one row per employee workday, from clock-in (at the yard) to clock-out. The server stamps the times.
--  • time_breaks:     optional recorded breaks inside a workday (only when the owner turns break tracking on).
--  • time_visits:     one row per actual property visit (a maintenance stop, or a landscaping project on a day).
--  • time_intervals:  each employee's OWN start/end at a visit. Crew labor-hours = the sum of these (never the visit length).
--  • *_rates:         the hourly rate in force when the work happened (snapshots, so a raise never rewrites old costs). Owner only.
--  • time_skip_requests: a worker asks to skip a property; only an owner decision lets the route move on.
--  • time_settings / time_property_targets / time_person_settings: owner switches, per-property target durations, per-employee alert
--    hours. Owner only. (None of this touches worker_pay_settings, so the Payroll Estimate's overtime terms are unaffected.)
--  • time_audit:      append-only history (owner corrections come in update 64).
--
-- Workers never read or write these tables directly. They use the time_* functions below, which check who is calling and
-- what is allowed (one open workday, one open property at a time, route order, required photos, no breaks mid-visit…).
-- Owners/admins read everything for their own company. Customers and other companies get nothing.
-- The existing work_sessions / check_ins / check_outs (landscaping) and maintenance_* stop records keep being written by the
-- functions here, so the older Hours / Payroll Estimate / route screens keep working.
-- Snow Mode keeps its own shifts (snow_shifts); nothing here touches it.
--
-- Nothing in 63, 64 or 65 deletes or rewrites existing data: they add tables, columns (all optional), functions and triggers.
-- If you ever run 63 again after 64 and 65, run 64 and then 65 again too, in that order (they redefine a few shared functions).
-- ============================================================================

-- ── Small additions to existing tables ──────────────────────────────────────
alter table public.maintenance_routes add column if not exists truck_id uuid references public.trucks(id) on delete set null;
alter table public.maintenance_photos add column if not exists time_phase text;
alter table public.project_photos add column if not exists time_phase text;
-- (Update 63 does not touch worker_pay_settings: the per-employee daily alert hours live in time_person_settings below, so saving
-- one never creates an overtime-terms row that would change the Payroll Estimate.)

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'maintenance_photos_time_phase_check') then
    alter table public.maintenance_photos add constraint maintenance_photos_time_phase_check check (time_phase is null or time_phase in ('start', 'complete'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'project_photos_time_phase_check') then
    alter table public.project_photos add constraint project_photos_time_phase_check check (time_phase is null or time_phase in ('start', 'complete'));
  end if;
end $$;

-- ── Owner settings (one row per company) and per-property targets ───────────
create table if not exists public.time_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  breaks_enabled boolean not null default false,
  -- Recorded breaks: true = paid (nothing deducted), false = unpaid (deducted from payable hours).
  breaks_paid boolean not null default true,
  require_start_photo boolean not null default false,
  require_complete_photo boolean not null default false,
  target_alerts_enabled boolean not null default false,
  target_notify_crew boolean not null default false,
  overtime_alerts_enabled boolean not null default false,
  -- "Approaching" the daily overtime-alert hours at this percent.
  approach_percent integer not null default 90 check (approach_percent between 50 and 100),
  -- Flag a single property visit longer than this as unusual.
  long_visit_hours numeric(5,2) not null default 6 check (long_visit_hours > 0),
  -- Flag a workday still open after this many hours (probably a forgotten clock-out).
  open_workday_hours numeric(5,2) not null default 14 check (open_workday_hours > 0),
  updated_by uuid references public.people(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Per-employee owner settings for time tracking (owner/admin only; workers never see it).
create table if not exists public.time_person_settings (
  person_id uuid primary key references public.people(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  -- The owner's own "tell me at this many payable hours in a day" number. Not the formal overtime rule.
  daily_alert_hours numeric(5,2) check (daily_alert_hours is null or (daily_alert_hours > 0 and daily_alert_hours <= 24)),
  updated_at timestamptz not null default now()
);

create table if not exists public.time_property_targets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  maintenance_property_id uuid references public.maintenance_properties(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  target_minutes integer not null check (target_minutes between 5 and 1440),
  updated_by uuid references public.people(id) on delete set null,
  updated_at timestamptz not null default now(),
  check ((maintenance_property_id is not null)::int + (project_id is not null)::int = 1)
);
create unique index if not exists uq_time_target_property on public.time_property_targets (maintenance_property_id) where maintenance_property_id is not null;
create unique index if not exists uq_time_target_project on public.time_property_targets (project_id) where project_id is not null;

-- ── Workdays and breaks ─────────────────────────────────────────────────────
create table if not exists public.time_workdays (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete restrict,
  -- The employee's LOCAL calendar date of the workday (sent by the phone; the times themselves are server timestamps).
  work_date date not null,
  clock_in_at timestamptz not null default now(),
  clock_out_at timestamptz,
  -- active = clocked in; closed = clocked out, waiting for the owner; approved = signed off for payroll; reopened = changed after approval, needs approval again.
  status text not null default 'active' check (status in ('active', 'closed', 'approved', 'reopened')),
  truck_id uuid references public.trucks(id) on delete set null,
  truck_source text check (truck_source is null or truck_source in ('owner', 'worker')),
  approved_by uuid references public.people(id) on delete set null,
  approved_at timestamptz,
  approval_version integer not null default 0,
  client_request_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_time_workdays_company_date on public.time_workdays (company_id, work_date);
create index if not exists idx_time_workdays_person_date on public.time_workdays (person_id, work_date);
-- One open workday per person, even from two phones.
create unique index if not exists uq_time_workday_open on public.time_workdays (person_id) where clock_out_at is null;

create table if not exists public.time_workday_rates (
  workday_id uuid primary key references public.time_workdays(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  hourly_rate numeric(8,2)
);

create table if not exists public.time_breaks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  workday_id uuid not null references public.time_workdays(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete restrict,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  -- Whether this break counted as paid when it was taken (the owner's setting at that moment).
  paid boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_time_breaks_workday on public.time_breaks (workday_id);
create unique index if not exists uq_time_break_open on public.time_breaks (workday_id) where ended_at is null;

-- ── Property visits and each employee's own interval ────────────────────────
create table if not exists public.time_visits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- 'maintenance_stop' = a stop on a maintenance route; 'project_day' = a landscaping project worked on one date.
  source text not null check (source in ('maintenance_stop', 'project_day')),
  maintenance_stop_id uuid references public.maintenance_stops(id) on delete set null,
  maintenance_property_id uuid references public.maintenance_properties(id) on delete set null,
  route_id uuid references public.maintenance_routes(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  visit_date date not null,
  label text,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'void')),
  -- Earliest interval start / latest interval end (kept by the functions; the intervals are the source of truth).
  started_at timestamptz,
  ended_at timestamptz,
  billable boolean not null default true,
  -- The target in force when the visit started (owner only; workers never see it).
  target_minutes integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
  -- No "source needs its stop/project" check on purpose: deleting a stop or project sets those links to null, and the visit (with its
  -- label, times and cost) has to survive that. The functions below always fill the link when they create a visit.
);
create unique index if not exists uq_time_visit_stop on public.time_visits (maintenance_stop_id) where maintenance_stop_id is not null;
create unique index if not exists uq_time_visit_project_day on public.time_visits (company_id, project_id, visit_date) where source = 'project_day';
create index if not exists idx_time_visits_company_date on public.time_visits (company_id, visit_date);
create index if not exists idx_time_visits_property on public.time_visits (maintenance_property_id, visit_date);
create index if not exists idx_time_visits_project on public.time_visits (project_id, visit_date);

create table if not exists public.time_intervals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  visit_id uuid not null references public.time_visits(id) on delete cascade,
  workday_id uuid not null references public.time_workdays(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete restrict,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'active' check (status in ('active', 'completed', 'void')),
  billable boolean not null default true,
  -- The older work_sessions row this interval also wrote (landscaping), so the existing Hours/Payroll screens stay right.
  legacy_session_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_time_intervals_visit on public.time_intervals (visit_id);
create index if not exists idx_time_intervals_workday on public.time_intervals (workday_id);
create index if not exists idx_time_intervals_person on public.time_intervals (person_id, started_at);
-- One property at a time per person.
create unique index if not exists uq_time_interval_active on public.time_intervals (person_id) where ended_at is null and status = 'active';

create table if not exists public.time_interval_rates (
  interval_id uuid primary key references public.time_intervals(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  hourly_rate numeric(8,2)
);

-- ── Skip requests (a skip is a request until the owner decides) ─────────────
create table if not exists public.time_skip_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source text not null check (source in ('maintenance_stop', 'assignment')),
  maintenance_stop_id uuid references public.maintenance_stops(id) on delete cascade,
  assignment_id uuid references public.assignments(id) on delete cascade,
  requested_by uuid not null references public.people(id) on delete restrict,
  reason text not null check (length(trim(reason)) > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'withdrawn')),
  decided_by uuid references public.people(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  check ((source = 'maintenance_stop' and maintenance_stop_id is not null) or (source = 'assignment' and assignment_id is not null))
);
create unique index if not exists uq_time_skip_pending_stop on public.time_skip_requests (maintenance_stop_id, requested_by) where status = 'pending' and maintenance_stop_id is not null;
create unique index if not exists uq_time_skip_pending_assignment on public.time_skip_requests (assignment_id) where status = 'pending' and assignment_id is not null;
create index if not exists idx_time_skip_company on public.time_skip_requests (company_id, status, created_at desc);

-- ── Audit history (append-only) ─────────────────────────────────────────────
create table if not exists public.time_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  entity text not null,
  entity_id uuid,
  person_id uuid references public.people(id) on delete set null,
  workday_id uuid,
  visit_id uuid,
  action text not null,
  field text,
  old_value jsonb,
  new_value jsonb,
  reason text,
  actor_id uuid references public.people(id) on delete set null,
  -- True when the record was already approved for payroll at the moment of the change.
  was_approved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_time_audit_company on public.time_audit (company_id, created_at desc);
create index if not exists idx_time_audit_workday on public.time_audit (workday_id);
create index if not exists idx_time_audit_visit on public.time_audit (visit_id);

-- The history can't be edited or deleted by anyone calling the app. The only changes allowed are the ones the database itself makes
-- when a whole company is deleted (cascade, trigger depth 2) or when a person's link is cleared (on delete set null).
create or replace function public._time_audit_immutable()
returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; end if;
    if (to_jsonb(new) - 'person_id' - 'actor_id') = (to_jsonb(old) - 'person_id' - 'actor_id')
       and (new.person_id is null or new.person_id = old.person_id) and (new.actor_id is null or new.actor_id = old.actor_id) then
      return new;
    end if;
  end if;
  raise exception 'The time history can''t be changed or deleted.';
end;
$$;
drop trigger if exists time_audit_no_update on public.time_audit;
create trigger time_audit_no_update before update or delete on public.time_audit
  for each row execute function public._time_audit_immutable();

-- ── Integrity rules ─────────────────────────────────────────────────────────
create or replace function public._time_check_workday()
returns trigger language plpgsql as $$
begin
  if new.clock_out_at is not null and new.clock_out_at < new.clock_in_at then
    raise exception 'The clock-out can''t be before the clock-in.';
  end if;
  if new.truck_id is not null and not exists (select 1 from public.trucks t where t.id = new.truck_id and t.company_id = new.company_id) then
    raise exception 'That truck belongs to another company.';
  end if;
  if not exists (select 1 from public.company_members m where m.company_id = new.company_id and m.person_id = new.person_id) then
    raise exception 'That person is not on this company''s team.';
  end if;
  if exists (
    select 1 from public.time_workdays o
    where o.person_id = new.person_id and o.id <> new.id
      and new.clock_in_at < coalesce(o.clock_out_at, 'infinity'::timestamptz)
      and coalesce(new.clock_out_at, 'infinity'::timestamptz) > o.clock_in_at
  ) then
    raise exception 'That overlaps another workday for the same person.';
  end if;
  -- Everything recorded inside the day must still fit inside it.
  if tg_op = 'UPDATE' and (new.clock_in_at is distinct from old.clock_in_at or new.clock_out_at is distinct from old.clock_out_at) then
    if exists (select 1 from public.time_intervals i where i.workday_id = new.id and i.status <> 'void'
                 and (i.started_at < new.clock_in_at or (new.clock_out_at is not null and coalesce(i.ended_at, new.clock_out_at + interval '1 second') > new.clock_out_at))) then
      raise exception 'A property visit in this workday falls outside those times. Correct the visit first.';
    end if;
    if exists (select 1 from public.time_breaks b where b.workday_id = new.id
                 and (b.started_at < new.clock_in_at or (new.clock_out_at is not null and coalesce(b.ended_at, new.clock_out_at + interval '1 second') > new.clock_out_at))) then
      raise exception 'A break in this workday falls outside those times. Correct the break first.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists time_workdays_check on public.time_workdays;
create trigger time_workdays_check before insert or update on public.time_workdays
  for each row execute function public._time_check_workday();

create or replace function public._time_check_interval()
returns trigger language plpgsql as $$
declare wd record;
begin
  if new.ended_at is not null and new.ended_at < new.started_at then
    raise exception 'A property visit can''t end before it starts.';
  end if;
  if new.status <> 'void' then
    new.status := case when new.ended_at is null then 'active' else 'completed' end;
  end if;
  if new.status <> 'void' then
    if exists (
      select 1 from public.time_intervals o
      where o.person_id = new.person_id and o.id <> new.id and o.status <> 'void'
        and new.started_at < coalesce(o.ended_at, 'infinity'::timestamptz)
        and coalesce(new.ended_at, 'infinity'::timestamptz) > o.started_at
    ) then
      raise exception 'That overlaps another property visit for the same person.';
    end if;
    select clock_in_at, clock_out_at, person_id, company_id into wd from public.time_workdays where id = new.workday_id;
    if wd is null then raise exception 'Workday not found.'; end if;
    if wd.person_id <> new.person_id or wd.company_id <> new.company_id then
      raise exception 'That property time doesn''t belong to this workday.';
    end if;
    if new.started_at < wd.clock_in_at or (wd.clock_out_at is not null and (new.ended_at is null or new.ended_at > wd.clock_out_at or new.started_at > wd.clock_out_at)) then
      raise exception 'A property visit has to fall inside the workday.';
    end if;
    -- A break is not property time: the two can't overlap (otherwise a property would be charged for the employee's break).
    if exists (
      select 1 from public.time_breaks b
      where b.workday_id = new.workday_id
        and new.started_at < coalesce(b.ended_at, 'infinity'::timestamptz)
        and coalesce(new.ended_at, 'infinity'::timestamptz) > b.started_at
    ) then
      raise exception 'That overlaps a break. Correct the break first.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists time_intervals_check on public.time_intervals;
create trigger time_intervals_check before insert or update on public.time_intervals
  for each row execute function public._time_check_interval();

create or replace function public._time_check_break()
returns trigger language plpgsql as $$
declare wd record;
begin
  if new.ended_at is not null and new.ended_at < new.started_at then
    raise exception 'A break can''t end before it starts.';
  end if;
  if exists (
    select 1 from public.time_breaks o
    where o.workday_id = new.workday_id and o.id <> new.id
      and new.started_at < coalesce(o.ended_at, 'infinity'::timestamptz)
      and coalesce(new.ended_at, 'infinity'::timestamptz) > o.started_at
  ) then
    raise exception 'Breaks can''t overlap each other.';
  end if;
  select clock_in_at, clock_out_at into wd from public.time_workdays where id = new.workday_id;
  if wd is null then raise exception 'Workday not found.'; end if;
  if new.started_at < wd.clock_in_at or (wd.clock_out_at is not null and (new.ended_at is null or new.ended_at > wd.clock_out_at or new.started_at > wd.clock_out_at)) then
    raise exception 'A break has to fall inside the workday.';
  end if;
  if exists (
    select 1 from public.time_intervals i
    where i.workday_id = new.workday_id and i.status <> 'void'
      and new.started_at < coalesce(i.ended_at, 'infinity'::timestamptz)
      and coalesce(new.ended_at, 'infinity'::timestamptz) > i.started_at
  ) then
    raise exception 'That break overlaps time at a property. Correct the property time first.';
  end if;
  return new;
end;
$$;
drop trigger if exists time_breaks_check on public.time_breaks;
create trigger time_breaks_check before insert or update on public.time_breaks
  for each row execute function public._time_check_break();

-- Trigger functions are only ever run by their triggers; nobody needs to be able to call them.
revoke all on function public._time_audit_immutable(), public._time_check_workday(), public._time_check_interval(), public._time_check_break() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['time_workdays', 'time_breaks', 'time_visits', 'time_intervals'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

-- ── Who may read / write (workers use the functions below, not the tables) ──
do $$
declare t text;
begin
  foreach t in array array['time_settings', 'time_person_settings', 'time_property_targets', 'time_workdays', 'time_workday_rates', 'time_breaks', 'time_visits',
                            'time_intervals', 'time_interval_rates', 'time_skip_requests', 'time_audit'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_select', t);
    execute format('create policy %I on public.%I for select using (public.is_staff(company_id))', t || '_staff_select', t);
  end loop;
end $$;
-- The owner edits these three directly (each change is checked and written to the history by a trigger); everything else only
-- through the functions.
drop policy if exists time_settings_staff_write on public.time_settings;
create policy time_settings_staff_write on public.time_settings for all using (public.is_staff(company_id)) with check (public.is_staff(company_id));
drop policy if exists time_person_settings_staff_write on public.time_person_settings;
create policy time_person_settings_staff_write on public.time_person_settings for all using (public.is_staff(company_id)) with check (public.is_staff(company_id));
drop policy if exists time_property_targets_staff_write on public.time_property_targets;
create policy time_property_targets_staff_write on public.time_property_targets for all using (public.is_staff(company_id)) with check (public.is_staff(company_id));

-- Belt and braces: even if a row-level-security policy were ever added by mistake, the app roles can't write the record tables.
-- (The functions below run as the table owner, so they are not affected.)
revoke insert, update, delete, truncate on public.time_workdays, public.time_workday_rates, public.time_breaks, public.time_visits,
  public.time_intervals, public.time_interval_rates, public.time_skip_requests, public.time_audit from anon, authenticated;
revoke all on public.time_workdays, public.time_workday_rates, public.time_breaks, public.time_visits, public.time_intervals, public.time_interval_rates,
  public.time_skip_requests, public.time_audit, public.time_settings, public.time_person_settings, public.time_property_targets from anon;

-- A target / per-employee setting must point at something in the SAME company (the policy above only checks the company_id column).
create or replace function public._time_check_same_company()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'time_property_targets' then
    if new.maintenance_property_id is not null and not exists (select 1 from public.maintenance_properties p where p.id = new.maintenance_property_id and p.company_id = new.company_id) then
      raise exception 'That property belongs to another company.';
    end if;
    if new.project_id is not null and not exists (select 1 from public.projects p where p.id = new.project_id and p.company_id = new.company_id) then
      raise exception 'That project belongs to another company.';
    end if;
  elsif tg_table_name = 'time_person_settings' then
    if not exists (select 1 from public.company_members m where m.person_id = new.person_id and m.company_id = new.company_id) then
      raise exception 'That person is not on this company''s team.';
    end if;
  elsif tg_table_name = 'maintenance_routes' then
    if new.truck_id is not null and not exists (select 1 from public.trucks t where t.id = new.truck_id and t.company_id = new.company_id) then
      raise exception 'That truck belongs to another company.';
    end if;
  elsif tg_table_name = 'time_project_estimates' then
    if not exists (select 1 from public.projects p where p.id = new.project_id and p.company_id = new.company_id) then
      raise exception 'That project belongs to another company.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public._time_check_same_company() from public, anon, authenticated;
drop trigger if exists time_targets_same_company on public.time_property_targets;
create trigger time_targets_same_company before insert or update on public.time_property_targets
  for each row execute function public._time_check_same_company();
drop trigger if exists time_person_settings_same_company on public.time_person_settings;
create trigger time_person_settings_same_company before insert or update on public.time_person_settings
  for each row execute function public._time_check_same_company();
drop trigger if exists maintenance_routes_truck_company on public.maintenance_routes;
create trigger maintenance_routes_truck_company before insert or update of truck_id on public.maintenance_routes
  for each row execute function public._time_check_same_company();

-- ── Helpers ─────────────────────────────────────────────────────────────────
create or replace function public._time_company(p_person uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.company_members
  where person_id = p_person and status = 'active' and role in ('owner', 'admin', 'worker')
  order by created_at limit 1
$$;

-- The hourly rate in force on a date (null when none is set).
create or replace function public._time_rate(p_company uuid, p_person uuid, p_date date)
returns numeric language sql stable security definer set search_path = public as $$
  select r.hourly_rate from public.worker_hourly_rates r
  where r.company_id = p_company and r.person_id = p_person and r.effective_date <= p_date
    and (r.end_date is null or r.end_date >= p_date)
  order by r.effective_date desc, r.created_at desc limit 1
$$;

create or replace function public._time_settings_row(p_company uuid)
returns public.time_settings language plpgsql stable security definer set search_path = public as $$
declare s public.time_settings;
begin
  select * into s from public.time_settings where company_id = p_company;
  if not found then
    s.company_id := p_company; s.breaks_enabled := false; s.breaks_paid := true; s.require_start_photo := false;
    s.require_complete_photo := false; s.target_alerts_enabled := false; s.target_notify_crew := false;
    s.overtime_alerts_enabled := false; s.approach_percent := 90; s.long_visit_hours := 6; s.open_workday_hours := 14;
  end if;
  return s;
end;
$$;

create or replace function public._time_audit(
  p_company uuid, p_entity text, p_entity_id uuid, p_person uuid, p_workday uuid, p_visit uuid,
  p_action text, p_field text, p_old jsonb, p_new jsonb, p_reason text, p_was_approved boolean
) returns void language sql security definer set search_path = public as $$
  insert into public.time_audit (company_id, entity, entity_id, person_id, workday_id, visit_id, action, field, old_value, new_value, reason, actor_id, was_approved)
  values (p_company, p_entity, p_entity_id, p_person, p_workday, p_visit, p_action, p_field, p_old, p_new, p_reason, public.my_person_id(), coalesce(p_was_approved, false))
$$;
revoke all on function public._time_audit(uuid, text, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public._time_company(uuid) from public, anon, authenticated;
revoke all on function public._time_rate(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public._time_settings_row(uuid) from public, anon, authenticated;

-- Keeps a visit's start/end/status in step with its intervals.
create or replace function public._time_refresh_visit(p_visit uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s timestamptz; e timestamptz; open_n integer; any_n integer;
begin
  select min(started_at), max(ended_at), count(*) filter (where ended_at is null), count(*)
    into s, e, open_n, any_n
  from public.time_intervals where visit_id = p_visit and status <> 'void';
  update public.time_visits
     set started_at = s,
         ended_at = case when open_n > 0 or any_n = 0 then null else e end,
         -- A visit with no live time left (every employee's time was removed) is void: it must not sit "in progress" forever.
         status = case when any_n = 0 then 'void' when open_n > 0 then 'in_progress' else 'completed' end
   where id = p_visit;
end;
$$;
revoke all on function public._time_refresh_visit(uuid) from public, anon, authenticated;

-- What the worker's phone needs (and nothing owner-only: no targets, averages, rates or costs).
create or replace function public._time_day_json(p_person uuid, p_company uuid, p_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  st public.time_settings := public._time_settings_row(p_company);
  days jsonb;
  cur jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', w.id, 'work_date', w.work_date, 'clock_in_at', w.clock_in_at, 'clock_out_at', w.clock_out_at, 'status', w.status,
      'truck', case when w.truck_id is null then null else jsonb_build_object('id', w.truck_id, 'name', (select t.name from public.trucks t where t.id = w.truck_id), 'source', w.truck_source) end,
      'breaks', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'started_at', b.started_at, 'ended_at', b.ended_at, 'paid', b.paid) order by b.started_at)
                          from public.time_breaks b where b.workday_id = w.id), '[]'::jsonb)
    ) order by w.clock_in_at), '[]'::jsonb)
    into days
  from public.time_workdays w
  where w.person_id = p_person and (w.work_date = p_date or w.clock_out_at is null);

  select jsonb_build_object('interval_id', i.id, 'visit_id', i.visit_id, 'started_at', i.started_at, 'workday_id', i.workday_id,
                            'source', v.source, 'stop_id', v.maintenance_stop_id, 'project_id', v.project_id, 'label', v.label)
    into cur
  from public.time_intervals i join public.time_visits v on v.id = i.visit_id
  where i.person_id = p_person and i.ended_at is null and i.status = 'active' limit 1;

  return jsonb_build_object(
    'server_now', now(),
    'work_date', p_date,
    'settings', jsonb_build_object('breaks_enabled', st.breaks_enabled, 'require_start_photo', st.require_start_photo, 'require_complete_photo', st.require_complete_photo),
    'days', days,
    'current', cur
  );
end;
$$;
revoke all on function public._time_day_json(uuid, uuid, date) from public, anon, authenticated;

create or replace function public.time_my_day(p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.my_person_id(); cid uuid;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  if cid is null then raise exception 'You are not on a team yet.'; end if;
  return public._time_day_json(me, cid, coalesce(p_date, current_date));
end;
$$;

-- ── Clock in / out ──────────────────────────────────────────────────────────
-- Trucks the worker may pick when the owner hasn't assigned one. A truck already on another person's open workday is
-- not offered, unless that person is working the same job or route today (a crew sharing a truck).
create or replace function public._time_same_group(p_a uuid, p_b uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.assignments a join public.assignments b on b.project_id = a.project_id and b.scheduled_date = a.scheduled_date
    where a.person_id = p_a and b.person_id = p_b and a.scheduled_date = p_date
      and a.status not in ('cancelled', 'reassigned') and b.status not in ('cancelled', 'reassigned')
  ) or exists (
    select 1 from public.maintenance_route_crew a join public.maintenance_route_crew b on b.route_id = a.route_id
    join public.maintenance_routes r on r.id = a.route_id
    where a.person_id = p_a and b.person_id = p_b and r.service_date = p_date and r.status <> 'cancelled'
  )
$$;
revoke all on function public._time_same_group(uuid, uuid, date) from public, anon, authenticated;

-- The truck the owner assigned for the day, if any.
create or replace function public._time_assigned_truck(p_person uuid, p_date date)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select a.truck_id from public.assignments a
      where a.person_id = p_person and a.scheduled_date = p_date and a.truck_id is not null and a.status not in ('cancelled', 'reassigned')
      order by a.sort_order, a.created_at limit 1),
    (select r.truck_id from public.maintenance_routes r join public.maintenance_route_crew c on c.route_id = r.id
      where c.person_id = p_person and r.service_date = p_date and r.truck_id is not null and r.status <> 'cancelled'
      order by r.created_at limit 1)
  )
$$;
revoke all on function public._time_assigned_truck(uuid, date) from public, anon, authenticated;

create or replace function public.time_trucks_for_clock_in(p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.my_person_id(); cid uuid; d date := coalesce(p_date, current_date); assigned uuid;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  if cid is null then raise exception 'You are not on a team yet.'; end if;
  assigned := public._time_assigned_truck(me, d);
  return jsonb_build_object(
    'assigned_truck_id', assigned,
    'assigned_truck_name', (select t.name from public.trucks t where t.id = assigned),
    'trucks', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'in_use', exists (
          select 1 from public.time_workdays w
          where w.truck_id = t.id and w.clock_out_at is null and w.person_id <> me and not public._time_same_group(me, w.person_id, d))
        ) order by t.name)
      from public.trucks t where t.company_id = cid and t.status in ('available', 'assigned')), '[]'::jsonb)
  );
end;
$$;

create or replace function public.time_clock_in(p_work_date date, p_truck_id uuid default null, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  cid uuid;
  d date := coalesce(p_work_date, current_date);
  w public.time_workdays;
  assigned uuid;
  use_truck uuid;
  src text;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  if cid is null then raise exception 'You are not on a team yet.'; end if;
  if d < current_date - 1 or d > current_date + 1 then raise exception 'That date doesn''t look right. Check your phone''s date and try again.'; end if;

  -- A retry of the same tap returns what it already made.
  if p_request_id is not null then
    select * into w from public.time_workdays where client_request_id = p_request_id and person_id = me;
    if found then return public._time_day_json(me, cid, d) || jsonb_build_object('already_active', true); end if;
  end if;
  -- Already clocked in (this phone or another): show it, never a second one.
  select * into w from public.time_workdays where person_id = me and clock_out_at is null;
  if found then return public._time_day_json(me, cid, d) || jsonb_build_object('already_active', true); end if;

  assigned := public._time_assigned_truck(me, d);
  if assigned is not null then
    use_truck := assigned; src := 'owner';
  elsif p_truck_id is not null then
    if not exists (select 1 from public.trucks t where t.id = p_truck_id and t.company_id = cid and t.status in ('available', 'assigned')) then
      raise exception 'That truck isn''t available.';
    end if;
    if exists (select 1 from public.time_workdays o where o.truck_id = p_truck_id and o.clock_out_at is null and o.person_id <> me
                 and not public._time_same_group(me, o.person_id, d)) then
      raise exception 'That truck is already in use by someone else today. Pick another.';
    end if;
    use_truck := p_truck_id; src := 'worker';
  end if;

  begin
    insert into public.time_workdays (company_id, person_id, work_date, truck_id, truck_source, client_request_id)
    values (cid, me, d, use_truck, src, p_request_id)
    returning * into w;
  exception when unique_violation then
    -- Two taps (or two phones) at the same instant: the other one won. Show that workday; never make a second.
    return public._time_day_json(me, cid, d) || jsonb_build_object('already_active', true);
  end;
  insert into public.time_workday_rates (workday_id, company_id, hourly_rate) values (w.id, cid, public._time_rate(cid, me, d));
  return public._time_day_json(me, cid, d);
end;
$$;

create or replace function public.time_clock_out(p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  cid uuid;
  w public.time_workdays;
  open_label text;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  select * into w from public.time_workdays where person_id = me and clock_out_at is null for update;
  if not found then
    -- Already clocked out (a retry): just show the day.
    return public._time_day_json(me, cid, current_date) || jsonb_build_object('already_closed', true);
  end if;
  select coalesce(v.label, 'a property') into open_label
    from public.time_intervals i join public.time_visits v on v.id = i.visit_id
   where i.person_id = me and i.ended_at is null and i.status = 'active' limit 1;
  if open_label is not null then
    raise exception 'You are still working at %. Complete that property first, then clock out.', open_label;
  end if;
  if exists (select 1 from public.time_breaks b where b.workday_id = w.id and b.ended_at is null) then
    raise exception 'Your break is still running. End your break, then clock out.';
  end if;
  update public.time_workdays set clock_out_at = now(), status = 'closed' where id = w.id;
  return public._time_day_json(me, cid, w.work_date);
end;
$$;

-- ── Breaks (only when the owner turned break tracking on) ───────────────────
create or replace function public.time_break_start()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_person_id(); cid uuid; st public.time_settings; w public.time_workdays;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  st := public._time_settings_row(cid);
  if not st.breaks_enabled then raise exception 'Break tracking is turned off.'; end if;
  select * into w from public.time_workdays where person_id = me and clock_out_at is null for update;
  if not found then raise exception 'Clock in first.'; end if;
  if exists (select 1 from public.time_breaks b where b.workday_id = w.id and b.ended_at is null) then
    return public._time_day_json(me, cid, w.work_date);  -- already on a break
  end if;
  if exists (select 1 from public.time_intervals i where i.person_id = me and i.ended_at is null and i.status = 'active') then
    raise exception 'Complete the property you are working at before starting a break.';
  end if;
  insert into public.time_breaks (company_id, workday_id, person_id, paid) values (cid, w.id, me, st.breaks_paid);
  return public._time_day_json(me, cid, w.work_date);
end;
$$;

create or replace function public.time_break_end()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_person_id(); cid uuid; w public.time_workdays;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  select * into w from public.time_workdays where person_id = me and clock_out_at is null for update;
  if not found then raise exception 'You are not clocked in.'; end if;
  update public.time_breaks set ended_at = now() where workday_id = w.id and ended_at is null;
  return public._time_day_json(me, cid, w.work_date);
end;
$$;

-- ── Route order ─────────────────────────────────────────────────────────────
-- The first earlier stop this person hasn't cleared (maintenance: by route order; landscaping: by the day's job order).
-- "Cleared" = finished, or skipped with the owner's approval, or this person already completed their own time there.
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

-- ── Start / complete a property ─────────────────────────────────────────────
-- p_source 'maintenance_stop' (p_ref = the stop) or 'assignment' (p_ref = the landscaping assignment).
create or replace function public.time_start_visit(
  p_source text, p_ref uuid,
  p_lat double precision default null, p_lng double precision default null, p_accuracy double precision default null,
  p_location_state text default 'ok', p_gps jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  cid uuid;
  st public.time_settings;
  w public.time_workdays;
  staff boolean;
  s public.maintenance_stops;
  a public.assignments;
  v public.time_visits;
  blocked text;
  tgt integer;
  vlabel text;
  sess uuid;
  iid uuid;
  ok_photo boolean;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  if cid is null then raise exception 'You are not on a team yet.'; end if;
  st := public._time_settings_row(cid);
  staff := public.is_staff(cid);
  select * into w from public.time_workdays where person_id = me and clock_out_at is null for update;
  if not found then raise exception 'Clock in for the day first.'; end if;
  if exists (select 1 from public.time_breaks b where b.workday_id = w.id and b.ended_at is null) then
    raise exception 'End your break before starting a property.';
  end if;

  if p_source = 'maintenance_stop' then
    select * into s from public.maintenance_stops where id = p_ref;
    if not found or s.company_id <> cid then raise exception 'Stop not found.'; end if;
    if not (staff or exists (select 1 from public.maintenance_route_crew c where c.route_id = s.route_id and c.person_id = me)) then
      raise exception 'You are not assigned to this route.';
    end if;
    if s.status in ('completed', 'skipped') then raise exception 'This stop is already %.', s.status; end if;
    blocked := public._time_blocking_stop(p_source, p_ref, me);
    if blocked is not null then
      -- The owner may work out of order (it is written to the history once the timer starts, below).
      if not staff then raise exception 'Finish % first. Stops are worked in order.', blocked; end if;
    end if;
    -- Already working here? Return the day (a double tap changes nothing).
    if exists (select 1 from public.time_intervals i join public.time_visits tv on tv.id = i.visit_id
                where tv.maintenance_stop_id = s.id and i.person_id = me and i.ended_at is null) then
      return public._time_day_json(me, cid, w.work_date);
    end if;
    if exists (select 1 from public.time_intervals i where i.person_id = me and i.ended_at is null and i.status = 'active') then
      raise exception 'You are already working at another property. Complete it first.';
    end if;
    -- The photo has to be a record this worker created for this stop (server-stamped, with a stored file), not an old or empty one.
    if st.require_start_photo and not exists (select 1 from public.maintenance_photos p where p.stop_id = s.id and p.uploaded_by = me
                                               and p.time_phase = 'start' and p.file_key <> '' and p.created_at >= w.clock_in_at) then
      raise exception 'Take the start photo for this property first.';
    end if;
    -- Arrive on the existing maintenance record (graded GPS, first-arrival fields), then time it.
    perform public.maintenance_mark_arrived(s.id, p_lat, p_lng, p_accuracy, p_location_state);
    -- Starting the work answers this worker's own pending "skip" request: it is withdrawn.
    update public.time_skip_requests set status = 'withdrawn', decided_at = now(), decision_note = 'Started the work'
     where maintenance_stop_id = s.id and requested_by = me and status = 'pending';
    select name into vlabel from public.maintenance_properties where id = s.property_id;
    select target_minutes into tgt from public.time_property_targets where maintenance_property_id = s.property_id and company_id = cid;
    insert into public.time_visits (company_id, source, maintenance_stop_id, maintenance_property_id, route_id, visit_date, label, target_minutes)
    values (cid, 'maintenance_stop', s.id, s.property_id, s.route_id,
            (select service_date from public.maintenance_routes where id = s.route_id), vlabel, tgt)
    on conflict (maintenance_stop_id) where maintenance_stop_id is not null do nothing;
    select * into v from public.time_visits where maintenance_stop_id = s.id;
  elsif p_source = 'assignment' then
    select * into a from public.assignments where id = p_ref;
    if not found or a.company_id <> cid then raise exception 'Job not found.'; end if;
    if a.person_id <> me then raise exception 'That job is not assigned to you.'; end if;
    if a.status in ('cancelled', 'reassigned') then raise exception 'That job was cancelled.'; end if;
    if a.scheduled_date <> w.work_date then raise exception 'That job is scheduled for another day.'; end if;
    blocked := public._time_blocking_stop(p_source, p_ref, me);
    if blocked is not null then
      if not staff then raise exception 'Finish % first. Jobs are worked in order.', blocked; end if;
    end if;
    if exists (select 1 from public.time_intervals i join public.time_visits tv on tv.id = i.visit_id
                where tv.project_id = a.project_id and tv.visit_date = a.scheduled_date and i.person_id = me and i.ended_at is null) then
      return public._time_day_json(me, cid, w.work_date);
    end if;
    if exists (select 1 from public.time_intervals i where i.person_id = me and i.ended_at is null and i.status = 'active') then
      raise exception 'You are already working at another property. Complete it first.';
    end if;
    -- created_at is stamped by the server (taken_at comes from the phone and could be anything).
    if st.require_start_photo and not exists (select 1 from public.project_photos p where p.project_id = a.project_id and p.uploaded_by = me
                                               and p.time_phase = 'start' and p.file_key <> '' and p.created_at >= w.clock_in_at) then
      raise exception 'Take the start photo for this property first.';
    end if;
    update public.time_skip_requests set status = 'withdrawn', decided_at = now(), decision_note = 'Started the work'
     where assignment_id = a.id and requested_by = me and status = 'pending';
    select name into vlabel from public.projects where id = a.project_id;
    select target_minutes into tgt from public.time_property_targets where project_id = a.project_id and company_id = cid;
    insert into public.time_visits (company_id, source, project_id, visit_date, label, target_minutes)
    values (cid, 'project_day', a.project_id, a.scheduled_date, vlabel, tgt)
    on conflict (company_id, project_id, visit_date) where source = 'project_day' do nothing;
    select * into v from public.time_visits where company_id = cid and project_id = a.project_id and visit_date = a.scheduled_date and source = 'project_day';
    -- Keep the older landscaping records right (check-in, session, assignment status): the radius rule still applies to workers.
    insert into public.check_ins (company_id, assignment_id, person_id, project_id, gps)
    values (cid, a.id, me, a.project_id, p_gps);
    insert into public.work_sessions (company_id, person_id, project_id, assignment_id, check_in_time, check_in_gps, status)
    values (cid, me, a.project_id, a.id, now(), p_gps, 'active')
    returning id into sess;
    update public.assignments set status = 'checked_in' where id = a.id and status in ('scheduled', 'confirmed', 'en_route');
  else
    raise exception 'Unknown property type.';
  end if;

  insert into public.time_intervals (company_id, visit_id, workday_id, person_id, billable, legacy_session_id)
  values (cid, v.id, w.id, me, v.billable, sess)
  returning id into iid;
  insert into public.time_interval_rates (interval_id, company_id, hourly_rate) values (iid, cid, public._time_rate(cid, me, w.work_date));
  perform public._time_refresh_visit(v.id);
  if staff and blocked is not null then
    perform public._time_audit(cid, 'visit', v.id, me, w.id, v.id, 'order_override', 'route_order', null, to_jsonb(blocked), 'Started before ' || blocked || ' was finished', false);
  end if;
  return public._time_day_json(me, cid, w.work_date);
end;
$$;

create or replace function public.time_complete_visit(
  p_visit_id uuid, p_note text default null,
  p_lat double precision default null, p_lng double precision default null, p_accuracy double precision default null,
  p_location_state text default 'ok', p_gps jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  cid uuid;
  st public.time_settings;
  w public.time_workdays;
  v public.time_visits;
  i public.time_intervals;
  a public.assignments;
  dur numeric;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  st := public._time_settings_row(cid);
  select * into v from public.time_visits where id = p_visit_id and company_id = cid;
  if not found then raise exception 'Visit not found.'; end if;
  select * into i from public.time_intervals where visit_id = v.id and person_id = me and ended_at is null and status = 'active' for update;
  if not found then
    -- Already completed (a repeat tap) or never started.
    select * into w from public.time_workdays where id = (select workday_id from public.time_intervals where visit_id = v.id and person_id = me order by started_at desc limit 1);
    if found then return public._time_day_json(me, cid, w.work_date) || jsonb_build_object('already_completed', true); end if;
    raise exception 'You haven''t started this property.';
  end if;
  select * into w from public.time_workdays where id = i.workday_id;

  if st.require_complete_photo then
    if v.source = 'maintenance_stop' and not exists (select 1 from public.maintenance_photos p where p.stop_id = v.maintenance_stop_id and p.uploaded_by = me
                                                       and p.time_phase = 'complete' and p.file_key <> '' and p.created_at >= i.started_at) then
      raise exception 'Take the completion photo for this property first.';
    end if;
    if v.source = 'project_day' and not exists (select 1 from public.project_photos p where p.project_id = v.project_id and p.uploaded_by = me
                                                  and p.time_phase = 'complete' and p.file_key <> '' and p.created_at >= i.started_at) then
      raise exception 'Take the completion photo for this property first.';
    end if;
  end if;

  if v.source = 'maintenance_stop' then
    -- The existing finish rules (required tasks and photos). A repeat finish by a crew mate returns the finished stop.
    perform public.maintenance_finish_stop(v.maintenance_stop_id, p_note, p_lat, p_lng, p_accuracy, p_location_state);
  else
    -- Prefer the live assignment; if the owner cancelled it while the worker was on site, the worker can still finish and clock out.
    select * into a from public.assignments where project_id = v.project_id and person_id = me and scheduled_date = v.visit_date
     order by (status in ('cancelled', 'reassigned')), created_at limit 1;
    if a.id is not null then
      insert into public.check_outs (company_id, assignment_id, person_id, project_id, gps)
      values (cid, a.id, me, v.project_id, p_gps);
    end if;
    if i.legacy_session_id is not null then
      dur := round(extract(epoch from (now() - i.started_at)) / 60.0, 2);
      update public.work_sessions set check_out_time = now(), check_out_gps = p_gps, duration_minutes = dur, status = 'completed'
       where id = i.legacy_session_id;
    end if;
    if a.id is not null then update public.assignments set status = 'completed' where id = a.id and status not in ('cancelled', 'reassigned'); end if;
  end if;

  update public.time_intervals set ended_at = now() where id = i.id;
  perform public._time_refresh_visit(v.id);
  return public._time_day_json(me, cid, w.work_date);
end;
$$;

-- ── Skip requests ───────────────────────────────────────────────────────────
create or replace function public.time_request_skip(p_source text, p_ref uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id(); cid uuid;
  s public.maintenance_stops; a public.assignments; blocked text; rid uuid;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  if cid is null then raise exception 'You are not on a team yet.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why this property can''t be done.'; end if;
  if length(p_reason) > 1000 then raise exception 'Keep the reason shorter.'; end if;
  if p_source = 'maintenance_stop' then
    select * into s from public.maintenance_stops where id = p_ref;
    if not found or s.company_id <> cid then raise exception 'Stop not found.'; end if;
    if not exists (select 1 from public.maintenance_route_crew c where c.route_id = s.route_id and c.person_id = me) then raise exception 'You are not assigned to this route.'; end if;
    if s.status in ('completed', 'skipped') then raise exception 'This stop is already %.', s.status; end if;
    blocked := public._time_blocking_stop(p_source, p_ref, me);
    if blocked is not null then raise exception 'Finish % before asking to skip this one.', blocked; end if;
    if exists (select 1 from public.time_intervals i join public.time_visits tv on tv.id = i.visit_id
                where tv.maintenance_stop_id = s.id and i.person_id = me and i.status = 'active') then
      raise exception 'You are working at this property right now. Complete it instead.';
    end if;
    insert into public.time_skip_requests (company_id, source, maintenance_stop_id, requested_by, reason)
    values (cid, p_source, p_ref, me, trim(p_reason))
    on conflict (maintenance_stop_id, requested_by) where status = 'pending' and maintenance_stop_id is not null do nothing
    returning id into rid;
  elsif p_source = 'assignment' then
    select * into a from public.assignments where id = p_ref;
    if not found or a.company_id <> cid or a.person_id <> me then raise exception 'Job not found.'; end if;
    if a.status in ('completed', 'cancelled', 'reassigned') then raise exception 'This job is already %.', a.status; end if;
    blocked := public._time_blocking_stop(p_source, p_ref, me);
    if blocked is not null then raise exception 'Finish % before asking to skip this one.', blocked; end if;
    if exists (select 1 from public.time_intervals i join public.time_visits tv on tv.id = i.visit_id
                where tv.project_id = a.project_id and tv.visit_date = a.scheduled_date and i.person_id = me and i.status = 'active') then
      raise exception 'You are working at this property right now. Complete it instead.';
    end if;
    insert into public.time_skip_requests (company_id, source, assignment_id, requested_by, reason)
    values (cid, p_source, p_ref, me, trim(p_reason))
    on conflict (assignment_id) where status = 'pending' and assignment_id is not null do nothing
    returning id into rid;
  else
    raise exception 'Unknown property type.';
  end if;
  return jsonb_build_object('request_id', coalesce(rid, (select id from public.time_skip_requests
      where requested_by = me and status = 'pending' and coalesce(maintenance_stop_id, assignment_id) = p_ref limit 1)));
end;
$$;

create or replace function public.time_withdraw_skip(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.time_skip_requests set status = 'withdrawn', decided_at = now()
   where id = p_request_id and requested_by = public.my_person_id() and status = 'pending';
end;
$$;

-- The worker's own pending skip requests (so the screen can show "waiting for the owner").
create or replace function public.time_my_skip_requests()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'source', r.source, 'ref_id', coalesce(r.maintenance_stop_id, r.assignment_id),
         'status', r.status, 'reason', r.reason, 'created_at', r.created_at, 'decision_note', r.decision_note) order by r.created_at desc), '[]'::jsonb)
  from public.time_skip_requests r
  where r.requested_by = public.my_person_id() and r.created_at > now() - interval '3 days'
$$;

-- Owner / admin only: approve or deny.
create or replace function public.time_decide_skip(p_request_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id(); r public.time_skip_requests;
begin
  select * into r from public.time_skip_requests where id = p_request_id for update;
  if not found or not public.is_staff(r.company_id) then raise exception 'Request not found.'; end if;
  if r.status <> 'pending' then return jsonb_build_object('status', r.status); end if;

  -- Nothing left to skip: it was finished (or already skipped / cancelled) after the request. Close the request instead of failing.
  if (r.source = 'maintenance_stop' and exists (select 1 from public.maintenance_stops s where s.id = r.maintenance_stop_id and s.status in ('completed', 'skipped')))
     or (r.source = 'assignment' and exists (select 1 from public.assignments a where a.id = r.assignment_id and a.status in ('completed', 'cancelled', 'reassigned'))) then
    update public.time_skip_requests set status = 'withdrawn', decided_by = me, decided_at = now(), decision_note = 'Already finished before your decision' where id = r.id;
    return jsonb_build_object('status', 'withdrawn');
  end if;
  -- Approving a skip while someone is timing work at that property would strand their timer.
  if p_approve and exists (
    select 1 from public.time_intervals i join public.time_visits tv on tv.id = i.visit_id
     where i.ended_at is null and i.status = 'active'
       and ((r.source = 'maintenance_stop' and tv.maintenance_stop_id = r.maintenance_stop_id)
            or (r.source = 'assignment' and tv.project_id = (select a.project_id from public.assignments a where a.id = r.assignment_id)
                and tv.visit_date = (select a.scheduled_date from public.assignments a where a.id = r.assignment_id)))
  ) then
    raise exception 'Someone is timing work at this property right now. Stop that timer first, or deny the request.';
  end if;

  update public.time_skip_requests
     set status = case when p_approve then 'approved' else 'denied' end, decided_by = me, decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '')
   where id = r.id;
  if p_approve then
    if r.source = 'maintenance_stop' then
      perform public.maintenance_skip_stop(r.maintenance_stop_id, r.reason);
    else
      update public.assignments set status = 'cancelled', cancelled_at = now(), cancelled_by = me, cancellation_reason = 'Skipped (approved): ' || r.reason
       where id = r.assignment_id and status not in ('completed', 'cancelled', 'reassigned');
    end if;
    -- Any other pending request for the same property (a crew mate asked too) is answered by this one.
    update public.time_skip_requests set status = 'withdrawn', decided_by = me, decided_at = now(), decision_note = 'Another request for this property was approved'
     where id <> r.id and status = 'pending'
       and ((r.maintenance_stop_id is not null and maintenance_stop_id = r.maintenance_stop_id) or (r.assignment_id is not null and assignment_id = r.assignment_id));
  end if;
  perform public._time_audit(r.company_id, 'skip', r.id, r.requested_by, null, null, case when p_approve then 'skip_approved' else 'skip_denied' end,
                             'status', to_jsonb('pending'::text), to_jsonb(case when p_approve then 'approved' else 'denied' end), p_note, false);
  return jsonb_build_object('status', case when p_approve then 'approved' else 'denied' end);
end;
$$;

-- ── Who may call what ───────────────────────────────────────────────────────
revoke all on function public.time_my_day(date) from public, anon;
revoke all on function public.time_trucks_for_clock_in(date) from public, anon;
revoke all on function public.time_clock_in(date, uuid, uuid) from public, anon;
revoke all on function public.time_clock_out(uuid) from public, anon;
revoke all on function public.time_break_start() from public, anon;
revoke all on function public.time_break_end() from public, anon;
revoke all on function public.time_start_visit(text, uuid, double precision, double precision, double precision, text, jsonb) from public, anon;
revoke all on function public.time_complete_visit(uuid, text, double precision, double precision, double precision, text, jsonb) from public, anon;
revoke all on function public.time_request_skip(text, uuid, text) from public, anon;
revoke all on function public.time_withdraw_skip(uuid) from public, anon;
revoke all on function public.time_my_skip_requests() from public, anon;
revoke all on function public.time_decide_skip(uuid, boolean, text) from public, anon;
grant execute on function public.time_my_day(date) to authenticated;
grant execute on function public.time_trucks_for_clock_in(date) to authenticated;
grant execute on function public.time_clock_in(date, uuid, uuid) to authenticated;
grant execute on function public.time_clock_out(uuid) to authenticated;
grant execute on function public.time_break_start() to authenticated;
grant execute on function public.time_break_end() to authenticated;
grant execute on function public.time_start_visit(text, uuid, double precision, double precision, double precision, text, jsonb) to authenticated;
grant execute on function public.time_complete_visit(uuid, text, double precision, double precision, double precision, text, jsonb) to authenticated;
grant execute on function public.time_request_skip(text, uuid, text) to authenticated;
grant execute on function public.time_withdraw_skip(uuid) to authenticated;
grant execute on function public.time_my_skip_requests() to authenticated;
grant execute on function public.time_decide_skip(uuid, boolean, text) to authenticated;
