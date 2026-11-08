-- ============================================================================
-- Update 108 — run once in Supabase → SQL Editor, AFTER 107. Safe to run again.
--
-- Clocking out for the day ends whatever the worker is still on. A worker who finishes a project has NOT finished their day: they clock out
-- on the Clock tab, back at the yard. Until now the clock-out refused with "Complete that property first" (or "End your break first").
-- Now the clock-out just works:
--   * A project the worker is still on is completed (same records as tapping Complete project: a check-out, the session closed, the
--     assignment marked completed).
--   * A maintenance route stop the worker is still on has its TIME ended at clock-out. The stop itself is left as it was, so it can still
--     be finished properly (its required tasks and photos are never skipped).
--   * A break that is still running ends.
-- Only this one function is replaced (the same name and arguments, so every grant stays); nothing else is touched.
-- ============================================================================

create or replace function public.time_clock_out(p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  cid uuid;
  w public.time_workdays;
  i public.time_intervals;
  v public.time_visits;
  a public.assignments;
  dur numeric;
  last_day date;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  perform public._time_flag_stale(me, cid);
  select * into w from public.time_workdays where person_id = me and clock_out_at is null for update;
  if not found then
    select work_date into last_day from public.time_workdays where person_id = me order by clock_in_at desc limit 1;
    return public._time_day_json(me, cid, coalesce(last_day, current_date)) || jsonb_build_object('already_closed', true);
  end if;

  -- A break still running ends now.
  update public.time_breaks set ended_at = now() where workday_id = w.id and ended_at is null;

  -- Whatever the worker is still on ends with the day.
  for i in select * from public.time_intervals where person_id = me and workday_id = w.id and ended_at is null and status = 'active' for update loop
    select * into v from public.time_visits where id = i.visit_id;
    if v.source = 'project_day' then
      select * into a from public.assignments where project_id = v.project_id and person_id = me and scheduled_date = v.visit_date
       order by (status in ('cancelled', 'reassigned')), created_at limit 1;
      if a.id is not null then
        insert into public.check_outs (company_id, assignment_id, person_id, project_id, gps) values (cid, a.id, me, v.project_id, null);
        update public.assignments set status = 'completed' where id = a.id and status not in ('cancelled', 'reassigned');
      end if;
      if i.legacy_session_id is not null then
        dur := round(extract(epoch from (now() - i.started_at)) / 60.0, 2);
        update public.work_sessions set check_out_time = now(), duration_minutes = dur, status = 'completed' where id = i.legacy_session_id;
      end if;
    end if;
    update public.time_intervals set ended_at = now() where id = i.id;
    perform public._time_refresh_visit(v.id);
  end loop;

  update public.time_workdays set clock_out_at = now(), status = 'closed' where id = w.id;
  return public._time_day_json(me, cid, w.work_date);
end;
$$;
revoke all on function public.time_clock_out(uuid) from public, anon;
grant execute on function public.time_clock_out(uuid) to authenticated;

notify pgrst, 'reload schema';
