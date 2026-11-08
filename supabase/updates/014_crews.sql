-- ============================================================================
-- Update 14 — run once in Supabase → SQL Editor (safe to run again).
--  • Crews: the owner groups workers into crews (e.g. "Maintenance Crew"),
--    each with a name and a color. A worker is in at most one crew, and the
--    crew shows as a small label on their card and profile.
--  • Schedule Work can add a whole crew at once.
--  • Same access rules as the rest of the team data: the crew can see, only
--    the owner/admin can change.
-- ============================================================================

create table if not exists public.crews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  color text not null default '#7CB342',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_crews_company_name on public.crews (company_id, lower(trim(name)));

-- One row per worker in a crew. A worker is in at most one crew.
create table if not exists public.crew_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  crew_id uuid not null references public.crews(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_crew_members_person on public.crew_members (company_id, person_id);
create index if not exists idx_crew_members_crew on public.crew_members (crew_id);

drop trigger if exists crews_updated_at on public.crews;
create trigger crews_updated_at before update on public.crews
  for each row execute function public.set_updated_at();

alter table public.crews enable row level security;
drop policy if exists crews_select on public.crews;
create policy crews_select on public.crews for select using (public.is_crew(company_id));
drop policy if exists crews_staff on public.crews;
create policy crews_staff on public.crews for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));

alter table public.crew_members enable row level security;
drop policy if exists crew_members_select on public.crew_members;
create policy crew_members_select on public.crew_members for select using (public.is_crew(company_id));
drop policy if exists crew_members_staff on public.crew_members;
create policy crew_members_staff on public.crew_members for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));

-- Live updates
do $$
declare t text;
begin
  foreach t in array array['crews', 'crew_members'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
