-- ============================================================================
-- Update 109 — run once in Supabase → SQL Editor, AFTER 108. Safe to run again.
--
-- Clocking in is manual and always possible. Until now the database refused a clock-in unless the worker had work scheduled today
-- (a route or a job) or, for Snow, was on a route in a dispatched storm. Now a worker can clock in and out on the Clock tab any time,
-- whether or not they have a job, even if they finished their jobs or never started one.
--   * Only the two "may this person clock in" checks are replaced; they now always say yes. Everything else about clocking in (one open
--     workday at a time, repeat taps, trucks, snow team access, shift tags) is unchanged.
--   * Same names and arguments, so every grant stays.
-- ============================================================================

create or replace function public._time_may_clock_in(p_person uuid, p_company uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select true
$$;
revoke all on function public._time_may_clock_in(uuid, uuid, date) from public, anon, authenticated;

create or replace function public._snow_may_clock_in(p_person uuid, p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select true
$$;
revoke all on function public._snow_may_clock_in(uuid, uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
