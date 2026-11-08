-- ============================================================================
-- Update 57 — run once in Supabase → SQL Editor (safe to run again). NOT run yet; read it before running.
--
-- The owner's PRIVATE notes, pictures and materials lists for a project, from the first quote onward.
--  • owner_project_notes: dated notes ("order 12 yards of mulch", measurements, what material to use...).
--  • owner_project_photos: the owner's own pictures of the site (before anything starts), with an optional caption.
--  • owner_material_lists: a vendor-ready materials list the owner had sorted out from the notes (kept so it can be printed again).
--  • They belong to the PROJECT, so a quote written on a prospect and the project it becomes are the same place: the notes
--    written while quoting are still there after the quote is approved.
--  • PRIVATE: only the company OWNER can see, add, change or delete any of it. Admins, workers and customers get nothing back,
--    even if they ask the database directly. (These are separate from the project's customer-visible photos and updates.)
-- ============================================================================

create or replace function public.is_company_owner(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.member_role(cid) = 'owner', false)
$$;

create table if not exists public.owner_project_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_owner_project_notes_project on public.owner_project_notes (project_id, created_at desc);

create table if not exists public.owner_project_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  file_url text not null,
  file_key text,
  caption text,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_owner_project_photos_project on public.owner_project_photos (project_id, created_at desc);

create table if not exists public.owner_material_lists (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null default 'Materials list',
  items jsonb not null default '[]'::jsonb,
  source_text text,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_owner_material_lists_project on public.owner_material_lists (project_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['owner_project_notes','owner_project_photos','owner_material_lists'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_delete', t);
    execute format('create policy %I on public.%I for select using (public.is_company_owner(company_id))', t || '_owner_select', t);
    -- The project must belong to the same company, so nothing can be attached to another company's project.
    execute format('create policy %I on public.%I for insert with check (public.is_company_owner(company_id)
      and exists (select 1 from public.projects pr where pr.id = project_id and pr.company_id = %I.company_id))', t || '_owner_insert', t, t);
    execute format('create policy %I on public.%I for update using (public.is_company_owner(company_id)) with check (public.is_company_owner(company_id))', t || '_owner_update', t);
    execute format('create policy %I on public.%I for delete using (public.is_company_owner(company_id))', t || '_owner_delete', t);
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;
