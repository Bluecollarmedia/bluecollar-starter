-- ============================================================================
-- Update 88 — run once in Supabase → SQL Editor (safe to run again). NOT run yet; read it before running.
--
-- A worker never waits for photos. Before, a stop could not be completed until its photos were saved, so a slow or failing upload
-- stranded the crew at the property. Now:
--   * Completing a stop no longer checks for photos. (The "photos required" settings stay as a reminder in the app, not a lock.)
--   * A photo or video can still be added to a stop AFTER it is completed, by the route lead, as long as the storm is still on the
--     books (the app keeps uploading in the background and attaches the photo when it arrives). It is shared with the customer by
--     itself like any other (update 87).
-- Nothing is deleted or rewritten.
-- ============================================================================

-- 1. Completing a stop: the same rules as update 60, without the photo count.
create or replace function public.snow_visit_status_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  storm_status text;
  me uuid := public.my_person_id();
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

-- 2. The lead may add a photo to a stop that is already completed (a skipped stop still takes none).
create or replace function public.snow_add_completion_media(
  p_visit_id uuid, p_kind text, p_file_key text,
  p_size_bytes bigint default null, p_duration_s numeric default null, p_captured_at timestamptz default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v public.snow_visits;
  mid uuid;
begin
  v := public._snow_visit_for_lead(p_visit_id);
  if v.status not in ('pending', 'arrived', 'completed') then
    raise exception 'This stop is already %.', v.status;
  end if;
  if p_file_key is null or p_file_key not like v.company_id::text || '/completion/' || v.id::text || '/%' then
    raise exception 'That file doesn''t belong to this stop.';
  end if;
  select id into mid from public.snow_completion_media where visit_id = v.id and file_key = p_file_key;
  if mid is not null then return mid; end if;  -- retry
  insert into public.snow_completion_media (visit_id, kind, file_key, size_bytes, duration_s, uploaded_by, captured_at)
  values (v.id, p_kind, p_file_key, p_size_bytes, p_duration_s, public.my_person_id(), coalesce(p_captured_at, now()))
  returning id into mid;
  return mid;
end;
$$;

-- 3. The storage rule for the 1-byte stand-in follows: a completed stop still accepts its photos.
drop policy if exists snow_media_completion_upload on storage.objects;
create policy snow_media_completion_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'snow-media'
    and (storage.foldername(name))[2] = 'completion'
    and exists (
      select 1 from public.snow_visits v
      where v.id = public._try_uuid((storage.foldername(name))[3])
        and v.company_id = public._try_uuid((storage.foldername(name))[1])
        and v.status in ('pending', 'arrived', 'completed')
        and public.snow_leads_dispatched_route(v.route_id)
    )
  );

notify pgrst, 'reload schema';
