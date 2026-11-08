-- 045: correcting a still-open snow shift now closes it at the CORRECTED clock-out time.
-- Needs: 028 (snow shifts). Safe to run twice. Run any time after 028.
-- Before: if an owner/admin corrected a shift that was still open and gave a clock-out time, the shift was
--   closed at the moment of the correction (now), not at the time they typed. The correction row itself kept
--   the right time, so the two disagreed. Now the shift row closes at the corrected time (never before the
--   original clock-in, never in the future), so they agree.
-- Everything else about snow_correct_shift is unchanged.

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
    update public.snow_shifts
       set clock_out_at = greatest(least(p_clock_out_at, now()), clock_in_at)
     where id = s.id;
  end if;
  perform public.snow_log_event(s.company_id, 'shift.corrected', 'snow_shift', s.id, p_person_id => s.person_id,
                                p_before => jsonb_build_object('clock_in_at', s.clock_in_at, 'clock_out_at', s.clock_out_at),
                                p_after => jsonb_build_object('clock_in_at', p_clock_in_at, 'clock_out_at', p_clock_out_at),
                                p_note => trim(p_reason));
  return cid;
end;
$$;

revoke all on function public.snow_correct_shift(uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.snow_correct_shift(uuid, timestamptz, timestamptz, text) to authenticated;
