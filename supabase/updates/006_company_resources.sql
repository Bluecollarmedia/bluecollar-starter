-- ============================================================================
-- Update 6 — run once in Supabase → SQL Editor (safe to run again).
--  • Company Resources: gate codes, truck/trailer lock codes, equipment
--    instructions, company info and company cards (label + last 4 only).
--  • Each resource is private until the owner grants individual workers access.
--  • Protected codes are encrypted with Supabase Vault and are only ever handed
--    out by reveal_resource_secret(), which checks access every time.
--  • Every change, grant, revoke and reveal is written to resource_audit_log
--    (never the code itself).
-- ============================================================================

create extension if not exists supabase_vault with schema vault;

-- ── Tables ──────────────────────────────────────────────────────────────────

create table if not exists public.company_resources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  category text not null check (category in ('access_code','vehicle','equipment','company_info','company_card')),
  name text not null check (length(trim(name)) > 0 and length(name) <= 120),
  description text check (description is null or length(description) <= 2000),
  -- Trucks & Trailers link to the existing truck record (trailers are trucks rows too).
  truck_id uuid references public.trucks(id) on delete set null,
  -- Equipment (or anything without its own record) is just named.
  item_name text check (item_name is null or length(item_name) <= 120),
  -- Company cards: safe metadata only. Never a full number, PIN or CVV.
  card_last_four text check (card_last_four is null or card_last_four ~ '^[0-9]{4}$'),
  card_holder_id uuid references public.people(id) on delete set null,
  -- Set only by set_resource_secret(); clients can't flip it.
  has_secret boolean not null default false,
  created_by uuid references public.people(id) on delete set null,
  updated_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_company_resources_company on public.company_resources(company_id);
create index if not exists idx_company_resources_truck on public.company_resources(truck_id);

create table if not exists public.resource_access (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  resource_id uuid not null references public.company_resources(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  granted_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (resource_id, person_id)
);
create index if not exists idx_resource_access_person on public.resource_access(person_id);

-- Pointer from a resource to its encrypted code in Vault. Nobody can read this
-- table from the app (RLS on, no policies); only the functions below use it.
create table if not exists public.resource_secrets (
  resource_id uuid primary key references public.company_resources(id) on delete cascade,
  vault_secret_id uuid not null,
  updated_at timestamptz not null default now()
);

-- Audit trail. No foreign keys except the company, so history survives the
-- resource or person being deleted. Never holds a code.
create table if not exists public.resource_audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  resource_id uuid,
  resource_name text,
  actor_id uuid,
  event_type text not null check (event_type in (
    'created','updated','deleted','access_granted','access_revoked',
    'code_changed','code_removed','code_revealed')),
  target_person_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_resource_audit_resource on public.resource_audit_log(resource_id, created_at desc);

drop trigger if exists company_resources_updated_at on public.company_resources;
create trigger company_resources_updated_at before update on public.company_resources
  for each row execute function public.set_updated_at();

-- ── Payment-card guard ──────────────────────────────────────────────────────

-- True when the text contains a 13–19 digit run (spaces/dashes allowed) that
-- passes the Luhn check, i.e. it looks like a real card number.
create or replace function public._has_card_number(t text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  m text[];
  digits text;
  total int;
  d int;
  i int;
begin
  if t is null then return false; end if;
  for m in select regexp_matches(t, '(?:[0-9][ -]?){12,18}[0-9]', 'g') loop
    digits := regexp_replace(m[1], '[^0-9]', '', 'g');
    total := 0;
    for i in 1..length(digits) loop
      d := substr(digits, length(digits) - i + 1, 1)::int;
      if i % 2 = 0 then
        d := d * 2;
        if d > 9 then d := d - 9; end if;
      end if;
      total := total + d;
    end loop;
    if total % 10 = 0 then return true; end if;
  end loop;
  return false;
end;
$$;

-- True when the text talks about a card PIN / CVV / security code.
create or replace function public._mentions_card_credential(t text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    t ~* '\m(cvv2?|cvc2?|cvn|security code)\M'
    or t ~* '\mcard\M.{0,30}\mpin\M'
    or t ~* '\mpin\M.{0,30}\mcard\M',
    false)
$$;

-- ── Row checks: company, card rules, who changed it ─────────────────────────

create or replace function public.company_resources_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.name := trim(new.name);
  if public._has_card_number(new.name) or public._has_card_number(new.description) or public._has_card_number(new.item_name) then
    raise exception 'That looks like a payment card number. Card numbers can''t be stored in the app.';
  end if;
  if public._mentions_card_credential(new.name) or public._mentions_card_credential(new.description) then
    raise exception 'Card PINs and security codes can''t be stored in the app. Use the card issuer''s PIN process.';
  end if;

  if new.category = 'company_card' and (new.name ~* '\mpins?\M' or new.description ~* '\mpins?\M') then
    raise exception 'Card PINs can''t be stored in the app. Use the card issuer''s PIN process.';
  end if;
  if new.category <> 'company_card' then
    new.card_last_four := null;
    new.card_holder_id := null;
  end if;
  if new.category <> 'vehicle' then
    new.truck_id := null;
  end if;
  if new.truck_id is not null and not exists (
    select 1 from public.trucks t where t.id = new.truck_id and t.company_id = new.company_id
  ) then
    raise exception 'That truck isn''t part of this company.';
  end if;
  if new.card_holder_id is not null and not exists (
    select 1 from public.company_members m
    where m.person_id = new.card_holder_id and m.company_id = new.company_id and m.status = 'active'
  ) then
    raise exception 'The card holder must be an active member of this company.';
  end if;

  -- has_secret can only be changed from set_resource_secret().
  if coalesce(current_setting('app.resource_secret_write', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.has_secret := false;
    else
      new.has_secret := old.has_secret;
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := public.my_person_id();
  else
    new.company_id := old.company_id;
    new.created_by := old.created_by;
  end if;
  new.updated_by := coalesce(public.my_person_id(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists company_resources_check on public.company_resources;
create trigger company_resources_check before insert or update on public.company_resources
  for each row execute function public.company_resources_check();

-- Access rows: company comes from the resource; only active workers can be granted.
create or replace function public.resource_access_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select company_id into new.company_id from public.company_resources where id = new.resource_id;
  if new.company_id is null then
    raise exception 'Resource not found.';
  end if;
  if not exists (
    select 1 from public.company_members m
    where m.person_id = new.person_id and m.company_id = new.company_id
      and m.role = 'worker' and m.status = 'active'
  ) then
    raise exception 'Access can only be given to active workers.';
  end if;
  new.granted_by := public.my_person_id();
  return new;
end;
$$;

drop trigger if exists resource_access_check on public.resource_access;
create trigger resource_access_check before insert or update on public.resource_access
  for each row execute function public.resource_access_check();

-- ── Audit triggers ──────────────────────────────────────────────────────────

create or replace function public.company_resources_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.resource_audit_log (company_id, resource_id, resource_name, actor_id, event_type, metadata)
    values (new.company_id, new.id, new.name, public.my_person_id(), 'created', jsonb_build_object('category', new.category));
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.name, new.category, new.description, new.truck_id, new.item_name, new.card_last_four, new.card_holder_id)
       is distinct from
       (old.name, old.category, old.description, old.truck_id, old.item_name, old.card_last_four, old.card_holder_id) then
      insert into public.resource_audit_log (company_id, resource_id, resource_name, actor_id, event_type)
      values (new.company_id, new.id, new.name, public.my_person_id(), 'updated');
    end if;
    return new;
  else
    -- Skip when the whole company is being wiped (reset script).
    if exists (select 1 from public.companies where id = old.company_id) then
      insert into public.resource_audit_log (company_id, resource_id, resource_name, actor_id, event_type)
      values (old.company_id, old.id, old.name, public.my_person_id(), 'deleted');
    end if;
    return old;
  end if;
end;
$$;

drop trigger if exists company_resources_audit on public.company_resources;
create trigger company_resources_audit after insert or update or delete on public.company_resources
  for each row execute function public.company_resources_audit();

create or replace function public.resource_access_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rname text;
begin
  if tg_op = 'INSERT' then
    select name into rname from public.company_resources where id = new.resource_id;
    insert into public.resource_audit_log (company_id, resource_id, resource_name, actor_id, event_type, target_person_id)
    values (new.company_id, new.resource_id, rname, public.my_person_id(), 'access_granted', new.person_id);
    return new;
  end if;
  -- A deleted resource takes its access rows with it; the 'deleted' entry covers that.
  select name into rname from public.company_resources where id = old.resource_id;
  if rname is not null then
    insert into public.resource_audit_log (company_id, resource_id, resource_name, actor_id, event_type, target_person_id, metadata)
    values (old.company_id, old.resource_id, rname, public.my_person_id(), 'access_revoked', old.person_id,
            case when coalesce(current_setting('app.resource_revoke_reason', true), '') <> ''
                 then jsonb_build_object('reason', current_setting('app.resource_revoke_reason', true)) end);
  end if;
  return old;
end;
$$;

drop trigger if exists resource_access_audit on public.resource_access;
create trigger resource_access_audit after insert or delete on public.resource_access
  for each row execute function public.resource_access_audit();

-- ── Deactivated workers lose every resource right away ──────────────────────

create or replace function public.revoke_resources_on_member_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform set_config('app.resource_revoke_reason', 'member_removed', true);
    delete from public.resource_access where person_id = old.person_id and company_id = old.company_id;
    perform set_config('app.resource_revoke_reason', '', true);
    return old;
  end if;
  if new.status <> 'active' or new.role <> 'worker' then
    perform set_config('app.resource_revoke_reason', 'deactivated', true);
    delete from public.resource_access where person_id = new.person_id and company_id = new.company_id;
    perform set_config('app.resource_revoke_reason', '', true);
  end if;
  return new;
end;
$$;

drop trigger if exists company_members_revoke_resources on public.company_members;
create trigger company_members_revoke_resources
  after update of status, role or delete on public.company_members
  for each row execute function public.revoke_resources_on_member_change();

-- One-time cleanup in case anyone is already inactive.
delete from public.resource_access ra
where not exists (
  select 1 from public.company_members m
  where m.person_id = ra.person_id and m.company_id = ra.company_id
    and m.role = 'worker' and m.status = 'active'
);

-- Removing a code also removes it from Vault.
create or replace function public.resource_secrets_cleanup()
returns trigger language plpgsql security definer set search_path = public, vault as $$
begin
  delete from vault.secrets where id = old.vault_secret_id;
  return old;
end;
$$;

drop trigger if exists resource_secrets_cleanup on public.resource_secrets;
create trigger resource_secrets_cleanup after delete on public.resource_secrets
  for each row execute function public.resource_secrets_cleanup();

-- ── Who can see a resource ──────────────────────────────────────────────────

-- Owner/admin of the company, or an ACTIVE worker who was explicitly granted it.
create or replace function public.can_view_resource(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_resources r
    where r.id = rid
      and (
        public.is_staff(r.company_id)
        or (
          public.member_role(r.company_id) = 'worker'
          and exists (
            select 1 from public.resource_access a
            where a.resource_id = r.id and a.person_id = public.my_person_id()
          )
        )
      )
  )
$$;

alter table public.company_resources enable row level security;
drop policy if exists company_resources_select on public.company_resources;
create policy company_resources_select on public.company_resources for select
  using (public.can_view_resource(id));
drop policy if exists company_resources_staff on public.company_resources;
create policy company_resources_staff on public.company_resources for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));

-- Workers see only their own access rows (never who else has access).
alter table public.resource_access enable row level security;
drop policy if exists resource_access_select on public.resource_access;
create policy resource_access_select on public.resource_access for select using (
  public.is_staff(company_id)
  or (person_id = public.my_person_id() and public.member_role(company_id) = 'worker')
);
drop policy if exists resource_access_staff on public.resource_access;
create policy resource_access_staff on public.resource_access for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));

alter table public.resource_secrets enable row level security;
revoke all on public.resource_secrets from anon, authenticated;

alter table public.resource_audit_log enable row level security;
drop policy if exists resource_audit_select on public.resource_audit_log;
create policy resource_audit_select on public.resource_audit_log for select
  using (public.is_staff(company_id));
revoke insert, update, delete on public.resource_audit_log from anon, authenticated;

-- ── Codes: set (owner/admin only) and reveal (checked every time) ──────────

create or replace function public.set_resource_secret(p_resource_id uuid, p_secret text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare
  r public.company_resources;
  sid uuid;
  v text := nullif(trim(coalesce(p_secret, '')), '');
begin
  select * into r from public.company_resources where id = p_resource_id;
  if r.id is null or not public.is_staff(r.company_id) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if v is not null then
    if r.category = 'company_card' then
      raise exception 'Card entries can''t hold a code or PIN. Use the card issuer''s PIN process.';
    end if;
    if length(v) > 500 then
      raise exception 'That code is too long.';
    end if;
    if public._has_card_number(v) then
      raise exception 'That looks like a payment card number. Card numbers can''t be stored in the app.';
    end if;
  end if;

  select vault_secret_id into sid from public.resource_secrets where resource_id = r.id;
  if v is null then
    delete from public.resource_secrets where resource_id = r.id;
  elsif sid is null then
    sid := vault.create_secret(v, 'company_resource_' || r.id::text, 'Brighton company resource code');
    insert into public.resource_secrets (resource_id, vault_secret_id) values (r.id, sid);
  else
    perform vault.update_secret(sid, v);
    update public.resource_secrets set updated_at = now() where resource_id = r.id;
  end if;

  perform set_config('app.resource_secret_write', 'on', true);
  update public.company_resources set has_secret = (v is not null) where id = r.id;
  perform set_config('app.resource_secret_write', '', true);

  insert into public.resource_audit_log (company_id, resource_id, resource_name, actor_id, event_type)
  values (r.company_id, r.id, r.name, public.my_person_id(), case when v is null then 'code_removed' else 'code_changed' end);
end;
$$;

-- Same "not available" answer whether the id doesn't exist or isn't yours,
-- so guessed ids reveal nothing.
create or replace function public.reveal_resource_secret(p_resource_id uuid)
returns text language plpgsql security definer set search_path = public, vault as $$
declare
  r public.company_resources;
  s text;
begin
  select * into r from public.company_resources where id = p_resource_id;
  if r.id is null or not public.can_view_resource(r.id) then
    raise exception 'This resource isn''t available.' using errcode = '42501';
  end if;
  select ds.decrypted_secret into s
  from public.resource_secrets rs
  join vault.decrypted_secrets ds on ds.id = rs.vault_secret_id
  where rs.resource_id = r.id;
  if s is null then
    return null;
  end if;
  insert into public.resource_audit_log (company_id, resource_id, resource_name, actor_id, event_type)
  values (r.company_id, r.id, r.name, public.my_person_id(), 'code_revealed');
  return s;
end;
$$;

revoke execute on function public.set_resource_secret(uuid, text) from public, anon;
grant execute on function public.set_resource_secret(uuid, text) to authenticated;
revoke execute on function public.reveal_resource_secret(uuid) from public, anon;
grant execute on function public.reveal_resource_secret(uuid) to authenticated;

-- ── Live updates ────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['company_resources','resource_access'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
