-- ============================================================================
-- Update 90 — run once in Supabase → SQL Editor (safe to run again). NOT run yet; read it before running.
--
-- A clock session that was never closed must never get in the way of the next day, and must never be given an invented end time.
--
--   WORKDAY clock (landscaping + maintenance) and SNOW clock (snow shifts):
--   * A session that is still open after a long time (workdays: the owner's "open workday hours", default 14; snow shifts: 20 hours, because
--     storms run through the night) is STALE. The first time that person asks for their day, or clocks in or out, the database FLAGS it:
--       - status "needs_review" (snow: flagged_at), a note of why, and an entry in the audit log;
--       - it is closed at ZERO length (clock-out = clock-in) so it counts for NO hours until a person decides the real end time. The original
--         clock-in is untouched, nothing is deleted, and nothing is guessed: zero is a placeholder that can only under-pay, never over-pay.
--       - a property timer or a break that was still running inside it is stopped at its own start (zero length) for the same reason.
--     The person can then clock in for today at once. Today's session is a separate row, so hours can never be counted twice.
--   * The worker tells the owner when they really stopped (time_claim_stale_end / snow_claim_stale_end): the claim is only SAVED, bounded
--     between the clock-in and now. Hours stay at zero until the owner uses it (their existing edit / correction tools) or enters another time.
--   * The owner is told when a session is flagged (in-app notification, like every other time alert).
--   * An approved day can no longer be approved while it still says "needs review".
-- Nothing existing is deleted or rewritten except the placeholder close described above.
-- ============================================================================

-- ── 1. Workdays: the new state, the note, the worker's claim ────────────────────
alter table public.time_workdays drop constraint if exists time_workdays_status_check;
alter table public.time_workdays add constraint time_workdays_status_check
  check (status in ('active', 'closed', 'approved', 'reopened', 'needs_review'));
alter table public.time_workdays add column if not exists flagged_at timestamptz;
alter table public.time_workdays add column if not exists flagged_reason text;
alter table public.time_workdays add column if not exists claimed_out_at timestamptz;
alter table public.time_workdays add column if not exists claim_note text;
alter table public.time_workdays add column if not exists claimed_at timestamptz;

-- ── 2. Snow shifts: the same note and claim ─────────────────────────────────────
alter table public.snow_shifts add column if not exists flagged_at timestamptz;
alter table public.snow_shifts add column if not exists flagged_reason text;
alter table public.snow_shifts add column if not exists claimed_out_at timestamptz;
alter table public.snow_shifts add column if not exists claim_note text;
alter table public.snow_shifts add column if not exists claimed_at timestamptz;

-- ── 3. Flagging stale workdays ──────────────────────────────────────────────────
-- Update 63's integrity rule says everything recorded inside a day must fit inside it. The zero-length placeholder close is the one
-- deliberate exception (a property visit or break that really started after the clock-in stays where it is; the owner's later edit
-- of the end time brings them back inside). Only the flagging function below turns this on, and only for its own statement.
create or replace function public._time_check_workday()
returns trigger language plpgsql as $$
begin
  if new.clock_out_at is not null and new.clock_out_at < new.clock_in_at then
    raise exception 'The clock-out can''t be before the clock-in.';
  end if;
  if new.truck_id is not null and not exists (select 1 from public.trucks t where t.id = new.truck_id and t.company_id = new.company_id) then
    raise exception 'That truck belongs to another company.';
  end if;
  if not exists (select 1 from public.company_members m where m.company_id = new.company_id and m.person_id = new.person_id) then
    raise exception 'That person is not on this company''s team.';
  end if;
  if exists (
    select 1 from public.time_workdays o
    where o.person_id = new.person_id and o.id <> new.id
      and new.clock_in_at < coalesce(o.clock_out_at, 'infinity'::timestamptz)
      and coalesce(new.clock_out_at, 'infinity'::timestamptz) > o.clock_in_at
  ) then
    raise exception 'That overlaps another workday for the same person.';
  end if;
  -- Everything recorded inside the day must still fit inside it (except while a stale day is being flagged).
  if tg_op = 'UPDATE' and coalesce(current_setting('brighton.time_flagging', true), '') <> 'on'
     and (new.clock_in_at is distinct from old.clock_in_at or new.clock_out_at is distinct from old.clock_out_at) then
    if exists (select 1 from public.time_intervals i where i.workday_id = new.id and i.status <> 'void'
                 and (i.started_at < new.clock_in_at or (new.clock_out_at is not null and coalesce(i.ended_at, new.clock_out_at + interval '1 second') > new.clock_out_at))) then
      raise exception 'A property visit in this workday falls outside those times. Correct the visit first.';
    end if;
    if exists (select 1 from public.time_breaks b where b.workday_id = new.id
                 and (b.started_at < new.clock_in_at or (new.clock_out_at is not null and coalesce(b.ended_at, new.clock_out_at + interval '1 second') > new.clock_out_at))) then
      raise exception 'A break in this workday falls outside those times. Correct the break first.';
    end if;
  end if;
  return new;
end;
$$;

-- Flags this person's stale open workday (if any). Returns how many were flagged. Never closes with a real-looking time.
create or replace function public._time_flag_stale(p_person uuid, p_company uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  st public.time_settings := public._time_settings_row(p_company);
  w public.time_workdays;
  n integer := 0;
  i record;
  b record;
  who text;
begin
  for w in
    select * from public.time_workdays
     where person_id = p_person and company_id = p_company and clock_out_at is null and status <> 'needs_review'
       and clock_in_at < now() - make_interval(secs => (st.open_workday_hours * 3600)::integer)
     for update
  loop
    -- A property timer still running inside it stops at its own start (zero time), like the legacy record kept in step with it.
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
       set clock_out_at = clock_in_at, status = 'needs_review', flagged_at = now(),
           flagged_reason = 'No clock-out was recorded. Counts as zero hours until the real end time is set.'
     where id = w.id;
    perform set_config('brighton.time_flagging', '', true);
    perform public._time_audit(w.company_id, 'workday', w.id, w.person_id, w.id, null, 'flagged', 'status', to_jsonb(w.status), to_jsonb('needs_review'::text),
                               'No clock-out was recorded. Counts as zero hours until the real end time is set.', false);
    select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) into who from public.people where id = p_person;
    perform public._time_notify_staff(p_company, 'time_unusual', 'Needs review: no clock-out',
      coalesce(nullif(who, ''), 'An employee') || ' never clocked out of the workday that started ' || to_char(w.clock_in_at at time zone 'UTC', 'Mon DD HH24:MI') || ' UTC. It counts as zero hours until you set the end time.',
      'time_workday', w.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public._time_flag_stale(uuid, uuid) from public, anon, authenticated;

-- The worker's day: flags a stale session first, and also hands back the sessions waiting for review (so the phone can show the one card).
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
    'settings', jsonb_build_object('breaks_enabled', st.breaks_enabled, 'require_start_photo', st.require_start_photo, 'require_complete_photo', st.require_complete_photo,
                                   'stale_after_hours', st.open_workday_hours),
    'days', days,
    'current', cur
  );
end;
$$;
revoke all on function public._time_day_json(uuid, uuid, date) from public, anon, authenticated;

create or replace function public.time_my_day(p_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_person_id(); cid uuid;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  if cid is null then raise exception 'You are not on a team yet.'; end if;
  perform public._time_flag_stale(me, cid);
  perform public._time_scan(cid);
  return public._time_day_json(me, cid, coalesce(p_date, current_date));
end;
$$;

-- Clock in: a stale open session is flagged first, so it never blocks today's. Everything else is update 67, unchanged.
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
  perform public._time_flag_stale(me, cid);
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

-- Clock out: a stale session is flagged (never closed at "now"); the already-closed retry path answers for the workday's own date,
-- not the server's UTC date (which is already tomorrow in the evening in the US).
create or replace function public.time_clock_out(p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  cid uuid;
  w public.time_workdays;
  open_label text;
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
  select coalesce(v.label, 'a property') into open_label
    from public.time_intervals i join public.time_visits v on v.id = i.visit_id
   where i.person_id = me and i.ended_at is null and i.status = 'active' limit 1;
  if open_label is not null then
    raise exception 'You are still working at %. Complete that property first, then clock out.', open_label;
  end if;
  if exists (select 1 from public.time_breaks b where b.workday_id = w.id and b.ended_at is null) then
    raise exception 'Your break is still running. End your break, then clock out.';
  end if;
  update public.time_workdays set clock_out_at = now(), status = 'closed' where id = w.id;
  return public._time_day_json(me, cid, w.work_date);
end;
$$;

-- ── 4. The worker says when they really stopped (saved only; nothing is paid until the owner decides) ───
create or replace function public.time_claim_stale_end(p_workday uuid, p_stopped_at timestamptz default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  cid uuid;
  w public.time_workdays;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  select * into w from public.time_workdays where id = p_workday and person_id = me for update;
  if not found then raise exception 'Workday not found.'; end if;
  if w.status <> 'needs_review' then raise exception 'That day is already settled.'; end if;
  if p_stopped_at is not null and (p_stopped_at < w.clock_in_at or p_stopped_at > now()) then
    raise exception 'The time you stopped has to be after you clocked in and not in the future.';
  end if;
  update public.time_workdays
     set claimed_out_at = p_stopped_at, claim_note = nullif(trim(coalesce(p_note, '')), ''), claimed_at = now()
   where id = w.id;
  perform public._time_audit(w.company_id, 'workday', w.id, w.person_id, w.id, null, 'claimed', 'claimed_out_at', null, to_jsonb(p_stopped_at),
                             coalesce(nullif(trim(coalesce(p_note, '')), ''), case when p_stopped_at is null then 'Not sure when they stopped.' else 'Says they stopped at this time.' end), false);
  perform public._time_notify_staff(w.company_id, 'time_unusual', 'Needs review: ' || coalesce((select first_name from public.people where id = me), 'a worker') || ' answered',
    case when p_stopped_at is null then 'They are not sure when they stopped. Set the end time.' else 'They say they stopped at ' || to_char(p_stopped_at at time zone 'UTC', 'Mon DD HH24:MI') || ' UTC. Use it or set another time.' end,
    'time_workday', w.id);
  return public._time_day_json(me, cid, w.work_date);
end;
$$;
revoke all on function public.time_claim_stale_end(uuid, timestamptz, text) from public, anon;
grant execute on function public.time_claim_stale_end(uuid, timestamptz, text) to authenticated;

-- ── 5. The owner settles it with the existing edit: setting a real end time on a flagged day resolves it ───────
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
         -- A flagged day with a real end time set is settled: back to a normal closed day waiting for approval.
         status = case when w.status = 'approved' then 'reopened'
                       when w.status = 'needs_review' and new_out is not null and new_out > new_in then 'closed'
                       when new_out is not null and w.status = 'active' then 'closed'
                       else w.status end
   where id = w.id;
  if new_in is distinct from w.clock_in_at then
    perform public._time_audit(w.company_id, 'workday', w.id, w.person_id, w.id, null, 'corrected', 'clock_in_at', to_jsonb(w.clock_in_at), to_jsonb(new_in), p_reason, was);
  end if;
  if new_out is distinct from w.clock_out_at then
    perform public._time_audit(w.company_id, 'workday', w.id, w.person_id, w.id, null, case when w.clock_out_at is null then 'clock_out_set' else 'corrected' end, 'clock_out_at', to_jsonb(w.clock_out_at), to_jsonb(new_out), p_reason, was);
  end if;
end;
$$;

-- An unresolved day cannot be approved for payroll.
create or replace function public.time_approve_workday(p_workday uuid)
returns void language plpgsql security definer set search_path = public as $$
declare w public.time_workdays; me uuid := public.my_person_id();
begin
  select * into w from public.time_workdays where id = p_workday for update;
  if not found or not public.is_staff(w.company_id) then raise exception 'Workday not found.'; end if;
  if w.status = 'approved' then return; end if;  -- already approved: a double tap changes nothing
  if w.status = 'needs_review' then raise exception 'This day is waiting for a real end time (the employee never clocked out). Set the end time first.'; end if;
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

-- ── 6. Snow shifts ──────────────────────────────────────────────────────────────
-- Stale = open for 20 hours or more (storms run through the night; the owner's Snow dashboard already warns earlier).
create or replace function public._snow_flag_stale(p_person uuid, p_company uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  s public.snow_shifts;
  n integer := 0;
begin
  for s in
    select * from public.snow_shifts
     where company_id = p_company and person_id = p_person and clock_out_at is null and flagged_at is null
       and clock_in_at < now() - interval '20 hours'
     for update
  loop
    update public.snow_shifts
       set clock_out_at = clock_in_at, flagged_at = now(),
           flagged_reason = 'No clock-out was recorded. Counts as zero hours until the real end time is set.'
     where id = s.id;
    perform public.snow_log_event(p_company, 'shift.flagged', 'snow_shift', s.id, p_storm_id => s.storm_id, p_person_id => p_person,
                                  p_after => jsonb_build_object('clock_in_at', s.clock_in_at, 'reason', 'no clock-out'));
    perform public._time_notify_staff(p_company, 'time_unusual', 'Needs review: no snow clock-out',
      coalesce((select nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '') from public.people where id = p_person), 'An employee')
        || ' never clocked out of the snow shift that started ' || to_char(s.clock_in_at at time zone 'UTC', 'Mon DD HH24:MI') || ' UTC. It counts as zero hours until you correct it.',
      'snow_shift', s.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public._snow_flag_stale(uuid, uuid) from public, anon, authenticated;

-- The phone calls this whenever it looks at its Snow clock, so a stale shift is flagged before anything is shown.
create or replace function public.snow_check_my_shift()
returns integer language plpgsql security definer set search_path = public as $$
declare cid uuid := public._snow_my_company(); me uuid := public.my_person_id();
begin
  if cid is null or me is null then return 0; end if;
  return public._snow_flag_stale(me, cid);
end;
$$;
revoke all on function public.snow_check_my_shift() from public, anon;
grant execute on function public.snow_check_my_shift() to authenticated;

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
  perform public._snow_flag_stale(me, cid);
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

create or replace function public.snow_clock_out()
returns public.snow_shifts language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public._snow_my_company();
  me uuid := public.my_person_id();
  s public.snow_shifts;
begin
  perform public._snow_flag_stale(me, cid);
  select * into s from public.snow_shifts where company_id = cid and person_id = me and clock_out_at is null;
  if s.id is null then
    -- Already clocked out (double tap), or the old shift was just flagged: hand back the last shift.
    select * into s from public.snow_shifts where company_id = cid and person_id = me order by clock_in_at desc limit 1;
    if s.id is null then raise exception 'You''re not clocked in.'; end if;
    return s;
  end if;
  update public.snow_shifts set clock_out_at = greatest(now(), clock_in_at) where id = s.id returning * into s;
  perform public.snow_log_event(cid, 'shift.clocked_out', 'snow_shift', s.id, p_person_id => me,
                                p_after => jsonb_build_object('clock_in_at', s.clock_in_at, 'clock_out_at', s.clock_out_at));
  return s;
end;
$$;
revoke all on function public.snow_clock_out() from public;
grant execute on function public.snow_clock_out() to authenticated;

-- The worker says when they really stopped (saved only; hours stay at zero until the owner corrects the shift).
create or replace function public.snow_claim_stale_end(p_shift uuid, p_stopped_at timestamptz default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_person_id(); s public.snow_shifts;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  select * into s from public.snow_shifts where id = p_shift and person_id = me for update;
  if not found then raise exception 'Shift not found.'; end if;
  if s.flagged_at is null then raise exception 'That shift is already settled.'; end if;
  if p_stopped_at is not null and (p_stopped_at < s.clock_in_at or p_stopped_at > now()) then
    raise exception 'The time you stopped has to be after you clocked in and not in the future.';
  end if;
  update public.snow_shifts set claimed_out_at = p_stopped_at, claim_note = nullif(trim(coalesce(p_note, '')), ''), claimed_at = now() where id = s.id;
  perform public._time_notify_staff(s.company_id, 'time_unusual', 'Needs review: a snow worker answered',
    case when p_stopped_at is null then 'They are not sure when they stopped. Correct the shift.' else 'They say they stopped at ' || to_char(p_stopped_at at time zone 'UTC', 'Mon DD HH24:MI') || ' UTC. Use it or set another time.' end,
    'snow_shift', s.id);
end;
$$;
revoke all on function public.snow_claim_stale_end(uuid, timestamptz, text) from public, anon;
grant execute on function public.snow_claim_stale_end(uuid, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';
