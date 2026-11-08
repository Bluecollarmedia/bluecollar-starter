-- ============================================================================
-- Update 29 — Snow Mode activity log: complete coverage and Owner filters.
-- Run in Supabase → SQL Editor after update 20b and the other snow updates.
-- Safe to run again, and worth re-running after any later snow update that
-- adds tables (or end that update with: select public.snow_attach_audit_all();).
--
--  • Builds on update 20b's snow_activity_events table and snow_log_event().
--    It doesn't create or reshape the table.
--  • 20b already logs storms, routes, lead changes, visits, media uploads,
--    skip requests, properties and settings with its own <table>_log
--    triggers. Every OTHER snow_* table with a company_id (snow team access,
--    property services and contacts, signup codes, shifts, notifications …)
--    gets a generic audit trigger here, so nothing a snow screen changes goes
--    unrecorded. Tables that already have a <table>_log trigger are skipped,
--    so nothing is logged twice.
--  • The Owner reads the log through snow_activity_feed() (filtered by storm,
--    route, worker, property and action, newest first, paged) and
--    snow_activity_filter_options() (the choices for each filter, named from
--    the log itself so deleted records still appear).
--  • Owner/admin only. Workers and customers can't read it.
-- ============================================================================

do $$
begin
  if to_regclass('public.snow_activity_events') is null
     or to_regprocedure('public.snow_log_event(uuid, text, text, uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb, text)') is null then
    raise exception 'Run update 20b (snow foundation) before update 29.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'snow_activity_events' and column_name = 'entity_type'
  ) then
    raise exception 'snow_activity_events has an older shape. Ask Claude for the one-time fix before running update 29.';
  end if;
end $$;

-- An earlier draft of this update defined a 14-argument snow_log_event. With
-- both installed, 20b's 13-argument calls fail as "not unique". Remove it.
drop function if exists public.snow_log_event(uuid, text, text, uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb, jsonb, text, jsonb);

-- The worker filter also matches who did it.
create index if not exists idx_snow_activity_actor on public.snow_activity_events (actor_id, occurred_at desc) where actor_id is not null;

-- ── Generic audit for snow tables 20b doesn't log ───────────────────────────
-- TG_ARGV[0] is the entity name used in actions ('staff', 'shift' …).
-- Filter ids come from well-known column names; the record's own id fills its
-- own dimension. A row that only points at its visit (or route) inherits the
-- storm, route, property and service from that record's earlier events.
-- Verb for an update:
--   status changed            → the new status ('approved', 'revoked' …),
--                               or 'reopened' when leaving 'ended'/'closed'
--   a *_status column changed → its new value ('shared', 'delivered' …)
--   arrived_at set            → 'arrived'
--   clock-out time set        → 'clocked_out' (shifts, time entries)
--   lead changed              → 'lead_changed'
--   assigned person changed   → 'reassigned'
--   only the order changed    → 'moved'
--   anything else             → 'updated'
-- Updates that change nothing but updated_at aren't logged.
create or replace function public.snow_audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_entity text := tg_argv[0];
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_before jsonb;
  v_after jsonb;
  v_changed text[] := '{}';
  v_verb text;
  v_key text;
  v_status_col text;
  v_id_of text := v_row ->> 'id';
  v_company uuid := (v_row ->> 'company_id')::uuid;
  v_storm uuid;
  v_route uuid;
  v_visit uuid;
  v_property uuid;
  v_service text;
  v_prior record;
begin
  if v_company is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    v_verb := 'created';
    v_after := v_new;
  elsif tg_op = 'DELETE' then
    v_verb := 'deleted';
    v_before := v_old;
  else
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key not in ('updated_at', 'created_at') and (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_changed := v_changed || v_key;
      end if;
    end loop;
    if cardinality(v_changed) = 0 then
      return null;
    end if;
    select jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k)
      into v_before, v_after
      from unnest(v_changed) k;

    select k into v_status_col from unnest(v_changed) k where k like '%\_status' order by k limit 1;
    if 'status' = any (v_changed) then
      if (v_old ->> 'status') in ('ended', 'closed') and (v_new ->> 'status') not in ('ended', 'closed') then
        v_verb := 'reopened';
      else
        v_verb := coalesce(v_new ->> 'status', 'cleared');
      end if;
    elsif v_status_col is not null then
      v_verb := coalesce(v_new ->> v_status_col, 'cleared');
    elsif 'arrived_at' = any (v_changed) and v_new ->> 'arrived_at' is not null then
      v_verb := 'arrived';
    elsif v_changed && array['clock_out_at', 'clocked_out_at', 'ended_at', 'end_at']
          and v_entity in ('shift', 'time_entry', 'time_record', 'clock_entry') then
      v_verb := 'clocked_out';
    elsif v_changed && array['lead_person_id', 'lead_worker_id'] then
      v_verb := 'lead_changed';
    elsif v_changed && array['assigned_person_id', 'worker_person_id', 'person_id'] then
      v_verb := 'reassigned';
    elsif v_changed <@ array['position', 'sequence', 'sort_order'] then
      v_verb := 'moved';
    else
      v_verb := 'updated';
    end if;
    v_verb := lower(regexp_replace(v_verb, '[^a-zA-Z_]+', '_', 'g'));
  end if;

  v_storm := (case when v_entity = 'storm' then v_id_of else v_row ->> 'storm_id' end)::uuid;
  v_route := (case when v_entity = 'route' then v_id_of else v_row ->> 'route_id' end)::uuid;
  v_visit := (case when v_entity = 'visit' then v_id_of else v_row ->> 'visit_id' end)::uuid;
  v_property := (case when v_entity = 'property' then v_id_of else v_row ->> 'property_id' end)::uuid;
  v_service := v_row ->> 'service';

  if v_visit is not null and (v_storm is null or v_route is null or v_property is null or v_service is null) then
    select e.storm_id, e.route_id, e.property_id, e.service into v_prior
      from public.snow_activity_events e
     where e.company_id = v_company and e.visit_id = v_visit
     order by e.occurred_at desc limit 1;
    if found then
      v_storm := coalesce(v_storm, v_prior.storm_id);
      v_route := coalesce(v_route, v_prior.route_id);
      v_property := coalesce(v_property, v_prior.property_id);
      v_service := coalesce(v_service, v_prior.service);
    end if;
  end if;
  if v_route is not null and (v_storm is null or v_service is null) then
    select e.storm_id, e.service into v_prior
      from public.snow_activity_events e
     where e.company_id = v_company and e.route_id = v_route and e.storm_id is not null
     order by e.occurred_at desc limit 1;
    if found then
      v_storm := coalesce(v_storm, v_prior.storm_id);
      v_service := coalesce(v_service, v_prior.service);
    end if;
  end if;

  perform public.snow_log_event(
    v_company,
    v_entity || '.' || v_verb,
    v_entity,
    v_id_of::uuid,
    v_storm, v_route, v_visit, v_property,
    coalesce(v_row ->> 'lead_person_id', v_row ->> 'worker_person_id',
             v_row ->> 'assigned_person_id', v_row ->> 'person_id')::uuid,
    v_service,
    v_before,
    v_after,
    null
  );
  return null;
end;
$$;
revoke all on function public.snow_audit_row() from public, anon, authenticated;

-- Attach the generic audit to one table. Safe to call again.
create or replace function public.snow_attach_audit(p_table regclass, p_entity text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_entity !~ '^[a-z_]+$' then
    raise exception 'Entity name must be lower_snake_case: %', p_entity;
  end if;
  execute format('drop trigger if exists snow_audit on %s', p_table);
  execute format(
    'create trigger snow_audit after insert or update or delete on %s for each row execute function public.snow_audit_row(%L)',
    p_table, p_entity
  );
end;
$$;
revoke all on function public.snow_attach_audit(regclass, text) from public, anon, authenticated;

-- Entity name for a snow table: snow_staff_services → staff_service,
-- snow_shifts → shift, snow_property_contacts → property_contact …
create or replace function public._snow_entity_for(p_table text)
returns text language sql immutable as $$
  select case
    when p_table like 'snow\_%ies' then regexp_replace(substr(p_table, 6), 'ies$', 'y')
    when p_table like 'snow\_%sses' or p_table like 'snow\_%shes' or p_table like 'snow\_%ches'
      then regexp_replace(substr(p_table, 6), 'es$', '')
    when p_table like 'snow\_%s' and p_table not like 'snow\_%ss' then regexp_replace(substr(p_table, 6), 's$', '')
    else substr(p_table, 6)
  end
$$;

-- Attach the generic audit to every snow_* table with a company_id, except:
--  • tables 20b (or a later update) already logs with a <table>_log trigger,
--  • snow_route_lead_assignments (logged as route.lead_assigned/lead_ended),
--  • snow_shifts, snow_shift_corrections (update 28 logs shift.* itself),
--  • logs themselves (*_log, *_events).
-- A table that gains its own <table>_log trigger later loses the generic one
-- the next time this runs, so it's never logged twice.
create or replace function public.snow_attach_audit_all()
returns int language plpgsql security definer set search_path = public as $$
declare t text; n int := 0;
begin
  for t in
    select c.relname from pg_class c
    join pg_namespace s on s.oid = c.relnamespace and s.nspname = 'public'
    where c.relkind in ('r', 'p') and c.relname like 'snow\_%'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
  loop
    if t in ('snow_route_lead_assignments', 'snow_shifts', 'snow_shift_corrections')
       or t like '%\_log' or t like '%\_events'
       or exists (select 1 from pg_trigger g where g.tgrelid = format('public.%I', t)::regclass
                  and g.tgname = t || '_log' and not g.tgisinternal) then
      execute format('drop trigger if exists snow_audit on public.%I', t);
    else
      perform public.snow_attach_audit(format('public.%I', t)::regclass, public._snow_entity_for(t));
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.snow_attach_audit_all() from public, anon, authenticated;
select public.snow_attach_audit_all();

-- ── Reading the log (Owner) ─────────────────────────────────────────────────

-- Newest first, filtered, with names. Owner/admin only.
--  p_person_id matches events about that worker or done by them.
--  p_action is a whole action ('visit.completed') or its first word ('visit').
-- Page with p_before_at/p_before_id from the last row of the previous page.
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
  p_limit int default 50
) returns table (
  id uuid,
  occurred_at timestamptz,
  actor_id uuid,
  actor_name text,
  action text,
  entity_type text,
  entity_id uuid,
  storm_id uuid,
  route_id uuid,
  visit_id uuid,
  property_id uuid,
  person_id uuid,
  person_name text,
  service text,
  before jsonb,
  after jsonb,
  note text
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
revoke all on function public.snow_activity_feed(uuid, uuid, uuid, uuid, uuid, text, timestamptz, uuid, int) from public, anon;
grant execute on function public.snow_activity_feed(uuid, uuid, uuid, uuid, uuid, text, timestamptz, uuid, int) to authenticated;

-- Every storm, route, property, worker and action that appears in the log,
-- with the best name it knows: the current record's name when it still
-- exists, otherwise the latest name/title/address the log recorded. A
-- deleted storm or property still shows up for its history.
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
    select * from public.snow_activity_events e where e.company_id = p_company_id
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
