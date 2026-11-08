-- ============================================================================
-- Update 18 — run once in Supabase → SQL Editor (safe to run again).
--  • Maintenance: recurring service properties, their contracts and service
--    rules, daily routes with ordered stops, the maintenance crew, an optional
--    Maintenance Lead, start-of-day attendance, arrival/finish events, stop
--    checklists, stop photos and service history.
--  • Maintenance is separate from Projects. A property can optionally point at
--    an existing customer (and the project it came from) so nothing is typed
--    twice, but it never needs a project.
--  • Workers are classified on their membership: worker_type 'landscaping'
--    (everyone today) or 'maintenance'. Only the owner/admin can change it.
--  • Access: the owner/admin manage everything. Maintenance workers can see
--    the properties and contracts, and the routes they are assigned to.
--    They record their own day start, arrivals, checklist ticks, photos and
--    stop completion through the functions below, which keep one shared
--    result per stop and never double-count a finished stop.
--  • History is kept: properties, contracts and stops that have been worked
--    can't be deleted, only deactivated. Events are append-only.
-- ============================================================================

-- ── Worker classification ───────────────────────────────────────────────────

alter table public.company_members
  add column if not exists worker_type text not null default 'landscaping';
alter table public.company_members drop constraint if exists company_members_worker_type_check;
alter table public.company_members add constraint company_members_worker_type_check
  check (worker_type in ('landscaping', 'maintenance'));

-- The company's maintenance crew is a normal crew (update 14) flagged here.
-- At most one per company.
alter table public.crews add column if not exists is_maintenance boolean not null default false;
create unique index if not exists uq_crews_one_maintenance on public.crews (company_id) where is_maintenance;

-- ── Helpers ─────────────────────────────────────────────────────────────────

-- Active worker classified as maintenance in this company.
create or replace function public.is_maintenance_worker(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_members
    where company_id = cid and person_id = public.my_person_id()
      and status = 'active' and role = 'worker' and worker_type = 'maintenance'
  )
$$;

-- Is this person an active maintenance worker of the company?
create or replace function public.person_is_maintenance_worker(cid uuid, pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_members
    where company_id = cid and person_id = pid
      and status = 'active' and role = 'worker' and worker_type = 'maintenance'
  )
$$;

-- Straight-line distance in metres.
create or replace function public._distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 6371000 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

-- ── Properties, contracts, service rules ────────────────────────────────────

create table if not exists public.maintenance_properties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  -- Optional links to records that already exist (no re-typing).
  customer_id uuid references public.people(id) on delete set null,
  source_project_id uuid references public.projects(id) on delete set null,
  address text not null default '',
  city text,
  state text,
  zip text,
  latitude double precision,
  longitude double precision,
  -- How close (metres) an arrival must be to count as GPS-verified.
  checkin_radius_m integer not null default 150 check (checkin_radius_m between 25 and 2000),
  access_notes text,
  notes text,
  is_active boolean not null default true,
  deactivated_at timestamptz,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_maint_properties_company on public.maintenance_properties (company_id);
create index if not exists idx_maint_properties_customer on public.maintenance_properties (customer_id);

-- What was agreed for a property, usually one per season.
create table if not exists public.maintenance_contracts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  property_id uuid not null references public.maintenance_properties(id) on delete restrict,
  name text not null default 'Season contract',
  status text not null default 'active' check (status in ('active', 'inactive')),
  season_start date,
  season_end date,
  notes text,
  deactivated_at timestamptz,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (season_end is null or season_start is null or season_end >= season_start)
);
create index if not exists idx_maint_contracts_property on public.maintenance_contracts (property_id);
create index if not exists idx_maint_contracts_company on public.maintenance_contracts (company_id);

-- One recurring service in a contract, with its own schedule.
--  frequency:
--   weekly / biweekly        every 7 / 14 days
--   every_n_days             every interval_days days
--   seasonal_window          once between window_start and window_end
--                            (spring cleanup, shrub trim in July, …)
--   as_needed                never recommended automatically
--  season_quantity caps the count (e.g. 26 cuts). prior_completed_count is
--  how many were done before the app tracked them; last_completed_on is the
--  last one done before the app tracked them.
create table if not exists public.maintenance_service_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contract_id uuid not null references public.maintenance_contracts(id) on delete cascade,
  property_id uuid not null references public.maintenance_properties(id) on delete restrict,
  service_type text not null check (length(trim(service_type)) > 0),
  label text not null check (length(trim(label)) > 0),
  frequency text not null check (frequency in ('weekly', 'biweekly', 'every_n_days', 'seasonal_window', 'as_needed')),
  interval_days integer check (interval_days is null or interval_days between 1 and 365),
  starts_on date,
  window_start date,
  window_end date,
  season_quantity integer check (season_quantity is null or season_quantity between 1 and 365),
  prior_completed_count integer not null default 0 check (prior_completed_count >= 0),
  last_completed_on date,
  requires_photos boolean not null default false,
  default_checklist jsonb not null default '[]'::jsonb,
  instructions text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (frequency <> 'every_n_days' or interval_days is not null),
  check (frequency <> 'seasonal_window' or (window_start is not null and window_end is not null and window_end >= window_start))
);
create index if not exists idx_maint_rules_contract on public.maintenance_service_rules (contract_id);
create index if not exists idx_maint_rules_property on public.maintenance_service_rules (property_id);

-- ── Routes, crew, stops ─────────────────────────────────────────────────────

create table if not exists public.maintenance_routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  service_date date not null,
  name text,
  notes text,
  -- Optional Maintenance Lead for this route.
  lead_person_id uuid references public.people(id) on delete set null,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'completed', 'cancelled')),
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_maint_routes_company_date on public.maintenance_routes (company_id, service_date);

-- Who is on a route (a snapshot of the maintenance crew when it was assigned,
-- so later crew changes don't rewrite history).
create table if not exists public.maintenance_route_crew (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  route_id uuid not null references public.maintenance_routes(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  added_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_maint_route_crew on public.maintenance_route_crew (route_id, person_id);
create index if not exists idx_maint_route_crew_person on public.maintenance_route_crew (person_id);

-- One visit to one property on one route. Shared by the whole crew.
create table if not exists public.maintenance_stops (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  route_id uuid not null references public.maintenance_routes(id) on delete cascade,
  property_id uuid not null references public.maintenance_properties(id) on delete restrict,
  contract_id uuid references public.maintenance_contracts(id) on delete restrict,
  sort_order integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'arrived', 'completed', 'skipped')),
  -- Stop-specific work for this visit only (never changes the contract).
  instructions text,
  requires_photos boolean not null default false,
  min_photos integer not null default 1 check (min_photos between 1 and 20),
  arrived_at timestamptz,
  arrived_by uuid references public.people(id) on delete set null,
  arrival_location_status text,
  completed_at timestamptz,
  completed_by uuid references public.people(id) on delete set null,
  completion_location_status text,
  completion_note text,
  skipped_at timestamptz,
  skipped_by uuid references public.people(id) on delete set null,
  skip_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_maint_stops_route on public.maintenance_stops (route_id, sort_order);
create index if not exists idx_maint_stops_property on public.maintenance_stops (property_id);

-- Which services are done at a stop. Completed rows are the service history.
create table if not exists public.maintenance_stop_services (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  route_id uuid not null references public.maintenance_routes(id) on delete cascade,
  stop_id uuid not null references public.maintenance_stops(id) on delete cascade,
  property_id uuid not null references public.maintenance_properties(id) on delete restrict,
  rule_id uuid references public.maintenance_service_rules(id) on delete set null,
  -- Copied from the rule so history reads the same if the rule changes.
  service_type text not null,
  label text not null,
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_maint_stop_services_stop on public.maintenance_stop_services (stop_id);
create index if not exists idx_maint_stop_services_rule on public.maintenance_stop_services (rule_id) where completed;
create index if not exists idx_maint_stop_services_property on public.maintenance_stop_services (property_id);

-- Checklist for one stop.
create table if not exists public.maintenance_stop_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  route_id uuid not null references public.maintenance_routes(id) on delete cascade,
  stop_id uuid not null references public.maintenance_stops(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  is_required boolean not null default true,
  sort_order integer not null default 0,
  completed_at timestamptz,
  completed_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_maint_stop_tasks_stop on public.maintenance_stop_tasks (stop_id);

-- Photos taken at a stop. Internal unless the owner shares one.
create table if not exists public.maintenance_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  route_id uuid not null references public.maintenance_routes(id) on delete cascade,
  stop_id uuid not null references public.maintenance_stops(id) on delete cascade,
  property_id uuid not null references public.maintenance_properties(id) on delete restrict,
  uploaded_by uuid references public.people(id) on delete set null,
  file_url text not null,
  file_key text not null default '',
  size_bytes bigint,
  caption text,
  is_customer_visible boolean not null default false,
  shared_by uuid references public.people(id) on delete set null,
  shared_at timestamptz,
  taken_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_maint_photos_stop on public.maintenance_photos (stop_id);
create index if not exists idx_maint_photos_property on public.maintenance_photos (property_id);

-- ── Attendance and events ───────────────────────────────────────────────────

-- Start of day at the yard, one per worker per day. No row = not started.
-- An owner correction keeps what the worker recorded in original_started_at.
create table if not exists public.maintenance_day_attendance (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  service_date date not null,
  route_id uuid references public.maintenance_routes(id) on delete set null,
  started_at timestamptz not null,
  source text not null default 'worker' check (source in ('worker', 'owner_correction')),
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  distance_m double precision,
  location_status text not null,
  original_started_at timestamptz,
  corrected_at timestamptz,
  corrected_by uuid references public.people(id) on delete set null,
  correction_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_maint_attendance_day on public.maintenance_day_attendance (company_id, person_id, service_date);

-- Append-only log of who did what, with location when there was one.
--  location_status: verified | outside_radius | low_accuracy | denied |
--                   unavailable | no_target_location | not_checked
create table if not exists public.maintenance_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  route_id uuid references public.maintenance_routes(id) on delete cascade,
  stop_id uuid references public.maintenance_stops(id) on delete cascade,
  person_id uuid references public.people(id) on delete set null,
  event_type text not null check (event_type in (
    'day_started', 'arrived', 'task_checked', 'task_unchecked', 'photo_added',
    'completed', 'skipped', 'correction'
  )),
  occurred_at timestamptz not null default now(),
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  distance_m double precision,
  location_status text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_maint_events_route on public.maintenance_events (route_id, occurred_at);
create index if not exists idx_maint_events_person on public.maintenance_events (person_id, occurred_at);
-- One arrival per worker per stop, and one completion per stop.
create unique index if not exists uq_maint_events_arrival on public.maintenance_events (stop_id, person_id) where event_type = 'arrived';
create unique index if not exists uq_maint_events_completion on public.maintenance_events (stop_id) where event_type = 'completed';

-- ── Updated-at triggers ─────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'maintenance_properties', 'maintenance_contracts', 'maintenance_service_rules',
    'maintenance_routes', 'maintenance_stops', 'maintenance_stop_tasks', 'maintenance_day_attendance'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

-- ── Integrity guards ────────────────────────────────────────────────────────

-- Children of a stop take their route/property/company from the stop.
create or replace function public.maint_fill_from_stop()
returns trigger language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select company_id, route_id, property_id into s from public.maintenance_stops where id = new.stop_id;
  if s is null then raise exception 'Stop not found.'; end if;
  new.company_id := s.company_id;
  new.route_id := s.route_id;
  if tg_table_name in ('maintenance_stop_services', 'maintenance_photos') then
    new.property_id := s.property_id;
  end if;
  return new;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['maintenance_stop_services', 'maintenance_stop_tasks', 'maintenance_photos'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_fill', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.maint_fill_from_stop()', t || '_fill', t);
  end loop;
end $$;

-- A rule's property is its contract's property.
create or replace function public.maint_rule_fill_property()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select property_id, company_id into c from public.maintenance_contracts where id = new.contract_id;
  if c is null then raise exception 'Contract not found.'; end if;
  new.property_id := c.property_id;
  new.company_id := c.company_id;
  return new;
end;
$$;
drop trigger if exists maintenance_service_rules_fill on public.maintenance_service_rules;
create trigger maintenance_service_rules_fill before insert or update of contract_id on public.maintenance_service_rules
  for each row execute function public.maint_rule_fill_property();

-- Only approved maintenance workers can be put on a route or made its lead.
create or replace function public.maint_check_crew_person()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if tg_table_name = 'maintenance_routes' then
    pid := new.lead_person_id;
  else
    pid := new.person_id;
  end if;
  if pid is not null and not public.person_is_maintenance_worker(new.company_id, pid) then
    raise exception 'Only approved maintenance workers can be assigned to a maintenance route.';
  end if;
  return new;
end;
$$;
drop trigger if exists maintenance_route_crew_check on public.maintenance_route_crew;
create trigger maintenance_route_crew_check before insert on public.maintenance_route_crew
  for each row execute function public.maint_check_crew_person();
drop trigger if exists maintenance_routes_lead_check on public.maintenance_routes;
create trigger maintenance_routes_lead_check before insert or update of lead_person_id on public.maintenance_routes
  for each row execute function public.maint_check_crew_person();

-- Worked stops (and routes that have them) keep their history.
create or replace function public.maint_block_history_delete()
returns trigger language plpgsql as $$
begin
  if tg_table_name = 'maintenance_stops' and old.status <> 'pending' then
    raise exception 'This stop has recorded work and can''t be deleted. Skip it instead.';
  end if;
  if tg_table_name = 'maintenance_routes' and exists (
    select 1 from public.maintenance_stops where route_id = old.id and status <> 'pending'
  ) then
    raise exception 'This route has recorded work and can''t be deleted. Cancel it instead.';
  end if;
  return old;
end;
$$;
drop trigger if exists maintenance_stops_keep_history on public.maintenance_stops;
create trigger maintenance_stops_keep_history before delete on public.maintenance_stops
  for each row execute function public.maint_block_history_delete();
drop trigger if exists maintenance_routes_keep_history on public.maintenance_routes;
create trigger maintenance_routes_keep_history before delete on public.maintenance_routes
  for each row execute function public.maint_block_history_delete();

-- Assigned-to-route check used by the access rules.
create or replace function public.on_maintenance_route(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.maintenance_route_crew rc
    join public.company_members m on m.company_id = rc.company_id and m.person_id = rc.person_id
    where rc.route_id = rid and rc.person_id = public.my_person_id() and m.status = 'active'
  )
$$;

-- ── Access rules ────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'maintenance_properties', 'maintenance_contracts', 'maintenance_service_rules',
    'maintenance_routes', 'maintenance_route_crew', 'maintenance_stops',
    'maintenance_stop_services', 'maintenance_stop_tasks', 'maintenance_photos',
    'maintenance_day_attendance', 'maintenance_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Properties, contracts, rules: owner/admin manage; maintenance workers read.
do $$
declare t text;
begin
  foreach t in array array['maintenance_properties', 'maintenance_contracts', 'maintenance_service_rules'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select using (public.is_staff(company_id) or public.is_maintenance_worker(company_id))', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff', t);
    execute format('create policy %I on public.%I for all using (public.is_staff(company_id)) with check (public.is_staff(company_id))', t || '_staff', t);
  end loop;
end $$;

-- Routes and everything on them: owner/admin manage; the assigned crew reads.
drop policy if exists maintenance_routes_select on public.maintenance_routes;
create policy maintenance_routes_select on public.maintenance_routes for select
  using (public.is_staff(company_id) or public.on_maintenance_route(id));
drop policy if exists maintenance_routes_staff on public.maintenance_routes;
create policy maintenance_routes_staff on public.maintenance_routes for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));

do $$
declare t text;
begin
  foreach t in array array['maintenance_route_crew', 'maintenance_stops', 'maintenance_stop_services', 'maintenance_stop_tasks'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select using (public.is_staff(company_id) or public.on_maintenance_route(route_id))', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff', t);
    execute format('create policy %I on public.%I for all using (public.is_staff(company_id)) with check (public.is_staff(company_id))', t || '_staff', t);
  end loop;
end $$;

-- Photos: the crew can add their own (internal only) and remove their own
-- until the stop is finished.
drop policy if exists maintenance_photos_select on public.maintenance_photos;
create policy maintenance_photos_select on public.maintenance_photos for select
  using (public.is_staff(company_id) or public.on_maintenance_route(route_id));
drop policy if exists maintenance_photos_staff on public.maintenance_photos;
create policy maintenance_photos_staff on public.maintenance_photos for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));
drop policy if exists maintenance_photos_crew_insert on public.maintenance_photos;
create policy maintenance_photos_crew_insert on public.maintenance_photos for insert
  with check (
    public.on_maintenance_route(route_id)
    and uploaded_by = public.my_person_id()
    and is_customer_visible = false and shared_by is null
    and exists (select 1 from public.maintenance_stops s where s.id = maintenance_photos.stop_id and s.status in ('pending', 'arrived'))
  );
drop policy if exists maintenance_photos_crew_delete on public.maintenance_photos;
create policy maintenance_photos_crew_delete on public.maintenance_photos for delete
  using (
    uploaded_by = public.my_person_id()
    and public.on_maintenance_route(route_id)
    and exists (select 1 from public.maintenance_stops s where s.id = maintenance_photos.stop_id and s.status in ('pending', 'arrived'))
  );

-- Attendance: owner/admin see everyone; a worker sees their own. Writes go
-- through maintenance_start_day / maintenance_correct_attendance.
drop policy if exists maintenance_day_attendance_select on public.maintenance_day_attendance;
create policy maintenance_day_attendance_select on public.maintenance_day_attendance for select
  using (public.is_staff(company_id) or person_id = public.my_person_id());

-- Events: read by owner/admin and the route's crew (a worker also sees their
-- own day-start events). Written only by the functions below.
drop policy if exists maintenance_events_select on public.maintenance_events;
create policy maintenance_events_select on public.maintenance_events for select
  using (
    public.is_staff(company_id)
    or (route_id is not null and public.on_maintenance_route(route_id))
    or person_id = public.my_person_id()
  );

-- ── Actions (one shared result per stop) ────────────────────────────────────

-- Works out how trustworthy a reported position is.
create or replace function public._maint_location(
  p_lat double precision, p_lng double precision, p_accuracy double precision, p_state text,
  t_lat double precision, t_lng double precision, t_radius double precision,
  out status text, out distance double precision
) language plpgsql immutable as $$
begin
  distance := null;
  if coalesce(p_state, 'ok') in ('denied', 'unavailable') then
    status := p_state; return;
  end if;
  if p_lat is null or p_lng is null then
    status := 'unavailable'; return;
  end if;
  if t_lat is null or t_lng is null then
    status := 'no_target_location'; return;
  end if;
  distance := round(public._distance_m(p_lat, p_lng, t_lat, t_lng)::numeric, 1);
  if p_accuracy is null or p_accuracy > greatest(100, t_radius) then
    status := 'low_accuracy';
  elsif distance > t_radius then
    status := 'outside_radius';
  else
    status := 'verified';
  end if;
end;
$$;

-- Start of day. Never blocked by GPS; the location is recorded as it was.
-- Calling it again the same day returns the first record unchanged.
create or replace function public.maintenance_start_day(
  p_company_id uuid,
  p_service_date date,
  p_route_id uuid default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy double precision default null,
  p_location_state text default 'ok'
) returns public.maintenance_day_attendance
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  c record;
  loc record;
  att public.maintenance_day_attendance;
begin
  if not public.is_crew(p_company_id) then raise exception 'Not a member of this company.'; end if;
  select * into att from public.maintenance_day_attendance
  where company_id = p_company_id and person_id = me and service_date = p_service_date;
  if found then return att; end if;

  select yard_latitude, yard_longitude into c from public.companies where id = p_company_id;
  select * into loc from public._maint_location(p_lat, p_lng, p_accuracy, p_location_state, c.yard_latitude, c.yard_longitude, 300);

  insert into public.maintenance_day_attendance
    (company_id, person_id, service_date, route_id, started_at, source, latitude, longitude, accuracy_m, distance_m, location_status)
  values (p_company_id, me, p_service_date, p_route_id, now(), 'worker', p_lat, p_lng, p_accuracy, loc.distance, loc.status)
  on conflict (company_id, person_id, service_date) do nothing
  returning * into att;
  if att.id is null then
    select * into att from public.maintenance_day_attendance
    where company_id = p_company_id and person_id = me and service_date = p_service_date;
    return att;
  end if;

  insert into public.maintenance_events (company_id, route_id, person_id, event_type, latitude, longitude, accuracy_m, distance_m, location_status)
  values (p_company_id, p_route_id, me, 'day_started', p_lat, p_lng, p_accuracy, loc.distance, loc.status);
  return att;
end;
$$;

-- Owner/admin correction of a worker's day start. Keeps the original time.
create or replace function public.maintenance_correct_attendance(
  p_company_id uuid, p_person_id uuid, p_service_date date, p_started_at timestamptz, p_note text
) returns public.maintenance_day_attendance
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  att public.maintenance_day_attendance;
begin
  if not public.is_staff(p_company_id) then raise exception 'Only the owner or an admin can correct attendance.'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Add a note explaining the correction.'; end if;
  select * into att from public.maintenance_day_attendance
  where company_id = p_company_id and person_id = p_person_id and service_date = p_service_date
  for update;
  if found then
    update public.maintenance_day_attendance
       set original_started_at = coalesce(original_started_at, started_at),
           started_at = p_started_at, corrected_at = now(), corrected_by = me, correction_note = p_note
     where id = att.id
    returning * into att;
  else
    insert into public.maintenance_day_attendance
      (company_id, person_id, service_date, started_at, source, location_status, corrected_at, corrected_by, correction_note)
    values (p_company_id, p_person_id, p_service_date, p_started_at, 'owner_correction', 'not_checked', now(), me, p_note)
    returning * into att;
  end if;
  insert into public.maintenance_events (company_id, person_id, event_type, note, metadata)
  values (p_company_id, me, 'correction', p_note, jsonb_build_object(
    'kind', 'attendance', 'worker_id', p_person_id, 'service_date', p_service_date,
    'started_at', p_started_at, 'original_started_at', att.original_started_at));
  return att;
end;
$$;

-- Can the caller work this stop? Returns the stop locked for update.
create or replace function public._maint_stop_for_crew(p_stop_id uuid)
returns public.maintenance_stops
language plpgsql security definer set search_path = public as $$
declare s public.maintenance_stops;
begin
  select * into s from public.maintenance_stops where id = p_stop_id for update;
  if not found then raise exception 'Stop not found.'; end if;
  if not (public.is_staff(s.company_id) or public.on_maintenance_route(s.route_id)) then
    raise exception 'You are not assigned to this route.';
  end if;
  return s;
end;
$$;

-- "I'm here". One arrival per worker per stop; repeat taps return the stop.
create or replace function public.maintenance_mark_arrived(
  p_stop_id uuid,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy double precision default null,
  p_location_state text default 'ok'
) returns public.maintenance_stops
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  s public.maintenance_stops;
  p record;
  loc record;
begin
  s := public._maint_stop_for_crew(p_stop_id);
  if s.status in ('completed', 'skipped') then return s; end if;
  select latitude, longitude, checkin_radius_m into p from public.maintenance_properties where id = s.property_id;
  select * into loc from public._maint_location(p_lat, p_lng, p_accuracy, p_location_state, p.latitude, p.longitude, p.checkin_radius_m);

  insert into public.maintenance_events (company_id, route_id, stop_id, person_id, event_type, latitude, longitude, accuracy_m, distance_m, location_status)
  values (s.company_id, s.route_id, s.id, me, 'arrived', p_lat, p_lng, p_accuracy, loc.distance, loc.status)
  on conflict (stop_id, person_id) where event_type = 'arrived' do nothing;

  if s.status = 'pending' then
    update public.maintenance_stops
       set status = 'arrived', arrived_at = now(), arrived_by = me, arrival_location_status = loc.status
     where id = s.id
    returning * into s;
    update public.maintenance_routes set status = 'in_progress'
     where id = s.route_id and status = 'planned';
  end if;
  return s;
end;
$$;

-- Tick or untick a checklist item (until the stop is finished).
create or replace function public.maintenance_set_task_done(p_task_id uuid, p_done boolean)
returns public.maintenance_stop_tasks
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  t public.maintenance_stop_tasks;
  s public.maintenance_stops;
begin
  select * into t from public.maintenance_stop_tasks where id = p_task_id;
  if not found then raise exception 'Checklist item not found.'; end if;
  s := public._maint_stop_for_crew(t.stop_id);
  if s.status in ('completed', 'skipped') then raise exception 'This stop is already finished.'; end if;
  if (t.completed_at is not null) = p_done then return t; end if;
  update public.maintenance_stop_tasks
     set completed_at = case when p_done then now() end,
         completed_by = case when p_done then me end
   where id = t.id
  returning * into t;
  insert into public.maintenance_events (company_id, route_id, stop_id, person_id, event_type, metadata)
  values (s.company_id, s.route_id, s.id, me, case when p_done then 'task_checked' else 'task_unchecked' end,
          jsonb_build_object('task_id', t.id, 'title', t.title));
  return t;
end;
$$;

-- Logs a photo added by the crew (the photo row itself is inserted directly).
create or replace function public.maintenance_log_photo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.maintenance_events (company_id, route_id, stop_id, person_id, event_type, metadata)
  values (new.company_id, new.route_id, new.stop_id, new.uploaded_by, 'photo_added', jsonb_build_object('photo_id', new.id));
  return new;
end;
$$;
drop trigger if exists maintenance_photos_log on public.maintenance_photos;
create trigger maintenance_photos_log after insert on public.maintenance_photos
  for each row execute function public.maintenance_log_photo();

-- "Finish stop". Checks the checklist and photos, then completes the stop for
-- the whole crew exactly once. Repeat calls return the finished stop.
create or replace function public.maintenance_finish_stop(
  p_stop_id uuid,
  p_note text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy double precision default null,
  p_location_state text default 'ok'
) returns public.maintenance_stops
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  s public.maintenance_stops;
  p record;
  loc record;
  open_tasks int;
  photo_count int;
  staff boolean;
begin
  s := public._maint_stop_for_crew(p_stop_id);
  if s.status = 'completed' then return s; end if;
  if s.status = 'skipped' then raise exception 'This stop was skipped.'; end if;
  staff := public.is_staff(s.company_id);
  if s.status <> 'arrived' and not staff then
    raise exception 'Tap I''m Here at this property first.';
  end if;

  select count(*) into open_tasks from public.maintenance_stop_tasks
  where stop_id = s.id and is_required and completed_at is null;
  if open_tasks > 0 then
    raise exception '% required checklist item(s) still open.', open_tasks;
  end if;
  if s.requires_photos then
    select count(*) into photo_count from public.maintenance_photos where stop_id = s.id;
    if photo_count < s.min_photos then
      raise exception 'Add % more photo(s) before finishing.', s.min_photos - photo_count;
    end if;
  end if;

  select latitude, longitude, checkin_radius_m into p from public.maintenance_properties where id = s.property_id;
  select * into loc from public._maint_location(p_lat, p_lng, p_accuracy, p_location_state, p.latitude, p.longitude, p.checkin_radius_m);

  update public.maintenance_stops
     set status = 'completed', completed_at = now(), completed_by = me,
         completion_location_status = loc.status, completion_note = nullif(trim(p_note), '')
   where id = s.id
  returning * into s;
  update public.maintenance_stop_services set completed = true, completed_at = s.completed_at
   where stop_id = s.id;
  insert into public.maintenance_events (company_id, route_id, stop_id, person_id, event_type, latitude, longitude, accuracy_m, distance_m, location_status, note, metadata)
  values (s.company_id, s.route_id, s.id, me, 'completed', p_lat, p_lng, p_accuracy, loc.distance, loc.status, nullif(trim(p_note), ''),
          jsonb_build_object('recorded_by_staff_without_arrival', staff and s.arrived_at is null));

  update public.maintenance_routes r set status = 'completed'
   where r.id = s.route_id and r.status in ('planned', 'in_progress')
     and not exists (select 1 from public.maintenance_stops x where x.route_id = r.id and x.status in ('pending', 'arrived'));
  update public.maintenance_routes set status = 'in_progress' where id = s.route_id and status = 'planned';
  return s;
end;
$$;

-- Owner/admin skips a stop (with a reason). Nothing is counted as done.
create or replace function public.maintenance_skip_stop(p_stop_id uuid, p_reason text)
returns public.maintenance_stops
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  s public.maintenance_stops;
begin
  select * into s from public.maintenance_stops where id = p_stop_id for update;
  if not found then raise exception 'Stop not found.'; end if;
  if not public.is_staff(s.company_id) then raise exception 'Only the owner or an admin can skip a stop.'; end if;
  if s.status in ('completed', 'skipped') then return s; end if;
  update public.maintenance_stops
     set status = 'skipped', skipped_at = now(), skipped_by = me, skip_reason = nullif(trim(p_reason), '')
   where id = s.id
  returning * into s;
  insert into public.maintenance_events (company_id, route_id, stop_id, person_id, event_type, note)
  values (s.company_id, s.route_id, s.id, me, 'skipped', nullif(trim(p_reason), ''));
  update public.maintenance_routes r set status = 'completed'
   where r.id = s.route_id and r.status in ('planned', 'in_progress')
     and not exists (select 1 from public.maintenance_stops x where x.route_id = r.id and x.status in ('pending', 'arrived'));
  return s;
end;
$$;

revoke all on function public._maint_stop_for_crew(uuid) from public, anon, authenticated;
grant execute on function public.maintenance_start_day(uuid, date, uuid, double precision, double precision, double precision, text) to authenticated;
grant execute on function public.maintenance_correct_attendance(uuid, uuid, date, timestamptz, text) to authenticated;
grant execute on function public.maintenance_mark_arrived(uuid, double precision, double precision, double precision, text) to authenticated;
grant execute on function public.maintenance_set_task_done(uuid, boolean) to authenticated;
grant execute on function public.maintenance_finish_stop(uuid, text, double precision, double precision, double precision, text) to authenticated;
grant execute on function public.maintenance_skip_stop(uuid, text) to authenticated;

-- ── Live updates ────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'maintenance_properties', 'maintenance_contracts', 'maintenance_service_rules',
    'maintenance_routes', 'maintenance_route_crew', 'maintenance_stops',
    'maintenance_stop_services', 'maintenance_stop_tasks', 'maintenance_photos',
    'maintenance_day_attendance', 'maintenance_events'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
