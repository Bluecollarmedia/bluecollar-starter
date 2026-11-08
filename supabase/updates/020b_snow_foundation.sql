-- ============================================================================
-- Update 20b — run once in Supabase → SQL Editor, AFTER update 20 (snow
-- access) and BEFORE update 22 (snow property details). Safe to run again.
--  Snow Mode foundation: the base records every snow screen builds on.
--
--  • Snow properties (their services, contacts, instructions and reference
--    media are added by update 22).
--  • Storms (one service each, several can be active at once), routes inside
--    a storm, and visits: one row per stop on a route. The same property can
--    be on several routes and more than once on one route; each visit has its
--    own status and timestamps. Nothing is ever "completed per property".
--  • The route's current lead lives on the route; every assignment and
--    reassignment is kept in snow_route_lead_assignments.
--  • Completion media (photos/videos uploaded during a storm) is separate from
--    property reference media (owned by a later update).
--  • Skip requests: a lead asks, the owner decides. A visit can only become
--    'skipped' once its request is approved, and skipped never counts as done.
--  • Activity events: one append-only log for the whole of Snow Mode. Rows are
--    written by snow_log_event() from triggers and server functions only.
--  • History: visits keep the property name/address as it was when the visit
--    was created; worked visits, media, decisions and lead assignments can't be
--    deleted; finished visits can't be reopened (a new pass is a new visit).
--
--  Access in this update is owner/admin only (public.is_staff). Snow worker
--  and customer access, signup, shifts, notification settings, reference media
--  and lifecycle functions come in the updates numbered after this one.
--  A route lead must hold that service on the snow team (update 20).
--  Nothing here touches landscaping tables or gives anyone landscaping access.
-- ============================================================================

-- ── Company snow settings ───────────────────────────────────────────────────

create table if not exists public.snow_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  -- Lead must tap "I'm Here" before a visit can be completed.
  require_arrival_before_completion boolean not null default true,
  updated_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every company gets a settings row (existing ones now, new ones on create).
insert into public.snow_settings (company_id) select id from public.companies on conflict do nothing;
create or replace function public.snow_settings_for_new_company()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.snow_settings (company_id) values (new.id) on conflict do nothing;
  return null;
end;
$$;
drop trigger if exists companies_snow_settings on public.companies;
create trigger companies_snow_settings after insert on public.companies
  for each row execute function public.snow_settings_for_new_company();

-- ── Properties and their services ───────────────────────────────────────────

create table if not exists public.snow_properties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  address text not null default '',
  city text,
  state text,
  zip text,
  latitude double precision,
  longitude double precision,
  -- Optional text for the maps app when the address alone isn't right
  -- (e.g. "Rear lot entrance, 12 Main St").
  map_destination text,
  notes text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  deactivated_at timestamptz,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_snow_properties_company on public.snow_properties (company_id);

-- ── Storms, routes, lead assignments, visits ────────────────────────────────

create table if not exists public.snow_storms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  service text not null check (service in ('plowing', 'shoveling', 'salting')),
  -- draft → dispatched → ended; reopening sets it back to dispatched.
  -- Transitions are enforced by the storm lifecycle update.
  status text not null default 'draft' check (status in ('draft', 'dispatched', 'ended')),
  notes text,
  created_by uuid references public.people(id) on delete set null,
  dispatched_at timestamptz,
  dispatched_by uuid references public.people(id) on delete set null,
  ended_at timestamptz,
  ended_by uuid references public.people(id) on delete set null,
  reopened_count integer not null default 0 check (reopened_count >= 0),
  last_reopened_at timestamptz,
  last_reopened_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, service)
);
create index if not exists idx_snow_storms_company_status on public.snow_storms (company_id, status);

create table if not exists public.snow_routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  storm_id uuid not null,
  -- Always the storm's service (filled in from the storm).
  service text not null check (service in ('plowing', 'shoveling', 'salting')),
  name text not null check (length(trim(name)) > 0),
  position integer not null default 0,
  -- The current lead. Several routes can share a lead; there is no limit.
  lead_person_id uuid references public.people(id) on delete set null,
  -- Completion photos/videos: required or optional, and how many when required.
  media_required boolean not null default false,
  min_media integer not null default 1 check (min_media between 1 and 20),
  notes text,
  cancelled_at timestamptz,
  cancelled_by uuid references public.people(id) on delete set null,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (storm_id, service) references public.snow_storms (id, service) on delete cascade,
  unique (id, storm_id, service)
);
create index if not exists idx_snow_routes_storm on public.snow_routes (storm_id, position);
create index if not exists idx_snow_routes_lead on public.snow_routes (lead_person_id) where lead_person_id is not null;

-- Every lead a route has had. Written by the trigger on snow_routes; the open
-- row (ended_at null) is the current lead.
create table if not exists public.snow_route_lead_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  storm_id uuid not null references public.snow_storms(id) on delete cascade,
  route_id uuid not null references public.snow_routes(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  assigned_by uuid references public.people(id) on delete set null,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references public.people(id) on delete set null
);
create unique index if not exists uq_snow_route_current_lead on public.snow_route_lead_assignments (route_id) where ended_at is null;
create index if not exists idx_snow_lead_assignments_person on public.snow_route_lead_assignments (person_id, storm_id);

-- One stop on one route. Repeat passes at a property are separate rows.
create table if not exists public.snow_visits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  storm_id uuid not null,
  route_id uuid not null,
  service text not null check (service in ('plowing', 'shoveling', 'salting')),
  property_id uuid not null references public.snow_properties(id) on delete restrict,
  -- Order on the route, set only by the owner.
  position integer not null,
  status text not null default 'pending' check (status in ('pending', 'arrived', 'completed', 'skipped')),
  arrived_at timestamptz,
  arrived_by uuid references public.people(id) on delete set null,
  completed_at timestamptz,
  completed_by uuid references public.people(id) on delete set null,
  completion_note text,
  skipped_at timestamptz,
  skipped_by uuid references public.people(id) on delete set null,
  -- The property as it was when this visit was created, so later edits to the
  -- property don't rewrite past storms.
  property_name text not null default '',
  property_address text not null default '',
  -- True when the owner added it after the storm was dispatched.
  added_after_dispatch boolean not null default false,
  -- Lets the app retry a create after a network drop without making two.
  client_request_id uuid unique,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (route_id, storm_id, service) references public.snow_routes (id, storm_id, service) on delete cascade,
  constraint snow_visits_route_position unique (route_id, position) deferrable initially deferred
);
create index if not exists idx_snow_visits_storm on public.snow_visits (storm_id, status);
create index if not exists idx_snow_visits_property on public.snow_visits (property_id, completed_at);
create index if not exists idx_snow_visits_property_service on public.snow_visits (property_id, service);

-- ── Completion media ────────────────────────────────────────────────────────

-- Photos/videos uploaded at a visit as proof of the work. Never shown to a
-- customer from this table: review and sharing are added by a later update.
create table if not exists public.snow_completion_media (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  storm_id uuid not null references public.snow_storms(id) on delete cascade,
  route_id uuid not null references public.snow_routes(id) on delete cascade,
  visit_id uuid not null references public.snow_visits(id) on delete cascade,
  property_id uuid not null references public.snow_properties(id) on delete restrict,
  service text not null,
  kind text not null check (kind in ('photo', 'video')),
  file_key text not null check (length(file_key) > 0),
  file_url text not null default '',
  size_bytes bigint,
  duration_s numeric,
  uploaded_by uuid references public.people(id) on delete set null,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  unique (visit_id, file_key)
);
create index if not exists idx_snow_completion_media_visit on public.snow_completion_media (visit_id);
create index if not exists idx_snow_completion_media_property on public.snow_completion_media (property_id, created_at);

-- ── Skip requests ───────────────────────────────────────────────────────────

create table if not exists public.snow_skip_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  storm_id uuid not null references public.snow_storms(id) on delete cascade,
  route_id uuid not null references public.snow_routes(id) on delete cascade,
  visit_id uuid not null references public.snow_visits(id) on delete cascade,
  property_id uuid not null references public.snow_properties(id) on delete restrict,
  requested_by uuid references public.people(id) on delete set null,
  reason text not null check (length(trim(reason)) > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'withdrawn')),
  decided_by uuid references public.people(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  client_request_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- At most one open request per visit.
create unique index if not exists uq_snow_skip_one_pending on public.snow_skip_requests (visit_id) where status = 'pending';
create index if not exists idx_snow_skip_requests_storm on public.snow_skip_requests (storm_id, status);

-- ── Activity log ────────────────────────────────────────────────────────────

-- Append-only. Ids are plain columns (not foreign keys) so a row survives
-- whatever happens to the record it describes.
--  action examples: storm.created, storm.dispatched, storm.ended, storm.reopened,
--  route.created, route.updated, route.media_rule_changed, route.cancelled,
--  route.lead_assigned, route.lead_ended, visit.added, visit.moved,
--  visit.arrived, visit.completed, visit.skipped, visit.removed,
--  media.uploaded, skip.requested, skip.approved, skip.denied, skip.withdrawn,
--  property.created, property.updated, settings.changed. Later updates add their own (shift.*, notification.*,
--  media.reviewed, media.shared, …).
create table if not exists public.snow_activity_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  action text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  entity_type text not null,
  entity_id uuid,
  storm_id uuid,
  route_id uuid,
  visit_id uuid,
  property_id uuid,
  -- The worker the event is about (lead, uploader, employee on a shift).
  person_id uuid,
  service text,
  before jsonb,
  after jsonb,
  note text
);
create index if not exists idx_snow_activity_company_time on public.snow_activity_events (company_id, occurred_at desc);
create index if not exists idx_snow_activity_storm on public.snow_activity_events (storm_id, occurred_at desc) where storm_id is not null;
create index if not exists idx_snow_activity_route on public.snow_activity_events (route_id, occurred_at desc) where route_id is not null;
create index if not exists idx_snow_activity_property on public.snow_activity_events (property_id, occurred_at desc) where property_id is not null;
create index if not exists idx_snow_activity_person on public.snow_activity_events (person_id, occurred_at desc) where person_id is not null;
create index if not exists idx_snow_activity_action on public.snow_activity_events (company_id, action, occurred_at desc);

-- The one way to write an event. Server-side only (triggers and SECURITY
-- DEFINER functions); the app can't call it.
create or replace function public.snow_log_event(
  p_company_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_storm_id uuid default null,
  p_route_id uuid default null,
  p_visit_id uuid default null,
  p_property_id uuid default null,
  p_person_id uuid default null,
  p_service text default null,
  p_before jsonb default null,
  p_after jsonb default null,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare eid uuid;
begin
  insert into public.snow_activity_events
    (company_id, actor_id, action, entity_type, entity_id, storm_id, route_id, visit_id,
     property_id, person_id, service, before, after, note)
  values
    (p_company_id, public.my_person_id(), p_action, p_entity_type, p_entity_id, p_storm_id, p_route_id, p_visit_id,
     p_property_id, p_person_id, p_service, p_before, p_after, nullif(trim(p_note), ''))
  returning id into eid;
  return eid;
end;
$$;
revoke all on function public.snow_log_event(uuid, text, text, uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb, text) from public, anon, authenticated;

create or replace function public.snow_activity_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'The snow activity log can''t be changed or deleted.';
end;
$$;
drop trigger if exists snow_activity_events_append_only on public.snow_activity_events;
create trigger snow_activity_events_append_only before update or delete on public.snow_activity_events
  for each row execute function public.snow_activity_append_only();

-- ── Updated-at triggers ─────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'snow_settings', 'snow_properties', 'snow_storms',
    'snow_routes', 'snow_visits', 'snow_skip_requests'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

-- ── Integrity: fill and check parent links ──────────────────────────────────

-- A route takes its company and service from its storm, and stays in it.
create or replace function public.snow_route_fill()
returns trigger language plpgsql security definer set search_path = public as $$
declare st record;
begin
  if tg_op = 'UPDATE' and new.storm_id <> old.storm_id then
    raise exception 'A route can''t be moved to another storm.';
  end if;
  select company_id, service, status into st from public.snow_storms where id = new.storm_id;
  if st is null then raise exception 'Storm not found.'; end if;
  if tg_op = 'INSERT' and st.status = 'ended' then
    raise exception 'This storm has ended. Reopen it to add routes.';
  end if;
  new.company_id := st.company_id;
  new.service := st.service;
  return new;
end;
$$;
drop trigger if exists snow_routes_fill on public.snow_routes;
create trigger snow_routes_fill before insert or update on public.snow_routes
  for each row execute function public.snow_route_fill();

-- A visit takes company/storm/service from its route; the property name and
-- address are copied once, here. (Update 22 also checks the property is set
-- up for the route's service.)
create or replace function public.snow_visit_fill()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
  p record;
begin
  select rt.company_id, rt.storm_id, rt.service, rt.cancelled_at, st.status as storm_status
    into r
    from public.snow_routes rt join public.snow_storms st on st.id = rt.storm_id
   where rt.id = new.route_id;
  if r is null then raise exception 'Route not found.'; end if;

  if tg_op = 'UPDATE' then
    if new.property_id <> old.property_id then
      raise exception 'A visit can''t be changed to another property. Add a new visit instead.';
    end if;
    if new.route_id <> old.route_id then
      if old.status <> 'pending' then raise exception 'Only a visit that hasn''t been started can move to another route.'; end if;
      if r.storm_id <> old.storm_id then raise exception 'A visit can''t move to another storm.'; end if;
    end if;
    new.company_id := old.company_id;
    new.storm_id := old.storm_id;
    new.property_id := old.property_id;
    new.service := old.service;
    new.property_name := old.property_name;
    new.property_address := old.property_address;
    new.added_after_dispatch := old.added_after_dispatch;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    return new;
  end if;

  if r.storm_status = 'ended' then raise exception 'This storm has ended. Reopen it to add visits.'; end if;
  if r.cancelled_at is not null then raise exception 'This route was cancelled.'; end if;
  select company_id, name, address, city, state, zip into p from public.snow_properties where id = new.property_id;
  if p is null or p.company_id <> r.company_id then raise exception 'Property not found.'; end if;

  new.company_id := r.company_id;
  new.storm_id := r.storm_id;
  new.service := r.service;
  new.property_name := p.name;
  new.property_address := concat_ws(', ', nullif(trim(p.address), ''), nullif(trim(p.city), ''),
                                    nullif(trim(concat_ws(' ', nullif(trim(p.state), ''), nullif(trim(p.zip), ''))), ''));
  new.added_after_dispatch := r.storm_status = 'dispatched';
  new.created_by := coalesce(new.created_by, public.my_person_id());
  if new.position is null then
    select coalesce(max(position), 0) + 1 into new.position from public.snow_visits where route_id = new.route_id;
  end if;
  -- New visits always start fresh.
  new.status := 'pending';
  new.arrived_at := null; new.arrived_by := null;
  new.completed_at := null; new.completed_by := null; new.completion_note := null;
  new.skipped_at := null; new.skipped_by := null;
  return new;
end;
$$;
drop trigger if exists snow_visits_fill on public.snow_visits;
create trigger snow_visits_fill before insert or update on public.snow_visits
  for each row execute function public.snow_visit_fill();

-- Media and skip requests take company/storm/route/property from the visit.
create or replace function public.snow_fill_from_visit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if tg_op = 'UPDATE' and new.visit_id <> old.visit_id then
    raise exception 'This record can''t be moved to another visit.';
  end if;
  select company_id, storm_id, route_id, property_id, service, status into v from public.snow_visits where id = new.visit_id;
  if v is null then raise exception 'Visit not found.'; end if;
  new.company_id := v.company_id;
  new.storm_id := v.storm_id;
  new.route_id := v.route_id;
  new.property_id := v.property_id;
  if tg_table_name = 'snow_completion_media' then
    new.service := v.service;
    if tg_op = 'INSERT' then
      if v.status = 'skipped' then raise exception 'This visit was skipped.'; end if;
      new.uploaded_by := coalesce(new.uploaded_by, public.my_person_id());
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists snow_completion_media_fill on public.snow_completion_media;
create trigger snow_completion_media_fill before insert or update on public.snow_completion_media
  for each row execute function public.snow_fill_from_visit();
drop trigger if exists snow_skip_requests_fill on public.snow_skip_requests;
create trigger snow_skip_requests_fill before insert or update on public.snow_skip_requests
  for each row execute function public.snow_fill_from_visit();

-- Moving a visit to another route keeps media and skip requests with it.
create or replace function public.snow_visit_children_follow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.route_id <> old.route_id then
    update public.snow_completion_media set route_id = new.route_id where visit_id = new.id;
    update public.snow_skip_requests set route_id = new.route_id where visit_id = new.id;
  end if;
  return null;
end;
$$;
drop trigger if exists snow_visits_children_follow on public.snow_visits;
create trigger snow_visits_children_follow after update of route_id on public.snow_visits
  for each row execute function public.snow_visit_children_follow();

-- ── Integrity: visit status ─────────────────────────────────────────────────
--  pending → arrived → completed, or pending/arrived → skipped (only with an
--  approved skip request). completed and skipped are final: more work at the
--  property is a new visit. Status only changes while the storm is dispatched.
--  Completing also needs the route's required photos/videos (as set at that
--  moment) and, if the company setting is on, an arrival first. Who may do it
--  and the route order are checked by the arrive/complete functions in a
--  later update.

create or replace function public.snow_visit_status_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  storm_status text;
  me uuid := public.my_person_id();
  rt record;
  media_count int;
begin
  if new.status = old.status then
    -- Recorded times stay as recorded.
    new.arrived_at := old.arrived_at; new.arrived_by := old.arrived_by;
    new.completed_at := old.completed_at; new.completed_by := old.completed_by;
    new.skipped_at := old.skipped_at; new.skipped_by := old.skipped_by;
    if old.status in ('completed', 'skipped') then
      new.completion_note := old.completion_note;
    end if;
    return new;
  end if;
  if old.status in ('completed', 'skipped') then
    raise exception 'This visit is already %. Add a new visit for more work.', old.status;
  end if;
  select status into storm_status from public.snow_storms where id = old.storm_id;
  if storm_status <> 'dispatched' then
    raise exception 'Work can only be recorded while the storm is dispatched.';
  end if;

  if new.status = 'pending' then
    raise exception 'A started visit can''t go back to not started.';
  elsif new.status = 'arrived' then
    new.arrived_at := coalesce(new.arrived_at, now());
    new.arrived_by := coalesce(new.arrived_by, me);
  elsif new.status = 'completed' then
    if old.status = 'pending' and coalesce((select require_arrival_before_completion from public.snow_settings
                                             where company_id = old.company_id), true) then
      raise exception 'Tap I''m Here at this property first.';
    end if;
    select media_required, min_media into rt from public.snow_routes where id = old.route_id;
    if rt.media_required then
      select count(*) into media_count from public.snow_completion_media where visit_id = old.id;
      if media_count < rt.min_media then
        raise exception 'Add % more photo(s) or video(s) before completing this stop.', rt.min_media - media_count;
      end if;
    end if;
    new.completed_at := coalesce(new.completed_at, now());
    new.completed_by := coalesce(new.completed_by, me);
    new.arrived_at := coalesce(old.arrived_at, new.arrived_at);
    new.arrived_by := coalesce(old.arrived_by, new.arrived_by);
  elsif new.status = 'skipped' then
    if not exists (select 1 from public.snow_skip_requests where visit_id = old.id and status = 'approved') then
      raise exception 'A visit can only be skipped after its skip request is approved.';
    end if;
    new.skipped_at := coalesce(new.skipped_at, now());
    new.skipped_by := coalesce(new.skipped_by, me);
    new.completed_at := null; new.completed_by := null;
  end if;
  return new;
end;
$$;
drop trigger if exists snow_visits_status_guard on public.snow_visits;
create trigger snow_visits_status_guard before update on public.snow_visits
  for each row execute function public.snow_visit_status_guard();

-- Skip request decisions: pending → approved / denied / withdrawn, once.
-- The reason and requester never change. An approved request skips the visit.
create or replace function public.snow_skip_request_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if tg_op = 'INSERT' then
    select status into v from public.snow_visits where id = new.visit_id;
    if v.status not in ('pending', 'arrived') then
      raise exception 'This visit is already %.', v.status;
    end if;
    if (select status from public.snow_storms where id = new.storm_id) <> 'dispatched' then
      raise exception 'Skip requests can only be made while the storm is dispatched.';
    end if;
    new.status := 'pending';
    new.decided_by := null; new.decided_at := null; new.decision_note := null;
    new.requested_by := coalesce(new.requested_by, public.my_person_id());
    return new;
  end if;
  new.reason := old.reason;
  new.requested_by := old.requested_by;
  new.created_at := old.created_at;
  if new.status = old.status then
    new.decided_by := old.decided_by; new.decided_at := old.decided_at;
    if old.status <> 'pending' then new.decision_note := old.decision_note; end if;
    return new;
  end if;
  if old.status <> 'pending' then
    raise exception 'This skip request was already %.', old.status;
  end if;
  new.decided_at := coalesce(new.decided_at, now());
  new.decided_by := coalesce(new.decided_by, public.my_person_id());
  return new;
end;
$$;
drop trigger if exists snow_skip_requests_guard on public.snow_skip_requests;
create trigger snow_skip_requests_guard before insert or update on public.snow_skip_requests
  for each row execute function public.snow_skip_request_guard();

create or replace function public.snow_skip_request_apply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status = 'pending' then
    update public.snow_visits
       set status = 'skipped', skipped_at = new.decided_at, skipped_by = new.decided_by
     where id = new.visit_id and status in ('pending', 'arrived');
  end if;
  return null;
end;
$$;
drop trigger if exists snow_skip_requests_apply on public.snow_skip_requests;
create trigger snow_skip_requests_apply after update of status on public.snow_skip_requests
  for each row execute function public.snow_skip_request_apply();

-- Completion media: the file and who uploaded it never change.
create or replace function public.snow_media_immutable()
returns trigger language plpgsql as $$
begin
  if new.file_key <> old.file_key or new.kind <> old.kind or new.uploaded_by is distinct from old.uploaded_by
     or new.created_at <> old.created_at then
    raise exception 'An uploaded photo or video can''t be replaced. Upload a new one instead.';
  end if;
  return new;
end;
$$;
drop trigger if exists snow_completion_media_immutable on public.snow_completion_media;
create trigger snow_completion_media_immutable before update on public.snow_completion_media
  for each row execute function public.snow_media_immutable();

-- ── Integrity: lead assignment history ──────────────────────────────────────

-- Only someone who holds the route's service on the snow team (or the
-- owner/admin) can lead it. One person may lead any number of routes.
create or replace function public.snow_route_lead_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.lead_person_id is not null
     and (tg_op = 'INSERT' or new.lead_person_id is distinct from old.lead_person_id)
     and not public.snow_person_has_service(new.company_id, new.lead_person_id, new.service) then
    raise exception 'This person isn''t on the snow team for %.', new.service;
  end if;
  return new;
end;
$$;
drop trigger if exists snow_routes_lead_check on public.snow_routes;
create trigger snow_routes_lead_check before insert or update of lead_person_id on public.snow_routes
  for each row execute function public.snow_route_lead_check();

create or replace function public.snow_route_lead_history()
returns trigger language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_person_id();
begin
  if tg_op = 'UPDATE' and new.lead_person_id is not distinct from old.lead_person_id then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.lead_person_id is not null then
    update public.snow_route_lead_assignments
       set ended_at = now(), ended_by = me
     where route_id = new.id and ended_at is null;
    perform public.snow_log_event(new.company_id, 'route.lead_ended', 'route', new.id, new.storm_id, new.id,
      null, null, old.lead_person_id, new.service);
  end if;
  if new.lead_person_id is not null then
    insert into public.snow_route_lead_assignments (company_id, storm_id, route_id, person_id, assigned_by)
    values (new.company_id, new.storm_id, new.id, new.lead_person_id, me);
    perform public.snow_log_event(new.company_id, 'route.lead_assigned', 'route', new.id, new.storm_id, new.id,
      null, null, new.lead_person_id, new.service,
      case when tg_op = 'UPDATE' then jsonb_build_object('lead_person_id', old.lead_person_id) end,
      jsonb_build_object('lead_person_id', new.lead_person_id));
  end if;
  return null;
end;
$$;
drop trigger if exists snow_routes_lead_history on public.snow_routes;
create trigger snow_routes_lead_history after insert or update of lead_person_id on public.snow_routes
  for each row execute function public.snow_route_lead_history();

-- Assignment rows: only "ended" can be filled in, once.
create or replace function public.snow_lead_assignment_guard()
returns trigger language plpgsql as $$
begin
  if new.route_id <> old.route_id or new.person_id <> old.person_id or new.assigned_at <> old.assigned_at
     or new.assigned_by is distinct from old.assigned_by or old.ended_at is not null then
    raise exception 'Lead assignment history can''t be changed.';
  end if;
  return new;
end;
$$;
drop trigger if exists snow_lead_assignments_guard on public.snow_route_lead_assignments;
create trigger snow_lead_assignments_guard before update on public.snow_route_lead_assignments
  for each row execute function public.snow_lead_assignment_guard();

-- ── Integrity: keep history ─────────────────────────────────────────────────
--  Draft storms can be deleted whole. Otherwise: a visit that has been worked
--  (or has media or a skip request) can't be deleted, routes/storms with such
--  visits can't be deleted (cancel or end them instead), and media, decided
--  skip requests and lead history are never deleted.

create or replace function public.snow_keep_history()
returns trigger language plpgsql security definer set search_path = public as $$
declare storm_status text;
begin
  select status into storm_status from public.snow_storms where id = old.storm_id;
  -- Deleting a whole draft storm (or a record inside one) is fine.
  if storm_status is null or storm_status = 'draft' then return old; end if;

  if tg_table_name = 'snow_routes' then
    if exists (select 1 from public.snow_visits where route_id = old.id) then
      raise exception 'This route has visits and can''t be deleted. Cancel it instead.';
    end if;
  elsif tg_table_name = 'snow_visits' then
    if old.status <> 'pending'
       or exists (select 1 from public.snow_completion_media where visit_id = old.id)
       or exists (select 1 from public.snow_skip_requests where visit_id = old.id) then
      raise exception 'This visit has recorded work and can''t be deleted.';
    end if;
  else
    raise exception 'Snow history can''t be deleted.';
  end if;
  return old;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['snow_routes', 'snow_visits', 'snow_completion_media',
                           'snow_skip_requests', 'snow_route_lead_assignments'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_keep_history', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.snow_keep_history()', t || '_keep_history', t);
  end loop;
end $$;
-- Storms themselves.
create or replace function public.snow_storm_keep_history()
returns trigger language plpgsql as $$
begin
  if old.status <> 'draft' then
    raise exception 'A dispatched storm can''t be deleted. End it instead.';
  end if;
  return old;
end;
$$;
drop trigger if exists snow_storms_keep_history on public.snow_storms;
create trigger snow_storms_keep_history before delete on public.snow_storms
  for each row execute function public.snow_storm_keep_history();

-- Properties and property services that have visits are kept (deactivate
-- instead); the foreign keys from snow_visits already block the delete.

-- ── Activity logging for the base tables ────────────────────────────────────

create or replace function public.snow_log_base()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  act text;
  diff_before jsonb;
  diff_after jsonb;
  k text;
begin
  -- Only the columns that changed.
  if tg_op = 'UPDATE' then
    diff_before := '{}'::jsonb; diff_after := '{}'::jsonb;
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at') and (o -> k) is distinct from (n -> k) then
        diff_before := diff_before || jsonb_build_object(k, o -> k);
        diff_after := diff_after || jsonb_build_object(k, n -> k);
      end if;
    end loop;
    if diff_after = '{}'::jsonb then return null; end if;
  else
    diff_before := o; diff_after := n;
  end if;

  if tg_table_name = 'snow_storms' then
    act := case
      when tg_op = 'INSERT' then 'storm.created'
      when tg_op = 'DELETE' then 'storm.deleted'
      when new.status <> old.status and new.status = 'dispatched' and old.status = 'ended' then 'storm.reopened'
      when new.status <> old.status then 'storm.' || new.status
      else 'storm.updated' end;
    perform public.snow_log_event((r->>'company_id')::uuid, act, 'storm', (r->>'id')::uuid,
      (r->>'id')::uuid, null, null, null, null, r->>'service', diff_before, diff_after);
    return null;
  elsif tg_table_name = 'snow_routes' then
    if tg_op = 'UPDATE' then
      diff_before := diff_before - 'lead_person_id';
      diff_after := diff_after - 'lead_person_id';
      if diff_after = '{}'::jsonb then return null; end if;
    end if;
    act := case
      when tg_op = 'INSERT' then 'route.created'
      when tg_op = 'DELETE' then 'route.deleted'
      when new.cancelled_at is not null and old.cancelled_at is null then 'route.cancelled'
      when (new.media_required, new.min_media) is distinct from (old.media_required, old.min_media) then 'route.media_rule_changed'
      else 'route.updated' end;
    perform public.snow_log_event((r->>'company_id')::uuid, act, 'route', (r->>'id')::uuid,
      (r->>'storm_id')::uuid, (r->>'id')::uuid, null, null, null, r->>'service', diff_before, diff_after);
    return null;
  elsif tg_table_name = 'snow_visits' then
    act := case
      when tg_op = 'INSERT' then 'visit.added'
      when tg_op = 'DELETE' then 'visit.removed'
      when new.status <> old.status then 'visit.' || new.status
      when new.route_id <> old.route_id or new.position <> old.position then 'visit.moved'
      else 'visit.updated' end;
    perform public.snow_log_event((r->>'company_id')::uuid, act, 'visit', (r->>'id')::uuid,
      (r->>'storm_id')::uuid, (r->>'route_id')::uuid, (r->>'id')::uuid, (r->>'property_id')::uuid,
      case when tg_op = 'UPDATE' and new.status <> old.status then
        coalesce(new.completed_by, new.arrived_by, new.skipped_by) end,
      r->>'service', diff_before, diff_after);
    return null;
  elsif tg_table_name = 'snow_completion_media' then
    if tg_op <> 'INSERT' then return null; end if;
    perform public.snow_log_event(new.company_id, 'media.uploaded', 'completion_media', new.id,
      new.storm_id, new.route_id, new.visit_id, new.property_id, new.uploaded_by, new.service,
      null, jsonb_build_object('kind', new.kind, 'file_key', new.file_key));
    return null;
  elsif tg_table_name = 'snow_skip_requests' then
    act := case when tg_op = 'INSERT' then 'skip.requested' else 'skip.' || new.status end;
    if tg_op = 'UPDATE' and new.status = old.status then return null; end if;
    perform public.snow_log_event(new.company_id, act, 'skip_request', new.id,
      new.storm_id, new.route_id, new.visit_id, new.property_id, new.requested_by, null,
      diff_before, diff_after, case when tg_op = 'INSERT' then new.reason else new.decision_note end);
    return null;
  elsif tg_table_name = 'snow_properties' then
    act := case when tg_op = 'INSERT' then 'property.created' when tg_op = 'DELETE' then 'property.deleted' else 'property.updated' end;
    perform public.snow_log_event((r->>'company_id')::uuid, act, 'property', (r->>'id')::uuid,
      null, null, null, (r->>'id')::uuid, null, null, diff_before, diff_after);
    return null;
  elsif tg_table_name = 'snow_settings' then
    if tg_op = 'INSERT' then return null; end if;
    perform public.snow_log_event((r->>'company_id')::uuid, 'settings.changed', 'settings', null,
      null, null, null, null, null, null, diff_before, diff_after);
    return null;
  end if;
  return null;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['snow_storms', 'snow_routes', 'snow_visits', 'snow_completion_media',
                           'snow_skip_requests', 'snow_properties', 'snow_settings'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_log', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.snow_log_base()', t || '_log', t);
  end loop;
end $$;

-- ── Access rules ────────────────────────────────────────────────────────────
--  Owner/admin only here. Default deny for everyone else: snow workers and
--  customers get their own narrow policies in later updates.

do $$
declare t text;
begin
  foreach t in array array[
    'snow_settings', 'snow_properties', 'snow_storms', 'snow_routes',
    'snow_route_lead_assignments', 'snow_visits', 'snow_completion_media', 'snow_skip_requests',
    'snow_activity_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  foreach t in array array[
    'snow_settings', 'snow_properties', 'snow_storms', 'snow_routes',
    'snow_visits', 'snow_completion_media', 'snow_skip_requests'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_staff', t);
    execute format('create policy %I on public.%I for all using (public.is_staff(company_id)) with check (public.is_staff(company_id))', t || '_staff', t);
  end loop;
  -- History tables: read-only for owner/admin, written by triggers.
  foreach t in array array['snow_route_lead_assignments', 'snow_activity_events'] loop
    execute format('drop policy if exists %I on public.%I', t || '_staff_select', t);
    execute format('create policy %I on public.%I for select using (public.is_staff(company_id))', t || '_staff_select', t);
  end loop;
end $$;

revoke all on function public.snow_log_base() from public, anon, authenticated;

-- ── Live updates ────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'snow_settings', 'snow_properties', 'snow_storms', 'snow_routes',
    'snow_route_lead_assignments', 'snow_visits', 'snow_completion_media', 'snow_skip_requests',
    'snow_activity_events'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
