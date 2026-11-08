-- ============================================================================
-- 032 · Snow Mode: the owner adds a photo or video to a completed stop
--
-- Run this in the Supabase SQL Editor AFTER update 030 (media review). It is
-- safe to run again: nothing here changes existing data.
--
--  • snow_owner_add_media(): owner/admin attach a photo or video to a stop
--    that is already completed (a lead can only add to a stop that isn't
--    finished). The owner added it, so it starts as "approved" (no second
--    review). It is NOT shared with the customer until the owner sends it
--    from Photo review, and it's logged as 'media.owner_added'.
--  • A storage rule so owner/admin can upload into a completed stop's folder
--    (leads can only upload while the stop is not started or on site).
--
-- Nothing here touches Landscaping.
-- ============================================================================

create or replace function public.snow_owner_add_media(
  p_visit_id uuid, p_kind text, p_file_key text,
  p_size_bytes bigint default null, p_duration_s numeric default null, p_captured_at timestamptz default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v public.snow_visits;
  mid uuid;
begin
  select * into v from public.snow_visits where id = p_visit_id;
  if v.id is null or not public.is_staff(v.company_id) then raise exception 'Stop not found.'; end if;
  if v.status <> 'completed' then
    raise exception 'You can add a photo here only to a completed stop.';
  end if;
  if p_kind not in ('photo', 'video') then raise exception 'Choose a photo or a video.'; end if;
  if p_file_key is null or p_file_key not like v.company_id::text || '/completion/' || v.id::text || '/%' then
    raise exception 'That file doesn''t belong to this stop.';
  end if;
  select id into mid from public.snow_completion_media where visit_id = v.id and file_key = p_file_key;
  if mid is not null then return mid; end if;  -- retry

  insert into public.snow_completion_media
    (visit_id, kind, file_key, size_bytes, duration_s, uploaded_by, captured_at, review_status, reviewed_by, reviewed_at)
  values
    (v.id, p_kind, p_file_key, p_size_bytes, p_duration_s, public.my_person_id(), coalesce(p_captured_at, now()),
     'approved', public.my_person_id(), now())
  returning id into mid;

  perform public.snow_log_event(v.company_id, 'media.owner_added', 'snow_completion_media', mid, v.storm_id, v.route_id,
                                v.id, v.property_id, p_service => v.service);
  return mid;
end;
$$;

revoke all on function public.snow_owner_add_media(uuid, text, text, bigint, numeric, timestamptz) from public;
grant execute on function public.snow_owner_add_media(uuid, text, text, bigint, numeric, timestamptz) to authenticated;

drop policy if exists snow_media_completion_staff_upload on storage.objects;
create policy snow_media_completion_staff_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'snow-media'
    and (storage.foldername(name))[2] = 'completion'
    and exists (
      select 1 from public.snow_visits v
      where v.id = public._try_uuid((storage.foldername(name))[3])
        and v.company_id = public._try_uuid((storage.foldername(name))[1])
        and v.status = 'completed'
        and public.is_staff(v.company_id)
    )
  );
