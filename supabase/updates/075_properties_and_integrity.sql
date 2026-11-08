-- ============================================================================
-- Update 75 — customers and properties, phase 1 (integrity guards + an additive properties table).
-- Run once in Supabase → SQL Editor (safe to run again). NOT run yet; read it before running.
--
-- Nothing here deletes, rewrites or moves existing data. It only
--   1. adds checks that keep a customer link inside its own company,
--   2. makes a deactivated customer lose access to Maintenance and Snow (before, only removing the link did),
--   3. makes a project-code claim merge the owner-created customer record, like a maintenance-code claim already does (update 70),
--   4. adds an empty `properties` table (one real record per customer location) and a nullable property_id on projects,
--      maintenance_properties and snow_properties. NOTHING uses these yet and no existing row is changed; update 76 (a dry run by
--      default) is what could fill them, only when the owner chooses.
-- ============================================================================

-- ── helpers (database-internal; not callable from the app) ─────────────────────
create or replace function public._is_company_customer(p_company uuid, p_person uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.company_members m where m.company_id = p_company and m.person_id = p_person and m.role = 'customer')
$$;
revoke all on function public._is_company_customer(uuid, uuid) from public, anon, authenticated;

-- A customer who may still use their access: an active customer, or one the owner invited (not yet signed in). Not a deactivated one.
create or replace function public._customer_in_good_standing(p_company uuid, p_person uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.company_members m
                  where m.company_id = p_company and m.person_id = p_person and m.role = 'customer' and m.status in ('active', 'invited'))
$$;
revoke all on function public._customer_in_good_standing(uuid, uuid) from public, anon, authenticated;

-- ── 1. A customer link must stay inside its own company ───────────────────────
-- (These checks look the rows up themselves, as the signed-in user, so staff only ever match their own company's rows.)
-- Checked for changes made from the app (the signed-in user). The database's own functions (claims, merges, add_customer) are exempt.
-- Only a NEW or CHANGED link is checked, so existing rows are never blocked from other edits.
create or replace function public._customer_same_company_guard()
returns trigger language plpgsql as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if new.customer_id is not null and (tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id) then
    if new.company_id is not null and not exists (select 1 from public.company_members m where m.company_id = new.company_id and m.person_id = new.customer_id and m.role = 'customer') then
      raise exception 'That person is not a customer of this company.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public._customer_same_company_guard() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['projects', 'maintenance_properties', 'quotes', 'change_orders', 'invoices'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_customer_company_guard', t);
    execute format('create trigger %I before insert or update of customer_id on public.%I for each row execute function public._customer_same_company_guard()',
                   t || '_customer_company_guard', t);
  end loop;
end $$;

-- A maintenance property may only point at a project of its own company.
create or replace function public._maintenance_property_source_guard()
returns trigger language plpgsql as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if new.source_project_id is not null and (tg_op = 'INSERT' or new.source_project_id is distinct from old.source_project_id) then
    if not exists (select 1 from public.projects p where p.id = new.source_project_id and p.company_id = new.company_id) then
      raise exception 'That project belongs to a different company.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public._maintenance_property_source_guard() from public, anon, authenticated;
drop trigger if exists maintenance_properties_source_guard on public.maintenance_properties;
create trigger maintenance_properties_source_guard before insert or update of source_project_id on public.maintenance_properties
  for each row execute function public._maintenance_property_source_guard();

-- A quote, change order or invoice must belong to a project of its own company.
create or replace function public._document_project_company_guard()
returns trigger language plpgsql as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if new.company_id is not null and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id) then
    if not exists (select 1 from public.projects p where p.id = new.project_id and p.company_id = new.company_id) then
      raise exception 'That project belongs to a different company.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public._document_project_company_guard() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['quotes', 'change_orders', 'invoices'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_project_company_guard', t);
    execute format('create trigger %I before insert or update of project_id on public.%I for each row execute function public._document_project_company_guard()',
                   t || '_project_company_guard', t);
  end loop;
end $$;

-- ── 2. A deactivated customer loses access (not only when their link is removed) ──
create or replace function public.snow_is_property_contact(prop_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_person_id() is not null and exists (
    select 1 from public.snow_property_contacts c
      join public.snow_properties sp on sp.id = c.property_id
     where c.property_id = prop_id and c.person_id = public.my_person_id() and c.removed_at is null
       and public._customer_in_good_standing(sp.company_id, c.person_id)
  )
$$;

create or replace function public.maintenance_my_properties()
returns table (id uuid, name text, address text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, concat_ws(', ', nullif(p.address, ''), nullif(p.city, ''))
    from public.maintenance_properties p
   where p.customer_id = public.my_person_id()
     and public._customer_in_good_standing(p.company_id, p.customer_id)
   order by p.name
$$;
revoke all on function public.maintenance_my_properties() from public, anon;
grant execute on function public.maintenance_my_properties() to authenticated;

create or replace function public.maintenance_customer_updates()
returns table (
  stop_id uuid, property_name text, completed_at timestamptz, services text, photos jsonb
)
language sql stable security definer set search_path = public as $$
  select s.id, p.name, s.completed_at,
         (select string_agg(ss.label, ', ' order by ss.label)
            from public.maintenance_stop_services ss where ss.stop_id = s.id and ss.completed),
         coalesce((select jsonb_agg(jsonb_build_object('id', ph.id, 'url', ph.file_url, 'key', ph.file_key) order by ph.created_at)
                     from public.maintenance_photos ph
                    where ph.stop_id = s.id and ph.is_customer_visible), '[]'::jsonb)
    from public.maintenance_stops s
    join public.maintenance_properties p on p.id = s.property_id
   where s.status = 'completed'
     and p.customer_id = public.my_person_id()
     and public._customer_in_good_standing(p.company_id, p.customer_id)
   order by s.completed_at desc
   limit 100
$$;
revoke all on function public.maintenance_customer_updates() from public;
grant execute on function public.maintenance_customer_updates() to authenticated;

create or replace function public.maintenance_photos_i_can_open(p_keys text[])
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(ph.file_key), '{}')
    from public.maintenance_photos ph
    join public.maintenance_stops s on s.id = ph.stop_id
    join public.maintenance_properties p on p.id = ph.property_id
   where ph.file_key = any (coalesce(p_keys, '{}'))
     and (
       public.is_staff(ph.company_id)
       or public.on_maintenance_route(ph.route_id)
       or (ph.is_customer_visible and s.status = 'completed' and p.customer_id = public.my_person_id()
           and public._customer_in_good_standing(p.company_id, p.customer_id))
     )
$$;
revoke all on function public.maintenance_photos_i_can_open(text[]) from public, anon;
grant execute on function public.maintenance_photos_i_can_open(text[]) to authenticated;

-- ── 3. A project-code claim also merges the owner-created customer record (as a maintenance-code claim already does) ──
create or replace function public._claim_project(pid uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pr record;
begin
  if exists (select 1 from public.maintenance_customer_codes where code = upper(trim(p_code))) then
    return public._claim_maintenance(pid, p_code);
  end if;

  select p.id, p.company_id, p.customer_id as old_customer, p.customer_claimed_by, coalesce(s.customer_interaction_enabled, true) as enabled
  into pr
  from public.projects p
  left join public.project_settings s on s.project_id = p.id
  where p.customer_project_code = upper(trim(p_code));

  if pr.id is null then
    return jsonb_build_object('success', false, 'error', 'invalid_code');
  end if;
  if not pr.enabled then
    return jsonb_build_object('success', false, 'error', 'portal_disabled');
  end if;
  if pr.customer_claimed_by is not null and pr.customer_claimed_by <> pid then
    return jsonb_build_object('success', false, 'error', 'already_claimed');
  end if;
  if exists (select 1 from public.company_members
             where company_id = pr.company_id and person_id = pid and status = 'inactive'
               and deactivated_by is not null and deactivated_by <> pid) then
    return jsonb_build_object('success', false, 'error', 'access_removed');
  end if;

  update public.projects
  set customer_claimed_by = pid, customer_claimed_at = coalesce(customer_claimed_at, now()), customer_id = pid
  where id = pr.id;

  insert into public.company_members (company_id, person_id, role, status, join_method)
  values (pr.company_id, pid, 'customer', 'active', 'invitation_link')
  on conflict (company_id, person_id) do update
    set status = 'active'
    where public.company_members.status <> 'active' and public.company_members.role = 'customer';

  -- If the owner had linked an owner-created record (no login) to this project, it becomes this person: no duplicate.
  perform public._merge_placeholder_customer(pr.company_id, pr.old_customer, pid);

  return jsonb_build_object('success', true, 'project_id', pr.id);
end;
$$;

-- ── 4. The properties table (empty, additive) ────────────────────────────────

-- A comparable form of an address, so "123 Main St." and "123 main street" are the same place. Street words are shortened (street -> st,
-- north -> n ...), punctuation and case are ignored, unit numbers are KEPT (unit 3 and unit 4 are different places), and the ZIP's first
-- five digits decide the town when there is a ZIP (otherwise the city and state do). A blank street gives '' (never compared).
create or replace function public.normalize_address(p_street text, p_city text, p_state text, p_zip text)
returns text language plpgsql immutable as $$
declare
  s text := lower(coalesce(p_street, ''));
  z text := substring(coalesce(p_zip, '') from '^\s*(\d{5})');
  pairs text[] := array[
    'street','st','avenue','ave','road','rd','drive','dr','lane','ln','boulevard','blvd','court','ct','place','pl','circle','cir',
    'terrace','ter','parkway','pkwy','highway','hwy','trail','trl','north','n','south','s','east','e','west','w',
    'northeast','ne','northwest','nw','southeast','se','southwest','sw','apartment','unit','apt','unit','suite','unit','ste','unit',
    'building','bldg','floor','fl'];
  i int;
begin
  s := regexp_replace(s, '#', ' unit ', 'g');
  s := regexp_replace(s, '[^a-z0-9 ]', ' ', 'g');
  s := ' ' || btrim(regexp_replace(s, '\s+', ' ', 'g')) || ' ';
  if btrim(s) = '' then return ''; end if;
  for pass in 1..2 loop
    i := 1;
    while i < array_length(pairs, 1) loop
      s := replace(s, ' ' || pairs[i] || ' ', ' ' || pairs[i + 1] || ' ');
      i := i + 2;
    end loop;
  end loop;
  s := btrim(regexp_replace(s, '\s+', ' ', 'g'));
  return s || '|' || coalesce(z, lower(btrim(coalesce(p_city, ''))) || '|' || lower(btrim(coalesce(p_state, ''))));
end;
$$;

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- The customer this location belongs to. A property never appears under another customer.
  customer_id uuid references public.people(id) on delete set null,
  -- Optional nickname, e.g. "Rushmore Plaza". Not required for a house.
  name text,
  address text not null default '',
  city text,
  state text,
  zip text,
  latitude double precision,
  longitude double precision,
  notes text,
  -- Comparable form of the address (kept up to date by a trigger); blocks a second copy for the same customer.
  address_key text not null default '',
  is_active boolean not null default true,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_properties_company on public.properties (company_id);
create index if not exists idx_properties_customer on public.properties (customer_id);
create unique index if not exists uq_properties_customer_address on public.properties (company_id, customer_id, address_key)
  where customer_id is not null and address_key <> '';

create or replace function public._properties_before_write()
returns trigger language plpgsql as $$
begin
  new.address_key := public.normalize_address(new.address, new.city, new.state, new.zip);
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public._properties_before_write() from public, anon, authenticated;
drop trigger if exists properties_before_write on public.properties;
create trigger properties_before_write before insert or update on public.properties for each row execute function public._properties_before_write();

drop trigger if exists properties_customer_company_guard on public.properties;
create trigger properties_customer_company_guard before insert or update of customer_id on public.properties
  for each row execute function public._customer_same_company_guard();

alter table public.properties enable row level security;
drop policy if exists properties_select on public.properties;
create policy properties_select on public.properties for select using (public.is_staff(company_id) or public.is_crew(company_id));
drop policy if exists properties_staff on public.properties;
create policy properties_staff on public.properties for all using (public.is_staff(company_id)) with check (public.is_staff(company_id));

-- The link from each module's existing record. Empty for now; nothing reads it yet.
alter table public.projects add column if not exists property_id uuid references public.properties(id) on delete set null;
alter table public.maintenance_properties add column if not exists property_id uuid references public.properties(id) on delete set null;
alter table public.snow_properties add column if not exists property_id uuid references public.properties(id) on delete set null;
create index if not exists idx_projects_property on public.projects (property_id);
create index if not exists idx_maint_properties_property on public.maintenance_properties (property_id);
create index if not exists idx_snow_properties_property on public.snow_properties (property_id);

-- A record may only point at a property of its own company, and a project/maintenance property only at a property of ITS customer.
create or replace function public._property_link_guard()
returns trigger language plpgsql as $$
declare prop record; cust uuid;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if new.property_id is not null and (tg_op = 'INSERT' or new.property_id is distinct from old.property_id) then
    select pr.company_id, pr.customer_id into prop from public.properties pr where pr.id = new.property_id;
    if not found or prop.company_id is distinct from new.company_id then
      raise exception 'That property belongs to a different company.';
    end if;
    if tg_table_name in ('projects', 'maintenance_properties') then
      cust := new.customer_id;
      if cust is not null and prop.customer_id is distinct from cust then
        raise exception 'That property belongs to a different customer.';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public._property_link_guard() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['projects', 'maintenance_properties', 'snow_properties'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_property_link_guard', t);
    execute format('create trigger %I before insert or update of property_id on public.%I for each row execute function public._property_link_guard()',
                   t || '_property_link_guard', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
