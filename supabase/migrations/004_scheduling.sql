-- ============================================================
-- Migration 004: Scheduling & Assignments
-- Evolves the schedule system from simple entries to full
-- assignment records with conflict tracking, confirmation
-- states, and audit history.
-- ============================================================

-- ── Assignments table (replaces simple schedule_entries for daily work) ──

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  scheduled_date date not null,
  start_time time,
  end_time time,
  is_full_day boolean not null default false,
  sort_order smallint not null default 1,

  status text not null default 'scheduled'
    check (status in (
      'scheduled','confirmed','en_route','checked_in',
      'working','completed','cancelled','reassigned'
    )),

  confirmation_state text not null default 'not_sent'
    check (confirmation_state in (
      'not_sent','awaiting','confirmed','updated_since','acknowledged'
    )),

  truck_id uuid references public.trucks(id) on delete set null,
  notes text,

  cancelled_at timestamptz,
  cancelled_by uuid references public.people(id),
  cancellation_reason text,

  reassigned_from uuid references public.assignments(id),
  reassigned_to uuid references public.assignments(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_assignments_company_date on public.assignments(company_id, scheduled_date);
create index idx_assignments_person_date on public.assignments(person_id, scheduled_date);
create index idx_assignments_project on public.assignments(project_id);
create index idx_assignments_truck on public.assignments(truck_id) where truck_id is not null;

alter table public.assignments enable row level security;

create policy "Company members can view assignments"
  on public.assignments for select
  using (
    company_id in (
      select company_id from public.company_members
      where person_id = auth.uid() and status = 'active'
    )
  );

create policy "Owners/admins can manage assignments"
  on public.assignments for all
  using (
    company_id in (
      select company_id from public.company_members
      where person_id = auth.uid()
        and role in ('owner','admin')
        and status = 'active'
    )
  );


-- ── Schedule changes (audit log) ────────────────────────────

create table if not exists public.schedule_changes (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  changed_by uuid not null references public.people(id),

  change_type text not null
    check (change_type in (
      'created','time_changed','project_changed','truck_changed',
      'truck_removed','cancelled','reassigned','status_changed',
      'emergency_override','notes_changed'
    )),

  previous_value jsonb,
  new_value jsonb,
  notes text,

  created_at timestamptz not null default now()
);

create index idx_schedule_changes_assignment on public.schedule_changes(assignment_id);
create index idx_schedule_changes_company on public.schedule_changes(company_id, created_at desc);

alter table public.schedule_changes enable row level security;

create policy "Company members can view schedule changes"
  on public.schedule_changes for select
  using (
    company_id in (
      select company_id from public.company_members
      where person_id = auth.uid() and status = 'active'
    )
  );

create policy "Owners/admins can insert schedule changes"
  on public.schedule_changes for insert
  with check (
    company_id in (
      select company_id from public.company_members
      where person_id = auth.uid()
        and role in ('owner','admin')
        and status = 'active'
    )
  );
