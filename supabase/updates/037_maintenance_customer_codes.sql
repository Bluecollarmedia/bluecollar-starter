-- ============================================================================
-- Update 37 — run once in Supabase → SQL Editor, AFTER updates 11, 18 and 34
-- (safe to run again). NOT run yet; read it before running.
--
-- Every maintenance property gets its own customer code, so a maintenance
-- customer can get in even without a regular project:
--  • Each property has a code (new properties get one automatically; existing
--    ones are given one now). Only the owner/admin and managers can see it.
--  • The customer types it on the same "Customer? View your project" screen.
--    Their account is linked to that property and they see its finished visits
--    and the photos you've shared (Account → Maintenance updates), nothing else.
--  • The owner can generate a new code (the old one stops working) and can
--    revoke a customer's access.
--
-- It reuses the project-code sign-up path: lookup_project_code() and
-- _claim_project() now also understand maintenance codes, so sign-up and the
-- signed-in claim both work without changing the sign-up trigger. Project codes
-- keep working exactly as before. Codes never repeat across projects and
-- properties.
-- ============================================================================

-- 1) The codes live apart from the property so crew members (who can read
--    properties) can't see them.
create table if not exists public.maintenance_customer_codes (
  property_id uuid primary key references public.maintenance_properties(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null unique,
  claimed_by uuid references public.people(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.maintenance_customer_codes enable row level security;
drop policy if exists maintenance_customer_codes_staff on public.maintenance_customer_codes;
create policy maintenance_customer_codes_staff on public.maintenance_customer_codes for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));

-- 2) A fresh code that no project or property already uses.
create or replace function public._new_customer_code()
returns text language plpgsql set search_path = public as $$
declare c text;
begin
  loop
    c := public._random_code(8);
    exit when not exists (select 1 from public.projects where customer_project_code = c)
          and not exists (select 1 from public.maintenance_customer_codes where code = c);
  end loop;
  return c;
end;
$$;
revoke all on function public._new_customer_code() from public, anon, authenticated;

-- 3) Every new property gets a code automatically.
create or replace function public._maintenance_property_code()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.maintenance_customer_codes (property_id, company_id, code)
  values (new.id, new.company_id, public._new_customer_code())
  on conflict (property_id) do nothing;
  return null;
end;
$$;
revoke all on function public._maintenance_property_code() from public, anon, authenticated;

drop trigger if exists maintenance_properties_code on public.maintenance_properties;
create trigger maintenance_properties_code after insert on public.maintenance_properties
  for each row execute function public._maintenance_property_code();

-- 4) Give every existing property a code (one at a time, so codes can't collide).
do $$
declare r record;
begin
  for r in
    select p.id, p.company_id from public.maintenance_properties p
     where not exists (select 1 from public.maintenance_customer_codes c where c.property_id = p.id)
  loop
    insert into public.maintenance_customer_codes (property_id, company_id, code)
    values (r.id, r.company_id, public._new_customer_code());
  end loop;
end $$;

-- 5) Claiming a maintenance code: links the signed-up person to the property.
create or replace function public._claim_maintenance(pid uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c record;
  prop record;
begin
  select * into c from public.maintenance_customer_codes where code = upper(trim(p_code));
  if c.property_id is null then
    return jsonb_build_object('success', false, 'error', 'invalid_code');
  end if;

  select id, company_id, customer_id into prop from public.maintenance_properties where id = c.property_id;

  -- A code belongs to the first customer who uses it (same as project codes).
  -- A customer record the owner linked by hand doesn't count as a claim, so
  -- the real customer can still use the code; the owner revokes to start over.
  if c.claimed_by is not null and c.claimed_by <> pid then
    return jsonb_build_object('success', false, 'error', 'already_claimed');
  end if;
  if exists (select 1 from public.company_members
             where company_id = c.company_id and person_id = pid and status = 'inactive'
               and deactivated_by is not null and deactivated_by <> pid) then
    return jsonb_build_object('success', false, 'error', 'access_removed');
  end if;

  update public.maintenance_properties set customer_id = pid where id = prop.id;
  update public.maintenance_customer_codes
     set claimed_by = pid, claimed_at = coalesce(claimed_at, now())
   where property_id = c.property_id;

  insert into public.company_members (company_id, person_id, role, status, join_method)
  values (c.company_id, pid, 'customer', 'active', 'invitation_link')
  on conflict (company_id, person_id) do update
    set status = 'active'
    where public.company_members.status <> 'active' and public.company_members.role = 'customer';

  return jsonb_build_object('success', true, 'project_id', prop.id, 'kind', 'maintenance');
end;
$$;
revoke all on function public._claim_maintenance(uuid, text) from public, anon, authenticated;

-- 6) _claim_project (sign-up and signed-in claim both go through it): a
--    maintenance code is handed to _claim_maintenance; everything else is the
--    project-code logic from update 11, unchanged.
create or replace function public._claim_project(pid uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pr record;
begin
  if exists (select 1 from public.maintenance_customer_codes where code = upper(trim(p_code))) then
    return public._claim_maintenance(pid, p_code);
  end if;

  select p.id, p.company_id, p.customer_claimed_by, coalesce(s.customer_interaction_enabled, true) as enabled
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

  return jsonb_build_object('success', true, 'project_id', pr.id);
end;
$$;

-- 7) The public "check a code before signing up" function also knows maintenance codes.
create or replace function public.lookup_project_code(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object(
       'valid', true,
       'project_id', p.id,
       'project_name', p.name,
       'portal_enabled', coalesce(s.customer_interaction_enabled, true),
       'claimed', p.customer_claimed_by is not null)
       from public.projects p
       left join public.project_settings s on s.project_id = p.id
      where p.customer_project_code = upper(trim(p_code))),
    (select jsonb_build_object(
       'valid', true,
       'project_id', mp.id,
       'project_name', mp.name,
       'portal_enabled', true,
       'claimed', c.claimed_by is not null,
       'kind', 'maintenance')
       from public.maintenance_customer_codes c
       join public.maintenance_properties mp on mp.id = c.property_id
      where c.code = upper(trim(p_code))),
    jsonb_build_object('valid', false)
  )
$$;
grant execute on function public.lookup_project_code(text) to anon, authenticated;

-- 8) Owner/admin: a new code for a property (the old one stops working and any
--    claim on the code is cleared). With p_revoke = true the customer who
--    claimed it is also unlinked from the property, so they lose access.
create or replace function public.regenerate_maintenance_code(p_property_id uuid, p_revoke boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  who uuid;
  new_code text;
begin
  select company_id into cid from public.maintenance_properties where id = p_property_id;
  if cid is null or not public.is_staff(cid) then raise exception 'not allowed'; end if;

  select claimed_by into who from public.maintenance_customer_codes where property_id = p_property_id;
  new_code := public._new_customer_code();

  insert into public.maintenance_customer_codes (property_id, company_id, code)
  values (p_property_id, cid, new_code)
  on conflict (property_id) do update set code = excluded.code, claimed_by = null, claimed_at = null;

  if p_revoke and who is not null then
    update public.maintenance_properties set customer_id = null
     where id = p_property_id and customer_id = who;
  end if;
  return new_code;
end;
$$;
revoke execute on function public.regenerate_maintenance_code(uuid, boolean) from public, anon;
grant execute on function public.regenerate_maintenance_code(uuid, boolean) to authenticated;

-- 9) A customer's own maintenance properties (so the app can show them even
--    before the first visit).
create or replace function public.maintenance_my_properties()
returns table (id uuid, name text, address text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, concat_ws(', ', nullif(p.address, ''), nullif(p.city, ''))
    from public.maintenance_properties p
   where p.customer_id = public.my_person_id()
   order by p.name
$$;
revoke all on function public.maintenance_my_properties() from public, anon;
grant execute on function public.maintenance_my_properties() to authenticated;
