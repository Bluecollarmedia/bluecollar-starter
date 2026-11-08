-- ============================================================================
-- Update 73 — run once in Supabase → SQL Editor, AFTER update 34 (safe to run again). NOT run yet; read it before running.
--
-- The customer's maintenance updates now also carry each shared photo's file key, so the app can open the file through a short-lived signed
-- link (media function action "maint-sign", which re-checks with update 71's maintenance_photos_i_can_open) once maintenance photo files
-- are private. Everything else is exactly update 34: finished visits of the customer's own properties and ONLY the photos the owner shared.
-- ============================================================================
create or replace function public.maintenance_customer_updates()
returns table (
  stop_id uuid, property_name text, completed_at timestamptz, services text, photos jsonb
)
language sql stable security definer set search_path = public as $$
  select s.id, p.name, s.completed_at,
         (select string_agg(ss.label, ', ' order by ss.label)
            from public.maintenance_stop_services ss where ss.stop_id = s.id and ss.completed),
         coalesce((select jsonb_agg(jsonb_build_object('id', ph.id, 'url', ph.file_url, 'key', ph.file_key) order by ph.created_at)
                     from public.maintenance_photos ph
                    where ph.stop_id = s.id and ph.is_customer_visible), '[]'::jsonb)
    from public.maintenance_stops s
    join public.maintenance_properties p on p.id = s.property_id
   where s.status = 'completed'
     and p.customer_id = public.my_person_id()
   order by s.completed_at desc
   limit 100
$$;

revoke all on function public.maintenance_customer_updates() from public;
grant execute on function public.maintenance_customer_updates() to authenticated;

notify pgrst, 'reload schema';
