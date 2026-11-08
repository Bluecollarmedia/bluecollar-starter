-- ============================================================================
-- Update 98 — run once in Supabase → SQL Editor, AFTER 097 (and 063-065, 090). NOT run yet; read it first. Safe to run again.
--
-- A workday closes by itself when the person has finished everything for the day, and a day that was forgotten is easy for the owner to settle.
--
--   1. AUTOMATIC CLOSE. When a worker's last open stop / job of the day is finished or skipped, their open workday is closed at that moment
--      (a real, server-stamped time) and a line is written to the time history ("Closed automatically ..."). It never closes:
--        - while they are on a property timer or a break (it closes right after those end),
--        - a day that is already stale (those go through the review rule of update 90),
--        - when they have no work at all for the day.
--      If more work is added later the same day, the worker clocks in again: that is a NEW session. The closed one is never reopened or edited.
--   2. THE 14-HOUR BACKSTOP stays as update 90 made it: the day closes at zero length and counts for NO hours until the owner confirms an end
--      time. New here: the database now works out a SUGGESTED end time (the last finished stop or property visit, the end of the last break, or
--      what the worker said) and the owner can accept it with one tap (time_review_list, time_accept_suggested_end, time_accept_all_suggested_ends).
--      Accepting uses the owner's existing audited edit (update 90), so nothing is paid until the owner accepts or sets another time.
--   3. DAILY ALERT HOURS. The overtime alert now adds up ALL of a person's sessions on a date (two sessions in one day could pass the alert
--      hours without it firing). Same alert, same notification text; a single-session day keeps its existing key.
--   4. has_open_work. The worker's day now says whether work is still open for the date, so the phone can say "all done" instead of "Clock in".
-- Nothing existing is deleted. No tables change.
-- ============================================================================

-- ── 1. Is there work left / was there work today ─────────────────────────────────
create or replace function public._time_open_work_count(p_person uuid, p_company uuid, p_date date)
returns integer language sql stable security definer set search_path = public as $$
  select (select count(*) from public.maintenance_stops s join public.maintenance_routes r on r.id = s.route_id
           where r.company_id = p_company and r.service_date = p_date and r.status <> 'cancelled' and s.status in ('pending', 'arrived')
             and (r.lead_person_id = p_person or exists (select 1 from public.maintenance_route_crew c where c.route_id = r.id and c.person_id = p_person)))::integer
       + (select count(*) from public.assignments a
           where a.person_id = p_person and a.company_id = p_company and a.scheduled_date = p_date
             and a.status in ('scheduled', 'confirmed', 'en_route', 'checked_in', 'working'))::integer
$$;
revoke all on function public._time_open_work_count(uuid, uuid, date) from public, anon, authenticated;

create or replace function public._time_any_work_count(p_person uuid, p_company uuid, p_date date)
returns integer language sql stable security definer set search_path = public as $$
  select (select count(*) from public.maintenance_stops s join public.maintenance_routes r on r.id = s.route_id
           where r.company_id = p_company and r.service_date = p_date and r.status <> 'cancelled'
             and (r.lead_person_id = p_person or exists (select 1 from public.maintenance_route_crew c where c.route_id = r.id and c.person_id = p_person)))::integer
       + (select count(*) from public.assignments a
           where a.person_id = p_person and a.company_id = p_company and a.scheduled_date = p_date and a.status not in ('cancelled', 'reassigned'))::integer
$$;
revoke all on function public._time_any_work_count(uuid, uuid, date) from public, anon, authenticated;

-- ── 2. Close the day when the work is done ───────────────────────────────────────
create or replace function public._time_try_auto_close(p_person uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  w public.time_workdays;
  st public.time_settings;
begin
  if p_person is null then return false; end if;
  select * into w from public.time_workdays where person_id = p_person and clock_out_at is null and status = 'active' for update;
  if not found then return false; end if;
  st := public._time_settings_row(w.company_id);
  -- A day that has been open too long is the review rule's job (it must never get a real-looking end time).
  if w.clock_in_at < now() - make_interval(secs => (st.open_workday_hours * 3600)::integer) then return false; end if;
  if exists (select 1 from public.time_intervals i where i.person_id = p_person and i.ended_at is null and i.status = 'active') then return false; end if;
  if exists (select 1 from public.time_breaks b where b.workday_id = w.id and b.ended_at is null) then return false; end if;
  if public._time_any_work_count(p_person, w.company_id, w.work_date) = 0 then return false; end if;
  if public._time_open_work_count(p_person, w.company_id, w.work_date) > 0 then return false; end if;
  update public.time_workdays set clock_out_at = greatest(now(), clock_in_at), status = 'closed' where id = w.id;
  perform public._time_audit(w.company_id, 'workday', w.id, w.person_id, w.id, null, 'auto_clock_out', 'clock_out_at', null, to_jsonb(now()),
                             'Closed automatically: the last stop of the day was finished.', false);
  return true;
end;
$$;
revoke all on function public._time_try_auto_close(uuid) from public, anon, authenticated;

-- A maintenance stop finished or skipped: try for everyone on its route.
create or replace function public._time_auto_close_after_stop()
returns trigger language plpgsql security definer set search_path = public as $$
declare p uuid;
begin
  for p in select r.lead_person_id from public.maintenance_routes r where r.id = new.route_id and r.lead_person_id is not null
           union select c.person_id from public.maintenance_route_crew c where c.route_id = new.route_id
  loop
    perform public._time_try_auto_close(p);
  end loop;
  return new;
end;
$$;
revoke all on function public._time_auto_close_after_stop() from public, anon, authenticated;
drop trigger if exists trg_time_auto_close_stop on public.maintenance_stops;
create trigger trg_time_auto_close_stop after update of status on public.maintenance_stops
  for each row when (new.status in ('completed', 'skipped') and old.status is distinct from new.status)
  execute function public._time_auto_close_after_stop();

-- A job (assignment) finished or cancelled.
create or replace function public._time_auto_close_after_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._time_try_auto_close(new.person_id);
  return new;
end;
$$;
revoke all on function public._time_auto_close_after_assignment() from public, anon, authenticated;
drop trigger if exists trg_time_auto_close_assignment on public.assignments;
create trigger trg_time_auto_close_assignment after update of status on public.assignments
  for each row when (new.status in ('completed', 'cancelled', 'reassigned') and old.status is distinct from new.status)
  execute function public._time_auto_close_after_assignment();

-- A property timer or a break ended (it was the last thing keeping the day open).
create or replace function public._time_auto_close_after_end()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ended_at is not null and old.ended_at is null then
    perform public._time_try_auto_close(new.person_id);
  end if;
  return new;
end;
$$;
revoke all on function public._time_auto_close_after_end() from public, anon, authenticated;
drop trigger if exists trg_time_auto_close_interval on public.time_intervals;
create trigger trg_time_auto_close_interval after update of ended_at on public.time_intervals
  for each row when (new.status <> 'void') execute function public._time_auto_close_after_end();
drop trigger if exists trg_time_auto_close_break on public.time_breaks;
create trigger trg_time_auto_close_break after update of ended_at on public.time_breaks
  for each row execute function public._time_auto_close_after_end();

-- ── 3. The suggested end time for a day waiting for review ───────────────────────
-- The last thing the person actually finished inside the day: a property visit, a break, or a stop on a route they were on.
-- The worker's own answer is used only when nothing else exists. Never later than now, never before the clock-in. Null when unknown.
create or replace function public._time_suggest_end(p_workday uuid)
returns table (suggested_at timestamptz, source text) language plpgsql stable security definer set search_path = public as $$
declare w public.time_workdays; a timestamptz; b timestamptz; s timestamptz; best timestamptz; src text;
begin
  select * into w from public.time_workdays where id = p_workday;
  if not found then return; end if;
  select max(i.ended_at) into a from public.time_intervals i where i.workday_id = w.id and i.status <> 'void' and i.ended_at > w.clock_in_at;
  select max(x.ended_at) into b from public.time_breaks x where x.workday_id = w.id and x.ended_at > w.clock_in_at;
  select max(coalesce(st.completed_at, st.skipped_at)) into s
    from public.maintenance_stops st join public.maintenance_routes r on r.id = st.route_id
   where r.company_id = w.company_id and st.status in ('completed', 'skipped')
     and coalesce(st.completed_at, st.skipped_at) > w.clock_in_at
     and (r.lead_person_id = w.person_id or exists (select 1 from public.maintenance_route_crew c where c.route_id = r.id and c.person_id = w.person_id))
     and r.service_date between w.work_date - 1 and w.work_date + 1;
  best := greatest(a, b, s);
  if best is not null then
    src := case when best = s then 'last_stop' when best = a then 'last_visit' else 'last_break' end;
  elsif w.claimed_out_at is not null and w.claimed_out_at > w.clock_in_at then
    best := w.claimed_out_at; src := 'worker_said';
  end if;
  if best is not null and best > w.clock_in_at and best <= now() then
    suggested_at := best; source := src; return next;
  end if;
end;
$$;
revoke all on function public._time_suggest_end(uuid) from public, anon, authenticated;

-- The owner's "needs your OK" list: every flagged day, with the suggested end time next to it.
create or replace function public.time_review_list()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_person_id(); cid uuid;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  if cid is null or not public.is_staff(cid) then raise exception 'Only the owner can do that.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'workday_id', w.id, 'person_id', w.person_id,
        'name', coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), 'An employee'),
        'work_date', w.work_date, 'clock_in_at', w.clock_in_at, 'flagged_at', w.flagged_at,
        'claimed_out_at', w.claimed_out_at, 'claim_note', w.claim_note,
        'suggested_end_at', sg.suggested_at, 'suggestion_source', sg.source
      ) order by w.clock_in_at desc)
    from public.time_workdays w
    join public.people p on p.id = w.person_id
    left join lateral public._time_suggest_end(w.id) sg on true
    where w.company_id = cid and w.status = 'needs_review'
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.time_review_list() from public, anon;
grant execute on function public.time_review_list() to authenticated;

-- One tap: accept the suggested end time. It is the owner's existing audited edit, with the reason filled in.
create or replace function public.time_accept_suggested_end(p_workday uuid)
returns void language plpgsql security definer set search_path = public as $$
declare w public.time_workdays; sg record;
begin
  select * into w from public.time_workdays where id = p_workday;
  if not found or not public.is_staff(w.company_id) then raise exception 'Workday not found.'; end if;
  if w.status <> 'needs_review' then raise exception 'That day is already settled.'; end if;
  select * into sg from public._time_suggest_end(p_workday);
  if sg.suggested_at is null then raise exception 'There is no suggested end time for this day. Set the end time yourself.'; end if;
  perform public.time_staff_edit_workday(p_workday, null, sg.suggested_at, 'Accepted the suggested end time');
end;
$$;
revoke all on function public.time_accept_suggested_end(uuid) from public, anon;
grant execute on function public.time_accept_suggested_end(uuid) to authenticated;

-- Accept every day that has a suggestion. A day that cannot be accepted is left waiting and reported back.
create or replace function public.time_accept_all_suggested_ends()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_person_id(); cid uuid; w record; ok integer := 0; left_ jsonb := '[]'::jsonb;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  if cid is null or not public.is_staff(cid) then raise exception 'Only the owner can do that.'; end if;
  for w in select id from public.time_workdays where company_id = cid and status = 'needs_review' order by clock_in_at loop
    begin
      perform public.time_accept_suggested_end(w.id);
      ok := ok + 1;
    exception when others then
      left_ := left_ || jsonb_build_object('workday_id', w.id, 'why', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('accepted', ok, 'left', left_);
end;
$$;
revoke all on function public.time_accept_all_suggested_ends() from public, anon;
grant execute on function public.time_accept_all_suggested_ends() to authenticated;

-- ── 4. The worker's day says whether work is still open ──────────────────────────
create or replace function public._time_day_json(p_person uuid, p_company uuid, p_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  st public.time_settings := public._time_settings_row(p_company);
  days jsonb;
  cur jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', w.id, 'work_date', w.work_date, 'clock_in_at', w.clock_in_at, 'clock_out_at', w.clock_out_at, 'status', w.status,
      'flagged_at', w.flagged_at, 'claimed_out_at', w.claimed_out_at, 'claim_note', w.claim_note, 'claimed_at', w.claimed_at,
      'truck', case when w.truck_id is null then null else jsonb_build_object('id', w.truck_id, 'name', (select t.name from public.trucks t where t.id = w.truck_id), 'source', w.truck_source) end,
      'breaks', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'started_at', b.started_at, 'ended_at', b.ended_at, 'paid', b.paid) order by b.started_at)
                          from public.time_breaks b where b.workday_id = w.id), '[]'::jsonb)
    ) order by w.clock_in_at), '[]'::jsonb)
    into days
  from public.time_workdays w
  where w.person_id = p_person and (w.work_date = p_date or w.clock_out_at is null or w.status = 'needs_review');

  select jsonb_build_object('interval_id', i.id, 'visit_id', i.visit_id, 'started_at', i.started_at, 'workday_id', i.workday_id,
                            'source', v.source, 'stop_id', v.maintenance_stop_id, 'project_id', v.project_id, 'label', v.label)
    into cur
  from public.time_intervals i join public.time_visits v on v.id = i.visit_id
  where i.person_id = p_person and i.ended_at is null and i.status = 'active' limit 1;

  return jsonb_build_object(
    'server_now', now(),
    'work_date', p_date,
    'can_clock_in', public._time_may_clock_in(p_person, p_company, p_date),
    'has_open_work', public._time_open_work_count(p_person, p_company, p_date) > 0,
    'settings', jsonb_build_object('breaks_enabled', st.breaks_enabled, 'require_start_photo', st.require_start_photo, 'require_complete_photo', st.require_complete_photo,
                                   'stale_after_hours', st.open_workday_hours),
    'days', days,
    'current', cur
  );
end;
$$;
revoke all on function public._time_day_json(uuid, uuid, date) from public, anon, authenticated;

-- ── 5. Daily alert hours: all of a person's sessions on a date, added up ─────────
create or replace function public._time_scan(p_company uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  st public.time_settings := public._time_settings_row(p_company);
  w record; v record; n integer := 0; name_ text; hrs numeric; thr numeric; crew record;
begin
  -- A "still clocked in" alert is closed by itself once the workday has a clock-out (the owner fixed it, or the employee clocked out).
  update public.time_alerts a set status = 'resolved', resolved_at = now()
   where a.company_id = p_company and a.kind = 'open_workday' and a.status = 'open'
     and exists (select 1 from public.time_workdays x where x.id = a.workday_id and x.clock_out_at is not null);

  -- A workday left open far too long (probably a forgotten clock-out).
  for w in select * from public.time_workdays where company_id = p_company and clock_out_at is null
                 and clock_in_at < now() - make_interval(secs => (st.open_workday_hours * 3600)::integer) loop
    select first_name || ' ' || last_name into name_ from public.people where id = w.person_id;
    if public._time_alert(p_company, 'open_workday', 'open_workday:' || w.id, w.person_id, w.id, null, null,
                          'Still clocked in: ' || coalesce(name_, 'an employee'),
                          'Clocked in more than ' || st.open_workday_hours || ' hours ago with no clock-out. Needs review.') then
      perform public._time_notify_staff(p_company, 'time_unusual', 'Needs review: still clocked in', coalesce(name_, 'An employee') || ' has been clocked in for over ' || st.open_workday_hours || ' hours.', 'time_workday', w.id);
      n := n + 1;
    end if;
  end loop;

  -- Property visits that run unusually long, or past the owner's target.
  for v in select tv.*, (extract(epoch from (coalesce(tv.ended_at, now()) - tv.started_at)) / 60.0) as mins_
             from public.time_visits tv where tv.company_id = p_company and tv.status <> 'void' and tv.started_at is not null
              and tv.visit_date >= current_date - 1 loop
    if v.mins_ > st.long_visit_hours * 60 then
      if public._time_alert(p_company, 'long_visit', 'long_visit:' || v.id, null, null, v.id, null,
                            'Unusually long visit: ' || coalesce(v.label, 'a property'),
                            'This visit has run longer than ' || st.long_visit_hours || ' hours. Needs review.') then
        perform public._time_notify_staff(p_company, 'time_unusual', 'Unusual duration: ' || coalesce(v.label, 'a property'), 'Longer than ' || st.long_visit_hours || ' hours.', 'time_visit', v.id);
        n := n + 1;
      end if;
    end if;
    if st.target_alerts_enabled and v.status = 'in_progress' and v.target_minutes is not null and v.mins_ > v.target_minutes then
      if public._time_alert(p_company, 'over_target', 'over_target:' || v.id, null, null, v.id, null,
                            'Over target: ' || coalesce(v.label, 'a property'),
                            'Past the ' || v.target_minutes || '-minute target.') then
        perform public._time_notify_staff(p_company, 'time_over_target', 'Over target: ' || coalesce(v.label, 'a property'), 'This visit passed its ' || v.target_minutes || '-minute target.', 'time_visit', v.id);
        if st.target_notify_crew then
          -- A neutral prompt only: no target, average or estimate is shown to the crew.
          for crew in select distinct person_id from public.time_intervals where visit_id = v.id and ended_at is null and status = 'active' loop
            insert into public.app_notifications (company_id, recipient_id, event_type, title, body, linked_entity_type, linked_entity_id)
            values (p_company, crew.person_id, 'time_progress_check', 'Check your progress', 'Take a moment to check how the work at ' || coalesce(v.label, 'this property') || ' is going.', 'time_visit', v.id::text);
          end loop;
        end if;
        n := n + 1;
      end if;
    end if;
  end loop;

  -- Daily overtime alerts (the owner's per-employee alert hours; not the formal overtime rule). One total per person per date, across every
  -- session of that date. The alert is filed under the person's FIRST session of the date, so a one-session day keeps its existing key.
  if st.overtime_alerts_enabled then
    for w in select (array_agg(ws.id order by ws.clock_in_at))[1] as id, ws.person_id, ps.daily_alert_hours,
                    sum(public._time_net_ms(ws.id)) as ms
               from public.time_workdays ws join public.time_person_settings ps on ps.person_id = ws.person_id and ps.company_id = ws.company_id
              where ws.company_id = p_company and ps.daily_alert_hours is not null and ws.work_date >= current_date - 1
              group by ws.person_id, ws.work_date, ps.daily_alert_hours loop
      hrs := w.ms / 3600000.0;
      thr := w.daily_alert_hours;
      select first_name || ' ' || last_name into name_ from public.people where id = w.person_id;
      if hrs >= thr then
        if public._time_alert(p_company, 'overtime_reached', 'ot_reached:' || w.id, w.person_id, w.id, null, null,
                              'Daily alert hours reached: ' || coalesce(name_, 'an employee'), round(hrs, 2) || ' payable hours against ' || thr || '.') then
          perform public._time_notify_staff(p_company, 'time_overtime', 'Daily alert hours reached', coalesce(name_, 'An employee') || ' has reached ' || thr || ' hours today.', 'time_workday', w.id);
          n := n + 1;
        end if;
      elsif hrs >= thr * st.approach_percent / 100.0 then
        if public._time_alert(p_company, 'overtime_approaching', 'ot_approach:' || w.id, w.person_id, w.id, null, null,
                              'Approaching daily alert hours: ' || coalesce(name_, 'an employee'), round(hrs, 2) || ' of ' || thr || ' payable hours.') then
          perform public._time_notify_staff(p_company, 'time_overtime', 'Approaching daily alert hours', coalesce(name_, 'An employee') || ' is at ' || round(hrs, 1) || ' of ' || thr || ' hours.', 'time_workday', w.id);
          n := n + 1;
        end if;
      end if;
    end loop;
  end if;
  return n;
end;
$$;
revoke all on function public._time_scan(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
