-- ============================================================================
-- Update 71 — run once in Supabase → SQL Editor, AFTER updates 18, 34 and 37 (safe to run again). NOT run yet; read it before running.
--
-- Who may OPEN which maintenance photo file. Maintenance photos are stored in R2 and the app saves each photo's public address, so the
-- internal/shared switch only controls what the app SHOWS; it does not stop someone who has an internal photo's address from opening it.
-- To make the switch real, the files must be private and opened through short-lived signed links, as Snow media and ID photos already do.
-- This function is the permission check for that: the media Edge Function (action "maint-sign") asks it, as the signed-in person,
-- which of the requested file keys they may open, and signs only those.
--
--   owner/admin ........ every photo of their company
--   crew on the route .. the photos of routes they are on
--   the customer ....... ONLY photos the owner shared (is_customer_visible), on a FINISHED stop, of a property linked to them
--   everyone else ...... nothing
--
-- Nothing is changed by this update alone: no file becomes private, and no screen uses it yet (see docs/maintenance-crew-visits.md).
-- ============================================================================
create or replace function public.maintenance_photos_i_can_open(p_keys text[])
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(ph.file_key), '{}')
    from public.maintenance_photos ph
    join public.maintenance_stops s on s.id = ph.stop_id
    join public.maintenance_properties p on p.id = ph.property_id
   where ph.file_key = any (coalesce(p_keys, '{}'))
     and (
       public.is_staff(ph.company_id)
       or public.on_maintenance_route(ph.route_id)
       or (ph.is_customer_visible and s.status = 'completed' and p.customer_id = public.my_person_id())
     )
$$;
revoke all on function public.maintenance_photos_i_can_open(text[]) from public, anon;
grant execute on function public.maintenance_photos_i_can_open(text[]) to authenticated;

notify pgrst, 'reload schema';
