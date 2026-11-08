-- ============================================================================
-- Update 51 — run once in Supabase → SQL Editor, AFTER 020b, 028, 029 and 050
-- (safe to run again). NOT run yet; read it before running.
--
-- Clear the activity logs. Owner/admin only.
--
-- SNOW ACTIVITY LOG
--  • Archive a period ("move it to history"): today, yesterday, a whole year, everything up to a date, or all time.
--    Archived entries leave the normal log but are kept, and show in the Archived view. Restore brings them back.
--  • Delete a period for good (the entries are removed from the database).
--  • Either way one short note is added to the log saying what was cleared and by whom, so the log never changes silently.
--  • Nobody else can change or delete log entries: the "append only" rule from 20b still applies to everything except
--    these functions, for owner/admin.
--  • The feed and the filter lists hide archived entries unless asked for them.
-- PROJECT ACTIVITY LOG (landscaping)
--  • Owner/admin can delete a project's history entries for a period (they had no delete rule before).
-- ============================================================================

alter table public.snow_activity_events add column if not exists archived_at timestamptz;
alter table public.snow_activity_events add column if not exists archived_by uuid references public.people(id) on delete set null;
create index if not exists idx_snow_activity_archived on public.snow_activity_events (company_id, occurred_at desc) where archived_at is not null;

-- Still append-only, except for the owner/admin clearing functions below (flag set for one transaction).
create or replace function public.snow_activity_append_only()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('snow.log_admin', true), '') = 'on' and public.is_staff(old.company_id) then
    if tg_op = 'DELETE' then return old; end if;
    -- an update may change only the two archive columns
    if (to_jsonb(new) - 'archived_at' - 'archived_by') = (to_jsonb(old) - 'archived_at' - 'archived_by') then return new; end if;
  end if;
  raise exception 'The snow activity log can''t be changed or deleted.';
end;
$$;

-- p_mode: 'archive' | 'restore' | 'delete'. Range is [p_from, p_to): either end may be null (open).
-- p_dry_run = true only counts what would be affected (for the confirmation question).
create or replace function public.snow_clear_activity(p_from timestamptz, p_to timestamptz, p_mode text, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public._snow_my_company();
  me uuid := public.my_person_id();
  n int;
begin
  if cid is null or not public.is_staff(cid) then raise exception 'Only the owner or an admin can clear the activity log.'; end if;
  if p_mode not in ('archive', 'restore', 'delete') then raise exception 'Unknown action.'; end if;

  if p_dry_run then
    select count(*) into n from public.snow_activity_events e
     where e.company_id = cid
       and (p_from is null or e.occurred_at >= p_from) and (p_to is null or e.occurred_at < p_to)
       and case p_mode when 'archive' then e.archived_at is null when 'restore' then e.archived_at is not null else true end;
    return jsonb_build_object('count', n, 'mode', p_mode, 'dry_run', true);
  end if;

  perform set_config('snow.log_admin', 'on', true);
  if p_mode = 'archive' then
    update public.snow_activity_events e set archived_at = now(), archived_by = me
     where e.company_id = cid and e.archived_at is null
       and (p_from is null or e.occurred_at >= p_from) and (p_to is null or e.occurred_at < p_to);
  elsif p_mode = 'restore' then
    update public.snow_activity_events e set archived_at = null, archived_by = null
     where e.company_id = cid and e.archived_at is not null
       and (p_from is null or e.occurred_at >= p_from) and (p_to is null or e.occurred_at < p_to);
  else
    delete from public.snow_activity_events e
     where e.company_id = cid
       and (p_from is null or e.occurred_at >= p_from) and (p_to is null or e.occurred_at < p_to);
  end if;
  get diagnostics n = row_count;
  perform set_config('snow.log_admin', 'off', true);

  -- A short trace (added after the clearing, so it is never swept up by it).
  if n > 0 then
    perform public.snow_log_event(cid, 'activity.' || case p_mode when 'archive' then 'archived' when 'restore' then 'restored' else 'deleted' end,
      'activity', null,
      p_note => n || (case when n = 1 then ' entry ' else ' entries ' end) ||
                case p_mode when 'archive' then 'moved to history' when 'restore' then 'restored from history' else 'deleted' end ||
                case when p_from is null and p_to is null then ' (all time)'
                     else ' (' || coalesce(to_char(p_from, 'Mon DD, YYYY'), 'the start') || ' to ' || coalesce(to_char(p_to - interval '1 second', 'Mon DD, YYYY'), 'now') || ')' end);
  end if;
  return jsonb_build_object('count', n, 'mode', p_mode, 'dry_run', false);
end;
$$;
revoke all on function public.snow_clear_activity(timestamptz, timestamptz, text, boolean) from public, anon;
grant execute on function public.snow_clear_activity(timestamptz, timestamptz, text, boolean) to authenticated;

-- The feed: archived entries are hidden unless p_archived is true (then ONLY archived ones are shown).
drop function if exists public.snow_activity_feed(uuid, uuid, uuid, uuid, uuid, text, timestamptz, uuid, int);
create or replace function public.snow_activity_feed(
  p_company_id uuid,
  p_storm_id uuid default null,
  p_route_id uuid default null,
  p_person_id uuid default null,
  p_property_id uuid default null,
  p_action text default null,
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_limit int default 50,
  p_archived boolean default false
) returns table (
  id uuid, occurred_at timestamptz, actor_id uuid, actor_name text, action text, entity_type text, entity_id uuid,
  storm_id uuid, route_id uuid, visit_id uuid, property_id uuid, person_id uuid, person_name text, service text,
  before jsonb, after jsonb, note text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff(p_company_id) then
    raise exception 'Only the owner can view the snow activity log.';
  end if;
  return query
  select e.id, e.occurred_at, e.actor_id,
         nullif(trim(a.first_name || ' ' || a.last_name), ''),
         e.action, e.entity_type, e.entity_id,
         e.storm_id, e.route_id, e.visit_id, e.property_id,
         e.person_id,
         nullif(trim(w.first_name || ' ' || w.last_name), ''),
         e.service, e.before, e.after, e.note
  from public.snow_activity_events e
  left join public.people a on a.id = e.actor_id
  left join public.people w on w.id = e.person_id
  where e.company_id = p_company_id
    and ((p_archived and e.archived_at is not null) or (not p_archived and e.archived_at is null))
    and (p_storm_id is null or e.storm_id = p_storm_id)
    and (p_route_id is null or e.route_id = p_route_id)
    and (p_property_id is null or e.property_id = p_property_id)
    and (p_person_id is null or e.person_id = p_person_id or e.actor_id = p_person_id)
    and (p_action is null or e.action = p_action or split_part(e.action, '.', 1) = p_action)
    and (p_before_at is null
         or (e.occurred_at, e.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by e.occurred_at desc, e.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
revoke all on function public.snow_activity_feed(uuid, uuid, uuid, uuid, uuid, text, timestamptz, uuid, int, boolean) from public, anon;
grant execute on function public.snow_activity_feed(uuid, uuid, uuid, uuid, uuid, text, timestamptz, uuid, int, boolean) to authenticated;

-- Years that have log entries (for "archive a whole year"), newest first. Archived and live entries both count.
create or replace function public.snow_activity_years()
returns table (year int, live bigint, archived bigint)
language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public._snow_my_company();
begin
  if cid is null or not public.is_staff(cid) then raise exception 'Only the owner can view the snow activity log.'; end if;
  return query
  select extract(year from e.occurred_at)::int, count(*) filter (where e.archived_at is null), count(*) filter (where e.archived_at is not null)
    from public.snow_activity_events e where e.company_id = cid
   group by 1 order by 1 desc;
end;
$$;
revoke all on function public.snow_activity_years() from public, anon;
grant execute on function public.snow_activity_years() to authenticated;

-- PROJECT ACTIVITY LOG: delete a project's history entries for a period (owner/admin). p_dry_run only counts.
create or replace function public.clear_project_activity(p_project_id uuid, p_from timestamptz, p_to timestamptz, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cid uuid; n int;
begin
  select company_id into cid from public.projects where id = p_project_id;
  if cid is null or not public.is_staff(cid) then raise exception 'Only the owner or an admin can clear a project''s activity.'; end if;
  if p_dry_run then
    select count(*) into n from public.project_history h
     where h.project_id = p_project_id and (p_from is null or h.created_at >= p_from) and (p_to is null or h.created_at < p_to);
    return jsonb_build_object('count', n, 'dry_run', true);
  end if;
  delete from public.project_history h
   where h.project_id = p_project_id and (p_from is null or h.created_at >= p_from) and (p_to is null or h.created_at < p_to);
  get diagnostics n = row_count;
  return jsonb_build_object('count', n, 'dry_run', false);
end;
$$;
revoke all on function public.clear_project_activity(uuid, timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.clear_project_activity(uuid, timestamptz, timestamptz, boolean) to authenticated;

-- The filter lists (storm, route, worker...) count live entries only, so archived entries don't clutter them.
drop function if exists public.snow_activity_filter_options(uuid);
create or replace function public.snow_activity_filter_options(p_company_id uuid)
returns table (kind text, id uuid, action text, label text, event_count bigint, last_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff(p_company_id) then
    raise exception 'Only the owner can view the snow activity log.';
  end if;
  return query
  with ev as (
    select * from public.snow_activity_events e where e.company_id = p_company_id and e.archived_at is null
  ),
  dims as (
    select 'storm'::text kind, ev.storm_id dim, ev.occurred_at from ev where ev.storm_id is not null
    union all select 'route', ev.route_id, ev.occurred_at from ev where ev.route_id is not null
    union all select 'property', ev.property_id, ev.occurred_at from ev where ev.property_id is not null
    union all select 'worker', ev.person_id, ev.occurred_at from ev where ev.person_id is not null
    union all select 'worker', ev.actor_id, ev.occurred_at from ev
      where ev.actor_id is not null and ev.actor_id is distinct from ev.person_id
  ),
  grouped as (
    select d.kind, d.dim, count(*) n, max(d.occurred_at) last_at from dims d group by d.kind, d.dim
  )
  select g.kind, g.dim, null::text,
    coalesce(
      case g.kind
        when 'worker' then (select nullif(trim(p.first_name || ' ' || p.last_name), '') from public.people p where p.id = g.dim)
        when 'storm' then (select s.name from public.snow_storms s where s.id = g.dim)
        when 'route' then (select r.name from public.snow_routes r where r.id = g.dim)
        when 'property' then (select p.name from public.snow_properties p where p.id = g.dim)
      end,
      (select coalesce(x.after ->> 'name', x.after ->> 'title', x.after ->> 'address')
         from ev x
        where x.entity_id = g.dim
          and coalesce(x.after ->> 'name', x.after ->> 'title', x.after ->> 'address') is not null
        order by x.occurred_at desc limit 1)
    ),
    g.n, g.last_at
  from grouped g
  union all
  select 'action', null::uuid, ev.action, null::text, count(*), max(ev.occurred_at)
  from ev group by ev.action
  order by 1, 6 desc;
end;
$$;
revoke all on function public.snow_activity_filter_options(uuid) from public, anon;
grant execute on function public.snow_activity_filter_options(uuid) to authenticated;
