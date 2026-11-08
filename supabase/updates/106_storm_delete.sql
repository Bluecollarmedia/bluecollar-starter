-- ============================================================================
-- Update 106 — run once in Supabase → SQL Editor, AFTER 105. Safe to run again.
--
-- The owner can delete a storm update, or a whole storm, that was published by mistake. It disappears for everyone, Storm History included.
--   * ONLY a signed-in, ACTIVE member whose role is exactly 'owner' can do it (not admins, workers, customers, or signed-out callers),
--     and only for their own company's storms.
--   * Deleting the last update of a storm removes the storm too. Deleting an update of a storm that has others makes the one before it current.
--   * Changing a published update is still impossible. Only the two functions below can delete, and only for the owner.
--   * Adds owner_storm_history(): every storm of the owner's company (whether or not public Weather is on), so the owner can see what can be deleted.
--   * A picture that was attached to a deleted update stays in storage but is no longer linked from anywhere.
-- Nothing existing is dropped or re-granted.
-- ============================================================================

-- Same function as in update 104, now with one narrow exception: a DELETE is allowed while the owner's delete functions below are running.
create or replace function public.storm_versions_are_permanent() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.storm_owner_delete', true), '') = '1' then
    return old;
  end if;
  raise exception 'A published storm update cannot be changed or deleted.';
end;
$$;

create or replace function public.owner_storm_history()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.my_person_id(); cid uuid;
begin
  if me is null then raise exception 'Only the owner can do that.'; end if;
  select m.company_id into cid from public.company_members m where m.person_id = me and m.role = 'owner' and m.status = 'active' limit 1;
  if cid is null then raise exception 'Only the owner can do that.'; end if;
  return coalesce((
    select jsonb_agg(
      public.storm_outlook_json(o.id) || jsonb_build_object('versions', (
        select coalesce(jsonb_agg(to_jsonb(v) - 'published_by' - 'outlook_id' order by v.version_no desc), '[]'::jsonb)
          from public.storm_outlook_versions v where v.outlook_id = o.id))
      order by o.created_at desc)
    from (select * from public.storm_outlooks x
           where x.company_id = cid and exists (select 1 from public.storm_outlook_versions v where v.outlook_id = x.id)
           order by x.created_at desc limit 50) o
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.owner_storm_history() from public, anon;
grant execute on function public.owner_storm_history() to authenticated;

-- Delete one update. If it was the only one, the storm goes too.
create or replace function public.delete_storm_update(p_version_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_person_id(); cid uuid; oid uuid; left_over integer;
begin
  if me is null then raise exception 'Only the owner can do that.'; end if;
  select m.company_id into cid from public.company_members m where m.person_id = me and m.role = 'owner' and m.status = 'active' limit 1;
  if cid is null then raise exception 'Only the owner can do that.'; end if;
  select v.outlook_id into oid from public.storm_outlook_versions v join public.storm_outlooks o on o.id = v.outlook_id
   where v.id = p_version_id and o.company_id = cid;
  if oid is null then raise exception 'That storm update was not found.'; end if;
  perform set_config('app.storm_owner_delete', '1', true);
  delete from public.storm_outlook_versions where id = p_version_id;
  select count(*) into left_over from public.storm_outlook_versions where outlook_id = oid;
  if left_over = 0 then delete from public.storm_outlooks where id = oid; end if;
  perform set_config('app.storm_owner_delete', '', true);
  return jsonb_build_object('deleted', true, 'storm_deleted', left_over = 0);
end;
$$;
revoke all on function public.delete_storm_update(uuid) from public, anon;
grant execute on function public.delete_storm_update(uuid) to authenticated;

-- Delete a whole storm with all of its updates.
create or replace function public.delete_storm_outlook(p_outlook_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_person_id(); cid uuid; n integer;
begin
  if me is null then raise exception 'Only the owner can do that.'; end if;
  select m.company_id into cid from public.company_members m where m.person_id = me and m.role = 'owner' and m.status = 'active' limit 1;
  if cid is null then raise exception 'Only the owner can do that.'; end if;
  perform set_config('app.storm_owner_delete', '1', true);
  delete from public.storm_outlooks where id = p_outlook_id and company_id = cid;
  get diagnostics n = row_count;
  perform set_config('app.storm_owner_delete', '', true);
  if n = 0 then raise exception 'That storm was not found.'; end if;
  return jsonb_build_object('deleted', true);
end;
$$;
revoke all on function public.delete_storm_outlook(uuid) from public, anon;
grant execute on function public.delete_storm_outlook(uuid) to authenticated;

notify pgrst, 'reload schema';
