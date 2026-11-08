-- Core Data Architecture
-- Companies, flexible account model, projects, and all project-related entities.
-- Builds on 001_profiles.sql (profiles table remains for backward compat; people replaces it going forward).

-- ── Companies ────────────────────────────────────────────────────

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_url text,
  phone text,
  email text,
  address text,
  city text,
  state text,
  zip text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.companies enable row level security;

create trigger companies_updated_at
  before update on public.companies
  for each row
  execute function public.handle_updated_at();

-- ── People (flexible identity — replaces profiles as the person record) ──

create table if not exists public.people (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  first_name text not null default '',
  last_name text not null default '',
  avatar_url text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.people enable row level security;

create trigger people_updated_at
  before update on public.people
  for each row
  execute function public.handle_updated_at();

-- ── Company Members (connects people to companies with roles) ───

create table if not exists public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'worker', 'customer')),
  status text not null default 'active' check (status in ('active', 'invited', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, person_id)
);

alter table public.company_members enable row level security;

create trigger company_members_updated_at
  before update on public.company_members
  for each row
  execute function public.handle_updated_at();

-- ── Projects (central object) ───────────────────────────────────

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid references public.people(id) on delete set null,
  name text not null,
  address text,
  city text,
  state text,
  zip text,
  latitude numeric,
  longitude numeric,
  status text not null default 'active' check (status in ('active', 'on_hold', 'completed', 'archived')),
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  start_date date,
  estimated_end_date date,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects enable row level security;

create index idx_projects_company on public.projects(company_id);
create index idx_projects_customer on public.projects(customer_id);
create index idx_projects_status on public.projects(company_id, status);

create trigger projects_updated_at
  before update on public.projects
  for each row
  execute function public.handle_updated_at();

-- ── Project Team (workers assigned to a project — NOT daily schedule) ──

create table if not exists public.project_team (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  added_at timestamptz not null default now(),
  removed_at timestamptz
);

alter table public.project_team enable row level security;

create unique index idx_project_team_active
  on public.project_team(project_id, person_id)
  where removed_at is null;

-- ── Project Tasks ───────────────────────────────────────────────

create table if not exists public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  sort_order integer not null default 0,
  assigned_to uuid references public.people(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_tasks enable row level security;

create index idx_project_tasks_project on public.project_tasks(project_id);

create trigger project_tasks_updated_at
  before update on public.project_tasks
  for each row
  execute function public.handle_updated_at();

-- ── Project Settings ────────────────────────────────────────────

create table if not exists public.project_settings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade unique,
  customer_interaction_enabled boolean not null default true,
  completion_photo_required boolean not null default false,
  checkin_radius_meters integer,
  customer_can_request boolean not null default true,
  customer_can_view_photos boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_settings enable row level security;

create trigger project_settings_updated_at
  before update on public.project_settings
  for each row
  execute function public.handle_updated_at();

-- ── Project Photos ──────────────────────────────────────────────

create table if not exists public.project_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.project_tasks(id) on delete set null,
  uploaded_by uuid not null references public.people(id) on delete cascade,
  file_key text not null,
  file_url text not null,
  caption text,
  is_customer_visible boolean not null default false,
  photo_type text not null default 'general' check (photo_type in ('progress', 'before', 'after', 'issue', 'general')),
  taken_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.project_photos enable row level security;

create index idx_project_photos_project on public.project_photos(project_id);

-- ── Project Updates (owner → customer communication) ────────────

create table if not exists public.project_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  created_by uuid not null references public.people(id) on delete cascade,
  title text not null,
  body text not null default '',
  is_customer_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_updates enable row level security;

create index idx_project_updates_project on public.project_updates(project_id);

create trigger project_updates_updated_at
  before update on public.project_updates
  for each row
  execute function public.handle_updated_at();

-- ── Project Requests (customer → owner requests) ────────────────

create table if not exists public.project_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_by uuid not null references public.people(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'pending' check (status in ('pending', 'acknowledged', 'completed', 'declined')),
  responded_at timestamptz,
  response_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_requests enable row level security;

create index idx_project_requests_project on public.project_requests(project_id);

create trigger project_requests_updated_at
  before update on public.project_requests
  for each row
  execute function public.handle_updated_at();

-- ── Project History (append-only audit log — NO updates, NO deletes) ──

create table if not exists public.project_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid references public.people(id) on delete set null,
  event_type text not null,
  description text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

alter table public.project_history enable row level security;

create index idx_project_history_project on public.project_history(project_id);
create index idx_project_history_created on public.project_history(project_id, created_at desc);

-- ── Schedule Entries (daily work assignments — separate from project team) ──

create table if not exists public.schedule_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  scheduled_date date not null,
  start_time time,
  end_time time,
  status text not null default 'scheduled' check (status in ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled')),
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.schedule_entries enable row level security;

create index idx_schedule_entries_date on public.schedule_entries(company_id, scheduled_date);
create index idx_schedule_entries_person on public.schedule_entries(person_id, scheduled_date);

create trigger schedule_entries_updated_at
  before update on public.schedule_entries
  for each row
  execute function public.handle_updated_at();

-- ── RLS Policies ────────────────────────────────────────────────
-- Company-scoped access: members can read their company's data,
-- owners/admins can write. Detailed policies per table.

-- Companies: members can read their own company
create policy "Members can view own company"
  on public.companies for select
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = companies.id
        and cm.person_id = auth.uid()
        and cm.status = 'active'
    )
  );

-- People: users can read/update their own record
create policy "Users can view own person record"
  on public.people for select
  using (auth.uid() = id);

create policy "Users can update own person record"
  on public.people for update
  using (auth.uid() = id);

create policy "Enable insert for authenticated users"
  on public.people for insert
  with check (auth.uid() = id);

-- People: company members can view other members in the same company
create policy "Company members can view colleagues"
  on public.people for select
  using (
    exists (
      select 1 from public.company_members cm1
      join public.company_members cm2 on cm1.company_id = cm2.company_id
      where cm1.person_id = auth.uid()
        and cm2.person_id = people.id
        and cm1.status = 'active'
    )
  );

-- Company members: users can view their own memberships
create policy "Users can view own memberships"
  on public.company_members for select
  using (person_id = auth.uid());

-- Company members: owners can manage memberships
create policy "Owners can manage company members"
  on public.company_members for all
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = company_members.company_id
        and cm.person_id = auth.uid()
        and cm.role in ('owner', 'admin')
        and cm.status = 'active'
    )
  );

-- Projects: company members can read projects in their company
create policy "Company members can view projects"
  on public.projects for select
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = projects.company_id
        and cm.person_id = auth.uid()
        and cm.status = 'active'
    )
  );

-- Projects: owners/admins can create and update
create policy "Owners can manage projects"
  on public.projects for all
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = projects.company_id
        and cm.person_id = auth.uid()
        and cm.role in ('owner', 'admin')
        and cm.status = 'active'
    )
  );

-- Project sub-tables: inherit project access
create policy "Project team access"
  on public.project_team for select
  using (
    exists (
      select 1 from public.projects p
      join public.company_members cm on cm.company_id = p.company_id
      where p.id = project_team.project_id
        and cm.person_id = auth.uid()
        and cm.status = 'active'
    )
  );

create policy "Project tasks access"
  on public.project_tasks for select
  using (
    exists (
      select 1 from public.projects p
      join public.company_members cm on cm.company_id = p.company_id
      where p.id = project_tasks.project_id
        and cm.person_id = auth.uid()
        and cm.status = 'active'
    )
  );

create policy "Project settings access"
  on public.project_settings for select
  using (
    exists (
      select 1 from public.projects p
      join public.company_members cm on cm.company_id = p.company_id
      where p.id = project_settings.project_id
        and cm.person_id = auth.uid()
        and cm.status = 'active'
    )
  );

create policy "Project photos access"
  on public.project_photos for select
  using (
    exists (
      select 1 from public.projects p
      join public.company_members cm on cm.company_id = p.company_id
      where p.id = project_photos.project_id
        and cm.person_id = auth.uid()
        and cm.status = 'active'
    )
  );

create policy "Project updates access"
  on public.project_updates for select
  using (
    exists (
      select 1 from public.projects p
      join public.company_members cm on cm.company_id = p.company_id
      where p.id = project_updates.project_id
        and cm.person_id = auth.uid()
        and cm.status = 'active'
    )
  );

create policy "Project requests access"
  on public.project_requests for select
  using (
    exists (
      select 1 from public.projects p
      join public.company_members cm on cm.company_id = p.company_id
      where p.id = project_requests.project_id
        and cm.person_id = auth.uid()
        and cm.status = 'active'
    )
  );

create policy "Project history access"
  on public.project_history for select
  using (
    exists (
      select 1 from public.projects p
      join public.company_members cm on cm.company_id = p.company_id
      where p.id = project_history.project_id
        and cm.person_id = auth.uid()
        and cm.status = 'active'
    )
  );

create policy "Schedule entries access"
  on public.schedule_entries for select
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = schedule_entries.company_id
        and cm.person_id = auth.uid()
        and cm.status = 'active'
    )
  );

-- Write policies for project sub-tables (owners/admins + assigned workers)
create policy "Owners can manage project team"
  on public.project_team for all
  using (
    exists (
      select 1 from public.projects p
      join public.company_members cm on cm.company_id = p.company_id
      where p.id = project_team.project_id
        and cm.person_id = auth.uid()
        and cm.role in ('owner', 'admin')
        and cm.status = 'active'
    )
  );

create policy "Owners can manage project tasks"
  on public.project_tasks for all
  using (
    exists (
      select 1 from public.projects p
      join public.company_members cm on cm.company_id = p.company_id
      where p.id = project_tasks.project_id
        and cm.person_id = auth.uid()
        and cm.role in ('owner', 'admin')
        and cm.status = 'active'
    )
  );

create policy "Owners can manage project settings"
  on public.project_settings for all
  using (
    exists (
      select 1 from public.projects p
      join public.company_members cm on cm.company_id = p.company_id
      where p.id = project_settings.project_id
        and cm.person_id = auth.uid()
        and cm.role in ('owner', 'admin')
        and cm.status = 'active'
    )
  );

create policy "Members can insert project photos"
  on public.project_photos for insert
  with check (uploaded_by = auth.uid());

create policy "Owners can manage project updates"
  on public.project_updates for all
  using (
    exists (
      select 1 from public.projects p
      join public.company_members cm on cm.company_id = p.company_id
      where p.id = project_updates.project_id
        and cm.person_id = auth.uid()
        and cm.role in ('owner', 'admin')
        and cm.status = 'active'
    )
  );

create policy "Customers can insert project requests"
  on public.project_requests for insert
  with check (requested_by = auth.uid());

create policy "Owners can manage project requests"
  on public.project_requests for all
  using (
    exists (
      select 1 from public.projects p
      join public.company_members cm on cm.company_id = p.company_id
      where p.id = project_requests.project_id
        and cm.person_id = auth.uid()
        and cm.role in ('owner', 'admin')
        and cm.status = 'active'
    )
  );

-- History is append-only: anyone in the company can insert, nobody updates/deletes
create policy "Members can insert project history"
  on public.project_history for insert
  with check (
    exists (
      select 1 from public.projects p
      join public.company_members cm on cm.company_id = p.company_id
      where p.id = project_history.project_id
        and cm.person_id = auth.uid()
        and cm.status = 'active'
    )
  );

create policy "Owners can manage schedule entries"
  on public.schedule_entries for all
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = schedule_entries.company_id
        and cm.person_id = auth.uid()
        and cm.role in ('owner', 'admin')
        and cm.status = 'active'
    )
  );
