-- ============================================================================
-- Update 42 — run once in Supabase → SQL Editor, AFTER 028, 040 and 041
-- (safe to run again). NOT run yet; read it before running.
--
-- Clock-ins are tagged with the storm they belong to, when that is clear.
--  • When someone clocks in, the shift is tagged with a storm if they have
--    EXACTLY ONE active route: a route they lead or are on the crew of, on a
--    dispatched storm (not a draft, not ended), not cancelled, for a service
--    they still hold. With no such route, or with more than one, the shift is
--    left untagged. The tag is decided once, at clock-in.
--  • Clocking in is NEVER blocked or slowed by this. If anything goes wrong
--    while working out the tag, the shift is simply left untagged.
--  • Each person still clocks themselves in and out. Nobody clocks anyone else.
--  • Shifts that already exist stay untagged. Clock-out, owner corrections,
--    the one-open-shift rule and double-tap safety are unchanged.
--  • Lead and crew rules are untouched: this only READS who leads or is on a
--    route; it grants no access to anything.
--  • The clock-in entry in the Snow activity log now names the storm.
-- ============================================================================

alter table public.snow_shifts
  add column if not exists storm_id uuid references public.snow_storms(id) on delete set null;
create index if not exists idx_snow_shifts_storm on public.snow_shifts (storm_id) where storm_id is not null;

-- The storm to tag a clock-in with, or null. Never raises: any problem means "no tag".
create or replace function public._snow_storm_to_tag(p_person uuid, p_company uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  n int;
  found_storm uuid;
begin
  select count(*), min(x.storm_id::text)::uuid into n, found_storm
  from (
    select r.id as route_id, r.storm_id
      from public.snow_routes r
      join public.snow_storms s on s.id = r.storm_id
     where r.company_id = p_company
       and r.cancelled_at is null
       and s.status = 'dispatched'
       and public.snow_person_has_service(r.company_id, p_person, r.service)
       and (
         r.lead_person_id = p_person
         or exists (select 1 from public.snow_route_crew c where c.route_id = r.id and c.person_id = p_person)
       )
  ) x;
  if n = 1 then return found_storm; end if;
  return null;
exception when others then
  return null;
end;
$$;
revoke all on function public._snow_storm_to_tag(uuid, uuid) from public, anon, authenticated;

-- Same as before (update 28), plus the tag. Returning the shift row means the
-- app also gets storm_id back.
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
    select * into s from public.snow_shifts where client_request_id = p_client_request_id;
    if s.id is not null then return s; end if;
  end if;
  select * into s from public.snow_shifts where company_id = cid and person_id = me and clock_out_at is null;
  if s.id is not null then return s; end if;  -- already clocked in

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
