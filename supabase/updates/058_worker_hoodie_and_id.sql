-- ============================================================================
-- Update 58 — run once in Supabase → SQL Editor (safe to run again).
--
-- Two things a worker gives when they join (and can change themself later in Settings → Edit Profile):
--  • people.hoodie_size: a plain size (XS … 3XL). Seen by the same people who can already see that person.
--  • person_ids: a photo of the worker's ID. PRIVATE: only that worker and the company OWNER (of a company they belong to or
--    asked to join) can read it. Admins, other workers and customers get nothing back, even asking the database directly.
--    Only the worker can add, replace or remove it. The app stores just the file's key here, never a public link.
-- ============================================================================

alter table public.people add column if not exists hoodie_size text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'people_hoodie_size_valid') then
    alter table public.people add constraint people_hoodie_size_valid
      check (hoodie_size is null or hoodie_size in ('XS','S','M','L','XL','2XL','3XL'));
  end if;
end $$;

-- True when I am the OWNER of a company this person belongs to or has asked to join.
create or replace function public.owner_of_person(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.company_members cm where cm.person_id = pid and public.is_company_owner(cm.company_id))
      or exists (select 1 from public.join_requests jr where jr.person_id = pid and public.is_company_owner(jr.company_id))
$$;

create table if not exists public.person_ids (
  person_id uuid primary key references public.people(id) on delete cascade,
  id_key text not null check (id_key ~ '^ids/[A-Za-z0-9._/-]+$'),
  updated_at timestamptz not null default now()
);

alter table public.person_ids enable row level security;
drop policy if exists person_ids_select on public.person_ids;
drop policy if exists person_ids_insert on public.person_ids;
drop policy if exists person_ids_update on public.person_ids;
drop policy if exists person_ids_delete on public.person_ids;
create policy person_ids_select on public.person_ids for select
  using (person_id = public.my_person_id() or public.owner_of_person(person_id));
create policy person_ids_insert on public.person_ids for insert
  with check (person_id = public.my_person_id() and id_key like 'ids/' || person_id::text || '/%');
create policy person_ids_update on public.person_ids for update
  using (person_id = public.my_person_id())
  with check (person_id = public.my_person_id() and id_key like 'ids/' || person_id::text || '/%');
create policy person_ids_delete on public.person_ids for delete
  using (person_id = public.my_person_id());
