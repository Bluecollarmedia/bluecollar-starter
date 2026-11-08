-- ============================================================================
-- Update 61 — run once in Supabase → SQL Editor (safe to run again).
--
-- Snow: ONE route can now do several services together (for example plowing + salting on the same truck).
--  • snow_routes.services: every service the route does (the first is the route's own service, as before).
--  • Adding a property to such a route makes one visit per service the property offers, side by side in the route.
--  • A lead can start both visits at a property without "finishing the stop you are at" in between: two services at the same
--    property are one stop.
--  • Dispatching needs a lead who can work EVERY service on the route.
-- Existing routes become routes with just their own service. Nothing existing changes.
-- ============================================================================

alter table public.snow_routes add column if not exists services text[];
update public.snow_routes set services = array[service] where services is null;

alter table public.snow_routes drop constraint if exists snow_routes_services_valid;
alter table public.snow_routes add constraint snow_routes_services_valid
  check (services is null or (cardinality(services) between 1 and 3 and services <@ array['plowing', 'shoveling', 'salting']::text[]));

-- A visit's service no longer has to equal the route's own service: it only has to be one the route does (checked in snow_visit_fill).
-- (Visits still belong to their storm with the same cascade as before; a route is never deleted on its own, only cancelled.)
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.snow_visits'::regclass
       and confrelid = 'public.snow_routes'::regclass
       and contype = 'f' and cardinality(conkey) = 3
  loop
    execute format('alter table public.snow_visits drop constraint %I', c.conname);
  end loop;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.snow_visits'::regclass and contype = 'f' and conname = 'snow_visits_route_id_fkey') then
    alter table public.snow_visits add constraint snow_visits_route_id_fkey
      foreign key (route_id) references public.snow_routes (id) on delete cascade;
  end if;
end $$;

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
    new.services := old.services;
  elsif new.service is null and new.services is not null and cardinality(new.services) > 0 then
    new.service := new.services[1];
  elsif new.service is null then
    if cardinality(st.services) = 1 then
      new.service := st.services[1];
    else
      raise exception 'Pick the service for this route (plowing, shoveling or salting).';
    end if;
  end if;
  if tg_op = 'INSERT' then
    -- Update 61: the services this route does, the first one always being its own service.
    select coalesce(array_agg(x.s order by x.ord), '{}') into new.services
    from (select distinct on (u.s) u.s, u.ord from unnest(array[new.service] || coalesce(new.services, '{}')) with ordinality as u(s, ord) order by u.s, u.ord) x;
  end if;
  if exists (select 1 from unnest(new.services) sv where not (sv = any (st.services))) then
    raise exception 'This storm doesn''t include every service on this route. Add it to the storm first.';
  end if;
  new.company_id := st.company_id;
  return new;
end;
$$;

create or replace function public.snow_visit_fill()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
  p record;
begin
  select rt.company_id, rt.storm_id, rt.service, rt.services, rt.cancelled_at, st.status as storm_status
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
  -- Update 61: a route can do several services; the visit says which one (default: the route's first).
  new.service := coalesce(new.service, r.service);
  if not (new.service = any (coalesce(r.services, array[r.service]))) then
    raise exception 'This route doesn''t do %. Add that service to the route first.', new.service;
  end if;
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

  select string_agg(r.name || ' (' || array_to_string(coalesce(r.services, array[r.service]), ' + ') || ')', ', ' order by r.position, r.name) into problems
  from public.snow_routes r
  where r.storm_id = s.id and r.cancelled_at is null
    and exists (select 1 from public.snow_visits v where v.route_id = r.id)
    and (r.lead_person_id is null or exists (select 1 from unnest(coalesce(r.services, array[r.service])) sv
                                              where not public.snow_person_has_service(s.company_id, r.lead_person_id, sv)));
  if problems is not null then
    raise exception 'These routes need a lead who can work their service before dispatching: %', problems;
  end if;

  update public.snow_storms set status = 'dispatched' where id = s.id returning * into s;
  return public._snow_storm_result(s, true);
end;
$$;

create or replace function public.snow_arrive_visit(p_visit_id uuid)
returns public.snow_visits language plpgsql security definer set search_path = public as $$
declare v public.snow_visits;
begin
  v := public._snow_visit_for_lead(p_visit_id);
  if v.status = 'arrived' then return v; end if;  -- double tap
  if v.status <> 'pending' then
    raise exception 'This stop is already %.', v.status;
  end if;
  if exists (select 1 from public.snow_visits where route_id = v.route_id and status = 'arrived' and id <> v.id
                and property_id <> v.property_id) then  -- update 61: two services at the same property are one stop
    raise exception 'Finish the stop you''re at before starting another.';
  end if;
  if exists (select 1 from public.snow_visits where route_id = v.route_id and position < v.position and status = 'pending') then
    raise exception 'Work the stops in order. Ask the owner to reorder the route if you need to.';
  end if;
  update public.snow_visits set status = 'arrived' where id = v.id returning * into v;
  return v;
end;
$$;

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

  select string_agg(distinct x, ', ') into blocked
  from public.snow_routes r cross join lateral unnest(coalesce(r.services, array[r.service])) x
  where r.storm_id = s.id and not (x = any (svcs));
  if blocked is not null then
    raise exception 'Can''t remove % while this storm has routes for it. Even cancelled routes stay on the storm as history, so the service has to stay.', blocked;
  end if;

  if svcs = s.services then return public._snow_storm_result(s, false); end if;
  update public.snow_storms set services = svcs where id = s.id returning * into s;
  return public._snow_storm_result(s, true);
end;
$$;

create or replace function public.snow_delete_storm(p_storm_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.snow_storms;
  n_routes int;
  n_visits int;
  n_done int;
  n_media int;
begin
  select * into s from public.snow_storms where id = p_storm_id;
  if s.id is null or not public.is_staff(s.company_id) then raise exception 'Storm not found.'; end if;

  select count(*) into n_routes from public.snow_routes where storm_id = s.id;
  select count(*), count(*) filter (where status = 'completed') into n_visits, n_done from public.snow_visits where storm_id = s.id;
  select count(*) into n_media from public.snow_completion_media where storm_id = s.id;

  perform set_config('snow.purge', 'on', true);   -- this transaction only
  -- Update 61: the stops go first, in their own step (their links in notifications and photos are cleared as they go).
  update public.snow_notifications set visit_id = null, route_id = null where storm_id = s.id;
  delete from public.snow_visits where storm_id = s.id;
  delete from public.snow_storms where id = s.id;
  perform set_config('snow.purge', 'off', true);

  return jsonb_build_object('storm_id', s.id, 'name', s.name, 'status', s.status,
                            'routes', n_routes, 'stops', n_visits, 'completed_stops', n_done, 'media', n_media);
end;
$$;
