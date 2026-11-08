-- ============================================================================
-- Update 41 — run once in Supabase → SQL Editor, AFTER 026, 027, 029 and 040
-- (safe to run again). NOT run yet; read it before running.
--
-- Crew members on a Snow route.
--  • A route still has exactly ONE lead. It can also have crew members.
--    Routes with no crew work exactly as before.
--  • A crew member can VIEW the route: its storm, stops, service and the
--    property instructions / reference photos for the stops. That is all.
--  • Only the LEAD can mark arrival, finish a stop, add completion photos or
--    ask to skip a stop. Those rules are untouched: they check "is the lead",
--    never "is on the crew".
--  • Crew only see routes they are on, only once the storm is dispatched,
--    only while the route is not cancelled, and only while they still hold
--    that route's snow service. A draft or someone else's route stays hidden.
--  • Only the owner/admin can change crew, with snow_set_route_crew(). The
--    table is read-only for everyone else, so nobody can add themselves.
--  • A person is never both lead and crew on a route: making a crew member
--    the lead removes them from the crew.
--  • Adding/removing crew is written to the Snow activity log.
-- No existing data is changed.
-- ============================================================================

-- ── 1) Crew table ───────────────────────────────────────────────────────────

create table if not exists public.snow_route_crew (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  storm_id uuid not null references public.snow_storms(id) on delete cascade,
  route_id uuid not null references public.snow_routes(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  added_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (route_id, person_id)
);
create index if not exists idx_snow_route_crew_person on public.snow_route_crew (person_id);
create index if not exists idx_snow_route_crew_storm on public.snow_route_crew (storm_id);

-- Fills company/storm from the route, and refuses anything that wouldn't make
-- sense: a lead as crew, a cancelled route or ended storm, a person who can't
-- work the route's service. A crew row is never edited, only added or removed.
create or replace function public._snow_route_crew_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if tg_op = 'UPDATE' then
    raise exception 'A crew assignment can''t be edited. Remove it and add it again.';
  end if;
  select rt.company_id, rt.storm_id, rt.service, rt.lead_person_id, rt.cancelled_at, st.status as storm_status
    into r
    from public.snow_routes rt join public.snow_storms st on st.id = rt.storm_id
   where rt.id = new.route_id;
  if r is null then raise exception 'Route not found.'; end if;
  if r.cancelled_at is not null then raise exception 'This route was cancelled.'; end if;
  if r.storm_status = 'ended' then raise exception 'This storm has ended. Reopen it to change the crew.'; end if;
  if r.lead_person_id is not distinct from new.person_id then
    raise exception 'This person already leads this route.';
  end if;
  if not public.snow_person_has_service(r.company_id, new.person_id, r.service) then
    raise exception 'This person isn''t on the snow team for %.', r.service;
  end if;
  new.company_id := r.company_id;
  new.storm_id := r.storm_id;
  new.added_by := coalesce(public.my_person_id(), new.added_by);
  return new;
end;
$$;
revoke all on function public._snow_route_crew_guard() from public, anon, authenticated;

drop trigger if exists snow_route_crew_guard on public.snow_route_crew;
create trigger snow_route_crew_guard before insert or update on public.snow_route_crew
  for each row execute function public._snow_route_crew_guard();

-- Making a crew member the route's lead takes them off the crew.
create or replace function public._snow_route_lead_leaves_crew()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.lead_person_id is not null and new.lead_person_id is distinct from old.lead_person_id then
    delete from public.snow_route_crew where route_id = new.id and person_id = new.lead_person_id;
  end if;
  return null;
end;
$$;
revoke all on function public._snow_route_lead_leaves_crew() from public, anon, authenticated;

drop trigger if exists snow_routes_lead_leaves_crew on public.snow_routes;
create trigger snow_routes_lead_leaves_crew after update of lead_person_id on public.snow_routes
  for each row execute function public._snow_route_lead_leaves_crew();

-- ── 2) Who may see crew rows; nobody writes the table directly ─────────────

alter table public.snow_route_crew enable row level security;
revoke all on public.snow_route_crew from anon, authenticated;
grant select on public.snow_route_crew to authenticated;

drop policy if exists snow_route_crew_select on public.snow_route_crew;
create policy snow_route_crew_select on public.snow_route_crew for select
  using (
    public.is_staff(company_id)
    or person_id = public.my_person_id()
    or public.snow_is_route_lead(route_id)   -- the lead sees who is on their crew
  );

-- ── 3) What crew can see (view only) ───────────────────────────────────────
-- Separate from the lead helpers on purpose: every action a lead takes is
-- checked with snow_is_route_lead / snow_leads_dispatched_route, which stay
-- "lead only". Crew get their own read-only rules below.

create or replace function public.snow_is_route_crew(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.snow_route_crew c
    join public.snow_routes r on r.id = c.route_id
    where c.route_id = rid
      and c.person_id = public.my_person_id()
      and r.cancelled_at is null
      and public.snow_has_service(r.company_id, r.service)
  )
$$;

create or replace function public.snow_crew_on_dispatched_route(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.snow_is_route_crew(rid) and exists (
    select 1 from public.snow_routes r join public.snow_storms s on s.id = r.storm_id
    where r.id = rid and s.status <> 'draft'
  )
$$;

create or replace function public.snow_crew_in_storm(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.snow_routes r
    join public.snow_storms s on s.id = r.storm_id
    where r.storm_id = sid and s.status <> 'draft' and public.snow_is_route_crew(r.id)
  )
$$;

revoke all on function public.snow_is_route_crew(uuid) from public, anon;
revoke all on function public.snow_crew_on_dispatched_route(uuid) from public, anon;
revoke all on function public.snow_crew_in_storm(uuid) from public, anon;
grant execute on function public.snow_is_route_crew(uuid) to authenticated;
grant execute on function public.snow_crew_on_dispatched_route(uuid) to authenticated;
grant execute on function public.snow_crew_in_storm(uuid) to authenticated;

drop policy if exists snow_storms_crew_select on public.snow_storms;
create policy snow_storms_crew_select on public.snow_storms for select
  using (public.snow_crew_in_storm(id));

drop policy if exists snow_routes_crew_select on public.snow_routes;
create policy snow_routes_crew_select on public.snow_routes for select
  using (public.snow_crew_on_dispatched_route(id));

drop policy if exists snow_visits_crew_select on public.snow_visits;
create policy snow_visits_crew_select on public.snow_visits for select
  using (public.snow_crew_on_dispatched_route(route_id));

-- Property instructions and reference photos: same rule as before (owner/admin,
-- or a worker with the service who is on a route that visits the property for
-- that service in a storm that hasn't ended), now counting crew as well as the lead.
create or replace function public.snow_can_see_property_service(ps_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.snow_property_services ps
    where ps.id = ps_id
      and (
        public.is_staff(ps.company_id)
        or (
          public.snow_has_service(ps.company_id, ps.service)
          and exists (
            select 1
            from public.snow_visits v
            join public.snow_routes r on r.id = v.route_id
            join public.snow_storms s on s.id = r.storm_id
            where v.property_id = ps.property_id
              and v.service = ps.service
              and r.cancelled_at is null
              and s.status <> 'ended'
              and (
                r.lead_person_id = public.my_person_id()
                or exists (
                  select 1 from public.snow_route_crew c
                  where c.route_id = r.id and c.person_id = public.my_person_id()
                )
              )
          )
        )
      )
  )
$$;

-- ── 4) The owner changes the crew ──────────────────────────────────────────
-- Replaces the route's crew with exactly this list (so a repeated tap changes
-- nothing). Owner/admin only. Every person must hold the route's service and
-- must not be the lead. Returns the crew as it is now.

create or replace function public.snow_set_route_crew(p_route_id uuid, p_person_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.snow_routes;
  st_status text;
  wanted uuid[];
  who uuid;
  nm text;
  changed boolean := false;
  removed int;
begin
  select * into r from public.snow_routes where id = p_route_id for update;
  if r.id is null or not public.is_staff(r.company_id) then raise exception 'Route not found.'; end if;
  if r.cancelled_at is not null then raise exception 'This route was cancelled.'; end if;
  select status into st_status from public.snow_storms where id = r.storm_id;
  if st_status = 'ended' then raise exception 'This storm has ended. Reopen it to change the crew.'; end if;

  select coalesce(array_agg(distinct x), '{}') into wanted from unnest(coalesce(p_person_ids, '{}')) x where x is not null;

  foreach who in array wanted loop
    select coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), 'This person') into nm from public.people where id = who;
    if nm is null then raise exception 'Person not found.'; end if;
    if r.lead_person_id is not distinct from who then raise exception '% already leads this route.', nm; end if;
    if not public.snow_person_has_service(r.company_id, who, r.service) then
      raise exception '% isn''t on the snow team for %.', nm, r.service;
    end if;
  end loop;

  delete from public.snow_route_crew where route_id = r.id and person_id <> all (wanted);
  get diagnostics removed = row_count;
  if removed > 0 then changed := true; end if;

  foreach who in array wanted loop
    insert into public.snow_route_crew (route_id, person_id) values (r.id, who)
    on conflict (route_id, person_id) do nothing;
    if found then changed := true; end if;
  end loop;

  return jsonb_build_object(
    'changed', changed,
    'crew', coalesce((select jsonb_agg(c.person_id order by c.created_at, c.person_id) from public.snow_route_crew c where c.route_id = r.id), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.snow_set_route_crew(uuid, uuid[]) from public, anon;
grant execute on function public.snow_set_route_crew(uuid, uuid[]) to authenticated;

-- ── 5) The worker's own routes, with their role ────────────────────────────
-- Live routes (not cancelled, storm dispatched or ended) the caller leads or
-- is on the crew of, and still holds the service for. 'lead' or 'crew'.

create or replace function public.snow_my_routes()
returns table (route_id uuid, role text)
language sql stable security definer set search_path = public as $$
  select r.id, 'lead'::text
    from public.snow_routes r join public.snow_storms s on s.id = r.storm_id
   where r.lead_person_id = public.my_person_id()
     and r.cancelled_at is null and s.status <> 'draft'
     and public.snow_has_service(r.company_id, r.service)
  union all
  select r.id, 'crew'::text
    from public.snow_route_crew c
    join public.snow_routes r on r.id = c.route_id
    join public.snow_storms s on s.id = r.storm_id
   where c.person_id = public.my_person_id()
     and r.cancelled_at is null and s.status <> 'draft'
     and public.snow_has_service(r.company_id, r.service)
$$;
revoke all on function public.snow_my_routes() from public, anon;
grant execute on function public.snow_my_routes() to authenticated;

-- ── 6) Activity log + live updates ─────────────────────────────────────────

select public.snow_attach_audit('public.snow_route_crew', 'route_crew');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'snow_route_crew'
  ) then
    alter publication supabase_realtime add table public.snow_route_crew;
  end if;
end $$;
