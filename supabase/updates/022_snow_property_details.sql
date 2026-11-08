-- ============================================================================
-- Update 22 — run once in Supabase → SQL Editor (safe to run again).
-- Run it after update 20 (snow access: snow_has_service) and update 20b
-- (snow foundation: snow_properties, snow_storms, snow_routes, snow_visits).
--
--  • Snow property details: one or more contacts per property, the services
--    each property gets (plowing, shoveling, salting), and for each service
--    its own written instructions and reference photos/videos.
--  • Reference media is loaded ahead of time and reused every storm. It is
--    not proof of work; completion photos live with the visit.
--  • History is never rewritten. Instructions are saved as numbered versions
--    (editing adds a version). Reference media is never deleted, only retired.
--    snow_reference_as_of() returns what was in effect at any moment, so an
--    old visit shows the instructions and media it was done with.
--  • Access: owner/admin manage everything. A worker sees a property's
--    service details only when they lead a route in an open storm that visits
--    that property for that service, and still hold that service permission.
--    So a plow lead never sees shoveling instructions or media, and the rest
--    of the crew sees none. A customer sees the properties they are a linked
--    contact for (name and address only, through snow_my_properties()) and
--    which services they get, never notes, instructions or media.
--  • A visit can only be added for a service the property gets.
--  • Files go in a private "snow-media" bucket. The app shows them through
--    short-lived signed links, and the bucket's read rule is the same as the
--    table's, so a copied link to someone else's media stops working.
-- ============================================================================

-- ── Helpers ─────────────────────────────────────────────────────────────────

-- Text → uuid without raising on bad input (storage paths are user-supplied).
create or replace function public._try_uuid(t text)
returns uuid language plpgsql immutable as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;

-- ── Services per property ───────────────────────────────────────────────────

create table if not exists public.snow_property_services (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  property_id uuid not null references public.snow_properties(id) on delete restrict,
  service text not null check (service in ('plowing', 'shoveling', 'salting')),
  is_active boolean not null default true,
  deactivated_at timestamptz,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, service)
);
create index if not exists idx_snow_prop_services_company on public.snow_property_services (company_id, service);

-- ── Contacts ────────────────────────────────────────────────────────────────

-- Customers or property managers for a property. person_id links a customer
-- account; that link is what lets the customer see this property in the app.
create table if not exists public.snow_property_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  property_id uuid not null references public.snow_properties(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  title text,
  phone text,
  email text,
  person_id uuid references public.people(id) on delete set null,
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  removed_at timestamptz,
  removed_by uuid references public.people(id) on delete set null,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_snow_contacts_property on public.snow_property_contacts (property_id);
create index if not exists idx_snow_contacts_person on public.snow_property_contacts (person_id) where person_id is not null;
create unique index if not exists uq_snow_contacts_primary on public.snow_property_contacts (property_id)
  where is_primary and removed_at is null;
create unique index if not exists uq_snow_contacts_person on public.snow_property_contacts (property_id, person_id)
  where person_id is not null and removed_at is null;

-- ── Instructions (versioned) ────────────────────────────────────────────────

-- One row per saved version. Editing the instructions adds a row; old rows
-- never change, so a past visit keeps the text it was done with.
create table if not exists public.snow_service_instructions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  property_service_id uuid not null references public.snow_property_services(id) on delete restrict,
  version integer not null,
  body text not null default '',
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (property_service_id, version)
);
create index if not exists idx_snow_instructions_ps on public.snow_service_instructions (property_service_id, created_at desc);

-- ── Reference media ─────────────────────────────────────────────────────────

-- Photos/videos showing where (and where not) to work. Never deleted:
-- "remove" sets retired_at, and the file stays for history.
create table if not exists public.snow_reference_media (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  property_service_id uuid not null references public.snow_property_services(id) on delete restrict,
  media_type text not null default 'image' check (media_type in ('image', 'video')),
  file_key text not null unique check (length(file_key) > 0),
  size_bytes bigint,
  caption text,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  retired_by uuid references public.people(id) on delete set null
);
create index if not exists idx_snow_ref_media_ps on public.snow_reference_media (property_service_id, created_at);

-- ── Guards ──────────────────────────────────────────────────────────────────

-- company_id always matches the parent record (never trusted from the app).
create or replace function public._snow_ps_child_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select company_id into new.company_id from public.snow_property_services where id = new.property_service_id;
  if new.company_id is null then
    raise exception 'Unknown property service';
  end if;
  return new;
end $$;

create or replace function public._snow_property_child_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.property_id <> old.property_id then
    raise exception 'A % can''t be moved to another property', replace(tg_table_name, 'snow_property_', '');
  end if;
  select company_id into new.company_id from public.snow_properties where id = new.property_id;
  if new.company_id is null then
    raise exception 'Unknown property';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists snow_property_services_guard on public.snow_property_services;
create trigger snow_property_services_guard before insert or update on public.snow_property_services
  for each row execute function public._snow_property_child_guard();

create or replace function public._snow_property_services_rules()
returns trigger language plpgsql as $$
begin
  if new.service <> old.service then
    raise exception 'A property''s service type can''t be changed. Add the other service instead.';
  end if;
  if new.is_active is distinct from old.is_active then
    new.deactivated_at := case when new.is_active then null else now() end;
  end if;
  return new;
end $$;
drop trigger if exists snow_property_services_rules on public.snow_property_services;
create trigger snow_property_services_rules before update on public.snow_property_services
  for each row execute function public._snow_property_services_rules();

drop trigger if exists snow_property_contacts_guard on public.snow_property_contacts;
create trigger snow_property_contacts_guard before insert or update on public.snow_property_contacts
  for each row execute function public._snow_property_child_guard();

-- A linked account must be a customer of this company.
create or replace function public._snow_contact_person_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.person_id is not null and (tg_op = 'INSERT' or new.person_id is distinct from old.person_id) then
    if not exists (
      select 1 from public.company_members
      where company_id = new.company_id and person_id = new.person_id
        and role = 'customer' and status in ('active', 'invited')
    ) then
      raise exception 'Only a customer account of this company can be linked to a contact';
    end if;
  end if;
  if new.removed_at is not null and (tg_op = 'INSERT' or old.removed_at is null) then
    new.removed_by := coalesce(new.removed_by, public.my_person_id());
    new.is_primary := false;
  end if;
  return new;
end $$;
drop trigger if exists snow_property_contacts_person on public.snow_property_contacts;
create trigger snow_property_contacts_person before insert or update on public.snow_property_contacts
  for each row execute function public._snow_contact_person_check();

-- Instructions: company from parent, next version number, never edited.
create or replace function public._snow_instructions_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Serialise versions per service so two saves can't take the same number.
  perform 1 from public.snow_property_services where id = new.property_service_id for update;
  select coalesce(max(version), 0) + 1 into new.version
    from public.snow_service_instructions where property_service_id = new.property_service_id;
  new.created_at := now();
  new.created_by := coalesce(public.my_person_id(), new.created_by);
  return new;
end $$;

create or replace function public._snow_history_locked()
returns trigger language plpgsql as $$
begin
  raise exception 'Saved snow instructions are kept as history and can''t be changed or deleted. Save a new version instead.';
end $$;

drop trigger if exists snow_instructions_company on public.snow_service_instructions;
create trigger snow_instructions_company before insert on public.snow_service_instructions
  for each row execute function public._snow_ps_child_guard();
drop trigger if exists snow_instructions_version on public.snow_service_instructions;
create trigger snow_instructions_version before insert on public.snow_service_instructions
  for each row execute function public._snow_instructions_insert();
drop trigger if exists snow_instructions_locked on public.snow_service_instructions;
create trigger snow_instructions_locked before update or delete on public.snow_service_instructions
  for each row execute function public._snow_history_locked();

-- Reference media: the only change allowed is retiring it (once). Nothing is
-- edited or deleted, so a past visit shows exactly what the crew was shown.
create or replace function public._snow_ref_media_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Reference media is kept as history. Remove it instead (it stays on past visits).';
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(public.my_person_id(), new.created_by);
    new.retired_at := null;
    new.retired_by := null;
    return new;
  end if;
  if new.property_service_id <> old.property_service_id or new.file_key <> old.file_key
     or new.media_type <> old.media_type or new.created_at <> old.created_at
     or new.company_id <> old.company_id or new.caption is distinct from old.caption
     or new.size_bytes is distinct from old.size_bytes then
    raise exception 'Reference media can''t be changed. Remove it and add a new one.';
  end if;
  if old.retired_at is not null then
    raise exception 'This reference media was already removed';
  end if;
  if new.retired_at is not null then
    new.retired_at := now();
    new.retired_by := public.my_person_id();
  end if;
  return new;
end $$;

drop trigger if exists snow_ref_media_company on public.snow_reference_media;
create trigger snow_ref_media_company before insert on public.snow_reference_media
  for each row execute function public._snow_ps_child_guard();
drop trigger if exists snow_ref_media_rules on public.snow_reference_media;
create trigger snow_ref_media_rules before insert or update or delete on public.snow_reference_media
  for each row execute function public._snow_ref_media_rules();

-- ── Access helpers ──────────────────────────────────────────────────────────

-- Can I see this property service's instructions and reference media?
-- Owner/admin: always. A worker: only while leading a route in a storm that
-- isn't ended which visits this property for this service, and only while
-- still holding that service permission.
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
              and r.lead_person_id = public.my_person_id()
              and r.cancelled_at is null
              and s.status <> 'ended'
          )
        )
      )
  )
$$;

-- Am I a linked customer contact of this property?
create or replace function public.snow_is_property_contact(prop_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_person_id() is not null and exists (
    select 1 from public.snow_property_contacts c
    where c.property_id = prop_id and c.person_id = public.my_person_id() and c.removed_at is null
  )
$$;

-- ── History: what was in effect at a moment ─────────────────────────────────

-- The instructions version in effect at `at` (null if none had been saved).
create or replace function public.snow_instructions_as_of(ps_id uuid, at timestamptz default now())
returns setof public.snow_service_instructions language sql stable as $$
  select * from public.snow_service_instructions
  where property_service_id = ps_id and created_at <= at
  order by version desc
  limit 1
$$;

-- The reference media that was live at `at`.
create or replace function public.snow_reference_media_as_of(ps_id uuid, at timestamptz default now())
returns setof public.snow_reference_media language sql stable as $$
  select * from public.snow_reference_media
  where property_service_id = ps_id and created_at <= at
    and (retired_at is null or retired_at > at)
  order by created_at
$$;

-- Both run with the caller's own access rules (not security definer), so
-- they never show more than the tables already would.

-- ── Access rules ────────────────────────────────────────────────────────────

alter table public.snow_property_services enable row level security;
drop policy if exists snow_property_services_select on public.snow_property_services;
create policy snow_property_services_select on public.snow_property_services for select using (
  public.is_staff(company_id)
  or public.snow_can_see_property_service(id)
  or public.snow_is_property_contact(property_id)
);
drop policy if exists snow_property_services_staff on public.snow_property_services;
create policy snow_property_services_staff on public.snow_property_services for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));

alter table public.snow_property_contacts enable row level security;
drop policy if exists snow_property_contacts_select on public.snow_property_contacts;
create policy snow_property_contacts_select on public.snow_property_contacts for select using (
  public.is_staff(company_id)
  or (person_id is not null and person_id = public.my_person_id() and removed_at is null)
);
drop policy if exists snow_property_contacts_staff on public.snow_property_contacts;
create policy snow_property_contacts_staff on public.snow_property_contacts for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));

alter table public.snow_service_instructions enable row level security;
drop policy if exists snow_instructions_select on public.snow_service_instructions;
create policy snow_instructions_select on public.snow_service_instructions for select using (
  public.is_staff(company_id) or public.snow_can_see_property_service(property_service_id)
);
drop policy if exists snow_instructions_insert on public.snow_service_instructions;
create policy snow_instructions_insert on public.snow_service_instructions for insert
  with check (public.is_staff(company_id));

alter table public.snow_reference_media enable row level security;
drop policy if exists snow_ref_media_select on public.snow_reference_media;
create policy snow_ref_media_select on public.snow_reference_media for select using (
  public.is_staff(company_id)
  or (retired_at is null and public.snow_can_see_property_service(property_service_id))
);
drop policy if exists snow_ref_media_insert on public.snow_reference_media;
create policy snow_ref_media_insert on public.snow_reference_media for insert
  with check (public.is_staff(company_id));
drop policy if exists snow_ref_media_update on public.snow_reference_media;
create policy snow_ref_media_update on public.snow_reference_media for update
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));

-- A customer contact sees the property's name and address, never its
-- internal notes. (No select rule on snow_properties for customers: this
-- function is their only way in.)
drop policy if exists snow_properties_contact_select on public.snow_properties;
create or replace function public.snow_my_properties()
returns table (id uuid, company_id uuid, name text, address text, city text, state text, zip text, map_destination text)
language sql stable security definer set search_path = public as $$
  select p.id, p.company_id, p.name, p.address, p.city, p.state, p.zip, p.map_destination
  from public.snow_properties p
  where public.snow_is_property_contact(p.id)
  order by p.name
$$;

-- A visit can only be added for a service the property gets (and hasn't
-- stopped). Existing visits are untouched when a service is stopped later.
create or replace function public._snow_visit_service_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.snow_property_services
    where property_id = new.property_id and service = new.service and is_active
  ) then
    raise exception 'This property isn''t set up for %. Add the service to the property first.', new.service;
  end if;
  return new;
end $$;
drop trigger if exists snow_visits_service_check on public.snow_visits;
create trigger snow_visits_service_check before insert on public.snow_visits
  for each row execute function public._snow_visit_service_check();

-- ── Private storage bucket ──────────────────────────────────────────────────
-- Paths: {company_id}/reference/{property_service_id}/{random}.{ext}

insert into storage.buckets (id, name, public)
values ('snow-media', 'snow-media', false)
on conflict (id) do update set public = false;

drop policy if exists snow_media_reference_upload on storage.objects;
create policy snow_media_reference_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'snow-media'
    and (storage.foldername(name))[2] = 'reference'
    and public.is_staff(public._try_uuid((storage.foldername(name))[1]))
  );

drop policy if exists snow_media_reference_read on storage.objects;
create policy snow_media_reference_read on storage.objects for select to authenticated
  using (
    bucket_id = 'snow-media'
    and (storage.foldername(name))[2] = 'reference'
    and (
      public.is_staff(public._try_uuid((storage.foldername(name))[1]))
      or exists (
        select 1 from public.snow_reference_media m
        where m.file_key = name and m.retired_at is null
          and public.snow_can_see_property_service(m.property_service_id)
      )
    )
  );

-- Owner/admin can clean up an upload that never got saved as media.
-- Saved media files are kept.
drop policy if exists snow_media_reference_delete on storage.objects;
create policy snow_media_reference_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'snow-media'
    and (storage.foldername(name))[2] = 'reference'
    and public.is_staff(public._try_uuid((storage.foldername(name))[1]))
    and not exists (select 1 from public.snow_reference_media m where m.file_key = name)
  );

-- ── Live updates ────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['snow_property_services', 'snow_property_contacts', 'snow_service_instructions', 'snow_reference_media'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
