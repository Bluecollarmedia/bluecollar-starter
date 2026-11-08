-- ============================================================================
-- Update 110 — run once in Supabase → SQL Editor, AFTER 109. Safe to run again.
--
-- A Snow route can have as many crew leads as the owner wants. Until now it had exactly ONE (snow_routes.lead_person_id).
--   * That column stays: it is the route's FIRST lead, so everything that reads it (the owner's screens, templates, history, older builds of
--     the app) keeps working exactly as before. Any further leads go in a new table, snow_route_extra_leads.
--   * Every lead has the same powers: see the route and its stops, arrive, finish, add photos, ask for a skip, see the crew and the
--     property instructions. They all work through ONE check (snow_is_route_lead), which now says yes for any of them.
--   * Owner/admin set the whole list with snow_set_route_leads(route, people). A lead is never also on the crew: adding someone as a lead takes
--     them off the crew, and someone who leads cannot be added to the crew.
--   * Each new lead is told ("You now lead ...") when the storm is already dispatched, and every lead is told when it is dispatched.
--   * ADDITIVE: one new table; existing functions are replaced with the same names and arguments (so every grant stays) and answer exactly as
--     before for a route with one lead.
-- ============================================================================

create table if not exists public.snow_route_extra_leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  storm_id uuid not null references public.snow_storms(id) on delete cascade,
  route_id uuid not null references public.snow_routes(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  added_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (route_id, person_id)
);
create index if not exists idx_snow_route_extra_leads_person on public.snow_route_extra_leads (person_id);
create index if not exists idx_snow_route_extra_leads_storm on public.snow_route_extra_leads (storm_id);

-- Nobody writes this table directly (only snow_set_route_leads does). Owner/admin, the person themself, and the route's leads can read it.
alter table public.snow_route_extra_leads enable row level security;
revoke all on public.snow_route_extra_leads from anon, authenticated;
grant select on public.snow_route_extra_leads to authenticated;

-- ── The ONE "is this caller a lead of this route" check ──────────────────────────────────────────────────────────────────────────────
-- Same as update 27, plus the extra leads.
create or replace function public.snow_is_route_lead(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.snow_routes r
    where r.id = rid
      and r.cancelled_at is null
      and (
        r.lead_person_id = public.my_person_id()
        or exists (select 1 from public.snow_route_extra_leads l where l.route_id = r.id and l.person_id = public.my_person_id())
      )
      and public.snow_has_service(r.company_id, r.service)
  )
$$;

drop policy if exists snow_route_extra_leads_select on public.snow_route_extra_leads;
create policy snow_route_extra_leads_select on public.snow_route_extra_leads for select
  using (
    public.is_staff(company_id)
    or person_id = public.my_person_id()
    or public.snow_is_route_lead(route_id)
  );

-- ── My routes: a lead of any kind gets the route as 'lead' ───────────────────────────────────────────────────────────────────────────
create or replace function public.snow_my_routes()
returns table (route_id uuid, role text)
language sql stable security definer set search_path = public as $$
  select r.id, 'lead'::text
    from public.snow_routes r join public.snow_storms s on s.id = r.storm_id
   where (r.lead_person_id = public.my_person_id()
          or exists (select 1 from public.snow_route_extra_leads l where l.route_id = r.id and l.person_id = public.my_person_id()))
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

-- ── Property instructions and photos: any lead counts, like the first lead ─────────────────────────────────────────────────────────────
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
                or exists (select 1 from public.snow_route_extra_leads l where l.route_id = r.id and l.person_id = public.my_person_id())
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

-- ── A clock-in is tagged with the person's one active route; leads of any kind count ──────────────────────────────────────────────────
create or replace function public._snow_storm_to_tag(p_person uuid, p_company uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  n int;
  found_storm uuid;
begin
  select count(*), min(x.storm_id::text)::uuid into n, found_storm
  from (
    select r.id as route_id, r.storm_id
      from public.snow_routes r
      join public.snow_storms s on s.id = r.storm_id
     where r.company_id = p_company
       and r.cancelled_at is null
       and s.status = 'dispatched'
       and public.snow_person_has_service(r.company_id, p_person, r.service)
       and (
         r.lead_person_id = p_person
         or exists (select 1 from public.snow_route_extra_leads l where l.route_id = r.id and l.person_id = p_person)
         or exists (select 1 from public.snow_route_crew c where c.route_id = r.id and c.person_id = p_person)
       )
  ) x;
  if n = 1 then return found_storm; end if;
  return null;
exception when others then
  return null;
end;
$$;
revoke all on function public._snow_storm_to_tag(uuid, uuid) from public, anon, authenticated;

-- ── A lead is never also on the crew (the existing guard, plus extra leads) ──────────────────────────────────────────────────────────
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
  if r.lead_person_id is not distinct from new.person_id
     or exists (select 1 from public.snow_route_extra_leads l where l.route_id = new.route_id and l.person_id = new.person_id) then
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
    if r.lead_person_id is not distinct from who
       or exists (select 1 from public.snow_route_extra_leads l where l.route_id = r.id and l.person_id = who) then
      raise exception '% already leads this route.', nm;
    end if;
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

-- ── The owner sets ALL of a route's leads ────────────────────────────────────────────────────────────────────────────────────────────
-- Owner/admin only. The list is the route's leads, any number. The first lead stays the route's first lead if they are still in the list
-- (so nothing changes for them); otherwise the first person in the list becomes the first lead. Everyone in the list is taken off the crew.
-- Repeating it changes nothing. Returns the leads as they are now, first lead first.
create or replace function public.snow_set_route_leads(p_route_id uuid, p_person_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.snow_routes;
  st public.snow_storms;
  wanted uuid[];
  who uuid;
  nm text;
  first_lead uuid;
  extras uuid[];
  nid uuid;
  added uuid[] := '{}';
begin
  select * into r from public.snow_routes where id = p_route_id for update;
  if r.id is null or not public.is_staff(r.company_id) then raise exception 'Route not found.'; end if;
  if r.cancelled_at is not null then raise exception 'This route was cancelled.'; end if;
  select * into st from public.snow_storms where id = r.storm_id;
  if st.status = 'ended' then raise exception 'This storm has ended. Reopen it to change the leads.'; end if;

  select coalesce(array_agg(x order by ord), '{}') into wanted
    from (select x, min(ord) as ord from unnest(coalesce(p_person_ids, '{}')) with ordinality as t(x, ord) where x is not null group by x) q;

  foreach who in array wanted loop
    select coalesce(nullif(trim(concat_ws(' ', first_name, last_name)), ''), 'This person') into nm from public.people where id = who;
    if nm is null then raise exception 'Person not found.'; end if;
    if not public.snow_person_has_service(r.company_id, who, r.service) then
      raise exception '% isn''t on the snow team for %.', nm, r.service;
    end if;
  end loop;

  -- Leads are never crew.
  delete from public.snow_route_crew where route_id = r.id and person_id = any (wanted);

  if cardinality(wanted) = 0 then
    first_lead := null;
  elsif r.lead_person_id is not null and r.lead_person_id = any (wanted) then
    first_lead := r.lead_person_id;
  else
    first_lead := wanted[1];
  end if;
  select coalesce(array_agg(x), '{}') into extras from unnest(wanted) x where x is distinct from first_lead;

  if first_lead is distinct from r.lead_person_id then
    update public.snow_routes set lead_person_id = first_lead where id = r.id;
  end if;

  delete from public.snow_route_extra_leads where route_id = r.id and person_id <> all (extras);
  foreach who in array extras loop
    insert into public.snow_route_extra_leads (company_id, storm_id, route_id, person_id, added_by)
    values (r.company_id, r.storm_id, r.id, who, public.my_person_id())
    on conflict (route_id, person_id) do nothing;
    if found then
      added := added || who;
      perform public.snow_log_event(r.company_id, 'route.lead_added', 'snow_route', r.id, p_storm_id => r.storm_id, p_route_id => r.id,
                                    p_person_id => who, p_service => r.service);
    end if;
  end loop;

  -- A lead added mid-storm is told (the storm going out tells everyone itself).
  if st.status = 'dispatched' then
    foreach who in array added loop
      nid := public._snow_add_crew_notification(r.company_id, r.storm_id, r.id, who, 'route.lead_assigned',
        r.id || ':lead:' || who || ':' || (extract(epoch from clock_timestamp()) * 1000)::bigint,
        'You now lead ' || r.name, st.name || '. Open My Route.');
      if nid is not null then perform public._snow_dispatch_notification(nid); end if;
    end loop;
  end if;

  return jsonb_build_object(
    'leads', (select coalesce(jsonb_agg(p order by o), '[]'::jsonb) from (
       select rr.lead_person_id as p, 0 as o from public.snow_routes rr where rr.id = r.id and rr.lead_person_id is not null
       union all
       select l.person_id, 1 from public.snow_route_extra_leads l where l.route_id = r.id
     ) z)
  );
end;
$$;
revoke execute on function public.snow_set_route_leads(uuid, uuid[]) from public, anon;
grant execute on function public.snow_set_route_leads(uuid, uuid[]) to authenticated;

-- The first lead is never also listed as an extra lead (the older screens and templates set the first lead directly).
create or replace function public._snow_route_lead_leaves_extra_leads()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.lead_person_id is not null and new.lead_person_id is distinct from old.lead_person_id then
    delete from public.snow_route_extra_leads where route_id = new.id and person_id = new.lead_person_id;
  end if;
  return null;
end;
$$;
revoke all on function public._snow_route_lead_leaves_extra_leads() from public, anon, authenticated;
drop trigger if exists snow_routes_lead_leaves_extra_leads on public.snow_routes;
create trigger snow_routes_lead_leaves_extra_leads after update of lead_person_id on public.snow_routes
  for each row execute function public._snow_route_lead_leaves_extra_leads();

-- ── Dispatch: every lead of every kind is told ──────────────────────────────────────────────────────────────────────────────────────
create or replace function public._snow_storm_dispatched_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
  m record;
  stops int;
  nid uuid;
  ids uuid[] := '{}';
begin
  if new.status <> 'dispatched' or old.status = 'dispatched' then return null; end if;
  for r in
    select rt.id, rt.name, rt.lead_person_id from public.snow_routes rt
     where rt.storm_id = new.id and rt.cancelled_at is null
  loop
    select count(*)::int into stops from public.snow_visits v where v.route_id = r.id;
    -- the first lead
    nid := public._snow_add_crew_notification(new.company_id, new.id, r.id, r.lead_person_id, 'storm.dispatched',
      new.id || ':dispatch:' || coalesce(new.reopened_count, 0) || ':' || r.id || ':' || r.lead_person_id,
      'Storm dispatched: ' || new.name,
      'You lead ' || r.name || ' · ' || stops || ' ' || case when stops = 1 then 'stop' else 'stops' end || '. Open My Route.');
    if nid is not null then ids := ids || nid; end if;
    -- the other leads
    for m in select l.person_id from public.snow_route_extra_leads l where l.route_id = r.id loop
      nid := public._snow_add_crew_notification(new.company_id, new.id, r.id, m.person_id, 'storm.dispatched',
        new.id || ':dispatch:' || coalesce(new.reopened_count, 0) || ':' || r.id || ':' || m.person_id,
        'Storm dispatched: ' || new.name,
        'You lead ' || r.name || ' · ' || stops || ' ' || case when stops = 1 then 'stop' else 'stops' end || '. Open My Route.');
      if nid is not null then ids := ids || nid; end if;
    end loop;
    -- the crew
    for m in select c.person_id from public.snow_route_crew c where c.route_id = r.id loop
      nid := public._snow_add_crew_notification(new.company_id, new.id, r.id, m.person_id, 'storm.dispatched',
        new.id || ':dispatch:' || coalesce(new.reopened_count, 0) || ':' || r.id || ':' || m.person_id,
        'Storm dispatched: ' || new.name,
        'You are on the crew of ' || r.name || ' · ' || stops || ' ' || case when stops = 1 then 'stop' else 'stops' end || '.');
      if nid is not null then ids := ids || nid; end if;
    end loop;
  end loop;
  foreach nid in array ids loop
    perform public._snow_dispatch_notification(nid);
  end loop;
  return null;
end;
$$;
revoke all on function public._snow_storm_dispatched_notify() from public, anon, authenticated;

notify pgrst, 'reload schema';
