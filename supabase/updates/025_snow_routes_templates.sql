-- ============================================================================
-- Update 25 — run once in Supabase → SQL Editor, after 020b, 022 and 024
-- (safe to run again).
--  • Route building for a storm: the owner/admin adds routes and stops
--    directly (update 020b's owner policies and triggers fill in and check
--    everything). This file adds what can't be done safely one row at a time:
--      - reorder a route's stops in one step (positions are unique per route),
--      - save a route as a reusable template,
--      - add a template to a storm as a new route with its stops.
--  • Templates remember the stop order, the lead and the photo rule. When a
--    template is used, properties that no longer offer the storm's service
--    (or are inactive) are left out, and a lead who no longer holds the
--    service is left empty, so the owner picks someone.
--  • Route and visit changes are logged by 020b's triggers; nothing here logs
--    them twice.
-- ============================================================================

-- ── Templates ───────────────────────────────────────────────────────────────

create table if not exists public.snow_route_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  service text not null check (service in ('plowing', 'shoveling', 'salting')),
  lead_person_id uuid references public.people(id) on delete set null,
  media_required boolean not null default false,
  min_media int not null default 1 check (min_media between 1 and 20),
  notes text,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_snow_route_templates_company on public.snow_route_templates (company_id, service);

create table if not exists public.snow_route_template_stops (
  template_id uuid not null references public.snow_route_templates(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  property_id uuid not null references public.snow_properties(id) on delete cascade,
  position int not null,
  primary key (template_id, position)
);

alter table public.snow_route_templates enable row level security;
alter table public.snow_route_template_stops enable row level security;

drop policy if exists snow_route_templates_staff on public.snow_route_templates;
create policy snow_route_templates_staff on public.snow_route_templates for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));
drop policy if exists snow_route_template_stops_staff on public.snow_route_template_stops;
create policy snow_route_template_stops_staff on public.snow_route_template_stops for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));

-- ── Reorder ─────────────────────────────────────────────────────────────────
-- p_visit_ids is the route's visits in the new order. Every visit on the
-- route must be listed exactly once. Positions are rewritten in one
-- statement, so the deferred unique (route_id, position) is never hit midway.

create or replace function public.snow_reorder_route(p_route_id uuid, p_visit_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
  on_route int;
begin
  select id, company_id into r from public.snow_routes where id = p_route_id;
  if r is null or not public.is_staff(r.company_id) then
    raise exception 'Route not found.';
  end if;
  select count(*) into on_route from public.snow_visits where route_id = p_route_id;
  if coalesce(array_length(p_visit_ids, 1), 0) <> on_route
     or (select count(distinct x) from unnest(p_visit_ids) x) <> on_route
     or exists (select 1 from unnest(p_visit_ids) x
                where not exists (select 1 from public.snow_visits v where v.id = x and v.route_id = p_route_id)) then
    raise exception 'The stop list changed. Pull to refresh and try again.';
  end if;

  update public.snow_visits v
     set position = o.ord
    from unnest(p_visit_ids) with ordinality as o(visit_id, ord)
   where v.id = o.visit_id and v.position is distinct from o.ord::int;
end;
$$;

-- ── Save a route as a template ──────────────────────────────────────────────

create or replace function public.snow_save_route_template(p_route_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r record;
  tid uuid;
  nm text := nullif(trim(coalesce(p_name, '')), '');
begin
  select * into r from public.snow_routes where id = p_route_id;
  if r is null or not public.is_staff(r.company_id) then
    raise exception 'Route not found.';
  end if;

  insert into public.snow_route_templates (company_id, name, service, lead_person_id, media_required, min_media, notes, created_by)
  values (r.company_id, coalesce(nm, r.name), r.service, r.lead_person_id, r.media_required, r.min_media, r.notes, public.my_person_id())
  returning id into tid;

  -- One stop per property, in route order (repeat passes aren't template stops).
  insert into public.snow_route_template_stops (template_id, company_id, property_id, position)
  select tid, r.company_id, property_id, row_number() over (order by first_pos)
    from (select property_id, min(position) as first_pos
            from public.snow_visits where route_id = p_route_id group by property_id) s;

  return tid;
end;
$$;

-- ── Use a template on a storm ───────────────────────────────────────────────
-- Makes a new route on the storm with the template's stops. Returns the new
-- route's id. Stops for properties that can't take this service are left out.

create or replace function public.snow_apply_route_template(p_storm_id uuid, p_template_id uuid, p_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  st record;
  t record;
  rid uuid;
  lead uuid;
  next_pos int;
  nm text := nullif(trim(coalesce(p_name, '')), '');
begin
  select id, company_id, service, status into st from public.snow_storms where id = p_storm_id;
  if st is null or not public.is_staff(st.company_id) then
    raise exception 'Storm not found.';
  end if;
  select * into t from public.snow_route_templates where id = p_template_id and company_id = st.company_id;
  if t is null then raise exception 'Template not found.'; end if;
  if t.service <> st.service then
    raise exception 'This template is for %, but the storm is for %.', t.service, st.service;
  end if;

  lead := case when t.lead_person_id is not null
                 and public.snow_person_has_service(st.company_id, t.lead_person_id, st.service)
               then t.lead_person_id end;
  select coalesce(max(position), 0) + 1 into next_pos from public.snow_routes where storm_id = p_storm_id;

  insert into public.snow_routes (storm_id, name, position, lead_person_id, media_required, min_media, notes, created_by)
  values (p_storm_id, coalesce(nm, t.name), next_pos, lead, t.media_required, t.min_media, t.notes, public.my_person_id())
  returning id into rid;

  insert into public.snow_visits (route_id, property_id, position, created_by)
  select rid, ts.property_id, row_number() over (order by ts.position), public.my_person_id()
    from public.snow_route_template_stops ts
    join public.snow_properties p on p.id = ts.property_id and p.status = 'active'
    join public.snow_property_services ps on ps.property_id = ts.property_id and ps.service = st.service and ps.is_active
   where ts.template_id = p_template_id;

  return rid;
end;
$$;

revoke all on function public.snow_reorder_route(uuid, uuid[]) from public;
revoke all on function public.snow_save_route_template(uuid, text) from public;
revoke all on function public.snow_apply_route_template(uuid, uuid, text) from public;
grant execute on function public.snow_reorder_route(uuid, uuid[]) to authenticated;
grant execute on function public.snow_save_route_template(uuid, text) to authenticated;
grant execute on function public.snow_apply_route_template(uuid, uuid, text) to authenticated;
