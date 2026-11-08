-- ============================================================================
-- Update 102 — run once in Supabase → SQL Editor, AFTER 101. NOT run yet; read it first. Safe to run again.
--
-- A check-in distance of 0 means ANYWHERE: the worker does not have to be at the property.
--   * Projects: the database's distance rule (update 52) is skipped when the project's saved distance is 0.
--   * Maintenance properties: the saved distance may now be 0 (it was 25 to 2000 meters), and an arrival at a property set to Anywhere
--     is recorded as verified instead of "outside the radius". (Maintenance never refused an arrival; it recorded where the phone was.)
-- Nothing else changes. Every existing distance keeps working as before.
-- ============================================================================

-- ── Maintenance: allow 0 ─────────────────────────────────────────────────────────
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.maintenance_properties'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%checkin_radius_m%'
  loop
    execute format('alter table public.maintenance_properties drop constraint %I', c);
  end loop;
end $$;
alter table public.maintenance_properties add constraint maintenance_properties_checkin_radius_m_check
  check (checkin_radius_m = 0 or checkin_radius_m between 25 and 2000);

create or replace function public._maint_location(
  p_lat double precision, p_lng double precision, p_accuracy double precision, p_state text,
  t_lat double precision, t_lng double precision, t_radius double precision,
  out status text, out distance double precision
) language plpgsql immutable as $$
begin
  distance := null;
  if coalesce(p_state, 'ok') in ('denied', 'unavailable') then
    status := p_state; return;
  end if;
  if p_lat is null or p_lng is null then
    status := 'unavailable'; return;
  end if;
  -- Anywhere: there is no zone to be outside of.
  if coalesce(t_radius, 150) <= 0 then
    status := 'verified'; return;
  end if;
  if t_lat is null or t_lng is null then
    status := 'no_target_location'; return;
  end if;
  distance := round(public._distance_m(p_lat, p_lng, t_lat, t_lng)::numeric, 1);
  if p_accuracy is null or p_accuracy > greatest(100, t_radius) then
    status := 'low_accuracy';
  elsif distance > t_radius then
    status := 'outside_radius';
  else
    status := 'verified';
  end if;
end;
$$;

-- ── Projects: skip the distance rule when the saved distance is 0 ───────────────────
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

  -- Anywhere (saved distance 0): the worker does not have to be at the project.
  if v_radius is not null and v_radius <= 0 then return new; end if;

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

notify pgrst, 'reload schema';
