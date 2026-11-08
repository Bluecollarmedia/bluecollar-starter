-- ============================================================================
-- Update 68 — run once in Supabase → SQL Editor, AFTER 067 (and 063-065). NOT run yet; read it first. Safe to run again.
-- Needs the new app build: it changes who may check a crew into a maintenance property (see "Compatibility" at the end).
--
-- MAINTENANCE: one crew visit per property, started and finished by the crew leader.
--
--  • Every worker still clocks in and out for their OWN workday (update 63/67). Nothing here changes that.
--  • At a maintenance stop only the route's CREW LEADER (maintenance_routes.lead_person_id) checks the crew in ("I'm here")
--    and completes the stop. Owner/admin may do either. If an owner has not named a leader for a route, any crew member may (the
--    them (also if they call the functions directly or use an old build). EVERY route needs one explicitly named leader: a route with
--    no leader blocks property check-in and completion for everyone except owner/admin, with a plain explanation, until the owner
--    chooses one (maintenance_set_route_leader). Nobody becomes leader implicitly, not even a lone crew member.
--  • The leader's check-in saves ONE property visit (time_visits, "crew_level") with the real arrival time. Completing saves the real
--    completion time. The visit's elapsed time is therefore a saved, server-stamped fact, not a phone timer.
--  • No per-worker property timers any more for maintenance (the old time_start_visit / time_complete_visit refuse maintenance stops).
--    Landscaping jobs are unchanged.
--  • Estimated labor-hours are DERIVED, never stored: for each worker assigned to the route (crew + leader), the minutes their own
--    recorded workday (time_workdays) overlaps the visit's arrival-to-completion window, added up. A worker who clocks out half way
--    contributes only the part before their clock-out. It is an estimate for trends, not payroll: payroll still comes from each
--    person's own workday. maintenance_property_visits() returns it, visit by visit, for the owner's Property History screen.
--  • The route leader is also allowed to clock in (067 only looked at the crew list).
-- Nothing is deleted or rewritten. Existing visits and per-worker intervals stay as they are.
-- ============================================================================

alter table public.time_visits add column if not exists crew_level boolean not null default false;

-- ── Who leads, who may act ──────────────────────────────────────────────────
create or replace function public._maint_may_lead(p_stop_id uuid, p_person uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare s public.maintenance_stops; r public.maintenance_routes;
begin
  select * into s from public.maintenance_stops where id = p_stop_id;
  if s.id is null then return false; end if;
  select * into r from public.maintenance_routes where id = s.route_id;
  if exists (select 1 from public.company_members m where m.company_id = s.company_id and m.person_id = p_person and m.status = 'active' and m.role in ('owner', 'admin')) then
    return true;
  end if;
  -- A worker may act only as the route's explicitly named leader. A route with no leader has nobody (no implicit leader).
  return r.lead_person_id is not null and r.lead_person_id = p_person
     and exists (select 1 from public.company_members m where m.company_id = s.company_id and m.person_id = p_person and m.status = 'active' and m.role = 'worker');
end;
$$;
revoke all on function public._maint_may_lead(uuid, uuid) from public, anon, authenticated;

-- Raises the right sentence when the person may not act as leader at this stop.
create or replace function public._maint_require_leader(p_stop_id uuid, p_person uuid, p_what text)
returns void language plpgsql stable security definer set search_path = public as $$
declare r public.maintenance_routes;
begin
  if public._maint_may_lead(p_stop_id, p_person) then return; end if;
  select r1.* into r from public.maintenance_routes r1 join public.maintenance_stops s on s.route_id = r1.id where s.id = p_stop_id;
  if r.lead_person_id is null then
    raise exception 'This route has no crew leader yet, so nobody can % at its properties. Ask the owner to choose a crew leader for the route.', p_what;
  end if;
  raise exception 'Only the crew leader can % at a property.', p_what;
end;
$$;
revoke all on function public._maint_require_leader(uuid, uuid, text) from public, anon, authenticated;

-- A route's leader counts as being on the route (a leader who is not also in the crew list could not open the stop before).
create or replace function public._maint_stop_for_crew(p_stop_id uuid)
returns public.maintenance_stops
language plpgsql security definer set search_path = public as $$
declare s public.maintenance_stops;
begin
  select * into s from public.maintenance_stops where id = p_stop_id for update;
  if not found then raise exception 'Stop not found.'; end if;
  if not (public.is_staff(s.company_id) or public.on_maintenance_route(s.route_id)
          or exists (select 1 from public.maintenance_routes r where r.id = s.route_id and r.lead_person_id = public.my_person_id())) then
    raise exception 'You are not assigned to this route.';
  end if;
  return s;
end;
$$;
revoke all on function public._maint_stop_for_crew(uuid) from public, anon, authenticated;

-- The leader may clock in too (067 looked only at the crew list).
create or replace function public._time_may_clock_in(p_person uuid, p_company uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.company_members m
                  where m.person_id = p_person and m.company_id = p_company and m.status = 'active' and m.role in ('owner', 'admin'))
      or exists (select 1 from public.maintenance_routes r
                  where r.company_id = p_company and r.service_date = p_date and r.status <> 'cancelled'
                    and (r.lead_person_id = p_person or exists (select 1 from public.maintenance_route_crew c where c.route_id = r.id and c.person_id = p_person)))
      or exists (select 1 from public.assignments a
                  where a.person_id = p_person and a.company_id = p_company and a.scheduled_date = p_date and a.status not in ('cancelled', 'reassigned'))
$$;
revoke all on function public._time_may_clock_in(uuid, uuid, date) from public, anon, authenticated;

-- ── The old direct calls can't be used to get around the leader rule ─────────
-- "I'm here" (018), now leader-only. Everything else is as before.
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
  perform public._maint_require_leader(s.id, me, 'check the crew in');
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
grant execute on function public.maintenance_mark_arrived(uuid, double precision, double precision, double precision, text) to authenticated;

-- "Finish stop" (018), now leader-only.
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
  perform public._maint_require_leader(s.id, me, 'finish a stop');
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
grant execute on function public.maintenance_finish_stop(uuid, text, double precision, double precision, double precision, text) to authenticated;

-- ── Every route needs one explicitly named leader ───────────────────────────
-- Owner/admin choose (or change) a route's leader. The leader must be an active maintenance worker who is on the route's crew.
create or replace function public.maintenance_set_route_leader(p_route uuid, p_person uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_person_id(); r public.maintenance_routes; old uuid;
begin
  select * into r from public.maintenance_routes where id = p_route for update;
  if not found or not public.is_staff(r.company_id) then raise exception 'Route not found.'; end if;
  if r.status in ('cancelled', 'completed') then raise exception 'This route is already %.', r.status; end if;
  if p_person is null then raise exception 'Choose a crew leader. A route always needs one.'; end if;
  if not exists (select 1 from public.maintenance_route_crew c where c.route_id = r.id and c.person_id = p_person) then
    raise exception 'The leader has to be on the route''s crew. Add them to the crew first.';
  end if;
  if not public.person_is_maintenance_worker(r.company_id, p_person) then
    raise exception 'The crew leader must be an approved maintenance worker.';
  end if;
  old := r.lead_person_id;
  if old is not distinct from p_person then return; end if;
  perform set_config('brighton.route_leader', 'on', true);
  update public.maintenance_routes set lead_person_id = p_person where id = r.id;
  perform set_config('brighton.route_leader', '', true);
  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
  values (r.company_id, 'route_leader_set', me, p_person, jsonb_build_object('route_id', r.id, 'previous_leader', old));
end;
$$;

-- Owner/admin: routes that still need a leader (including routes that existed before this rule). Nothing is assigned for you.
create or replace function public.maintenance_routes_without_leader()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public._my_owned_or_staff_company();
begin
  if cid is null then raise exception 'not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('route_id', r.id, 'name', r.name, 'service_date', r.service_date, 'status', r.status,
             'crew', (select count(*) from public.maintenance_route_crew c where c.route_id = r.id)) order by r.service_date)
      from public.maintenance_routes r
     where r.company_id = cid and r.lead_person_id is null and r.status not in ('cancelled', 'completed') and r.service_date >= current_date - 1
  ), '[]'::jsonb);
end;
$$;
create or replace function public._my_owned_or_staff_company()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.company_members where person_id = public.my_person_id() and role in ('owner', 'admin') and status = 'active' order by created_at limit 1
$$;
revoke all on function public._my_owned_or_staff_company() from public, anon, authenticated;

-- A route can't lose its leader from a phone, and a leader has to be on the crew (checked on changes; a new route gets its crew right after it).
create or replace function public._maintenance_routes_leader_guard()
returns trigger language plpgsql as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if new.lead_person_id is distinct from old.lead_person_id then
    if new.lead_person_id is null then
      raise exception 'A route always needs a crew leader. Choose a different leader instead of removing it.';
    end if;
    if not exists (select 1 from public.maintenance_route_crew c where c.route_id = new.id and c.person_id = new.lead_person_id) then
      raise exception 'The leader has to be on the route''s crew. Add them to the crew first.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public._maintenance_routes_leader_guard() from public, anon, authenticated;
drop trigger if exists maintenance_routes_leader_guard on public.maintenance_routes;
create trigger maintenance_routes_leader_guard before update of lead_person_id on public.maintenance_routes
  for each row execute function public._maintenance_routes_leader_guard();

-- ── Crew visits (one per stop): saved arrival and completion, no per-worker property timers ──
-- A crew visit never has per-person intervals, and the older per-worker functions can't make a maintenance visit.
create or replace function public._time_visit_guard()
returns trigger language plpgsql as $$
begin
  if new.source = 'maintenance_stop' and not new.crew_level then
    raise exception 'At a maintenance stop the crew leader checks everyone in (I''m Here on the route screen). Workers do not start their own property timer.';
  end if;
  return new;
end;
$$;
revoke all on function public._time_visit_guard() from public, anon, authenticated;
drop trigger if exists time_visits_guard on public.time_visits;
create trigger time_visits_guard before insert on public.time_visits for each row execute function public._time_visit_guard();

create or replace function public._time_interval_crew_guard()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.time_visits v where v.id = new.visit_id and v.crew_level) then
    raise exception 'A crew visit has no per-person property time. Its time is the leader''s arrival to completion; each person''s workday is separate.';
  end if;
  return new;
end;
$$;
revoke all on function public._time_interval_crew_guard() from public, anon, authenticated;
drop trigger if exists time_intervals_crew_guard on public.time_intervals;
create trigger time_intervals_crew_guard before insert on public.time_intervals for each row execute function public._time_interval_crew_guard();

-- Keeps a visit in step with its intervals (063). A crew visit is not derived from intervals: leave it alone.
create or replace function public._time_refresh_visit(p_visit uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s timestamptz; e timestamptz; open_n integer; any_n integer;
begin
  if exists (select 1 from public.time_visits where id = p_visit and crew_level) then return; end if;
  select min(started_at), max(ended_at), count(*) filter (where ended_at is null), count(*)
    into s, e, open_n, any_n
  from public.time_intervals where visit_id = p_visit and status <> 'void';
  update public.time_visits
     set started_at = s,
         ended_at = case when open_n > 0 or any_n = 0 then null else e end,
         status = case when any_n = 0 then 'void' when open_n > 0 then 'in_progress' else 'completed' end
   where id = p_visit;
end;
$$;
revoke all on function public._time_refresh_visit(uuid) from public, anon, authenticated;

-- The leader (or owner/admin) checks the crew in at the next stop.
create or replace function public.maintenance_leader_arrive(
  p_stop_id uuid,
  p_lat double precision default null, p_lng double precision default null, p_accuracy double precision default null,
  p_location_state text default 'ok'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  cid uuid;
  st public.time_settings;
  w public.time_workdays;
  s public.maintenance_stops;
  v public.time_visits;
  r public.maintenance_routes;
  staff boolean;
  blocked text;
  vlabel text;
  tgt integer;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  if cid is null then raise exception 'You are not on a team yet.'; end if;
  st := public._time_settings_row(cid);
  staff := public.is_staff(cid);
  select * into s from public.maintenance_stops where id = p_stop_id;
  if not found or s.company_id <> cid then raise exception 'Stop not found.'; end if;
  select * into r from public.maintenance_routes where id = s.route_id;
  if r.status = 'cancelled' then raise exception 'That route was cancelled.'; end if;
  perform public._maint_require_leader(s.id, me, 'check the crew in');
  if s.status in ('completed', 'skipped') then raise exception 'This stop is already %.', s.status; end if;

  select * into w from public.time_workdays where person_id = me and clock_out_at is null;
  if not found and not staff then raise exception 'Clock in for the day first.'; end if;

  -- Already checked in (a double tap, or a second phone): show it, never a second visit.
  select * into v from public.time_visits where maintenance_stop_id = s.id;
  if s.status = 'arrived' and v.id is not null then
    return jsonb_build_object('stop_id', s.id, 'visit_id', v.id, 'arrived_at', v.started_at, 'already_arrived', true);
  end if;

  -- Stops are worked in the owner's order (the owner may work out of order; it is written to the history).
  select (select p.name from public.maintenance_properties p where p.id = e.property_id) into blocked
    from public.maintenance_stops e
   where e.route_id = s.route_id and e.sort_order < s.sort_order and e.status not in ('completed', 'skipped')
   order by e.sort_order limit 1;
  if blocked is not null and not staff then raise exception 'Finish % first. Stops are worked in order.', blocked; end if;

  if st.require_start_photo and not staff and not exists (
       select 1 from public.maintenance_photos p where p.stop_id = s.id and p.uploaded_by = me and p.time_phase = 'start'
          and p.file_key <> '' and p.created_at >= w.clock_in_at) then
    raise exception 'Take the start photo for this property first.';
  end if;

  perform public.maintenance_mark_arrived(s.id, p_lat, p_lng, p_accuracy, p_location_state);
  -- The crew has started the work, so any skip request for this stop is moot.
  update public.time_skip_requests set status = 'withdrawn', decided_at = now(), decision_note = 'The crew started the work'
   where maintenance_stop_id = s.id and status = 'pending';

  select name into vlabel from public.maintenance_properties where id = s.property_id;
  select target_minutes into tgt from public.time_property_targets where maintenance_property_id = s.property_id and company_id = cid;
  insert into public.time_visits (company_id, source, crew_level, maintenance_stop_id, maintenance_property_id, route_id, visit_date, label, target_minutes, started_at, status)
  values (cid, 'maintenance_stop', true, s.id, s.property_id, s.route_id, r.service_date, vlabel, tgt, now(), 'in_progress')
  on conflict (maintenance_stop_id) where maintenance_stop_id is not null do nothing;
  select * into v from public.time_visits where maintenance_stop_id = s.id;
  if blocked is not null and staff then
    perform public._time_audit(cid, 'visit', v.id, me, w.id, v.id, 'order_override', 'route_order', null, to_jsonb(blocked), 'Started before ' || blocked || ' was finished', false);
  end if;
  return jsonb_build_object('stop_id', s.id, 'visit_id', v.id, 'arrived_at', v.started_at, 'already_arrived', false);
end;
$$;

-- The leader (or owner/admin) finishes the stop: the visit's completion time and elapsed time are saved.
create or replace function public.maintenance_leader_complete(
  p_stop_id uuid, p_note text default null,
  p_lat double precision default null, p_lng double precision default null, p_accuracy double precision default null,
  p_location_state text default 'ok'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  cid uuid;
  st public.time_settings;
  s public.maintenance_stops;
  v public.time_visits;
  staff boolean;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  if cid is null then raise exception 'You are not on a team yet.'; end if;
  st := public._time_settings_row(cid);
  staff := public.is_staff(cid);
  select * into s from public.maintenance_stops where id = p_stop_id;
  if not found or s.company_id <> cid then raise exception 'Stop not found.'; end if;
  perform public._maint_require_leader(s.id, me, 'finish a stop');
  select * into v from public.time_visits where maintenance_stop_id = s.id;

  if s.status = 'completed' then
    return jsonb_build_object('stop_id', s.id, 'visit_id', v.id, 'completed_at', coalesce(v.ended_at, s.completed_at), 'already_completed', true);
  end if;
  if st.require_complete_photo and not staff and not exists (
       select 1 from public.maintenance_photos p where p.stop_id = s.id and p.uploaded_by = me and p.time_phase = 'complete'
          and p.file_key <> '' and p.created_at >= coalesce(v.started_at, s.arrived_at, now() - interval '1 day')) then
    raise exception 'Take the completion photo for this property first.';
  end if;

  perform public.maintenance_finish_stop(s.id, p_note, p_lat, p_lng, p_accuracy, p_location_state);

  update public.time_visits set ended_at = now(), status = 'completed' where maintenance_stop_id = s.id and crew_level;
  select * into v from public.time_visits where maintenance_stop_id = s.id;
  return jsonb_build_object('stop_id', s.id, 'visit_id', v.id, 'completed_at', v.ended_at, 'already_completed', false);
end;
$$;

-- Owner/admin: fix a crew visit's arrival / completion (kept in the history with the old values and a reason).
create or replace function public.maintenance_staff_edit_visit(p_visit uuid, p_started timestamptz default null, p_ended timestamptz default null, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v public.time_visits; ns timestamptz; ne timestamptz;
begin
  select * into v from public.time_visits where id = p_visit for update;
  if not found or not v.crew_level then raise exception 'Visit not found.'; end if;
  perform public._time_need_staff(v.company_id, p_reason);
  ns := coalesce(p_started, v.started_at); ne := coalesce(p_ended, v.ended_at);
  if ne is not null and ne < ns then raise exception 'A visit can''t end before it starts.'; end if;
  if ns is not distinct from v.started_at and ne is not distinct from v.ended_at then return; end if;
  perform public._time_no_future(ns); perform public._time_no_future(ne);
  update public.time_visits set started_at = ns, ended_at = ne where id = v.id;
  if ns is distinct from v.started_at then
    perform public._time_audit(v.company_id, 'visit', v.id, null, null, v.id, 'corrected', 'started_at', to_jsonb(v.started_at), to_jsonb(ns), p_reason, false);
  end if;
  if ne is distinct from v.ended_at then
    perform public._time_audit(v.company_id, 'visit', v.id, null, null, v.id, 'corrected', 'ended_at', to_jsonb(v.ended_at), to_jsonb(ne), p_reason, false);
  end if;
end;
$$;

-- ── Estimated labor-hours (derived, never stored) ───────────────────────────
-- Per assigned worker: minutes their own recorded workday overlaps [from, to]. Workers assigned = the route's crew + its leader.
create or replace function public._maint_crew_minutes(p_route uuid, p_company uuid, p_from timestamptz, p_to timestamptz)
returns table (person_id uuid, minutes numeric)
language sql stable security definer set search_path = public as $$
  select x.person_id,
         coalesce((select sum(greatest(0, extract(epoch from (least(coalesce(w.clock_out_at, now()), p_to) - greatest(w.clock_in_at, p_from))) / 60.0))
                     from public.time_workdays w
                    where w.person_id = x.person_id and w.company_id = p_company
                      and w.clock_in_at < p_to and coalesce(w.clock_out_at, now()) > p_from), 0)
    from (select c.person_id from public.maintenance_route_crew c where c.route_id = p_route
          union
          select r.lead_person_id from public.maintenance_routes r where r.id = p_route and r.lead_person_id is not null) x
$$;
revoke all on function public._maint_crew_minutes(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Owner/admin: every visit to one property, newest first, with elapsed time and ESTIMATED labor-hours.
-- Before time tracking (or when the arrival came through the older path) the stop's own arrival/completion times are used.
create or replace function public.maintenance_property_visits(p_property uuid, p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cid uuid; res jsonb;
begin
  select company_id into cid from public.maintenance_properties where id = p_property;
  if cid is null or not public.is_staff(cid) then raise exception 'not allowed'; end if;
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.service_date desc, t.arrived_at desc nulls last), '[]'::jsonb) into res
  from (
    select s.id as stop_id, v.id as visit_id, r.service_date, s.status, r.lead_person_id as leader_id,
           (select coalesce(nullif(trim(p.first_name || ' ' || p.last_name), ''), p.email) from public.people p where p.id = r.lead_person_id) as leader_name,
           coalesce(v.started_at, s.arrived_at) as arrived_at,
           coalesce(v.ended_at, s.completed_at) as completed_at,
           case when coalesce(v.started_at, s.arrived_at) is null or coalesce(v.ended_at, s.completed_at) is null then null
                else round((extract(epoch from (coalesce(v.ended_at, s.completed_at) - coalesce(v.started_at, s.arrived_at))) / 60.0)::numeric, 1) end as elapsed_minutes,
           case when coalesce(v.started_at, s.arrived_at) is null or coalesce(v.ended_at, s.completed_at) is null then null
                else (select round(coalesce(sum(m.minutes), 0)::numeric, 1) from public._maint_crew_minutes(r.id, s.company_id, coalesce(v.started_at, s.arrived_at), coalesce(v.ended_at, s.completed_at)) m) end as est_labor_minutes,
           case when coalesce(v.started_at, s.arrived_at) is null or coalesce(v.ended_at, s.completed_at) is null then '[]'::jsonb
                else coalesce((select jsonb_agg(jsonb_build_object('person_id', m.person_id,
                          'name', (select coalesce(nullif(trim(p.first_name || ' ' || p.last_name), ''), p.email) from public.people p where p.id = m.person_id),
                          'minutes', round(m.minutes::numeric, 1)) order by m.minutes desc)
                       from public._maint_crew_minutes(r.id, s.company_id, coalesce(v.started_at, s.arrived_at), coalesce(v.ended_at, s.completed_at)) m), '[]'::jsonb) end as crew,
           (select count(*) from public.maintenance_stop_tasks k where k.stop_id = s.id and k.completed_at is not null)::int as tasks_done,
           (select count(*) from public.maintenance_stop_tasks k where k.stop_id = s.id)::int as tasks_total,
           (select count(*) from public.maintenance_photos ph where ph.stop_id = s.id)::int as photos,
           coalesce(v.crew_level, false) as saved_visit
      from public.maintenance_stops s
      join public.maintenance_routes r on r.id = s.route_id
      left join public.time_visits v on v.maintenance_stop_id = s.id
     where s.property_id = p_property and s.company_id = cid and r.status <> 'cancelled'
     order by r.service_date desc, coalesce(v.started_at, s.arrived_at) desc nulls last
     limit greatest(1, least(coalesce(p_limit, 200), 500))
  ) t;
  return res;
end;
$$;

revoke all on function public.maintenance_set_route_leader(uuid, uuid), public.maintenance_routes_without_leader() from public, anon;
grant execute on function public.maintenance_set_route_leader(uuid, uuid), public.maintenance_routes_without_leader() to authenticated;
revoke all on function public.maintenance_leader_arrive(uuid, double precision, double precision, double precision, text),
  public.maintenance_leader_complete(uuid, text, double precision, double precision, double precision, text),
  public.maintenance_staff_edit_visit(uuid, timestamptz, timestamptz, text), public.maintenance_property_visits(uuid, integer) from public, anon;
grant execute on function public.maintenance_leader_arrive(uuid, double precision, double precision, double precision, text),
  public.maintenance_leader_complete(uuid, text, double precision, double precision, double precision, text),
  public.maintenance_staff_edit_visit(uuid, timestamptz, timestamptz, text), public.maintenance_property_visits(uuid, integer) to authenticated;

-- ── Skip requests know about crew visits ───────────────────────────────────
-- (Same as update 63 plus: no skip request, and no skip approval, while the crew is at the property.)
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
    if s.status = 'arrived' then
      raise exception 'The crew is at this property right now. Finish it instead.';
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
  -- The crew is at this property (a crew visit is open): skipping now would strand it.
  if p_approve and r.source = 'maintenance_stop' and exists (select 1 from public.maintenance_stops s where s.id = r.maintenance_stop_id and s.status = 'arrived') then
    raise exception 'The crew is at this property right now. Wait for them to finish, or deny the request.';
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

-- ── Company deletion also lists the company's stored files for removal ───────
-- Files are not in the database (they are in the media storage); deleting the rows would leave them behind with nobody pointing at them.
-- This list outlives the company (no link to it). Nothing reads it through the app. A storage-cleanup job (not part of this update; it
-- needs the storage credentials; supabase/functions/storage-cleanup) claims unprocessed rows, deletes the files, and records the result.
-- The database delete and the file delete can NOT be one atomic step (the files are outside the database). So: the rows go in one
-- all-or-nothing step together with the list of files; the files are then removed by a retrying job. A failure is retried with a
-- growing delay and is marked 'failed' after 8 attempts; processed_at is set only once the storage confirmed the file is gone.
create table if not exists public.storage_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  source_table text not null,
  file_key text not null,
  enqueued_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.storage_cleanup_queue add column if not exists status text not null default 'pending';
alter table public.storage_cleanup_queue add column if not exists attempts integer not null default 0;
alter table public.storage_cleanup_queue add column if not exists last_error text;
alter table public.storage_cleanup_queue add column if not exists next_attempt_at timestamptz not null default now();
alter table public.storage_cleanup_queue add column if not exists locked_until timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'storage_cleanup_status_check') then
    alter table public.storage_cleanup_queue add constraint storage_cleanup_status_check check (status in ('pending', 'done', 'failed'));
  end if;
end $$;
create unique index if not exists uq_storage_cleanup_key on public.storage_cleanup_queue (file_key);
drop index if exists public.idx_storage_cleanup_pending;
create index if not exists idx_storage_cleanup_due on public.storage_cleanup_queue (next_attempt_at) where status = 'pending';
alter table public.storage_cleanup_queue enable row level security;
revoke all on public.storage_cleanup_queue from anon, authenticated;

-- Job side (service role only; never callable from the app). Claims a batch with a 10 minute lock so two runs never take the same file.
create or replace function public.storage_cleanup_claim(p_limit integer default 25)
returns table (id uuid, company_id uuid, file_key text, attempts integer)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select q.id from public.storage_cleanup_queue q
     where q.status = 'pending' and q.next_attempt_at <= now() and (q.locked_until is null or q.locked_until < now())
     order by q.next_attempt_at limit greatest(1, least(coalesce(p_limit, 25), 100)) for update skip locked
  )
  update public.storage_cleanup_queue q set locked_until = now() + interval '10 minutes', attempts = q.attempts + 1
    from due where q.id = due.id
  returning q.id, q.company_id, q.file_key, q.attempts;
end;
$$;

-- Records a result. Success is the only way processed_at gets set. A failure waits 2^attempts minutes (max 6 hours) and gives up after 8.
create or replace function public.storage_cleanup_finish(p_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
declare q public.storage_cleanup_queue;
begin
  select * into q from public.storage_cleanup_queue where id = p_id for update;
  if not found then raise exception 'No such cleanup item.'; end if;
  if p_ok then
    update public.storage_cleanup_queue set status = 'done', processed_at = now(), locked_until = null, last_error = null where id = p_id;
  elsif q.attempts >= 8 then
    update public.storage_cleanup_queue set status = 'failed', locked_until = null, last_error = left(coalesce(p_error, 'failed'), 500) where id = p_id;
  else
    update public.storage_cleanup_queue set locked_until = null, last_error = left(coalesce(p_error, 'failed'), 500),
      next_attempt_at = now() + least(power(2, q.attempts) * interval '1 minute', interval '6 hours') where id = p_id;
  end if;
end;
$$;

-- Honest progress for an operator: how many files are still in storage (pending), gone (done), or gave up (failed).
create or replace function public.storage_cleanup_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('pending', count(*) filter (where status = 'pending'), 'done', count(*) filter (where status = 'done'),
                            'failed', count(*) filter (where status = 'failed')) from public.storage_cleanup_queue
$$;
revoke all on function public.storage_cleanup_claim(integer), public.storage_cleanup_finish(uuid, boolean, text), public.storage_cleanup_status() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.storage_cleanup_claim(integer), public.storage_cleanup_finish(uuid, boolean, text), public.storage_cleanup_status() to service_role;
  end if;
end $$;

create or replace function public._enqueue_company_files(p_company uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare t record; n integer := 0; c integer;
begin
  for t in
    select c1.relname from pg_class c1 join pg_namespace n1 on n1.oid = c1.relnamespace and n1.nspname = 'public'
     where c1.relkind = 'r' and c1.relname <> 'storage_cleanup_queue'
       and exists (select 1 from pg_attribute a where a.attrelid = c1.oid and a.attname = 'company_id' and not a.attisdropped)
       and exists (select 1 from pg_attribute a where a.attrelid = c1.oid and a.attname = 'file_key' and not a.attisdropped)
  loop
    execute format('insert into public.storage_cleanup_queue (company_id, source_table, file_key) select company_id, %L, file_key from public.%I where company_id = $1 and coalesce(file_key, '''') <> '''' on conflict (file_key) do nothing', t.relname, t.relname) using p_company;
    get diagnostics c = row_count;
    n := n + c;
  end loop;
  return n;
end;
$$;
revoke all on function public._enqueue_company_files(uuid) from public, anon, authenticated;

create or replace function public.delete_my_company(p_confirm_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  pid uuid := public.my_person_id();
  cid uuid;
  cname text;
  t text;
  prev jsonb;
  who text;
  gone_people uuid[];
  gone_users uuid[];
begin
  if pid is null then raise exception 'not signed in'; end if;

  select m.company_id into cid
    from public.company_members m
   where m.person_id = pid and m.role = 'owner' and m.status = 'active'
   limit 1;
  if cid is null then raise exception 'Only the company owner can delete the company.'; end if;

  select name into cname from public.companies where id = cid;
  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(coalesce(cname, ''))) then
    raise exception 'Type the company name exactly to confirm.';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.one_company'));

  prev := public.company_closure_preview();
  if (prev ->> 'on_the_clock')::int > 0 or (prev ->> 'timing_a_property')::int > 0 then
    raise exception 'Someone is still clocked in. Clock them out (Hours & Labor) before closing the company.';
  end if;
  if (prev ->> 'dispatched_storms')::int > 0 then
    raise exception 'A snow storm is still dispatched. End it before closing the company.';
  end if;

  -- Close every way back in first (if anything below fails, all of this is rolled back too).
  update public.team_codes set is_active = false where company_id = cid;
  update public.snow_signup_codes set is_active = false where company_id = cid;
  update public.join_requests set status = 'cancelled', reviewed_by = pid, reviewed_at = now() where company_id = cid and status = 'pending';
  update public.snow_access_requests set status = 'removed', reviewed_by = pid, reviewed_at = now() where company_id = cid and status = 'pending';

  select trim(first_name || ' ' || last_name) into who from public.people where id = pid;
  insert into public.company_closure_log (company_id, company_name, closed_by, closed_by_name, counts)
  values (cid, cname, pid, who, prev);

  -- The company's stored files (photos, documents) live outside the database. Their names are written to a cleanup list BEFORE the rows
  -- are deleted, in this same all-or-nothing step, so nothing is left unlisted. A separate job must delete the files from storage.
  perform public._enqueue_company_files(cid);

  -- Deleting a company deletes everything inside it, including the accounts of the people who belonged ONLY to it (owner included), so
  -- nobody is left with a login that opens onto "Finish setting up". Anyone who also belongs to (or has Snow access in) another company
  -- keeps their account. Decided now, before the memberships disappear.
  select coalesce(array_agg(distinct m.person_id), '{}') into gone_people
    from public.company_members m
   where m.company_id = cid
     and not exists (select 1 from public.company_members m2 where m2.person_id = m.person_id and m2.company_id <> cid)
     and not exists (select 1 from public.snow_staff s where s.person_id = m.person_id and s.company_id <> cid);

  for t in
    select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r'
       and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
  loop
    execute format('alter table public.%I disable trigger user', t);
  end loop;

  perform set_config('app.allow_company_delete', 'on', true);
  delete from public.companies where id = cid;
  perform set_config('app.allow_company_delete', 'off', true);

  for t in
    select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r'
       and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
  loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;

  if exists (select 1 from public.companies where id = cid) then
    raise exception 'The company could not be deleted.';
  end if;

  -- Same all-or-nothing step: remove those people and their logins. If any of this fails, the company is NOT deleted either.
  select coalesce(array_agg(user_id) filter (where user_id is not null), '{}') into gone_users from public.people where id = any(gone_people);
  delete from public.people where id = any(gone_people);
  delete from auth.users where id = any(gone_users);
  update public.company_closure_log
     set counts = coalesce(counts, '{}'::jsonb) || jsonb_build_object('accounts_deleted', coalesce(array_length(gone_people, 1), 0))
   where company_id = cid;
end;
$$;
revoke execute on function public.delete_my_company(text) from public, anon;
grant execute on function public.delete_my_company(text) to authenticated;

-- ── Compatibility ───────────────────────────────────────────────────────────
-- Builds before this update let every crew member tap "I'm here" and start their own property timer. After this update those
-- taps are refused for everyone except the leader (and the old per-worker timer for maintenance is refused outright), so ship
-- this update together with the new build, which shows I'm Here only to the leader.
notify pgrst, 'reload schema';
