-- ============================================================================
-- Update 101 — run once in Supabase → SQL Editor, AFTER 100. NOT run yet; read it first. Safe to run again.
--
-- The owner can settle a day that is waiting on the "Needs your OK" card with NO HOURS: the person did not really work that day (clocked in by
-- mistake, or nobody knows when they stopped and the owner does not want to guess). The day stays at zero length, is marked settled
-- (closed, waiting for approval like any day), leaves the card, and the owner's choice is written to the time history.
-- Owner/admin only. A day that is not waiting for review cannot be settled this way.
-- ============================================================================

create or replace function public.time_settle_no_hours(p_workday uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare w public.time_workdays; why text := coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'No hours worked');
begin
  select * into w from public.time_workdays where id = p_workday for update;
  if not found or not public.is_staff(w.company_id) then raise exception 'Workday not found.'; end if;
  if w.status <> 'needs_review' then raise exception 'That day is already settled.'; end if;
  update public.time_workdays set status = 'closed' where id = w.id;
  perform public._time_audit(w.company_id, 'workday', w.id, w.person_id, w.id, null, 'settled_no_hours', 'status', to_jsonb(w.status), to_jsonb('closed'::text), why, false);
end;
$$;
revoke all on function public.time_settle_no_hours(uuid, text) from public, anon;
grant execute on function public.time_settle_no_hours(uuid, text) to authenticated;

notify pgrst, 'reload schema';
