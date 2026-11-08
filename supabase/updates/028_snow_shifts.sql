-- ============================================================================
-- Update 28 — run once in Supabase → SQL Editor, after 020 and 020b
-- (safe to run again).
--  • Snow clock in / clock out, kept apart from landscaping Payroll and
--    Attendance (work_sessions is never touched). No location is used.
--  • One open shift per person per company. Clocking in or out twice
--    (double tap, retry) changes nothing.
--  • The original times are never edited. The owner/admin fixes a shift by
--    adding a correction row (new times plus a reason); the latest
--    correction is what counts, and every correction stays visible.
--  • Workers see only their own shifts and corrections. Owner/admin see all.
--    Nobody writes these tables directly; the functions below do.
-- ============================================================================

create table if not exists public.snow_shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  clock_in_at timestamptz not null default now(),
  clock_out_at timestamptz,
  client_request_id uuid unique,
  created_at timestamptz not null default now(),
  check (clock_out_at is null or clock_out_at >= clock_in_at)
);
create unique index if not exists uq_snow_shifts_open on public.snow_shifts (company_id, person_id) where clock_out_at is null;
create index if not exists idx_snow_shifts_company on public.snow_shifts (company_id, clock_in_at desc);

create table if not exists public.snow_shift_corrections (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.snow_shifts(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  clock_in_at timestamptz not null,
  clock_out_at timestamptz,
  reason text not null check (length(trim(reason)) > 0),
  corrected_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  check (clock_out_at is null or clock_out_at >= clock_in_at)
);
create index if not exists idx_snow_shift_corrections_shift on public.snow_shift_corrections (shift_id, created_at);

alter table public.snow_shifts enable row level security;
alter table public.snow_shift_corrections enable row level security;

drop policy if exists snow_shifts_select on public.snow_shifts;
create policy snow_shifts_select on public.snow_shifts for select
  using (public.is_staff(company_id) or person_id = public.my_person_id());
drop policy if exists snow_shift_corrections_select on public.snow_shift_corrections;
create policy snow_shift_corrections_select on public.snow_shift_corrections for select
  using (public.is_staff(company_id)
         or exists (select 1 from public.snow_shifts s where s.id = shift_id and s.person_id = public.my_person_id()));

-- Corrections are append-only, even for the owner.
create or replace function public.snow_shift_corrections_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'Shift corrections can''t be changed or deleted. Add a new correction instead.';
end;
$$;
drop trigger if exists snow_shift_corrections_append_only on public.snow_shift_corrections;
create trigger snow_shift_corrections_append_only before update or delete on public.snow_shift_corrections
  for each row execute function public.snow_shift_corrections_append_only();

-- The company the caller works snow for (snow staff first, then owner/admin).
create or replace function public._snow_my_company()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.company_id from public.snow_staff s where s.person_id = public.my_person_id() and s.status = 'active' limit 1),
    (select m.company_id from public.company_members m where m.person_id = public.my_person_id()
       and m.status = 'active' and m.role in ('owner', 'admin') limit 1)
  )
$$;

-- ── Clock in / out ──────────────────────────────────────────────────────────

create or replace function public.snow_clock_in(p_client_request_id uuid default null)
returns public.snow_shifts language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public._snow_my_company();
  me uuid := public.my_person_id();
  s public.snow_shifts;
begin
  if cid is null or not public.snow_is_active(cid) then
    raise exception 'You need snow team access to clock in.';
  end if;
  if p_client_request_id is not null then
    select * into s from public.snow_shifts where client_request_id = p_client_request_id;
    if s.id is not null then return s; end if;
  end if;
  select * into s from public.snow_shifts where company_id = cid and person_id = me and clock_out_at is null;
  if s.id is not null then return s; end if;  -- already clocked in

  insert into public.snow_shifts (company_id, person_id, client_request_id)
  values (cid, me, p_client_request_id) returning * into s;
  perform public.snow_log_event(cid, 'shift.clocked_in', 'snow_shift', s.id, p_person_id => me,
                                p_after => jsonb_build_object('clock_in_at', s.clock_in_at));
  return s;
end;
$$;

create or replace function public.snow_clock_out()
returns public.snow_shifts language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public._snow_my_company();
  me uuid := public.my_person_id();
  s public.snow_shifts;
begin
  select * into s from public.snow_shifts where company_id = cid and person_id = me and clock_out_at is null;
  if s.id is null then
    -- Already clocked out (double tap): hand back the last shift.
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

-- ── Owner/admin: correct a shift ────────────────────────────────────────────
-- Pass the times the shift should have. p_clock_out_at null keeps it open.
-- If the shift is still open and a clock-out time is given, the shift is
-- closed too, so the person can clock in again.

create or replace function public.snow_correct_shift(
  p_shift_id uuid, p_clock_in_at timestamptz, p_clock_out_at timestamptz, p_reason text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  s public.snow_shifts;
  cid uuid;
begin
  select * into s from public.snow_shifts where id = p_shift_id;
  if s.id is null or not public.is_staff(s.company_id) then raise exception 'Shift not found.'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Say why the shift is being corrected.'; end if;
  if p_clock_out_at is not null and p_clock_out_at < p_clock_in_at then
    raise exception 'Clock out can''t be before clock in.';
  end if;

  insert into public.snow_shift_corrections (shift_id, company_id, clock_in_at, clock_out_at, reason, corrected_by)
  values (s.id, s.company_id, p_clock_in_at, p_clock_out_at, trim(p_reason), public.my_person_id())
  returning id into cid;
  if s.clock_out_at is null and p_clock_out_at is not null then
    update public.snow_shifts set clock_out_at = greatest(now(), clock_in_at) where id = s.id;
  end if;
  perform public.snow_log_event(s.company_id, 'shift.corrected', 'snow_shift', s.id, p_person_id => s.person_id,
                                p_before => jsonb_build_object('clock_in_at', s.clock_in_at, 'clock_out_at', s.clock_out_at),
                                p_after => jsonb_build_object('clock_in_at', p_clock_in_at, 'clock_out_at', p_clock_out_at),
                                p_note => trim(p_reason));
  return cid;
end;
$$;

revoke all on function public.snow_clock_in(uuid) from public;
revoke all on function public.snow_clock_out() from public;
revoke all on function public.snow_correct_shift(uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.snow_clock_in(uuid) to authenticated;
grant execute on function public.snow_clock_out() to authenticated;
grant execute on function public.snow_correct_shift(uuid, timestamptz, timestamptz, text) to authenticated;
