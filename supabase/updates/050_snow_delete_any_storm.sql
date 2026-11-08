-- ============================================================================
-- Update 50 — run once in Supabase → SQL Editor, AFTER 020b, 024, 031, 040, 041 and 042
-- (safe to run again). NOT run yet; read it before running.
--
-- Delete ANY storm, whatever its status (draft, dispatched or ended) — for a storm made by mistake or one that is
-- finished and no longer wanted. Before this, only drafts could be deleted.
--  • Owner/admin only, through snow_delete_storm(storm id). Nobody can delete storm records by any other route:
--    the "keep history" rules from 020b still block every other delete.
--  • Deleting a storm removes its routes, stops, skip requests, completion photo/video records, route crew and
--    lead history. Clock-in tags that point at it are cleared (the shifts stay). Notifications that point at it stay.
--  • The Activity log records the deletion (Storm deleted, Route removed, Stop removed...) like any other change.
--  • Photo FILES in storage are not removed by this update (only their database records); they stop being reachable.
--  • It returns what was removed (routes, stops, completed stops, media) so the app can show it.
-- ============================================================================

-- True only inside snow_delete_storm, for an owner/admin of the storm's company.
create or replace function public._snow_purging(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(current_setting('snow.purge', true), '') = 'on' and public.is_staff(cid)
$$;
revoke all on function public._snow_purging(uuid) from public, anon;

-- The same "keep history" rules as 020b, except while snow_delete_storm is deleting a whole storm.
create or replace function public.snow_keep_history()
returns trigger language plpgsql security definer set search_path = public as $$
declare storm_status text;
begin
  if public._snow_purging(old.company_id) then return old; end if;
  select status into storm_status from public.snow_storms where id = old.storm_id;
  -- Deleting a whole draft storm (or a record inside one) is fine.
  if storm_status is null or storm_status = 'draft' then return old; end if;

  if tg_table_name = 'snow_routes' then
    if exists (select 1 from public.snow_visits where route_id = old.id) then
      raise exception 'This route has visits and can''t be deleted. Cancel it instead.';
    end if;
  elsif tg_table_name = 'snow_visits' then
    if old.status <> 'pending'
       or exists (select 1 from public.snow_completion_media where visit_id = old.id)
       or exists (select 1 from public.snow_skip_requests where visit_id = old.id) then
      raise exception 'This visit has recorded work and can''t be deleted.';
    end if;
  else
    raise exception 'Snow history can''t be deleted.';
  end if;
  return old;
end;
$$;

create or replace function public.snow_storm_keep_history()
returns trigger language plpgsql as $$
begin
  if old.status <> 'draft' and not public._snow_purging(old.company_id) then
    raise exception 'A dispatched storm can''t be deleted. End it instead.';
  end if;
  return old;
end;
$$;

create or replace function public.snow_delete_storm(p_storm_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.snow_storms;
  n_routes int;
  n_visits int;
  n_done int;
  n_media int;
begin
  select * into s from public.snow_storms where id = p_storm_id;
  if s.id is null or not public.is_staff(s.company_id) then raise exception 'Storm not found.'; end if;

  select count(*) into n_routes from public.snow_routes where storm_id = s.id;
  select count(*), count(*) filter (where status = 'completed') into n_visits, n_done from public.snow_visits where storm_id = s.id;
  select count(*) into n_media from public.snow_completion_media where storm_id = s.id;

  perform set_config('snow.purge', 'on', true);   -- this transaction only
  delete from public.snow_storms where id = s.id;
  perform set_config('snow.purge', 'off', true);

  return jsonb_build_object('storm_id', s.id, 'name', s.name, 'status', s.status,
                            'routes', n_routes, 'stops', n_visits, 'completed_stops', n_done, 'media', n_media);
end;
$$;
revoke all on function public.snow_delete_storm(uuid) from public, anon;
grant execute on function public.snow_delete_storm(uuid) to authenticated;

-- ── Fix found while testing: deleting a skip request failed in the activity logger ───────────────────────────
-- The skip-request branch of snow_log_base (020b) read the NEW row even for a DELETE, where there is none, so any
-- delete that reached a skip request (including this storm delete) stopped with a "company_id is null" error.
-- Same function as 020b with only that branch corrected.
create or replace function public.snow_log_base()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  act text;
  diff_before jsonb;
  diff_after jsonb;
  k text;
begin
  -- Only the columns that changed.
  if tg_op = 'UPDATE' then
    diff_before := '{}'::jsonb; diff_after := '{}'::jsonb;
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at') and (o -> k) is distinct from (n -> k) then
        diff_before := diff_before || jsonb_build_object(k, o -> k);
        diff_after := diff_after || jsonb_build_object(k, n -> k);
      end if;
    end loop;
    if diff_after = '{}'::jsonb then return null; end if;
  else
    diff_before := o; diff_after := n;
  end if;

  if tg_table_name = 'snow_storms' then
    act := case
      when tg_op = 'INSERT' then 'storm.created'
      when tg_op = 'DELETE' then 'storm.deleted'
      when new.status <> old.status and new.status = 'dispatched' and old.status = 'ended' then 'storm.reopened'
      when new.status <> old.status then 'storm.' || new.status
      else 'storm.updated' end;
    perform public.snow_log_event((r->>'company_id')::uuid, act, 'storm', (r->>'id')::uuid,
      (r->>'id')::uuid, null, null, null, null, r->>'service', diff_before, diff_after);
    return null;
  elsif tg_table_name = 'snow_routes' then
    if tg_op = 'UPDATE' then
      diff_before := diff_before - 'lead_person_id';
      diff_after := diff_after - 'lead_person_id';
      if diff_after = '{}'::jsonb then return null; end if;
    end if;
    act := case
      when tg_op = 'INSERT' then 'route.created'
      when tg_op = 'DELETE' then 'route.deleted'
      when new.cancelled_at is not null and old.cancelled_at is null then 'route.cancelled'
      when (new.media_required, new.min_media) is distinct from (old.media_required, old.min_media) then 'route.media_rule_changed'
      else 'route.updated' end;
    perform public.snow_log_event((r->>'company_id')::uuid, act, 'route', (r->>'id')::uuid,
      (r->>'storm_id')::uuid, (r->>'id')::uuid, null, null, null, r->>'service', diff_before, diff_after);
    return null;
  elsif tg_table_name = 'snow_visits' then
    act := case
      when tg_op = 'INSERT' then 'visit.added'
      when tg_op = 'DELETE' then 'visit.removed'
      when new.status <> old.status then 'visit.' || new.status
      when new.route_id <> old.route_id or new.position <> old.position then 'visit.moved'
      else 'visit.updated' end;
    perform public.snow_log_event((r->>'company_id')::uuid, act, 'visit', (r->>'id')::uuid,
      (r->>'storm_id')::uuid, (r->>'route_id')::uuid, (r->>'id')::uuid, (r->>'property_id')::uuid,
      case when tg_op = 'UPDATE' and new.status <> old.status then
        coalesce(new.completed_by, new.arrived_by, new.skipped_by) end,
      r->>'service', diff_before, diff_after);
    return null;
  elsif tg_table_name = 'snow_completion_media' then
    if tg_op <> 'INSERT' then return null; end if;
    perform public.snow_log_event(new.company_id, 'media.uploaded', 'completion_media', new.id,
      new.storm_id, new.route_id, new.visit_id, new.property_id, new.uploaded_by, new.service,
      null, jsonb_build_object('kind', new.kind, 'file_key', new.file_key));
    return null;
  elsif tg_table_name = 'snow_skip_requests' then
    if tg_op = 'UPDATE' and new.status = old.status then return null; end if;
    -- (020b read new.* here even for a DELETE, where it is empty; that made deleting a skip request fail.)
    act := case when tg_op = 'INSERT' then 'skip.requested' when tg_op = 'DELETE' then 'skip.deleted' else 'skip.' || new.status end;
    perform public.snow_log_event((r->>'company_id')::uuid, act, 'skip_request', (r->>'id')::uuid,
      (r->>'storm_id')::uuid, (r->>'route_id')::uuid, (r->>'visit_id')::uuid, (r->>'property_id')::uuid, (r->>'requested_by')::uuid, null,
      diff_before, diff_after, case when tg_op = 'UPDATE' then r->>'decision_note' else r->>'reason' end);
    return null;
  elsif tg_table_name = 'snow_properties' then
    act := case when tg_op = 'INSERT' then 'property.created' when tg_op = 'DELETE' then 'property.deleted' else 'property.updated' end;
    perform public.snow_log_event((r->>'company_id')::uuid, act, 'property', (r->>'id')::uuid,
      null, null, null, (r->>'id')::uuid, null, null, diff_before, diff_after);
    return null;
  elsif tg_table_name = 'snow_settings' then
    if tg_op = 'INSERT' then return null; end if;
    perform public.snow_log_event((r->>'company_id')::uuid, 'settings.changed', 'settings', null,
      null, null, null, null, null, null, diff_before, diff_after);
    return null;
  end if;
  return null;
end;
$$;
