-- ============================================================================
-- Update 107 — run once in Supabase → SQL Editor, AFTER 106. Safe to run again.
--
-- Clock-in location alerts, using the yard the owner already set (Settings > Yard Location: the company's yard address and coordinates).
--   * The owner chooses, in Settings, how close counts as "at the yard", whether to be emailed, and (optionally) which address gets the email.
--     Alerts start OFF until the owner turns them on.
--   * Workers can ALWAYS clock in, wherever they are. When they do, the app records where the phone was. If alerts are on, a yard is set and
--     the worker is outside it (or the phone could not give a location), the owner is emailed exactly where the worker clocked in from
--     (the clock-in-alert edge function).
--   * ADDITIVE: two new tables and four new functions. Nothing existing is altered, dropped or re-granted.
--   * Only a signed-in, ACTIVE member whose role is exactly 'owner' can read or change the alert settings. A worker can only record a
--     location for their own workday, once.
-- ============================================================================

create table if not exists public.company_yard_alerts (
  company_id uuid primary key references public.companies(id) on delete cascade,
  radius_m integer not null default 152 check (radius_m between 30 and 5000),
  alert_on boolean not null default false,
  alert_email text check (alert_email is null or char_length(alert_email) <= 200),
  updated_by uuid references public.people(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.time_clock_locations (
  workday_id uuid primary key references public.time_workdays(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  lat numeric(9,6),
  lng numeric(9,6),
  accuracy_m numeric(8,1),
  note text check (note is null or char_length(note) <= 160),
  yard_distance_m integer,
  outside_yard boolean,
  recorded_at timestamptz not null default now(),
  alert_sent_at timestamptz
);

-- Nobody reads or writes these tables directly.
alter table public.company_yard_alerts enable row level security;
alter table public.time_clock_locations enable row level security;
revoke all on public.company_yard_alerts from public, anon, authenticated;
revoke all on public.time_clock_locations from public, anon, authenticated;

-- Distance in meters between two points (haversine).
create or replace function public._yard_distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns integer language sql immutable as $$
  select round(2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )))::integer
$$;
revoke all on function public._yard_distance_m(double precision, double precision, double precision, double precision) from public, anon, authenticated;

create or replace function public._yard_owner_company()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.my_person_id(); cid uuid;
begin
  if me is null then raise exception 'Only the owner can do that.'; end if;
  select m.company_id into cid from public.company_members m where m.person_id = me and m.role = 'owner' and m.status = 'active' limit 1;
  if cid is null then raise exception 'Only the owner can do that.'; end if;
  return cid;
end;
$$;
revoke all on function public._yard_owner_company() from public, anon, authenticated;

-- The owner's alert settings, with where the yard is (it is set on the Yard Location screen).
create or replace function public.owner_get_yard_alerts()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public._yard_owner_company(); c public.companies; a public.company_yard_alerts;
begin
  select * into c from public.companies where id = cid;
  select * into a from public.company_yard_alerts where company_id = cid;
  return jsonb_build_object(
    'yard_set', c.yard_latitude is not null and c.yard_longitude is not null,
    'yard_address', concat_ws(', ', nullif(btrim(coalesce(c.yard_address, '')), ''), nullif(btrim(coalesce(c.yard_city, '')), ''), nullif(btrim(coalesce(c.yard_state, '')), '')),
    'radius_m', coalesce(a.radius_m, 152),
    'alert_on', coalesce(a.alert_on, false),
    'alert_email', a.alert_email
  );
end;
$$;
revoke all on function public.owner_get_yard_alerts() from public, anon;
grant execute on function public.owner_get_yard_alerts() to authenticated;

create or replace function public.owner_set_yard_alerts(p_radius_m integer, p_alert_on boolean, p_alert_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cid uuid := public._yard_owner_company(); me uuid := public.my_person_id(); mail text := nullif(btrim(coalesce(p_alert_email, '')), '');
begin
  if p_radius_m is null or p_radius_m not between 30 and 5000 then raise exception 'Choose how close counts as at the yard.'; end if;
  if mail is not null and mail !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then raise exception 'That email address does not look right.'; end if;
  insert into public.company_yard_alerts (company_id, radius_m, alert_on, alert_email, updated_by, updated_at)
  values (cid, p_radius_m, coalesce(p_alert_on, false), mail, me, now())
  on conflict (company_id) do update set radius_m = excluded.radius_m, alert_on = excluded.alert_on, alert_email = excluded.alert_email,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return public.owner_get_yard_alerts();
end;
$$;
revoke all on function public.owner_set_yard_alerts(integer, boolean, text) from public, anon;
grant execute on function public.owner_set_yard_alerts(integer, boolean, text) to authenticated;

-- A worker records where the phone was when they clocked in (their own workday, once). Never blocks anything.
-- Answers whether the owner should be told: alerts are on, a yard is set, and the worker is outside it or no location could be read.
create or replace function public.time_record_clock_in_location(p_workday uuid, p_lat numeric, p_lng numeric, p_accuracy numeric, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id(); w public.time_workdays; c public.companies; a public.company_yard_alerts;
  has_pt boolean := p_lat is not null and p_lng is not null and p_lat between -90 and 90 and p_lng between -180 and 180;
  yard_set boolean; radius integer; dist integer; outside boolean; need boolean;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  select * into w from public.time_workdays where id = p_workday and person_id = me;
  if not found then raise exception 'That workday was not found.'; end if;
  if exists (select 1 from public.time_clock_locations where workday_id = w.id) then
    return jsonb_build_object('recorded', false, 'alert_needed', false);
  end if;
  select * into c from public.companies where id = w.company_id;
  select * into a from public.company_yard_alerts where company_id = w.company_id;
  yard_set := c.yard_latitude is not null and c.yard_longitude is not null;
  radius := coalesce(a.radius_m, 152);
  if yard_set and has_pt then
    dist := public._yard_distance_m(p_lat::double precision, p_lng::double precision, c.yard_latitude, c.yard_longitude);
    outside := dist > radius;
  end if;
  insert into public.time_clock_locations (workday_id, company_id, person_id, lat, lng, accuracy_m, note, yard_distance_m, outside_yard)
  values (w.id, w.company_id, me, case when has_pt then p_lat end, case when has_pt then p_lng end, p_accuracy, left(p_note, 160), dist, outside);
  need := yard_set and coalesce(a.alert_on, false) and (not has_pt or coalesce(outside, false));
  return jsonb_build_object('recorded', true, 'yard_set', yard_set, 'outside', outside, 'distance_m', dist, 'alert_needed', coalesce(need, false));
end;
$$;
revoke all on function public.time_record_clock_in_location(uuid, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.time_record_clock_in_location(uuid, numeric, numeric, numeric, text) to authenticated;

notify pgrst, 'reload schema';
