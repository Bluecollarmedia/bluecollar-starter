-- ============================================================================
-- 035 · Snow Mode: route templates keep repeat visits
--
-- Run this in the Supabase SQL Editor AFTER update 025 (route templates). Safe
-- to run again: it only replaces one function and changes no existing data.
--
-- Until now, saving a route as a template kept ONE stop per property, so a
-- route with repeat passes at the same property lost them. Now every visit on
-- the route becomes a template stop, in route order, so applying the template
-- to a new storm brings back the same visit structure.
--
-- Templates saved before this update keep one stop per property (they are not
-- changed). snow_apply_route_template() already creates one visit per template
-- stop, so it needs no change. Editing a template never touches past storms.
-- ============================================================================

create or replace function public.snow_save_route_template(p_route_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r record;
  tid uuid;
  nm text := nullif(trim(coalesce(p_name, '')), '');
begin
  select * into r from public.snow_routes where id = p_route_id;
  if r is null or not public.is_staff(r.company_id) then
    raise exception 'Route not found.';
  end if;

  insert into public.snow_route_templates (company_id, name, service, lead_person_id, media_required, min_media, notes, created_by)
  values (r.company_id, coalesce(nm, r.name), r.service, r.lead_person_id, r.media_required, r.min_media, r.notes, public.my_person_id())
  returning id into tid;

  -- One template stop per visit, in route order. A property visited twice on
  -- the route is two template stops.
  insert into public.snow_route_template_stops (template_id, company_id, property_id, position)
  select tid, r.company_id, v.property_id, row_number() over (order by v.position)
    from public.snow_visits v
   where v.route_id = p_route_id;

  return tid;
end;
$$;

revoke all on function public.snow_save_route_template(uuid, text) from public;
grant execute on function public.snow_save_route_template(uuid, text) to authenticated;
