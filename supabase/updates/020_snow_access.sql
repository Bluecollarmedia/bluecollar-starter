-- ============================================================================
-- Update 20 — Snow Mode access: who is on the snow team and which services
-- they may work. Run once in Supabase → SQL Editor, after update 19 (safe to
-- run again).
--  • Snow-only employees are kept OUT of company_members, so every existing
--    landscaping rule (is_member / is_crew) keeps them out of landscaping data.
--  • Plowing, shoveling and salting are separate grants.
--  • Pending signup requests grant nothing; only snow_grant_access does.
--  • The company's active mode is never used as permission.
-- ============================================================================

-- ── Who is on the snow team ─────────────────────────────────────────────────
-- Snow access lives here, never on company_members. A company_members worker
-- row makes is_crew()/is_member() true, which opens every landscaping table,
-- so a snow-only employee has a snow_staff row and NO company_members row.
-- A dual-mode employee has both, and each side keeps its own rules.
-- The company's active mode is never consulted here: switching to Snow Mode
-- grants nobody anything.

create table if not exists public.snow_staff (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'revoked')),
  granted_by uuid references public.people(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_by uuid references public.people(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, person_id)
);
create index if not exists idx_snow_staff_person on public.snow_staff (person_id);

-- Which snow services each employee may work. Plowing, shoveling and salting
-- are separate grants: holding one never implies another.
create table if not exists public.snow_staff_services (
  company_id uuid not null,
  person_id uuid not null,
  service text not null check (service in ('plowing', 'shoveling', 'salting')),
  granted_by uuid references public.people(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (company_id, person_id, service),
  foreign key (company_id, person_id)
    references public.snow_staff (company_id, person_id) on delete cascade
);

-- Every grant, change and revoke, kept for the owner. Append-only.
create table if not exists public.snow_access_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid references public.people(id) on delete set null,
  actor_id uuid references public.people(id) on delete set null,
  action text not null check (action in ('granted', 'services_changed', 'revoked')),
  services text[] not null default '{}',
  previous_services text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_snow_access_log_company on public.snow_access_log (company_id, created_at desc);

drop trigger if exists snow_staff_updated_at on public.snow_staff;
create trigger snow_staff_updated_at before update on public.snow_staff
  for each row execute function public.set_updated_at();

-- ── Access checks (SECURITY DEFINER so policies never recurse) ──────────────

-- Owner/admin of the company: full snow operations access.
create or replace function public.snow_is_admin(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff(cid)
$$;

-- Owner/admin, or an approved snow employee whose access hasn't been revoked.
create or replace function public.snow_is_active(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff(cid) or exists (
    select 1 from public.snow_staff s
    where s.company_id = cid and s.person_id = public.my_person_id() and s.status = 'active'
  )
$$;

-- May the caller work this snow service? Owner/admin always may.
create or replace function public.snow_has_service(cid uuid, svc text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff(cid) or exists (
    select 1 from public.snow_staff s
    join public.snow_staff_services ss on ss.company_id = s.company_id and ss.person_id = s.person_id
    where s.company_id = cid and s.person_id = public.my_person_id()
      and s.status = 'active' and ss.service = svc
  )
$$;

-- Same check for someone else (e.g. before making them a route lead).
create or replace function public.snow_person_has_service(cid uuid, pid uuid, svc text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_members m
    where m.company_id = cid and m.person_id = pid and m.status = 'active' and m.role in ('owner', 'admin')
  ) or exists (
    select 1 from public.snow_staff s
    join public.snow_staff_services ss on ss.company_id = s.company_id and ss.person_id = s.person_id
    where s.company_id = cid and s.person_id = pid and s.status = 'active' and ss.service = svc
  )
$$;

-- People the caller may see on the snow side: themselves; for owner/admin,
-- every snow employee; for an employee, teammates who share one of their
-- services (a plower never sees the shoveling crew).
create or replace function public.snow_can_see_person(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.snow_staff s
    where s.person_id = pid and public.is_staff(s.company_id)
  ) or exists (
    select 1
    from public.snow_staff me_s
    join public.snow_staff_services me_ss on me_ss.company_id = me_s.company_id and me_ss.person_id = me_s.person_id
    join public.snow_staff_services them on them.company_id = me_ss.company_id and them.service = me_ss.service
    join public.snow_staff them_s on them_s.company_id = them.company_id and them_s.person_id = them.person_id
    where me_s.person_id = public.my_person_id() and me_s.status = 'active'
      and them.person_id = pid and them_s.status = 'active'
  )
$$;

-- ── Access rules for the tables above ───────────────────────────────────────

alter table public.snow_staff enable row level security;
drop policy if exists snow_staff_select on public.snow_staff;
create policy snow_staff_select on public.snow_staff for select
  using (public.is_staff(company_id) or person_id = public.my_person_id());
-- Changes go through snow_grant_access / snow_revoke_access below.

alter table public.snow_staff_services enable row level security;
drop policy if exists snow_staff_services_select on public.snow_staff_services;
create policy snow_staff_services_select on public.snow_staff_services for select
  using (public.is_staff(company_id) or person_id = public.my_person_id());

alter table public.snow_access_log enable row level security;
drop policy if exists snow_access_log_select on public.snow_access_log;
create policy snow_access_log_select on public.snow_access_log for select
  using (public.is_staff(company_id));

-- Additive: snow employees can read their own company's name/contact row and
-- the names of the people above. Landscaping rules are untouched.
drop policy if exists companies_select_snow on public.companies;
create policy companies_select_snow on public.companies for select
  using (public.snow_is_active(id));

drop policy if exists people_select_snow on public.people;
create policy people_select_snow on public.people for select
  using (public.snow_can_see_person(id));

-- ── Owner actions ───────────────────────────────────────────────────────────

-- Grant (or change) someone's snow services. Replaces their service list.
-- Used by the snow signup approval and by later permission edits.
create or replace function public.snow_grant_access(p_person_id uuid, p_services text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  cid uuid;
  prev text[];
  was_active boolean;
  svcs text[];
begin
  select company_id into cid from public.company_members
  where person_id = me and role in ('owner', 'admin') and status = 'active'
  order by created_at limit 1;
  if cid is null then raise exception 'Only the owner can change snow access.'; end if;
  if p_person_id is null or not exists (select 1 from public.people where id = p_person_id) then
    raise exception 'Person not found.';
  end if;

  select coalesce(array_agg(distinct s order by s), '{}') into svcs
  from unnest(coalesce(p_services, '{}')) s;
  if cardinality(svcs) = 0 then raise exception 'Pick at least one snow service.'; end if;
  if exists (select 1 from unnest(svcs) s where s not in ('plowing', 'shoveling', 'salting')) then
    raise exception 'Unknown snow service.';
  end if;

  select status = 'active' into was_active from public.snow_staff
  where company_id = cid and person_id = p_person_id for update;
  select coalesce(array_agg(service order by service), '{}') into prev
  from public.snow_staff_services where company_id = cid and person_id = p_person_id;

  insert into public.snow_staff (company_id, person_id, status, granted_by, granted_at)
  values (cid, p_person_id, 'active', me, now())
  on conflict (company_id, person_id) do update
    set status = 'active', revoked_by = null, revoked_at = null,
        granted_by = case when public.snow_staff.status = 'active' then public.snow_staff.granted_by else me end,
        granted_at = case when public.snow_staff.status = 'active' then public.snow_staff.granted_at else now() end;

  delete from public.snow_staff_services
  where company_id = cid and person_id = p_person_id and service <> all (svcs);
  insert into public.snow_staff_services (company_id, person_id, service, granted_by)
  select cid, p_person_id, s, me from unnest(svcs) s
  on conflict do nothing;

  if coalesce(was_active, false) and prev = svcs then return; end if;  -- double tap: nothing changed
  insert into public.snow_access_log (company_id, person_id, actor_id, action, services, previous_services)
  values (cid, p_person_id, me,
          case when coalesce(was_active, false) then 'services_changed' else 'granted' end,
          svcs, case when coalesce(was_active, false) then prev else '{}' end);
end;
$$;

-- Take away all snow access. The row and history stay; landscaping access
-- (if any) is not touched.
create or replace function public.snow_revoke_access(p_person_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  cid uuid;
  prev text[];
begin
  select company_id into cid from public.company_members
  where person_id = me and role in ('owner', 'admin') and status = 'active'
  order by created_at limit 1;
  if cid is null then raise exception 'Only the owner can change snow access.'; end if;

  select coalesce(array_agg(service order by service), '{}') into prev
  from public.snow_staff_services where company_id = cid and person_id = p_person_id;

  update public.snow_staff set status = 'revoked', revoked_by = me, revoked_at = now()
  where company_id = cid and person_id = p_person_id and status = 'active';
  if not found then return; end if;  -- not on the snow team, or already revoked

  delete from public.snow_staff_services where company_id = cid and person_id = p_person_id;
  insert into public.snow_access_log (company_id, person_id, actor_id, action, services, previous_services)
  values (cid, p_person_id, me, 'revoked', '{}', prev);
end;
$$;

-- What the signed-in person may do on the snow side. The app uses this to
-- decide whether to offer Snow Mode at all; the database enforces it anyway.
create or replace function public.get_my_snow_access()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'company_id', c.id,
      'company_name', c.name,
      'is_admin', public.is_staff(c.id),
      'services', case when public.is_staff(c.id)
        then to_jsonb(array['plowing', 'shoveling', 'salting'])
        else coalesce((select to_jsonb(array_agg(ss.service order by ss.service))
                       from public.snow_staff_services ss
                       where ss.company_id = c.id and ss.person_id = public.my_person_id()), '[]'::jsonb)
      end,
      'landscaping_access', public.is_crew(c.id)
    ))
    from public.companies c
    where public.snow_is_active(c.id)
  ), '[]'::jsonb)
$$;

revoke execute on function public.snow_grant_access(uuid, text[]) from anon;
revoke execute on function public.snow_revoke_access(uuid) from anon;
revoke execute on function public.get_my_snow_access() from anon;
