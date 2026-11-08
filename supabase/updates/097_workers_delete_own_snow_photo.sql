-- Update 97: anyone who uploaded a Snow stop photo can delete it (a wrong photo picked by mistake, before or after the stop is finished); the owner
-- and admins can delete any. Replaces the function from update 96. Snow keeps its history otherwise: the allowance below is only on inside this
-- function, for this one delete. The file itself is left for the storage clean-up job. Safe to run more than once.

create or replace function public._snow_purging(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (coalesce(current_setting('snow.purge', true), '') = 'on' and public.is_staff(cid))
      or coalesce(current_setting('snow.media_delete', true), '') = 'on'
$$;
revoke all on function public._snow_purging(uuid) from public, anon;

create or replace function public.snow_delete_media(p_media_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  m record;
begin
  select * into m from public.snow_completion_media where id = p_media_id;
  if m.id is null or me is null or not (public.is_staff(m.company_id) or m.uploaded_by = me) then raise exception 'Photo not found.'; end if;
  perform set_config('snow.media_delete', 'on', true);   -- this transaction only
  delete from public.snow_completion_media where id = p_media_id;
  perform set_config('snow.media_delete', 'off', true);
  perform public.snow_log_event(m.company_id, 'media.deleted', 'snow_completion_media', m.id, m.storm_id, m.route_id, m.visit_id, m.property_id,
                                p_service => m.service, p_note => case when public.is_staff(m.company_id) then 'Deleted by the owner' else 'Deleted by the person who uploaded it' end);
end;
$$;
revoke all on function public.snow_delete_media(uuid) from public, anon;
grant execute on function public.snow_delete_media(uuid) to authenticated;
