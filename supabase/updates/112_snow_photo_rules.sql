-- ============================================================================
-- Update 112 — run once in Supabase → SQL Editor, AFTER 111. Safe to run again.
--
-- Snow photo rules, set where the owner builds things:
--   * Each service at a property (plowing, shoveling, salting) can carry its OWN photo rule: required or not, and how many photos
--     (snow_property_services.photos_required / photo_count). Empty = follow the route.
--   * A stop (one property on a route) can carry its own count too (snow_visits.min_media, 1 to 20). Empty = follow the route's count.
--   * When a stop is added to a route, it starts from its property's rule for that service (a trigger fills photos_required and min_media
--     if they were not given). The owner can still change any one stop, or the whole route, afterwards.
--   * ADDITIVE: three new columns and one new trigger. Nothing existing is dropped or changed. Existing stops, routes and properties
--     keep following the route exactly as before.
-- ============================================================================

alter table public.snow_property_services add column if not exists photos_required boolean;
alter table public.snow_property_services add column if not exists photo_count integer;
alter table public.snow_visits add column if not exists min_media integer;

do $$ begin
  alter table public.snow_property_services add constraint snow_property_services_photo_count_check check (photo_count is null or photo_count between 1 and 20);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.snow_visits add constraint snow_visits_min_media_check check (min_media is null or min_media between 1 and 20);
exception when duplicate_object then null; end $$;

-- A new stop starts from its property's rule for that service.
create or replace function public._snow_visit_photo_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
declare ps record;
begin
  select p.photos_required, p.photo_count into ps
    from public.snow_property_services p
   where p.property_id = new.property_id and p.service = new.service
   limit 1;
  if ps is null then return new; end if;
  if new.photos_required is null and ps.photos_required is not null then new.photos_required := ps.photos_required; end if;
  if new.min_media is null and ps.photo_count is not null then new.min_media := ps.photo_count; end if;
  return new;
end;
$$;
revoke all on function public._snow_visit_photo_defaults() from public, anon, authenticated;
drop trigger if exists snow_visits_photo_defaults on public.snow_visits;
create trigger snow_visits_photo_defaults before insert on public.snow_visits
  for each row execute function public._snow_visit_photo_defaults();

notify pgrst, 'reload schema';
