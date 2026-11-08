-- ============================================================================
-- Update 116 — the customer portal's "everything in one place" data. Run once in Supabase → SQL Editor, AFTER 111 (safe to run again).
-- NOT run yet; read it before running.
--
-- What it adds for a signed-in customer (all read-only, only their own properties, only while their portal access is on):
--   1. Snow history now says when the crew ARRIVED at a finished visit (before, only when it was completed).
--   2. Maintenance history now says when the crew arrived, and each shared photo carries the name of the task it was taken for (update 111).
--   3. maintenance_customer_next_visits(): for each of their maintenance properties, the date of the NEXT planned visit and the services
--      planned for it. Nothing else about the route is shown: no crew, no stop order, no notes.
--
-- The two history functions are NEW functions (snow_customer_history, maintenance_customer_history) that sit beside the old ones, which are not
-- touched: app builds already out there keep using the old ones, and earlier updates stay safe to run again. The app asks for the new ones
-- first and falls back to the old ones, so it keeps working if this update has not been run: it just shows no arrival time, no task names
-- and no next visit.
-- ============================================================================

-- ── 1. Snow history with the arrival time (beside snow_customer_timeline) ───
create or replace function public.snow_customer_history()
returns table (
  visit_id uuid, property_id uuid, property_name text, service text, storm_name text, arrived_at timestamptz, completed_at timestamptz, media jsonb
)
language sql stable security definer set search_path = public as $$
  select v.id, v.property_id, v.property_name, v.service, st.name, v.arrived_at, v.completed_at,
         coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'file_key', m.file_key) order by m.created_at)
                     from public.snow_completion_media m
                    where m.visit_id = v.id and m.shared_at is not null and m.withdrawn_at is null), '[]'::jsonb)
    from public.snow_visits v
    join public.snow_storms st on st.id = v.storm_id
   where v.status = 'completed'
     and v.customer_notified_at is not null
     and public.snow_is_property_contact(v.property_id)
   order by v.completed_at desc
   limit 300
$$;
revoke all on function public.snow_customer_history() from public, anon;
grant execute on function public.snow_customer_history() to authenticated;

-- ── 2. Maintenance history with arrival time and task names (beside maintenance_customer_updates) ──
create or replace function public.maintenance_customer_history()
returns table (
  stop_id uuid, property_id uuid, property_name text, arrived_at timestamptz, completed_at timestamptz, services text, photos jsonb
)
language sql stable security definer set search_path = public as $$
  select s.id, s.property_id, p.name, s.arrived_at, s.completed_at,
         (select string_agg(ss.label, ', ' order by ss.label)
            from public.maintenance_stop_services ss where ss.stop_id = s.id and ss.completed),
         coalesce((select jsonb_agg(jsonb_build_object('id', ph.id, 'url', ph.file_url, 'key', ph.file_key, 'task', t.title) order by ph.created_at)
                     from public.maintenance_photos ph
                     left join public.maintenance_stop_tasks t on t.id = ph.task_id
                    where ph.stop_id = s.id and ph.is_customer_visible), '[]'::jsonb)
    from public.maintenance_stops s
    join public.maintenance_properties p on p.id = s.property_id
   where s.status = 'completed'
     and p.customer_id = public.my_person_id()
     and public._customer_in_good_standing(p.company_id, p.customer_id)
   order by s.completed_at desc
   limit 200
$$;
revoke all on function public.maintenance_customer_history() from public, anon;
grant execute on function public.maintenance_customer_history() to authenticated;

-- ── 3. The next planned visit to each of their maintenance properties ───────
create or replace function public.maintenance_customer_next_visits()
returns table (property_id uuid, service_date date, services text)
language sql stable security definer set search_path = public as $$
  select distinct on (s.property_id)
         s.property_id, r.service_date,
         (select string_agg(ss.label, ', ' order by ss.label) from public.maintenance_stop_services ss where ss.stop_id = s.id)
    from public.maintenance_stops s
    join public.maintenance_routes r on r.id = s.route_id
    join public.maintenance_properties p on p.id = s.property_id
   where s.status in ('pending', 'arrived')
     and r.status in ('planned', 'in_progress')
     and r.service_date >= current_date
     and p.customer_id = public.my_person_id()
     and public._customer_in_good_standing(p.company_id, p.customer_id)
   order by s.property_id, r.service_date
$$;
revoke all on function public.maintenance_customer_next_visits() from public, anon;
grant execute on function public.maintenance_customer_next_visits() to authenticated;
