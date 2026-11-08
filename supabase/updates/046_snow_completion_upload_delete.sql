-- 046: let the app clean up a completion photo/video that was uploaded but never saved.
-- Needs: 026 (completion upload/read policies) and 030 (snow_completion_media). Safe to run twice.
-- Before: if saving a completion photo failed after the file had uploaded, the app tried to delete the file but
--   no delete rule existed, so the file stayed in storage with nothing pointing to it.
-- Now: the crew lead of that stop (while it is still pending/arrived) or owner/admin can delete a completion file,
--   but ONLY if no saved completion-media row uses it. Saved photos are never deletable this way.
-- Nobody else (crew members, customers, other companies) can delete anything.

drop policy if exists snow_media_completion_delete on storage.objects;
create policy snow_media_completion_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'snow-media'
    and (storage.foldername(name))[2] = 'completion'
    and not exists (select 1 from public.snow_completion_media m where m.file_key = name)
    and (
      public.is_staff(public._try_uuid((storage.foldername(name))[1]))
      or exists (
        select 1 from public.snow_visits v
        where v.id = public._try_uuid((storage.foldername(name))[3])
          and v.company_id = public._try_uuid((storage.foldername(name))[1])
          and v.status in ('pending', 'arrived')
          and public.snow_leads_dispatched_route(v.route_id)
      )
    )
  );
