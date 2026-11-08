-- ============================================================================
-- Update 52 — run once in Supabase → SQL Editor (safe to run again). NOT run yet; read it before running.
--
-- The check-in distance is enforced by the DATABASE, not only by the app.
-- A worker's "I'm here" (a row in check_ins and the matching work_sessions row) is refused when the GPS fix saved with it is:
--   • missing or not a real location,
--   • too vague to trust (accuracy worse than 100 m), or
--   • farther from the project than the project's saved check-in distance
--     (project_settings.checkin_radius_meters, or half a mile = 805 m when none is saved), allowing the phone's own error
--     margin up to 75 m. Same numbers as the app (src/lib/checkInRadius.ts).
-- Owners/admins are not limited (they correct and add records), and a project with no saved coordinates can't be checked
-- here (the app asks the office to fix the address instead).
-- Distance is the great-circle (haversine) distance between the saved GPS fix and the project's latitude/longitude.
-- ============================================================================

create or replace function public.haversine_m(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)
  )))
$$;

create or replace function public.enforce_checkin_radius()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_gps jsonb;
  v_row jsonb := to_jsonb(new);
  v_project uuid := nullif(v_row ->> 'project_id', '')::uuid;
  v_company uuid := nullif(v_row ->> 'company_id', '')::uuid;
  v_lat double precision;
  v_lon double precision;
  v_radius integer;
  v_glat double precision;
  v_glon double precision;
  v_acc double precision;
  v_dist double precision;
begin
  -- Not a signed-in app user (backend jobs, the SQL editor), or no project to measure against.
  if auth.uid() is null or v_project is null then return new; end if;
  -- Owners and admins add and correct records without being on site.
  if public.is_staff(v_company) then return new; end if;
  -- Only a fresh check-in is judged (not a later edit such as a check-out on the same row).
  if tg_table_name = 'work_sessions' and coalesce(v_row ->> 'status', 'active') <> 'active' then return new; end if;

  v_gps := case when tg_table_name = 'check_ins' then v_row -> 'gps' else v_row -> 'check_in_gps' end;

  select p.latitude, p.longitude, s.checkin_radius_meters
    into v_lat, v_lon, v_radius
    from public.projects p
    left join public.project_settings s on s.project_id = p.id
   where p.id = v_project;

  -- No saved coordinates for the project: nothing to measure against here.
  if v_lat is null or v_lon is null then return new; end if;

  v_glat := nullif(v_gps ->> 'latitude', '')::double precision;
  v_glon := nullif(v_gps ->> 'longitude', '')::double precision;
  if v_glat is null or v_glon is null or abs(v_glat) > 90 or abs(v_glon) > 180 or (v_glat = 0 and v_glon = 0) then
    raise exception 'Your location is needed to check in. Turn on location and try again.' using errcode = 'P0001';
  end if;

  v_acc := greatest(0, coalesce(nullif(v_gps ->> 'accuracy', '')::double precision, 0));
  if v_acc > 100 then
    raise exception 'Your location is not accurate enough to check in. Step into the open and try again.' using errcode = 'P0001';
  end if;

  v_dist := public.haversine_m(v_glat, v_glon, v_lat, v_lon);
  if v_dist - least(v_acc, 75) > coalesce(v_radius, 805) then
    raise exception 'You are too far from this project to check in.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists check_ins_enforce_radius on public.check_ins;
create trigger check_ins_enforce_radius before insert on public.check_ins
  for each row execute function public.enforce_checkin_radius();

drop trigger if exists work_sessions_enforce_radius on public.work_sessions;
create trigger work_sessions_enforce_radius before insert on public.work_sessions
  for each row execute function public.enforce_checkin_radius();
