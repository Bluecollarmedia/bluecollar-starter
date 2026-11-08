-- ============================================================================
-- Update 85 — run once in Supabase → SQL Editor (safe to run again). NOT run yet; read it before running.
--
-- Cleanup of the old "codes and requests" era. Update 78 replaced team codes, Snow codes, project codes and customer codes with private
-- invite links, and switched the old functions off. This DROPS the ones nothing uses any more:
--   * joining by a code and asking to be approved (request_join, join_with_code, approve/decline_join_request)
--   * looking up and claiming codes (lookup_*_code, claim_project, and the internal _claim_* / _request_* helpers)
--   * Snow sign-up codes and Snow access requests (request/approve/decline/remove/list/withdraw)
--   * project and maintenance customer code makers, and the triggers that made them
--   * the old Snow sign-up hook that was already unplugged in update 78
-- Every function below was checked: nothing in the app, no edge function, no other database function and no trigger uses it.
-- No table, column or row is touched (several live functions still read the old, empty tables; dropping those is a separate step).
--
-- One small fix rides along: update 80 locked the helper _snow_purging from signed-in users, but the storm delete guard (a trigger that runs
-- as the person deleting) calls it, so a plain delete of a running storm said "permission denied" instead of "A dispatched storm can't be
-- deleted. End it instead." The guard now runs with the same rights as the database function that checks it. Nothing else changes.
-- ============================================================================

-- Triggers first (they point at functions below).
drop trigger if exists maintenance_properties_code on public.maintenance_properties;
drop trigger if exists join_requests_guard on public.join_requests;
drop trigger if exists join_requests_guard_worker_type on public.join_requests;

-- Joining by a code, asking to be approved.
drop function if exists public.approve_join_request(uuid, text, text);
drop function if exists public.decline_join_request(uuid, text);
drop function if exists public.request_join(text);
drop function if exists public.join_with_code(text);
drop function if exists public._request_join(uuid, text);
drop function if exists public._join_requests_guard();
drop function if exists public._guard_requested_worker_type();

-- Looking up and claiming codes.
drop function if exists public.lookup_any_code(text);
drop function if exists public.lookup_team_code(text);
drop function if exists public.lookup_project_code(text);
drop function if exists public.lookup_snow_code(text);
drop function if exists public.claim_project(text);
drop function if exists public._claim_project(uuid, text);
drop function if exists public._claim_maintenance(uuid, text);

-- Project and maintenance customer codes.
drop function if exists public.regenerate_project_code(uuid);
drop function if exists public.regenerate_maintenance_code(uuid, boolean);
drop function if exists public._new_customer_code();
drop function if exists public._maintenance_property_code();

-- Snow sign-up codes and Snow access requests.
drop function if exists public.regenerate_snow_signup_code();
drop function if exists public.disable_snow_signup_code();
drop function if exists public.request_snow_access(text);
drop function if exists public._request_snow_access(uuid, text);
drop function if exists public.approve_snow_access_request(uuid, text[]);
drop function if exists public.decline_snow_access_request(uuid, text);
drop function if exists public.remove_snow_access_request(uuid);
drop function if exists public.list_snow_access_requests();
drop function if exists public.withdraw_my_snow_request();
drop function if exists public.handle_new_user_snow();


-- The storm delete guard keeps working with the helper locked down (see the note at the top).
alter function public.snow_storm_keep_history() security definer;
alter function public.snow_storm_keep_history() set search_path = public;

notify pgrst, 'reload schema';
