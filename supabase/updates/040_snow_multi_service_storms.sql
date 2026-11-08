-- ============================================================================
-- Update 40 — run once in Supabase → SQL Editor, AFTER 024, 025 and 026
-- (safe to run again). NOT run yet; read it before running.
--
-- One storm, several services.
--  • A storm lists the services it covers (plowing, shoveling, salting).
--    Existing storms get a one-item list from their old single service, so
--    nothing about past or current storms changes.
--  • Each ROUTE still has exactly one service and always did: its visits,
--    photos, notifications and activity already take the service from the route.
--    What changes is that the route no longer has to match the storm's one
--    service; it must be one of the storm's services. A route's service can't
--    be changed after it is made.
--  • The old snow_storms.service column stays, kept equal to the first service
--    in the list, so older code and old records keep working.
--  • Services can be edited on a draft or a running storm with
--    snow_set_storm_services(), but a service that has a route can't be removed.
--  • Dispatch now checks each route's lead against THAT route's service, and
--    refuses a route with no stops (cancel it or add stops first).
--  • Route templates work on any storm that includes the template's service.
--  • Activity: an entry about a storm that covers several services no longer
--    names only its first service. Its service field is left empty and its note
--    lists them all ("Services: plowing, shoveling, salting"). Editing the
--    services records the before and after lists (the existing change log) and
--    the note shows the current list. Single-service storms, and every
--    route/visit/other entry, are logged exactly as before; entries already
--    written are not rewritten.
-- No data is deleted or rewritten except filling the new column.
-- ============================================================================

-- ── 1) The list of services on a storm ─────────────────────────────────────

alter table public.snow_storms add column if not exists services text[];
update public.snow_storms set services = array[service] where services is null;
alter table public.snow_storms alter column services set not null;

alter table public.snow_storms drop constraint if exists snow_storms_services_valid;
alter table public.snow_storms add constraint snow_storms_services_valid
  check (cardinality(services) >= 1 and services <@ array['plowing', 'shoveling', 'salting']::text[]);

-- Keeps the list tidy (no repeats, order kept) and `service` = its first item.
-- Runs after the lifecycle guard (trigger names run alphabetically), so a
-- direct attempt to change `service` is still refused by the guard.
create or replace function public._snow_storm_services_sync()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.services is null or cardinality(new.services) = 0 then
    new.services := array[new.service];
  end if;
  select coalesce(array_agg(x.s order by x.ord), '{}') into new.services
  from (select distinct on (u.s) u.s, u.ord from unnest(new.services) with ordinality as u(s, ord) order by u.s, u.ord) x;
  new.service := new.services[1];
  return new;
end;
$$;
revoke all on function public._snow_storm_services_sync() from public, anon, authenticated;

drop trigger if exists snow_storms_services_sync on public.snow_storms;
create trigger snow_storms_services_sync before insert or update on public.snow_storms
  for each row execute function public._snow_storm_services_sync();

-- ── 2) A route's service no longer has to equal one fixed storm service ────

-- The old composite foreign key (storm_id, service) forced route.service to
-- equal the storm's single service. Replace it with a plain link to the storm.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.snow_routes'::regclass
       and confrelid = 'public.snow_storms'::regclass
       and contype = 'f' and cardinality(conkey) = 2
  loop
    execute format('alter table public.snow_routes drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.snow_routes drop constraint if exists snow_routes_storm_fk;
alter table public.snow_routes add constraint snow_routes_storm_fk
  foreign key (storm_id) references public.snow_storms(id) on delete cascade;

-- Route insert/update: the service must be one of the storm's services. A new
-- route without a service takes the storm's only service, and is refused when
-- the storm has several (the owner must say which). A route's service is fixed.
create or replace function public.snow_route_fill()
returns trigger language plpgsql security definer set search_path = public as $$
declare st record;
begin
  if tg_op = 'UPDATE' and new.storm_id <> old.storm_id then
    raise exception 'A route can''t be moved to another storm.';
  end if;
  select company_id, services, status into st from public.snow_storms where id = new.storm_id;
  if st is null then raise exception 'Storm not found.'; end if;
  if tg_op = 'INSERT' and st.status = 'ended' then
    raise exception 'This storm has ended. Reopen it to add routes.';
  end if;
  if tg_op = 'UPDATE' then
    if new.service is distinct from old.service then
      raise exception 'A route''s service can''t be changed. Make a new route for another service.';
    end if;
  elsif new.service is null then
    if cardinality(st.services) = 1 then
      new.service := st.services[1];
    else
      raise exception 'Pick the service for this route (plowing, shoveling or salting).';
    end if;
  end if;
  if not (new.service = any (st.services)) then
    raise exception 'This storm doesn''t include %. Add it to the storm first.', new.service;
  end if;
  new.company_id := st.company_id;
  return new;
end;
$$;

-- ── 3) Editing a storm's services ──────────────────────────────────────────
-- Owner/admin. Draft or running (not ended). A service that has a route on
-- this storm can't be removed (cancelled routes count: they are history; the
-- error message says so).

create or replace function public.snow_set_storm_services(p_storm_id uuid, p_services text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.snow_storms := public._snow_storm_for_staff(p_storm_id);
  svcs text[];
  blocked text;
begin
  if s.status = 'ended' then raise exception 'This storm has ended. Reopen it to change its services.'; end if;
  select coalesce(array_agg(x.v order by x.ord), '{}') into svcs
  from (select distinct on (u.v) u.v, u.ord from unnest(coalesce(p_services, '{}')) with ordinality as u(v, ord) order by u.v, u.ord) x;
  if cardinality(svcs) = 0 then raise exception 'Pick at least one service.'; end if;
  if exists (select 1 from unnest(svcs) v where v not in ('plowing', 'shoveling', 'salting')) then
    raise exception 'Choose plowing, shoveling or salting.';
  end if;

  select string_agg(distinct r.service, ', ') into blocked
  from public.snow_routes r
  where r.storm_id = s.id and not (r.service = any (svcs));
  if blocked is not null then
    raise exception 'Can''t remove % while this storm has routes for it. Even cancelled routes stay on the storm as history, so the service has to stay.', blocked;
  end if;

  if svcs = s.services then return public._snow_storm_result(s, false); end if;
  update public.snow_storms set services = svcs where id = s.id returning * into s;
  return public._snow_storm_result(s, true);
end;
$$;

-- ── 4) Creating a storm with several services ──────────────────────────────
-- The old one-service call keeps working (it calls this one).

create or replace function public.snow_create_storm(
  p_name text,
  p_services text[],
  p_notes text default null,
  p_client_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  cid uuid;
  s public.snow_storms;
  svcs text[];
begin
  select company_id into cid from public.company_members
  where person_id = me and status = 'active' and role in ('owner', 'admin')
  order by created_at limit 1;
  if cid is null then raise exception 'Only the owner or an admin can create a storm.'; end if;

  select coalesce(array_agg(x.v order by x.ord), '{}') into svcs
  from (select distinct on (u.v) u.v, u.ord from unnest(coalesce(p_services, '{}')) with ordinality as u(v, ord) order by u.v, u.ord) x;
  if cardinality(svcs) = 0 or exists (select 1 from unnest(svcs) v where v not in ('plowing', 'shoveling', 'salting')) then
    raise exception 'Choose plowing, shoveling or salting.';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the storm a name.'; end if;

  if p_client_request_id is not null then
    select * into s from public.snow_storms where client_request_id = p_client_request_id;
    if s.id is not null then
      if s.company_id <> cid then raise exception 'Storm not found.'; end if;
      return public._snow_storm_result(s, false);
    end if;
  end if;

  insert into public.snow_storms (company_id, name, service, services, notes, client_request_id)
  values (cid, trim(p_name), svcs[1], svcs, nullif(trim(p_notes), ''), p_client_request_id)
  on conflict (client_request_id) where client_request_id is not null do nothing
  returning * into s;
  if s.id is null then
    -- Lost a race with the same request: hand back the one that won.
    select * into s from public.snow_storms where client_request_id = p_client_request_id;
    return public._snow_storm_result(s, false);
  end if;
  return public._snow_storm_result(s, true);
end;
$$;

create or replace function public.snow_create_storm(
  p_name text,
  p_service text,
  p_notes text default null,
  p_client_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_service is null or p_service not in ('plowing', 'shoveling', 'salting') then
    raise exception 'Choose plowing, shoveling or salting.';
  end if;
  return public.snow_create_storm(p_name, array[p_service]::text[], p_notes, p_client_request_id);
end;
$$;

-- ── 5) Properties a storm can use ──────────────────────────────────────────
-- Active properties with at least one of the storm's services turned on, with
-- which of the storm's services each one offers. Pass p_service to see only
-- the properties for one service (what a route of that service needs).

drop function if exists public.snow_storm_eligible_properties(uuid);

create or replace function public.snow_storm_eligible_properties(p_storm_id uuid, p_service text default null)
returns table (property_id uuid, name text, address text, city text, state text, zip text,
               latitude double precision, longitude double precision, map_destination text,
               services text[])
language plpgsql stable security definer set search_path = public as $$
declare s public.snow_storms;
begin
  select * into s from public.snow_storms where id = p_storm_id;
  if s.id is null or not public.is_staff(s.company_id) then raise exception 'Storm not found.'; end if;
  if p_service is not null and not (p_service = any (s.services)) then
    raise exception 'This storm doesn''t include %.', p_service;
  end if;
  return query
    select p.id, p.name, p.address, p.city, p.state, p.zip, p.latitude::double precision,
           p.longitude::double precision, p.map_destination,
           array_agg(distinct ps.service order by ps.service)
    from public.snow_properties p
    join public.snow_property_services ps
      on ps.property_id = p.id and ps.is_active
     and ps.service = any (s.services) and (p_service is null or ps.service = p_service)
    where p.company_id = s.company_id and p.status = 'active'
    group by p.id, p.name, p.address, p.city, p.state, p.zip, p.latitude, p.longitude, p.map_destination
    order by p.name;
end;
$$;

-- ── 6) Dispatch ────────────────────────────────────────────────────────────
-- As before (draft only, at least one route with stops, double tap changes
-- nothing), but each route's lead is checked against THAT route's service, and
-- a route with no stops stops the dispatch so no empty route reaches a worker.

create or replace function public.snow_dispatch_storm(p_storm_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.snow_storms := public._snow_storm_for_staff(p_storm_id);
  problems text;
begin
  if s.status = 'dispatched' then return public._snow_storm_result(s, false); end if;
  if s.status = 'ended' then raise exception 'This storm has ended. Reopen it instead.'; end if;

  if not exists (
    select 1 from public.snow_routes r join public.snow_visits v on v.route_id = r.id
    where r.storm_id = s.id and r.cancelled_at is null
  ) then
    raise exception 'Add at least one route with stops before dispatching.';
  end if;

  select string_agg(r.name, ', ' order by r.position, r.name) into problems
  from public.snow_routes r
  where r.storm_id = s.id and r.cancelled_at is null
    and not exists (select 1 from public.snow_visits v where v.route_id = r.id);
  if problems is not null then
    raise exception 'These routes have no stops. Add stops or cancel them before dispatching: %', problems;
  end if;

  select string_agg(r.name || ' (' || r.service || ')', ', ' order by r.position, r.name) into problems
  from public.snow_routes r
  where r.storm_id = s.id and r.cancelled_at is null
    and exists (select 1 from public.snow_visits v where v.route_id = r.id)
    and (r.lead_person_id is null or not public.snow_person_has_service(s.company_id, r.lead_person_id, r.service));
  if problems is not null then
    raise exception 'These routes need a lead who can work their service before dispatching: %', problems;
  end if;

  update public.snow_storms set status = 'dispatched' where id = s.id returning * into s;
  return public._snow_storm_result(s, true);
end;
$$;

-- ── 7) Route templates on multi-service storms ─────────────────────────────

create or replace function public.snow_apply_route_template(p_storm_id uuid, p_template_id uuid, p_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  st record;
  t record;
  rid uuid;
  lead uuid;
  next_pos int;
  nm text := nullif(trim(coalesce(p_name, '')), '');
begin
  select id, company_id, services, status into st from public.snow_storms where id = p_storm_id;
  if st is null or not public.is_staff(st.company_id) then
    raise exception 'Storm not found.';
  end if;
  select * into t from public.snow_route_templates where id = p_template_id and company_id = st.company_id;
  if t is null then raise exception 'Template not found.'; end if;
  if not (t.service = any (st.services)) then
    raise exception 'This template is for %, which this storm doesn''t include.', t.service;
  end if;

  lead := case when t.lead_person_id is not null
                 and public.snow_person_has_service(st.company_id, t.lead_person_id, t.service)
               then t.lead_person_id end;
  select coalesce(max(position), 0) + 1 into next_pos from public.snow_routes where storm_id = p_storm_id;

  insert into public.snow_routes (storm_id, service, name, position, lead_person_id, media_required, min_media, notes, created_by)
  values (p_storm_id, t.service, coalesce(nm, t.name), next_pos, lead, t.media_required, t.min_media, t.notes, public.my_person_id())
  returning id into rid;

  insert into public.snow_visits (route_id, property_id, position, created_by)
  select rid, ts.property_id, row_number() over (order by ts.position), public.my_person_id()
    from public.snow_route_template_stops ts
    join public.snow_properties p on p.id = ts.property_id and p.status = 'active'
    join public.snow_property_services ps on ps.property_id = ts.property_id and ps.service = t.service and ps.is_active
   where ts.template_id = p_template_id;

  return rid;
end;
$$;

-- ── 8) Activity entries for a multi-service storm ──────────────────────────
-- Every activity entry goes through snow_log_event(). The row logger (update
-- 029) fills `service` from the row, and for a storm that is its first service,
-- which would read as "plowing" for a plowing + shoveling + salting storm. So,
-- for entries ABOUT a storm only: when it covers more than one service, leave
-- the service empty and say which services in the note. The before/after
-- change log (which already holds the old and new `services` lists when they
-- are edited) is untouched. Same arguments and permissions as before.

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
declare
  eid uuid;
  svcs text[];
begin
  if p_entity_type = 'storm' then
    select services into svcs from public.snow_storms where id = coalesce(p_entity_id, p_storm_id);
    -- A deleted storm is gone from the table: its last row is in the log's "before".
    if svcs is null and p_before is not null and jsonb_typeof(p_before -> 'services') = 'array' then
      svcs := array(select jsonb_array_elements_text(p_before -> 'services'));
    end if;
    if svcs is not null and cardinality(svcs) > 1 then
      p_service := null;
      p_note := coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Services: ' || array_to_string(svcs, ', '));
    end if;
  end if;
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

-- ── Who can call what ──────────────────────────────────────────────────────
revoke execute on function public.snow_set_storm_services(uuid, text[]) from public, anon;
revoke execute on function public.snow_create_storm(text, text[], text, uuid) from public, anon;
revoke execute on function public.snow_create_storm(text, text, text, uuid) from public, anon;
revoke execute on function public.snow_storm_eligible_properties(uuid, text) from public, anon;
revoke execute on function public.snow_dispatch_storm(uuid) from public, anon;
revoke execute on function public.snow_apply_route_template(uuid, uuid, text) from public, anon;
grant execute on function public.snow_set_storm_services(uuid, text[]) to authenticated;
grant execute on function public.snow_create_storm(text, text[], text, uuid) to authenticated;
grant execute on function public.snow_create_storm(text, text, text, uuid) to authenticated;
grant execute on function public.snow_storm_eligible_properties(uuid, text) to authenticated;
grant execute on function public.snow_dispatch_storm(uuid) to authenticated;
grant execute on function public.snow_apply_route_template(uuid, uuid, text) to authenticated;
