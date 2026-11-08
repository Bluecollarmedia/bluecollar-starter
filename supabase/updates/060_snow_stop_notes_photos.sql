-- ============================================================================
-- Update 60 — run once in Supabase → SQL Editor (safe to run again).
--
-- Snow: each property (stop) on a route can now carry the owner's own settings, set while building the route:
--  • owner_note: a note for that property (the crew sees it on their route).
--  • photos_required: true = photos are required at this property, false = not required, empty = follow the route's rule.
-- Finishing a stop checks the property's setting first, then the route's. Only owners/admins can change them (staff-only
-- write access on snow_visits, as before). Nothing existing changes.
-- ============================================================================

alter table public.snow_visits add column if not exists owner_note text check (owner_note is null or length(owner_note) <= 1000);
alter table public.snow_visits add column if not exists photos_required boolean;

create or replace function public.snow_visit_status_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  storm_status text;
  me uuid := public.my_person_id();
  rt record;
  media_count int;
begin
  if new.status = old.status then
    -- Recorded times stay as recorded.
    new.arrived_at := old.arrived_at; new.arrived_by := old.arrived_by;
    new.completed_at := old.completed_at; new.completed_by := old.completed_by;
    new.skipped_at := old.skipped_at; new.skipped_by := old.skipped_by;
    if old.status in ('completed', 'skipped') then
      new.completion_note := old.completion_note;
    end if;
    return new;
  end if;
  if old.status in ('completed', 'skipped') then
    raise exception 'This visit is already %. Add a new visit for more work.', old.status;
  end if;
  select status into storm_status from public.snow_storms where id = old.storm_id;
  if storm_status <> 'dispatched' then
    raise exception 'Work can only be recorded while the storm is dispatched.';
  end if;

  if new.status = 'pending' then
    raise exception 'A started visit can''t go back to not started.';
  elsif new.status = 'arrived' then
    new.arrived_at := coalesce(new.arrived_at, now());
    new.arrived_by := coalesce(new.arrived_by, me);
  elsif new.status = 'completed' then
    if old.status = 'pending' and coalesce((select require_arrival_before_completion from public.snow_settings
                                             where company_id = old.company_id), true) then
      raise exception 'Tap I''m Here at this property first.';
    end if;
    select media_required, min_media into rt from public.snow_routes where id = old.route_id;
    -- Update 60: the owner can say per property whether photos are required; otherwise the route's rule applies.
    if coalesce(old.photos_required, rt.media_required) then
      select count(*) into media_count from public.snow_completion_media where visit_id = old.id;
      if media_count < rt.min_media then
        raise exception 'Add % more photo(s) or video(s) before completing this stop.', rt.min_media - media_count;
      end if;
    end if;
    new.completed_at := coalesce(new.completed_at, now());
    new.completed_by := coalesce(new.completed_by, me);
    new.arrived_at := coalesce(old.arrived_at, new.arrived_at);
    new.arrived_by := coalesce(old.arrived_by, new.arrived_by);
  elsif new.status = 'skipped' then
    if not exists (select 1 from public.snow_skip_requests where visit_id = old.id and status = 'approved') then
      raise exception 'A visit can only be skipped after its skip request is approved.';
    end if;
    new.skipped_at := coalesce(new.skipped_at, now());
    new.skipped_by := coalesce(new.skipped_by, me);
    new.completed_at := null; new.completed_by := null;
  end if;
  return new;
end;
$$;
