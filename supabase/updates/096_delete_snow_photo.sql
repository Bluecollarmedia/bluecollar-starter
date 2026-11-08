-- Update 96: the owner or an admin can delete a Snow stop photo or video (any time, even one already sent to the customer: it disappears for
-- them). Snow keeps its history otherwise, so this uses the same "purge" allowance as deleting a storm (update 50), only inside this function.
-- The file itself is left for the storage clean-up job. Safe to run more than once.

create or replace function public.snow_delete_media(p_media_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m record;
begin
  select * into m from public.snow_completion_media where id = p_media_id;
  if m.id is null or not public.is_staff(m.company_id) then raise exception 'Photo not found.'; end if;
  perform set_config('snow.purge', 'on', true);   -- this transaction only
  delete from public.snow_completion_media where id = p_media_id;
  perform set_config('snow.purge', 'off', true);
  perform public.snow_log_event(m.company_id, 'media.deleted', 'snow_completion_media', m.id, m.storm_id, m.route_id, m.visit_id, m.property_id,
                                p_service => m.service, p_note => 'Deleted by the owner');
end;
$$;
revoke all on function public.snow_delete_media(uuid) from public, anon;
grant execute on function public.snow_delete_media(uuid) to authenticated;
