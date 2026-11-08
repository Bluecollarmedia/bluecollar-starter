-- Minimal stand-in for the "Snow roles and service permissions" update, so the
-- Snow onboarding test runs on its own. Use the real update when it exists.
create table if not exists public.snow_staff (
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  status text not null default 'active' check (status in ('active','revoked')),
  granted_by uuid, granted_at timestamptz default now(), revoked_by uuid, revoked_at timestamptz,
  primary key (company_id, person_id));
create table if not exists public.snow_staff_services (
  company_id uuid not null, person_id uuid not null,
  service text not null check (service in ('plowing','shoveling','salting')),
  primary key (company_id, person_id, service));
create or replace function public.snow_grant_access(p_person_id uuid, p_services text[])
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid := (select company_id from company_members where person_id = my_person_id() and role in ('owner','admin') and status='active' limit 1);
begin
  if cid is null then raise exception 'not allowed'; end if;
  insert into snow_staff(company_id, person_id, status, granted_by) values (cid, p_person_id, 'active', my_person_id())
  on conflict (company_id, person_id) do update set status='active', granted_at=now(), revoked_at=null;
  delete from snow_staff_services where company_id=cid and person_id=p_person_id;
  insert into snow_staff_services select cid, p_person_id, unnest(p_services);
end $$;
create or replace function public.snow_revoke_access(p_person_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update snow_staff set status='revoked', revoked_at=now() where person_id=p_person_id and public.is_staff(company_id);
  delete from snow_staff_services s where person_id=p_person_id and public.is_staff(s.company_id);
end $$;
alter table public.snow_staff enable row level security;
alter table public.snow_staff_services enable row level security;
