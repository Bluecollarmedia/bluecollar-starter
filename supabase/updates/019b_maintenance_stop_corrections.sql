-- ============================================================================
-- Update 19b — run once in Supabase → SQL Editor (safe to run again).
-- Needs update 18 (maintenance) first.
--  • Owner/admin corrections of a stop's arrival or finish time, for when the
--    crew forgot to tap I'm Here or tapped Finish Stop late.
--  • A correction is only a new 'correction' row in maintenance_events. The
--    stop and the crew's own arrival/completion events are never changed, so
--    the original record (who, when, GPS) always stays visible next to it.
--  • Corrections don't change service history or season counts: those move
--    only when a stop is finished.
-- ============================================================================

create or replace function public.maintenance_correct_stop_time(
  p_stop_id uuid, p_kind text, p_at timestamptz, p_note text
) returns public.maintenance_events
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  s public.maintenance_stops;
  ev public.maintenance_events;
  original timestamptz;
  original_by uuid;
begin
  select * into s from public.maintenance_stops where id = p_stop_id;
  if not found then raise exception 'Stop not found.'; end if;
  if not public.is_staff(s.company_id) then raise exception 'Only the owner or an admin can correct a stop.'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Add a note explaining the correction.'; end if;
  if p_at is null then raise exception 'Pick the corrected time.'; end if;
  if p_at > now() + interval '5 minutes' then raise exception 'The corrected time can''t be in the future.'; end if;

  if p_kind = 'arrival' then
    if s.status = 'skipped' then raise exception 'This stop was skipped.'; end if;
    original := s.arrived_at; original_by := s.arrived_by;
  elsif p_kind = 'completion' then
    if s.status <> 'completed' then raise exception 'Only a finished stop''s time can be corrected.'; end if;
    original := s.completed_at; original_by := s.completed_by;
  else
    raise exception 'Unknown correction.';
  end if;

  insert into public.maintenance_events (company_id, route_id, stop_id, person_id, event_type, occurred_at, note, metadata)
  values (s.company_id, s.route_id, s.id, me, 'correction', now(), trim(p_note), jsonb_build_object(
    'kind', 'stop_' || p_kind, 'stop_id', s.id, 'corrected_time', p_at,
    'original_time', original, 'original_person_id', original_by))
  returning * into ev;
  return ev;
end;
$$;

grant execute on function public.maintenance_correct_stop_time(uuid, text, timestamptz, text) to authenticated;
