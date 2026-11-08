-- ============================================================================
-- Update 67 — run once in Supabase → SQL Editor, AFTER 063-065 (safe to run again). NOT run yet; read it first.
--
-- A worker can only clock in when there is work for them that day.
--
-- Before: time_clock_in() (update 63) let ANY active team member clock in at any time (3 AM, no route, no job), and the phone
-- always showed a Clock In button. That could start timers and create time records for nobody's authorized work.
--
-- Now a worker (owner and admin are exempt: they run the company and may clock in without a route) may clock in only when, for the
-- workday's date, EITHER
--   • they are on the crew of a maintenance route that day that is not cancelled, OR
--   • they have a landscaping assignment that day that is not cancelled or reassigned.
-- Nothing else authorizes it: not Snow Mode being on, not another worker's route or job, not a project that exists with nobody
-- assigned, not an assignment on a different date.
-- There is NO clock-in time window in this app (no scheduled start rule exists), so none is invented: a worker with work that
-- day may clock in at any hour. That is reported as an open decision, not guessed.
--
-- SNOW MODE (the snow time clock, update 28 / 42): the same rule, written for snow. Before, snow_clock_in() let anyone with snow
-- access start a shift at any time (update 42 even says clock-in is "never blocked"); the Snow Time Clock screen always showed Clock In.
-- Now a snow WORKER may clock in only when they are on a route that is really running: they lead it or are on its crew, the route
-- is not cancelled, its storm is DISPATCHED (not a draft, not ended), and they still hold that route's service (plowing / shoveling /
-- salting). Owner and admin are exempt (as everywhere). Having snow access, Snow Mode being on, a storm existing, another worker's
-- route, or an old route of an ended storm authorizes nothing. There is no time window: a storm can be dispatched at 3 AM and the
-- crew may clock in then. The shift is still tagged with its storm as before (update 42), and clock-out never needs a route.
--
-- time_my_day() now also says "can_clock_in" so the phone shows "No work scheduled today" instead of a Clock In button. The
-- database is the authority: time_clock_in() refuses even if the phone is old or the request is edited.
-- Everything else (clock-out, an already-open shift, breaks, property visits, rates, history) is unchanged. Nothing is deleted.
-- ============================================================================

-- May this person start a workday for this date? (Owner/admin always; workers need a route or a job that day.)
create or replace function public._time_may_clock_in(p_person uuid, p_company uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.company_members m
                  where m.person_id = p_person and m.company_id = p_company and m.status = 'active' and m.role in ('owner', 'admin'))
      or exists (select 1 from public.maintenance_route_crew c join public.maintenance_routes r on r.id = c.route_id
                  where c.person_id = p_person and r.company_id = p_company and r.service_date = p_date and r.status <> 'cancelled')
      or exists (select 1 from public.assignments a
                  where a.person_id = p_person and a.company_id = p_company and a.scheduled_date = p_date and a.status not in ('cancelled', 'reassigned'))
$$;
revoke all on function public._time_may_clock_in(uuid, uuid, date) from public, anon, authenticated;

-- The worker's day, now with can_clock_in (for the phone; the database enforces it either way).
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
    'can_clock_in', public._time_may_clock_in(p_person, p_company, p_date),
    'settings', jsonb_build_object('breaks_enabled', st.breaks_enabled, 'require_start_photo', st.require_start_photo, 'require_complete_photo', st.require_complete_photo),
    'days', days,
    'current', cur
  );
end;
$$;
revoke all on function public._time_day_json(uuid, uuid, date) from public, anon, authenticated;

-- Clock in: same as update 63, plus the work check. An already-open shift (this phone or another) is still just shown, never refused.
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

  if p_request_id is not null then
    select * into w from public.time_workdays where client_request_id = p_request_id and person_id = me;
    if found then return public._time_day_json(me, cid, d) || jsonb_build_object('already_active', true); end if;
  end if;
  select * into w from public.time_workdays where person_id = me and clock_out_at is null;
  if found then return public._time_day_json(me, cid, d) || jsonb_build_object('already_active', true); end if;

  if not public._time_may_clock_in(me, cid, d) then
    raise exception 'You have no work scheduled today, so you can''t clock in yet. Once the owner puts you on a route or a job, Clock In appears.';
  end if;

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
    return public._time_day_json(me, cid, d) || jsonb_build_object('already_active', true);
  end;
  insert into public.time_workday_rates (workday_id, company_id, hourly_rate) values (w.id, cid, public._time_rate(cid, me, d));
  return public._time_day_json(me, cid, d);
end;
$$;
revoke all on function public.time_clock_in(date, uuid, uuid) from public, anon;
grant execute on function public.time_clock_in(date, uuid, uuid) to authenticated;

-- ── Snow Mode ────────────────────────────────────────────────────────────────
-- May this person start a snow shift in this company now? Staff always; a worker needs an active (dispatched) route they lead or crew.
create or replace function public._snow_may_clock_in(p_person uuid, p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.company_members m
                  where m.person_id = p_person and m.company_id = p_company and m.status = 'active' and m.role in ('owner', 'admin'))
      or exists (
        select 1
          from public.snow_routes r
          join public.snow_storms s on s.id = r.storm_id
         where r.company_id = p_company and r.cancelled_at is null and s.status = 'dispatched'
           and public.snow_person_has_service(r.company_id, p_person, r.service)
           and (r.lead_person_id = p_person
                or exists (select 1 from public.snow_route_crew c where c.route_id = r.id and c.person_id = p_person)))
$$;
revoke all on function public._snow_may_clock_in(uuid, uuid) from public, anon, authenticated;

-- For the Snow Time Clock screen: is there an authorized route right now? (The database refuses a clock-in either way.)
create or replace function public.snow_can_clock_in()
returns boolean language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public._snow_my_company(); me uuid := public.my_person_id();
begin
  if cid is null or me is null or not public.snow_is_active(cid) then return false; end if;
  return public._snow_may_clock_in(me, cid);
end;
$$;
revoke all on function public.snow_can_clock_in() from public, anon;
grant execute on function public.snow_can_clock_in() to authenticated;

-- Same as update 42, plus the route check. An already-open shift (or a repeat of the same request) is still just returned.
create or replace function public.snow_clock_in(p_client_request_id uuid default null)
returns public.snow_shifts language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public._snow_my_company();
  me uuid := public.my_person_id();
  s public.snow_shifts;
  tag uuid;
begin
  if cid is null or not public.snow_is_active(cid) then
    raise exception 'You need snow team access to clock in.';
  end if;
  if p_client_request_id is not null then
    select * into s from public.snow_shifts where client_request_id = p_client_request_id and person_id = me;
    if s.id is not null then return s; end if;
  end if;
  select * into s from public.snow_shifts where company_id = cid and person_id = me and clock_out_at is null;
  if s.id is not null then return s; end if;  -- already clocked in

  if not public._snow_may_clock_in(me, cid) then
    raise exception 'No active storm assignment. You can clock in once you are put on a route for a storm that has been dispatched.';
  end if;

  tag := public._snow_storm_to_tag(me, cid);

  insert into public.snow_shifts (company_id, person_id, client_request_id, storm_id)
  values (cid, me, p_client_request_id, tag) returning * into s;
  perform public.snow_log_event(cid, 'shift.clocked_in', 'snow_shift', s.id,
                                p_storm_id => s.storm_id, p_person_id => me,
                                p_after => jsonb_strip_nulls(jsonb_build_object('clock_in_at', s.clock_in_at, 'storm_id', s.storm_id)));
  return s;
end;
$$;
revoke execute on function public.snow_clock_in(uuid) from public, anon;
grant execute on function public.snow_clock_in(uuid) to authenticated;
