-- Update 82: the crew hears about a storm.
--
-- Until now a route's lead and crew only found out a storm existed by opening the app. Now, the moment a storm is DISPATCHED, every
-- live route's lead and crew get a push notification (and an in-app one): "Storm dispatched: Oct 21 Plowing" with their route name
-- and stop count. Mid-storm, a NEW lead or someone newly added to a route is told too ("You now lead ...", "You're on the crew of ...").
--
-- Uses the existing snow notification plumbing (update 31): the same records, the same sender (send-snow-notification, redeploy it
-- with this update so a tap opens the route), the same honest delivery log. Each notice is made once per person, so a double tap or
-- a retry never sends two. A reopened storm that is dispatched again tells the crew again.
--
-- Safe to run more than once.

-- The notification kinds now include the crew ones (category 'employee' was reserved for exactly this).
alter table public.snow_notifications drop constraint if exists snow_notifications_event_check;
alter table public.snow_notifications add constraint snow_notifications_event_check
  check (event in ('visit.arrived', 'visit.completed', 'storm.dispatched', 'route.lead_assigned', 'route.crew_added'));

-- One crew notification (+ its in-app copy and push row). Returns its id, or null when this exact notice already exists.
create or replace function public._snow_add_crew_notification(
  p_company uuid, p_storm uuid, p_route uuid, p_person uuid, p_event text, p_key text, p_title text, p_body text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  nid uuid;
  app_id uuid;
begin
  if p_person is null then return null; end if;
  insert into public.snow_notifications
    (company_id, category, event, storm_id, route_id, recipient_person_id, title, body, dedupe_key)
  values
    (p_company, 'employee', p_event, p_storm, p_route, p_person, p_title, p_body, p_key)
  on conflict (dedupe_key) do nothing
  returning id into nid;
  if nid is null then return null; end if;

  insert into public.app_notifications
    (company_id, recipient_id, event_type, title, body, linked_entity_type, linked_entity_id, metadata, pushed_at)
  values
    (p_company, p_person, 'snow_' || replace(p_event, '.', '_'), p_title, p_body, 'snow_route', p_route::text,
     jsonb_build_object('snow_notification_id', nid), now())
  returning id into app_id;
  insert into public.snow_notification_deliveries (notification_id, company_id, channel, status, provider, provider_ref, attempted_at)
  values (nid, p_company, 'in_app', 'stored', 'app', app_id::text, now()),
         (nid, p_company, 'push', 'pending', 'expo', null, null);
  return nid;
end;
$$;
revoke all on function public._snow_add_crew_notification(uuid, uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;

-- The storm goes out: tell every live route's lead and crew.
create or replace function public._snow_storm_dispatched_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
  m record;
  stops int;
  nid uuid;
  ids uuid[] := '{}';
begin
  if new.status <> 'dispatched' or old.status = 'dispatched' then return null; end if;
  for r in
    select rt.id, rt.name, rt.lead_person_id from public.snow_routes rt
     where rt.storm_id = new.id and rt.cancelled_at is null
  loop
    select count(*)::int into stops from public.snow_visits v where v.route_id = r.id;
    -- the lead
    nid := public._snow_add_crew_notification(new.company_id, new.id, r.id, r.lead_person_id, 'storm.dispatched',
      new.id || ':dispatch:' || coalesce(new.reopened_count, 0) || ':' || r.id || ':' || r.lead_person_id,
      'Storm dispatched: ' || new.name,
      'You lead ' || r.name || ' · ' || stops || ' ' || case when stops = 1 then 'stop' else 'stops' end || '. Open My Route.');
    if nid is not null then ids := ids || nid; end if;
    -- the crew
    for m in select c.person_id from public.snow_route_crew c where c.route_id = r.id loop
      nid := public._snow_add_crew_notification(new.company_id, new.id, r.id, m.person_id, 'storm.dispatched',
        new.id || ':dispatch:' || coalesce(new.reopened_count, 0) || ':' || r.id || ':' || m.person_id,
        'Storm dispatched: ' || new.name,
        'You are on the crew of ' || r.name || ' · ' || stops || ' ' || case when stops = 1 then 'stop' else 'stops' end || '.');
      if nid is not null then ids := ids || nid; end if;
    end loop;
  end loop;
  foreach nid in array ids loop
    perform public._snow_dispatch_notification(nid);
  end loop;
  return null;
end;
$$;
revoke all on function public._snow_storm_dispatched_notify() from public, anon, authenticated;
drop trigger if exists snow_storms_dispatched_notify on public.snow_storms;
create trigger snow_storms_dispatched_notify after update of status on public.snow_storms
  for each row execute function public._snow_storm_dispatched_notify();

-- Mid-storm: a new lead is told.
create or replace function public._snow_route_lead_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  st public.snow_storms;
  nid uuid;
begin
  if new.lead_person_id is null or new.lead_person_id is not distinct from old.lead_person_id or new.cancelled_at is not null then return null; end if;
  select * into st from public.snow_storms where id = new.storm_id;
  if st.status <> 'dispatched' then return null; end if;
  nid := public._snow_add_crew_notification(new.company_id, new.storm_id, new.id, new.lead_person_id, 'route.lead_assigned',
    new.id || ':lead:' || new.lead_person_id || ':' || (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'You now lead ' || new.name, st.name || '. Open My Route.');
  if nid is not null then perform public._snow_dispatch_notification(nid); end if;
  return null;
end;
$$;
revoke all on function public._snow_route_lead_notify() from public, anon, authenticated;
drop trigger if exists snow_routes_lead_notify on public.snow_routes;
create trigger snow_routes_lead_notify after update of lead_person_id on public.snow_routes
  for each row execute function public._snow_route_lead_notify();

-- Mid-storm: someone added to a route's crew is told.
create or replace function public._snow_route_crew_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  st public.snow_storms;
  rt public.snow_routes;
  nid uuid;
begin
  select * into rt from public.snow_routes where id = new.route_id;
  if rt.id is null or rt.cancelled_at is not null then return null; end if;
  select * into st from public.snow_storms where id = rt.storm_id;
  if st.status <> 'dispatched' then return null; end if;
  nid := public._snow_add_crew_notification(rt.company_id, rt.storm_id, rt.id, new.person_id, 'route.crew_added',
    rt.id || ':crew:' || new.person_id || ':' || (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'You were added to ' || rt.name, st.name || '. Open My Route.');
  if nid is not null then perform public._snow_dispatch_notification(nid); end if;
  return null;
end;
$$;
revoke all on function public._snow_route_crew_notify() from public, anon, authenticated;
drop trigger if exists snow_route_crew_notify on public.snow_route_crew;
create trigger snow_route_crew_notify after insert on public.snow_route_crew
  for each row execute function public._snow_route_crew_notify();

notify pgrst, 'reload schema';
