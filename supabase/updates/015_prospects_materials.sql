-- ============================================================================
-- Update 15 — run once in Supabase → SQL Editor (safe to run again).
-- Needs update 8 (quotes & invoices) first.
--  • Prospect projects: a quote for a new customer or property creates the
--    project as a Prospect. Prospects aren't on the schedule and have no team;
--    when the quote is approved the owner taps Start Project and it becomes
--    Active (the same project, so nothing is duplicated).
--  • Document defaults: the tax rate, terms, exclusions and payment
--    instructions every new quote / change order / invoice starts with.
--  • Materials: each project's checklist of materials to prepare (owner-only),
--    saved vendors / pickup places, and a preparation reminder tied to the
--    job's scheduled date.
--  • Access: only the owner/admin can see or change any of it. Workers and
--    customers can't.
-- ============================================================================

-- ── Prospect projects ───────────────────────────────────────────────────────
alter table public.projects drop constraint if exists projects_status_check;
alter table public.projects add constraint projects_status_check
  check (status in ('prospect','active','on_hold','completed','archived'));

-- ── Document defaults ───────────────────────────────────────────────────────
create table if not exists public.financial_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  default_tax_rate numeric(6,3) check (default_tax_rate >= 0 and default_tax_rate < 100),
  default_terms text,
  default_exclusions text,
  default_payment_instructions text,
  updated_at timestamptz not null default now()
);

-- ── Vendors / pickup places ─────────────────────────────────────────────────
create table if not exists public.material_vendors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  contact_name text,
  phone text,
  email text,
  address text,
  pickup_instructions text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_material_vendors_company on public.material_vendors(company_id);

-- ── A project's materials checklist ─────────────────────────────────────────
create table if not exists public.project_materials (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  -- Empty when the quantity isn't known yet (it then needs review).
  quantity numeric(12,3) check (quantity is null or quantity > 0),
  unit text,
  status text not null default 'needs_review'
    check (status in ('needs_review','to_order','ordered','ready','picked_up','complete')),
  vendor_id uuid references public.material_vendors(id) on delete set null,
  -- Internal only; never printed for the customer.
  notes text,
  -- Where a suggestion came from: {type, id, number, lineItemId, quantity, unit}.
  source jsonb,
  sort_order integer not null default 0,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_project_materials_project on public.project_materials(project_id, sort_order);

-- One row per project: where to get the materials and the prep reminder.
create table if not exists public.project_material_plans (
  project_id uuid primary key references public.projects(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  vendor_id uuid references public.material_vendors(id) on delete set null,
  pickup_location text,
  pickup_instructions text,
  handling_notes text,
  reminder_at timestamptz,
  -- The job date the reminder was set for, so a moved job can be flagged.
  reminder_job_date date,
  reminder_note text,
  -- Suggestions the owner removed, so refreshing doesn't bring them back.
  dismissed_sources jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- company_id comes from the project, like the other project tables
do $$
declare t text;
begin
  foreach t in array array['project_materials','project_material_plans'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_company', t);
    execute format('create trigger %I before insert or update of project_id on public.%I for each row execute function public.set_company_from_project()', t || '_company', t);
  end loop;
  foreach t in array array['financial_settings','material_vendors','project_materials','project_material_plans'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

-- ── Access rules: owner/admin only ──────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['financial_settings','material_vendors','project_materials','project_material_plans'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff', t);
  end loop;
end $$;

create policy financial_settings_staff on public.financial_settings for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));
create policy material_vendors_staff on public.material_vendors for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));
create policy project_materials_staff on public.project_materials for all
  using (public.is_staff(company_id))
  with check (public.is_staff((select company_id from public.projects where id = project_id)));
create policy project_material_plans_staff on public.project_material_plans for all
  using (public.is_staff(company_id))
  with check (public.is_staff((select company_id from public.projects where id = project_id)));

-- ── Live updates in the app ─────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['financial_settings','material_vendors','project_materials','project_material_plans'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
