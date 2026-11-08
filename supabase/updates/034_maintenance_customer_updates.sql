-- ============================================================================
-- 034 · Maintenance: customers can see their property's finished visits and
--       the photos the owner chose to share
--
-- Run this in the Supabase SQL Editor AFTER update 018 (maintenance). Safe to
-- run again: it only adds a function.
--
--  • maintenance_customer_updates(): the signed-in customer's completed
--    maintenance visits for properties linked to them (maintenance_properties
--    .customer_id), newest first, with the services done and ONLY the photos
--    the owner shared (is_customer_visible). Nothing else is exposed: no
--    route, crew, stop order, notes, checklist, location or unshared photos.
--
-- The owner shares or un-shares each photo from the route screen. Nothing
-- here touches Landscaping projects or customer project access.
-- ============================================================================

create or replace function public.maintenance_customer_updates()
returns table (
  stop_id uuid, property_name text, completed_at timestamptz, services text, photos jsonb
)
language sql stable security definer set search_path = public as $$
  select s.id, p.name, s.completed_at,
         (select string_agg(ss.label, ', ' order by ss.label)
            from public.maintenance_stop_services ss where ss.stop_id = s.id and ss.completed),
         coalesce((select jsonb_agg(jsonb_build_object('id', ph.id, 'url', ph.file_url) order by ph.created_at)
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
