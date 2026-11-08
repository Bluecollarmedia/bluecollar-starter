-- Phase 5: Worker check-ins, check-outs, photos, and offline sync
-- Captures GPS coordinates for every check-in/out action

-- ── Check-ins ──────────────────────────────────────────────────
create table if not exists check_ins (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  person_id uuid not null references profiles(id),
  project_id uuid not null references projects(id),
  company_id uuid not null references companies(id),
  timestamp timestamptz not null,
  latitude double precision not null,
  longitude double precision not null,
  accuracy double precision not null,
  distance_from_site double precision,
  within_radius boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_check_ins_assignment on check_ins(assignment_id);
create index idx_check_ins_person_date on check_ins(person_id, timestamp);

-- ── Check-outs ─────────────────────────────────────────────────
create table if not exists check_outs (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  person_id uuid not null references profiles(id),
  project_id uuid not null references projects(id),
  company_id uuid not null references companies(id),
  timestamp timestamptz not null,
  latitude double precision not null,
  longitude double precision not null,
  accuracy double precision not null,
  distance_from_site double precision,
  created_at timestamptz not null default now()
);

create index idx_check_outs_assignment on check_outs(assignment_id);

-- ── Worker Photos ──────────────────────────────────────────────
create table if not exists worker_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  task_id uuid references project_tasks(id),
  assignment_id uuid references assignments(id),
  uploaded_by uuid not null references profiles(id),
  file_key text not null,
  file_url text not null,
  caption text,
  is_customer_visible boolean not null default false,
  photo_type text not null default 'general',
  taken_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_worker_photos_project on worker_photos(project_id);
create index idx_worker_photos_task on worker_photos(task_id);

-- ── Offline Sync Queue ─────────────────────────────────────────
create table if not exists offline_actions (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text unique not null,
  person_id uuid not null references profiles(id),
  company_id uuid not null references companies(id),
  action_type text not null,
  payload jsonb not null default '{}',
  original_timestamp timestamptz not null,
  sync_status text not null default 'pending',
  synced_at timestamptz,
  retry_count int not null default 0,
  created_at timestamptz not null default now()
);

create index idx_offline_actions_person on offline_actions(person_id, sync_status);

-- ── Worker Activity Log ────────────────────────────────────────
create table if not exists worker_activities (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references profiles(id),
  company_id uuid not null references companies(id),
  assignment_id uuid references assignments(id),
  project_id uuid references projects(id),
  activity_type text not null,
  description text not null,
  metadata jsonb,
  timestamp timestamptz not null default now()
);

create index idx_worker_activities_person on worker_activities(person_id, timestamp desc);

-- ── RLS ────────────────────────────────────────────────────────
alter table check_ins enable row level security;
alter table check_outs enable row level security;
alter table worker_photos enable row level security;
alter table offline_actions enable row level security;
alter table worker_activities enable row level security;
