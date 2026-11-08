-- Update 93: a storm ends by itself the moment its last stop is finished or skipped. The owner no longer has to tap "End storm".
-- It does exactly what the manual End does (the status goes from dispatched to ended; the existing guard stamps who and when and the
-- activity log records it) and nothing more: no one is clocked out and nothing is sent again. "Reopen storm" still brings it back for a
-- late stop or a second pass. It waits (does not end) while a skip request is still pending, so the owner can decide it first.
-- Safe to run more than once.

create or replace function public._snow_end_storm_when_done()
returns trigger language plpgsql security definer set search_path = public as $$
declare s public.snow_storms;
begin
  select * into s from public.snow_storms where id = new.storm_id for update;
  if not found or s.status <> 'dispatched' then return new; end if;

  -- Anything still to do on a route that is not cancelled keeps the storm open.
  if exists (
    select 1 from public.snow_visits v
      join public.snow_routes r on r.id = v.route_id and r.cancelled_at is null
     where v.storm_id = s.id and v.status in ('pending', 'arrived')
  ) then return new; end if;

  -- At least one stop was actually finished or skipped (a storm with nothing done yet never ends).
  if not exists (
    select 1 from public.snow_visits v
      join public.snow_routes r on r.id = v.route_id and r.cancelled_at is null
     where v.storm_id = s.id and v.status in ('completed', 'skipped')
  ) then return new; end if;

  -- A skip request still waiting for the owner's decision is theirs to settle first.
  if exists (select 1 from public.snow_skip_requests k where k.storm_id = s.id and k.status = 'pending') then return new; end if;

  update public.snow_storms set status = 'ended' where id = s.id;
  return new;
end;
$$;
revoke all on function public._snow_end_storm_when_done() from public, anon, authenticated;

drop trigger if exists snow_visits_end_storm_when_done on public.snow_visits;
create trigger snow_visits_end_storm_when_done after update of status on public.snow_visits
  for each row when (new.status in ('completed', 'skipped') and old.status is distinct from new.status)
  execute function public._snow_end_storm_when_done();
