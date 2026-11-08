-- ============================================================================
-- Update 100 — run once in Supabase → SQL Editor, AFTER 099. NOT run yet; read it first. Safe to run again.
--
-- A workday nobody clocked out of ends at MIDNIGHT (the company's local midnight, Eastern time unless changed), not 14 hours later.
--   * Same rule as update 90, which is how Jobber works too: the day is closed at ZERO length and counts for NO hours until the owner accepts
--     an end time. The database suggests one (update 98: the last finished stop, visit or break) and the owner accepts it in one tap.
--   * It is done the next time anyone looks (the worker opens the app, the owner opens their screens or the Needs your OK card). Until then
--     nothing is paid for it either way: the owner's "Needs your OK" list flags every such day first.
--   * The 14-hour rule stays as a second safety net.
--   * A day started today is never touched. A person on a property timer or a break at midnight is handled by the same placeholder close as before.
-- Adds one setting: time_settings.timezone (default America/New_York).
-- ============================================================================

alter table public.time_settings add column if not exists timezone text not null default 'America/New_York';

create or replace function public._time_tz(p_company uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select s.timezone from public.time_settings s where s.company_id = p_company), 'America/New_York')
$$;
revoke all on function public._time_tz(uuid) from public, anon, authenticated;

-- Did this clock-in happen on an earlier LOCAL date than today?
create or replace function public._time_past_midnight(p_clock_in timestamptz, p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (p_clock_in at time zone public._time_tz(p_company))::date < (now() at time zone public._time_tz(p_company))::date
$$;
revoke all on function public._time_past_midnight(timestamptz, uuid) from public, anon, authenticated;

-- Flags this person's stale or past-midnight open workday (if any). Returns how many were flagged. Never closes with a real-looking time.
create or replace function public._time_flag_stale(p_person uuid, p_company uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  st public.time_settings := public._time_settings_row(p_company);
  w public.time_workdays;
  n integer := 0;
  i record;
  b record;
  who text;
  why text;
begin
  for w in
    select * from public.time_workdays
     where person_id = p_person and company_id = p_company and clock_out_at is null and status <> 'needs_review'
       and (clock_in_at < now() - make_interval(secs => (st.open_workday_hours * 3600)::integer)
            or public._time_past_midnight(clock_in_at, p_company))
     for update
  loop
    why := 'No clock-out was recorded by midnight. Counts as zero hours until the real end time is set.';
    for i in select * from public.time_intervals where workday_id = w.id and ended_at is null and status = 'active' for update loop
      update public.time_intervals set ended_at = i.started_at where id = i.id;
      if i.legacy_session_id is not null then
        update public.work_sessions set check_out_time = i.started_at, duration_minutes = 0, status = 'corrected' where id = i.legacy_session_id;
      end if;
      perform public._time_refresh_visit(i.visit_id);
      perform public._time_audit(w.company_id, 'interval', i.id, w.person_id, w.id, i.visit_id, 'flagged', 'ended_at', null, to_jsonb(i.started_at),
                                 'Never stopped. Closed at zero length until the owner decides the real time.', false);
    end loop;
    for b in select * from public.time_breaks where workday_id = w.id and ended_at is null loop
      update public.time_breaks set ended_at = b.started_at where id = b.id;
    end loop;
    perform set_config('brighton.time_flagging', 'on', true);
    update public.time_workdays
       set clock_out_at = clock_in_at, status = 'needs_review', flagged_at = now(), flagged_reason = why
     where id = w.id;
    perform set_config('brighton.time_flagging', '', true);
    perform public._time_audit(w.company_id, 'workday', w.id, w.person_id, w.id, null, 'flagged', 'status', to_jsonb(w.status), to_jsonb('needs_review'::text), why, false);
    select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) into who from public.people where id = p_person;
    perform public._time_notify_staff(p_company, 'time_unusual', 'Needs your OK: no clock-out',
      coalesce(nullif(who, ''), 'An employee') || ' never clocked out of the workday that started ' || to_char(w.clock_in_at at time zone public._time_tz(p_company), 'Mon DD HH12:MI AM')
        || '. It counts as zero hours until you accept an end time.',
      'time_workday', w.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public._time_flag_stale(uuid, uuid) from public, anon, authenticated;

-- Everyone in the company at once (the owner's screens call this before reading).
create or replace function public._time_flag_company(p_company uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select distinct person_id from public.time_workdays where company_id = p_company and clock_out_at is null and status <> 'needs_review' loop
    n := n + public._time_flag_stale(r.person_id, p_company);
  end loop;
  return n;
end;
$$;
revoke all on function public._time_flag_company(uuid) from public, anon, authenticated;

create or replace function public.time_scan_alerts()
returns integer language plpgsql security definer set search_path = public as $$
declare cid uuid := public._time_company(public.my_person_id());
begin
  if cid is null or not public.is_staff(cid) then raise exception 'Only the owner can do that.'; end if;
  perform public._time_flag_company(cid);
  return public._time_scan(cid);
end;
$$;

-- The "Needs your OK" list flags first, so a forgotten day shows up even if the worker never opened the app again.
create or replace function public.time_review_list()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_person_id(); cid uuid;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  if cid is null or not public.is_staff(cid) then raise exception 'Only the owner can do that.'; end if;
  perform public._time_flag_company(cid);
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

-- The automatic close at the last stop never closes a day that is already past midnight (that one goes through the review rule).
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
  if w.clock_in_at < now() - make_interval(secs => (st.open_workday_hours * 3600)::integer) then return false; end if;
  if public._time_past_midnight(w.clock_in_at, w.company_id) then return false; end if;
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

notify pgrst, 'reload schema';
