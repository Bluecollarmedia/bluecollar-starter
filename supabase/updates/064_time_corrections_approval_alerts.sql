-- ============================================================================
-- Update 64 — run once in Supabase → SQL Editor (safe to run again). Run it AFTER 063.
--
-- Time tracking, part 2: owner corrections with a full history, daily payroll approval, pay-rate changes that never rewrite
-- the past, and alerts (over target, daily overtime, forgotten clock-out, unusually long visit, skip requests).
--
--  • Every owner correction needs a reason and is written to time_audit with the old and new value, who and when. The original
--    time is never lost. Changing a day that was already approved reopens it ("needs approval again").
--  • time_approve_workday signs a clocked-out day off for payroll and locks it; time_reopen_workday opens it again.
--  • time_set_hourly_rate adds a NEW effective-dated rate (the old one is ended, not edited), so costs already recorded keep the
--    rate that applied to them.
--  • Alerts are saved once (a unique key per event) so the same thing never alerts twice. There is no background scheduler in
--    this app: alerts are worked out when a worker acts or has the app open, and when the owner opens Hours & Labor.
-- ============================================================================

create table if not exists public.time_alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('open_workday', 'long_visit', 'over_target', 'overtime_approaching', 'overtime_reached', 'skip_request', 'needs_review')),
  person_id uuid references public.people(id) on delete set null,
  workday_id uuid references public.time_workdays(id) on delete cascade,
  visit_id uuid references public.time_visits(id) on delete cascade,
  skip_request_id uuid references public.time_skip_requests(id) on delete cascade,
  title text not null,
  detail text not null default '',
  dedupe_key text not null unique,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by uuid references public.people(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_time_alerts_company on public.time_alerts (company_id, status, created_at desc);
alter table public.time_alerts enable row level security;
drop policy if exists time_alerts_staff_select on public.time_alerts;
create policy time_alerts_staff_select on public.time_alerts for select using (public.is_staff(company_id));
-- Read-only for the app roles: alerts are created and closed only by the functions below.
revoke insert, update, delete, truncate on public.time_alerts from anon, authenticated;
revoke all on public.time_alerts from anon;

-- ── Small helpers ───────────────────────────────────────────────────────────
-- Paid-time rule: gross elapsed minus UNPAID breaks (paid breaks are not deducted). Milliseconds.
create or replace function public._time_net_ms(p_workday uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select (extract(epoch from (coalesce(w.clock_out_at, now()) - w.clock_in_at)) * 1000)::bigint
         - coalesce((select sum(extract(epoch from (coalesce(b.ended_at, now()) - b.started_at)) * 1000)::bigint
                     from public.time_breaks b where b.workday_id = w.id and not b.paid), 0)
  from public.time_workdays w where w.id = p_workday
$$;
revoke all on function public._time_net_ms(uuid) from public, anon, authenticated;

create or replace function public._time_need_staff(p_company uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_company is null or not public.is_staff(p_company) then raise exception 'Only the owner can do that.'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Enter a reason for this change.'; end if;
end;
$$;
revoke all on function public._time_need_staff(uuid, text) from public, anon, authenticated;

create or replace function public._time_no_future(p_at timestamptz)
returns void language plpgsql as $$
begin
  if p_at is not null and p_at > now() + interval '1 minute' then raise exception 'That time is in the future.'; end if;
end;
$$;

revoke all on function public._time_no_future(timestamptz) from public, anon, authenticated;

-- A typo guard for the owner's corrections: a workday is at most 24 hours long and sits on (about) the date it is filed under.
-- (The employee's own clock-out is never refused for being long: the server's times are the truth, and the owner then corrects them.)
create or replace function public._time_sane_workday(p_work_date date, p_in timestamptz, p_out timestamptz)
returns void language plpgsql immutable as $$
begin
  if p_out is not null and p_out - p_in > interval '24 hours' then
    raise exception 'A workday can''t be longer than 24 hours. Check the clock-in and clock-out times.';
  end if;
  if abs((p_in at time zone 'UTC')::date - p_work_date) > 1 then
    raise exception 'That clock-in is not on the workday''s date (%). Check the date and the time.', p_work_date;
  end if;
end;
$$;
revoke all on function public._time_sane_workday(date, timestamptz, timestamptz) from public, anon, authenticated;

-- Tells the owners/admins (an in-app notification; push goes out through the existing notification trigger).
create or replace function public._time_notify_staff(p_company uuid, p_event text, p_title text, p_body text, p_type text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.app_notifications (company_id, recipient_id, event_type, title, body, linked_entity_type, linked_entity_id)
  select p_company, m.person_id, p_event, p_title, p_body, p_type, p_id::text
  from public.company_members m where m.company_id = p_company and m.role in ('owner', 'admin') and m.status = 'active';
end;
$$;
revoke all on function public._time_notify_staff(uuid, text, text, text, text, uuid) from public, anon, authenticated;

-- Saves an alert once. Returns true only the first time (so the notification goes out once).
create or replace function public._time_alert(p_company uuid, p_kind text, p_key text, p_person uuid, p_workday uuid, p_visit uuid, p_skip uuid, p_title text, p_detail text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.time_alerts (company_id, kind, person_id, workday_id, visit_id, skip_request_id, title, detail, dedupe_key)
  values (p_company, p_kind, p_person, p_workday, p_visit, p_skip, p_title, p_detail, p_key)
  on conflict (dedupe_key) do nothing;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke all on function public._time_alert(uuid, text, text, uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;

-- ── Looking for things that need attention ──────────────────────────────────
create or replace function public._time_scan(p_company uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  st public.time_settings := public._time_settings_row(p_company);
  w record; v record; n integer := 0; name_ text; hrs numeric; thr numeric; mins integer; crew record;
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

  -- Daily overtime alerts (the owner's per-employee alert hours; not the formal overtime rule).
  if st.overtime_alerts_enabled then
    for w in select ws.*, ps.daily_alert_hours from public.time_workdays ws join public.time_person_settings ps on ps.person_id = ws.person_id and ps.company_id = ws.company_id
              where ws.company_id = p_company and ps.daily_alert_hours is not null and ws.work_date >= current_date - 1 loop
      hrs := public._time_net_ms(w.id) / 3600000.0;
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

-- The owner's screens call this when opened (and a worker's phone calls it through time_my_day while it is in use).
create or replace function public.time_scan_alerts()
returns integer language plpgsql security definer set search_path = public as $$
declare cid uuid := public._time_company(public.my_person_id());
begin
  if cid is null or not public.is_staff(cid) then raise exception 'Only the owner can do that.'; end if;
  return public._time_scan(cid);
end;
$$;

-- time_my_day now also looks for alerts for the company (it only reads for the worker; nothing owner-only is returned).
create or replace function public.time_my_day(p_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_person_id(); cid uuid;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  if cid is null then raise exception 'You are not on a team yet.'; end if;
  perform public._time_scan(cid);
  return public._time_day_json(me, cid, coalesce(p_date, current_date));
end;
$$;

create or replace function public.time_alert_resolve(p_alert uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.time_alerts;
begin
  select * into a from public.time_alerts where id = p_alert;
  if not found or not public.is_staff(a.company_id) then raise exception 'Alert not found.'; end if;
  update public.time_alerts set status = 'resolved', resolved_by = public.my_person_id(), resolved_at = now() where id = p_alert;
end;
$$;

-- A worker's skip request tells the owner (once).
create or replace function public._time_skip_requested()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text; what text;
begin
  select first_name || ' ' || last_name into who from public.people where id = new.requested_by;
  select coalesce((select p.name from public.maintenance_stops s join public.maintenance_properties p on p.id = s.property_id where s.id = new.maintenance_stop_id),
                  (select pr.name from public.assignments a join public.projects pr on pr.id = a.project_id where a.id = new.assignment_id), 'a property') into what;
  if public._time_alert(new.company_id, 'skip_request', 'skip:' || new.id, new.requested_by, null, null, new.id, 'Skip requested: ' || what, coalesce(who, 'A worker') || ': ' || new.reason) then
    perform public._time_notify_staff(new.company_id, 'time_skip_request', 'Skip requested: ' || what, coalesce(who, 'A worker') || ': ' || new.reason, 'time_skip', new.id);
  end if;
  return null;
end;
$$;
revoke all on function public._time_skip_requested() from public, anon, authenticated;
drop trigger if exists time_skip_requests_notify on public.time_skip_requests;
create trigger time_skip_requests_notify after insert on public.time_skip_requests
  for each row execute function public._time_skip_requested();

-- A closed skip request resolves its alert.
create or replace function public._time_skip_decided()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'pending' and old.status = 'pending' then
    update public.time_alerts set status = 'resolved', resolved_at = now(), resolved_by = new.decided_by where skip_request_id = new.id and status = 'open';
  end if;
  return null;
end;
$$;
revoke all on function public._time_skip_decided() from public, anon, authenticated;
drop trigger if exists time_skip_requests_decided on public.time_skip_requests;
create trigger time_skip_requests_decided after update on public.time_skip_requests
  for each row execute function public._time_skip_decided();

-- ── Owner corrections (each one needs a reason and is written to the history) ───
-- Changing an approved day reopens it so it has to be approved again.
create or replace function public._time_touch_approval(p_workday uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare was boolean;
begin
  select status = 'approved' into was from public.time_workdays where id = p_workday;
  if coalesce(was, false) then update public.time_workdays set status = 'reopened' where id = p_workday; end if;
  return coalesce(was, false);
end;
$$;
revoke all on function public._time_touch_approval(uuid) from public, anon, authenticated;

create or replace function public.time_staff_edit_workday(p_workday uuid, p_clock_in timestamptz default null, p_clock_out timestamptz default null, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare w public.time_workdays; was boolean; new_in timestamptz; new_out timestamptz;
begin
  select * into w from public.time_workdays where id = p_workday for update;
  if not found then raise exception 'Workday not found.'; end if;
  perform public._time_need_staff(w.company_id, p_reason);
  new_in := coalesce(p_clock_in, w.clock_in_at);
  new_out := coalesce(p_clock_out, w.clock_out_at);
  if new_in is not distinct from w.clock_in_at and new_out is not distinct from w.clock_out_at then return; end if;  -- nothing changed: no reopen, no history row
  perform public._time_no_future(new_in); perform public._time_no_future(new_out);
  perform public._time_sane_workday(w.work_date, new_in, new_out);
  if p_clock_out is not null and w.clock_out_at is null then
    if exists (select 1 from public.time_intervals where workday_id = w.id and ended_at is null and status = 'active') then
      raise exception 'A property visit is still running. Stop its timer first, then set the clock-out.';
    end if;
    if exists (select 1 from public.time_breaks where workday_id = w.id and ended_at is null) then
      raise exception 'A break is still running. End it first, then set the clock-out.';
    end if;
  end if;
  was := (w.status = 'approved');
  update public.time_workdays
     set clock_in_at = new_in, clock_out_at = new_out,
         status = case when w.status = 'approved' then 'reopened' when new_out is not null and w.status = 'active' then 'closed' else w.status end
   where id = w.id;
  if new_in is distinct from w.clock_in_at then
    perform public._time_audit(w.company_id, 'workday', w.id, w.person_id, w.id, null, 'corrected', 'clock_in_at', to_jsonb(w.clock_in_at), to_jsonb(new_in), p_reason, was);
  end if;
  if new_out is distinct from w.clock_out_at then
    perform public._time_audit(w.company_id, 'workday', w.id, w.person_id, w.id, null, case when w.clock_out_at is null then 'clock_out_set' else 'corrected' end, 'clock_out_at', to_jsonb(w.clock_out_at), to_jsonb(new_out), p_reason, was);
  end if;
end;
$$;

-- A missing workday (the employee forgot to clock in at all).
create or replace function public.time_staff_add_workday(p_person uuid, p_work_date date, p_clock_in timestamptz, p_clock_out timestamptz, p_reason text, p_truck uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid := public._time_company(p_person); wid uuid;
begin
  perform public._time_need_staff(cid, p_reason);
  if p_clock_in is null or p_work_date is null then raise exception 'Enter the date and the clock-in time.'; end if;
  perform public._time_no_future(p_clock_in); perform public._time_no_future(p_clock_out);
  perform public._time_sane_workday(p_work_date, p_clock_in, p_clock_out);
  insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, clock_out_at, status, truck_id, truck_source)
  values (cid, p_person, p_work_date, p_clock_in, p_clock_out, case when p_clock_out is null then 'active' else 'closed' end, p_truck, case when p_truck is null then null else 'owner' end)
  returning id into wid;
  insert into public.time_workday_rates (workday_id, company_id, hourly_rate) values (wid, cid, public._time_rate(cid, p_person, p_work_date));
  perform public._time_audit(cid, 'workday', wid, p_person, wid, null, 'added', null, null, jsonb_build_object('clock_in_at', p_clock_in, 'clock_out_at', p_clock_out), p_reason, false);
  return wid;
end;
$$;

create or replace function public.time_staff_edit_break(p_break uuid, p_started timestamptz default null, p_ended timestamptz default null, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare b public.time_breaks; was boolean;
begin
  select * into b from public.time_breaks where id = p_break for update;
  if not found then raise exception 'Break not found.'; end if;
  perform public._time_need_staff(b.company_id, p_reason);
  perform public._time_no_future(p_started); perform public._time_no_future(p_ended);
  if coalesce(p_started, b.started_at) = b.started_at and coalesce(p_ended, b.ended_at) is not distinct from b.ended_at then return; end if;  -- nothing changed
  was := public._time_touch_approval(b.workday_id);
  update public.time_breaks set started_at = coalesce(p_started, started_at), ended_at = coalesce(p_ended, ended_at) where id = b.id;
  perform public._time_audit(b.company_id, 'break', b.id, b.person_id, b.workday_id, null, 'corrected', 'break',
                             jsonb_build_object('started_at', b.started_at, 'ended_at', b.ended_at), jsonb_build_object('started_at', coalesce(p_started, b.started_at), 'ended_at', coalesce(p_ended, b.ended_at)), p_reason, was);
end;
$$;

create or replace function public.time_staff_add_break(p_workday uuid, p_started timestamptz, p_ended timestamptz, p_paid boolean, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare w public.time_workdays; bid uuid; was boolean;
begin
  select * into w from public.time_workdays where id = p_workday for update;
  if not found then raise exception 'Workday not found.'; end if;
  perform public._time_need_staff(w.company_id, p_reason);
  perform public._time_no_future(p_started); perform public._time_no_future(p_ended);
  was := public._time_touch_approval(w.id);
  insert into public.time_breaks (company_id, workday_id, person_id, started_at, ended_at, paid)
  values (w.company_id, w.id, w.person_id, p_started, p_ended, coalesce(p_paid, true)) returning id into bid;
  perform public._time_audit(w.company_id, 'break', bid, w.person_id, w.id, null, 'added', null, null, jsonb_build_object('started_at', p_started, 'ended_at', p_ended, 'paid', p_paid), p_reason, was);
  return bid;
end;
$$;

-- Fix a property timer: change its start/end, or end one that was left running ("stop the timer").
create or replace function public.time_staff_edit_interval(p_interval uuid, p_started timestamptz default null, p_ended timestamptz default null, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare i public.time_intervals; was boolean; new_s timestamptz; new_e timestamptz;
begin
  select * into i from public.time_intervals where id = p_interval for update;
  if not found then raise exception 'Property visit time not found.'; end if;
  perform public._time_need_staff(i.company_id, p_reason);
  if i.status = 'void' then raise exception 'That time was removed. Add a new property time instead.'; end if;
  new_s := coalesce(p_started, i.started_at); new_e := coalesce(p_ended, i.ended_at);
  if new_s = i.started_at and new_e is not distinct from i.ended_at then return; end if;  -- nothing changed
  perform public._time_no_future(new_s); perform public._time_no_future(new_e);
  was := public._time_touch_approval(i.workday_id);
  update public.time_intervals set started_at = new_s, ended_at = new_e where id = i.id;
  if i.legacy_session_id is not null then
    update public.work_sessions set check_in_time = new_s, check_out_time = new_e,
           duration_minutes = case when new_e is null then null else round(extract(epoch from (new_e - new_s)) / 60.0, 2) end,
           status = case when new_e is null then status else 'corrected' end
     where id = i.legacy_session_id;
  end if;
  perform public._time_refresh_visit(i.visit_id);
  if new_s is distinct from i.started_at then
    perform public._time_audit(i.company_id, 'interval', i.id, i.person_id, i.workday_id, i.visit_id, 'corrected', 'started_at', to_jsonb(i.started_at), to_jsonb(new_s), p_reason, was);
  end if;
  if new_e is distinct from i.ended_at then
    perform public._time_audit(i.company_id, 'interval', i.id, i.person_id, i.workday_id, i.visit_id, case when i.ended_at is null then 'timer_stopped' else 'corrected' end, 'ended_at', to_jsonb(i.ended_at), to_jsonb(new_e), p_reason, was);
  end if;
end;
$$;

-- Add an employee's time at a visit by hand (start, or start and end).
create or replace function public.time_staff_add_interval(p_visit uuid, p_person uuid, p_started timestamptz, p_ended timestamptz, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v public.time_visits; w public.time_workdays; iid uuid; was boolean;
begin
  select * into v from public.time_visits where id = p_visit;
  if not found then raise exception 'Visit not found.'; end if;
  perform public._time_need_staff(v.company_id, p_reason);
  perform public._time_no_future(p_started); perform public._time_no_future(p_ended);
  select * into w from public.time_workdays where person_id = p_person and company_id = v.company_id
     and clock_in_at <= p_started and (clock_out_at is null or clock_out_at >= coalesce(p_ended, p_started)) order by clock_in_at desc limit 1;
  if not found then raise exception 'That employee has no workday covering those times. Add or correct the workday first.'; end if;
  was := public._time_touch_approval(w.id);
  insert into public.time_intervals (company_id, visit_id, workday_id, person_id, started_at, ended_at, billable)
  values (v.company_id, v.id, w.id, p_person, p_started, p_ended, v.billable) returning id into iid;
  insert into public.time_interval_rates (interval_id, company_id, hourly_rate) values (iid, v.company_id, public._time_rate(v.company_id, p_person, w.work_date));
  perform public._time_refresh_visit(v.id);
  perform public._time_audit(v.company_id, 'interval', iid, p_person, w.id, v.id, 'added', null, null, jsonb_build_object('started_at', p_started, 'ended_at', p_ended), p_reason, was);
  return iid;
end;
$$;

create or replace function public.time_staff_void_interval(p_interval uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare i public.time_intervals; was boolean;
begin
  select * into i from public.time_intervals where id = p_interval for update;
  if not found then raise exception 'Property visit time not found.'; end if;
  perform public._time_need_staff(i.company_id, p_reason);
  if i.status = 'void' then return; end if;  -- already removed: a repeat changes nothing and adds no history row
  was := public._time_touch_approval(i.workday_id);
  update public.time_intervals set status = 'void' where id = i.id;
  -- The older Hours / Payroll Estimate read the work session written alongside this time. Zero it (nothing is deleted: the original
  -- times are kept in the session's correction note and in the history) so the two systems agree.
  if i.legacy_session_id is not null then
    update public.work_sessions
       set correction = coalesce(correction, '{}'::jsonb) || jsonb_build_object('voided_by_time_tracking', true, 'original_check_in', check_in_time,
                          'original_check_out', check_out_time, 'original_duration_minutes', duration_minutes, 'reason', p_reason),
           check_out_time = check_in_time, duration_minutes = 0, status = 'corrected'
     where id = i.legacy_session_id;
  end if;
  perform public._time_refresh_visit(i.visit_id);
  perform public._time_audit(i.company_id, 'interval', i.id, i.person_id, i.workday_id, i.visit_id, 'voided', 'status', to_jsonb(i.status), to_jsonb('void'::text), p_reason, was);
end;
$$;

create or replace function public.time_set_visit_billable(p_visit uuid, p_billable boolean, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.time_visits;
begin
  select * into v from public.time_visits where id = p_visit for update;
  if not found then raise exception 'Visit not found.'; end if;
  perform public._time_need_staff(v.company_id, p_reason);
  if v.billable = p_billable then return; end if;
  update public.time_visits set billable = p_billable where id = v.id;
  update public.time_intervals set billable = p_billable where visit_id = v.id and status <> 'void';
  perform public._time_audit(v.company_id, 'visit', v.id, null, null, v.id, 'billable_changed', 'billable', to_jsonb(v.billable), to_jsonb(p_billable), p_reason, false);
end;
$$;

-- ── Daily approval ──────────────────────────────────────────────────────────
create or replace function public.time_approve_workday(p_workday uuid)
returns void language plpgsql security definer set search_path = public as $$
declare w public.time_workdays; me uuid := public.my_person_id();
begin
  select * into w from public.time_workdays where id = p_workday for update;
  if not found or not public.is_staff(w.company_id) then raise exception 'Workday not found.'; end if;
  if w.status = 'approved' then return; end if;  -- already approved: a double tap changes nothing
  if w.clock_out_at is null then raise exception 'This day has no clock-out yet. Set the clock-out (or have the employee clock out) before approving.'; end if;
  if exists (select 1 from public.time_intervals where workday_id = w.id and ended_at is null and status = 'active') then
    raise exception 'A property visit is still running. Stop its timer before approving.';
  end if;
  if exists (select 1 from public.time_breaks where workday_id = w.id and ended_at is null) then
    raise exception 'A break is still running. End it before approving.';
  end if;
  update public.time_workdays set status = 'approved', approved_by = me, approved_at = now(), approval_version = approval_version + 1 where id = w.id;
  perform public._time_audit(w.company_id, 'workday', w.id, w.person_id, w.id, null, 'approved', 'status', to_jsonb(w.status), to_jsonb('approved'::text), null, false);
end;
$$;

create or replace function public.time_reopen_workday(p_workday uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare w public.time_workdays;
begin
  select * into w from public.time_workdays where id = p_workday for update;
  if not found then raise exception 'Workday not found.'; end if;
  perform public._time_need_staff(w.company_id, p_reason);
  if w.status <> 'approved' then return; end if;
  update public.time_workdays set status = 'reopened' where id = w.id;
  perform public._time_audit(w.company_id, 'workday', w.id, w.person_id, w.id, null, 'reopened', 'status', to_jsonb(w.status), to_jsonb('reopened'::text), p_reason, true);
end;
$$;

-- ── Pay rates: a new effective-dated rate; the old one is ended, never edited ───
create or replace function public.time_set_hourly_rate(p_person uuid, p_rate numeric, p_effective date, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid := public._time_company(p_person); latest date; prev numeric; n_days integer; n_visits integer;
begin
  if cid is null or not public.is_staff(cid) then raise exception 'Only the owner can do that.'; end if;
  if p_rate is null or p_rate <= 0 or p_rate > 1000 then raise exception 'Enter an hourly rate above zero.'; end if;
  if p_effective is null then raise exception 'Enter the date the new rate starts.'; end if;
  select max(effective_date) into latest from public.worker_hourly_rates where company_id = cid and person_id = p_person;
  if latest is not null and p_effective <= latest then
    raise exception 'The new rate has to start after the current rate''s start date (%).', latest;
  end if;
  select hourly_rate into prev from public.worker_hourly_rates where company_id = cid and person_id = p_person and end_date is null order by effective_date desc limit 1;
  update public.worker_hourly_rates set end_date = p_effective - 1 where company_id = cid and person_id = p_person and end_date is null;
  insert into public.worker_hourly_rates (company_id, person_id, hourly_rate, effective_date, set_by) values (cid, p_person, p_rate, p_effective, public.my_person_id());
  perform public._time_audit(cid, 'rate', null, p_person, null, null, 'rate_set', 'hourly_rate', to_jsonb(prev), to_jsonb(p_rate), p_reason, false);

  -- Time recorded while the person had NO rate has a blank rate saved with it (the cost showed as "no rate"). Fill only those
  -- blanks, from this rate's start date, and never on a day already approved. A rate that was saved is never changed.
  update public.time_workday_rates r set hourly_rate = p_rate
    from public.time_workdays w
   where r.workday_id = w.id and r.hourly_rate is null and w.person_id = p_person and w.company_id = cid
     and w.work_date >= p_effective and w.status <> 'approved';
  get diagnostics n_days = row_count;
  update public.time_interval_rates r set hourly_rate = p_rate
    from public.time_intervals i join public.time_workdays w on w.id = i.workday_id
   where r.interval_id = i.id and r.hourly_rate is null and i.person_id = p_person and i.company_id = cid
     and w.work_date >= p_effective and w.status <> 'approved';
  get diagnostics n_visits = row_count;
  if n_days + n_visits > 0 then
    perform public._time_audit(cid, 'rate', null, p_person, null, null, 'rate_filled', 'hourly_rate', null,
                               jsonb_build_object('rate', p_rate, 'workdays', n_days, 'property_times', n_visits), 'Filled in the blank rate on time recorded before a rate was set', false);
  end if;
end;
$$;

-- ── Settings and target changes are written to the history too ──────────────
create or replace function public._time_settings_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'time_settings' then
    perform public._time_audit(new.company_id, 'settings', null, null, null, null, case when tg_op = 'INSERT' then 'settings_created' else 'settings_changed' end, 'time_settings',
                               case when tg_op = 'INSERT' then null else to_jsonb(old) - 'updated_at' - 'updated_by' end, to_jsonb(new) - 'updated_at' - 'updated_by', null, false);
  else
    perform public._time_audit(new.company_id, 'target', new.id, null, null, null, case when tg_op = 'INSERT' then 'target_set' else 'target_changed' end, 'target_minutes',
                               case when tg_op = 'INSERT' then null else to_jsonb(old.target_minutes) end, to_jsonb(new.target_minutes), null, false);
  end if;
  return null;
end;
$$;
revoke all on function public._time_settings_audit() from public, anon, authenticated;
drop trigger if exists time_settings_audit on public.time_settings;
create trigger time_settings_audit after insert or update on public.time_settings for each row execute function public._time_settings_audit();
drop trigger if exists time_targets_audit on public.time_property_targets;
create trigger time_targets_audit after insert or update on public.time_property_targets for each row execute function public._time_settings_audit();

-- ── Who may call what ───────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'time_scan_alerts()', 'time_my_day(date)', 'time_alert_resolve(uuid, text)',
    'time_staff_edit_workday(uuid, timestamptz, timestamptz, text)', 'time_staff_add_workday(uuid, date, timestamptz, timestamptz, text, uuid)',
    'time_staff_edit_break(uuid, timestamptz, timestamptz, text)', 'time_staff_add_break(uuid, timestamptz, timestamptz, boolean, text)',
    'time_staff_edit_interval(uuid, timestamptz, timestamptz, text)', 'time_staff_add_interval(uuid, uuid, timestamptz, timestamptz, text)',
    'time_staff_void_interval(uuid, text)', 'time_set_visit_billable(uuid, boolean, text)',
    'time_approve_workday(uuid)', 'time_reopen_workday(uuid, text)', 'time_set_hourly_rate(uuid, numeric, date, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
