-- ============================================================================
-- Brighton Lawn + Landscape — database setup
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Run it ONCE on a fresh project. It creates empty tables, security rules
-- (Row Level Security), sign-up automation, and live-update wiring.
--
-- Design notes
--  • people.id is the app's person id. people.user_id links to a login
--    (auth.users) and is NULL for customers/workers the owner adds before
--    they have signed up. When someone signs up with that email, the row is
--    linked automatically.
--  • Every company-owned table carries company_id so security rules are a
--    single membership check. Project child tables get company_id filled in
--    from their project by trigger.
--  • Security checks go through SECURITY DEFINER helper functions so policies
--    never query a table that is itself protected by the policy (which causes
--    "infinite recursion detected in policy" errors).
-- ============================================================================


-- ── Shared trigger: updated_at ──────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- Tables
-- ============================================================================

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_url text,
  phone text,
  email text,
  address text,
  city text,
  state text,
  zip text,
  -- Yard: where crews start and end the day (not the office, not a jobsite).
  yard_address text,
  yard_city text,
  yard_state text,
  yard_zip text,
  yard_latitude double precision,
  yard_longitude double precision,
  cover_photo_url text,
  -- Header photo on the workers' home screens (cover_photo_url is the owner dashboard's).
  worker_cover_photo_url text,
  -- Storage limit the owner picked under More → Settings → Storage, in GB (0 = no limit).
  storage_limit_gb integer not null default 1 check (storage_limit_gb >= 0),
  target_pay_enabled boolean not null default false,
  setup_state jsonb not null default '{}'::jsonb,
  setup_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  email text not null default '',
  first_name text not null default '',
  last_name text not null default '',
  avatar_url text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_people_email on public.people (lower(email));

create table public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  role text not null check (role in ('owner','admin','worker','customer')),
  status text not null default 'active' check (status in ('active','invited','inactive')),
  join_method text default 'company_creator',
  join_request_id uuid,
  approved_by uuid references public.people(id) on delete set null,
  approved_at timestamptz,
  deactivated_at timestamptz,
  deactivated_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, person_id)
);
create index idx_members_person on public.company_members(person_id);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid references public.people(id) on delete set null,
  name text not null,
  address text,
  city text,
  state text,
  zip text,
  latitude double precision,
  longitude double precision,
  status text not null default 'active' check (status in ('active','on_hold','completed','archived')),
  progress integer not null default 0 check (progress between 0 and 100),
  start_date date,
  estimated_end_date date,
  completed_at timestamptz,
  notes text,
  cover_photo_url text,
  customer_project_code text unique,
  customer_claimed_by uuid references public.people(id) on delete set null,
  customer_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_projects_company on public.projects(company_id);

create table public.project_team (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  added_at timestamptz not null default now(),
  removed_at timestamptz
);
create index idx_project_team_project on public.project_team(project_id);

create table public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'pending' check (status in ('pending','in_progress','completed')),
  sort_order integer not null default 0,
  assigned_to uuid references public.people(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_project_tasks_project on public.project_tasks(project_id);

create table public.project_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  project_id uuid not null unique references public.projects(id) on delete cascade,
  customer_interaction_enabled boolean not null default true,
  completion_photo_required boolean not null default false,
  checkin_radius_meters integer,
  customer_can_request boolean not null default true,
  customer_can_view_photos boolean not null default true,
  customer_can_comment boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.project_tasks(id) on delete set null,
  assignment_id uuid,
  uploaded_by uuid references public.people(id) on delete set null,
  file_key text not null default '',
  file_url text not null,
  caption text,
  customer_description text,
  is_customer_visible boolean not null default false,
  shared_by uuid references public.people(id) on delete set null,
  shared_at timestamptz,
  photo_type text not null default 'general' check (photo_type in ('progress','before','after','issue','general')),
  taken_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index idx_project_photos_project on public.project_photos(project_id);

create table public.project_updates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  created_by uuid references public.people(id) on delete set null,
  title text not null,
  body text not null default '',
  is_customer_visible boolean not null default true,
  photo_ids text[] default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_project_updates_project on public.project_updates(project_id);

create table public.project_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_by uuid references public.people(id) on delete set null,
  title text not null,
  description text,
  category text not null default 'other' check (category in ('change_request','question','additional_work','other')),
  attachment_url text,
  status text not null default 'pending' check (status in ('pending','acknowledged','completed','declined','converted')),
  linked_task_id uuid references public.project_tasks(id) on delete set null,
  responded_at timestamptz,
  response_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_project_requests_project on public.project_requests(project_id);

create table public.project_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid references public.people(id) on delete set null,
  event_type text not null,
  description text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index idx_project_history_project on public.project_history(project_id, created_at desc);

create table public.customer_timeline (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  event_type text not null,
  title text not null,
  description text,
  photo_url text,
  timestamp timestamptz not null default now()
);
create index idx_customer_timeline_project on public.customer_timeline(project_id, timestamp desc);

create table public.trucks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  make text,
  model text,
  year integer,
  license_plate text,
  vin text,
  color text,
  photo_url text,
  status text not null default 'available' check (status in ('available','assigned','maintenance','out_of_service')),
  notes text,
  assigned_to uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_trucks_company on public.trucks(company_id);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  scheduled_date date not null,
  start_time text,           -- 'HH:MM' company-local wall clock
  end_time text,
  is_full_day boolean not null default false,
  sort_order integer not null default 1,
  status text not null default 'scheduled' check (status in
    ('scheduled','confirmed','en_route','checked_in','working','completed','cancelled','reassigned')),
  confirmation_state text not null default 'not_sent' check (confirmation_state in
    ('not_sent','awaiting','confirmed','updated_since','acknowledged')),
  truck_id uuid references public.trucks(id) on delete set null,
  notes text,
  cancelled_at timestamptz,
  cancelled_by uuid references public.people(id) on delete set null,
  cancellation_reason text,
  reassigned_from uuid,
  reassigned_to uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_assignments_company_date on public.assignments(company_id, scheduled_date);
create index idx_assignments_person_date on public.assignments(person_id, scheduled_date);
-- A worker can only be on the same job once per day (cancelled/moved don't count).
create unique index uq_assignments_worker_job_day
  on public.assignments (person_id, project_id, scheduled_date)
  where status not in ('cancelled', 'reassigned');

create table public.schedule_changes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  changed_by uuid references public.people(id) on delete set null,
  change_type text not null,
  previous_value text,
  new_value text,
  notes text,
  created_at timestamptz not null default now()
);
create index idx_schedule_changes_company on public.schedule_changes(company_id, created_at desc);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid references public.people(id) on delete set null,
  title text not null,
  body text not null default '',
  audience text not null default 'all_workers' check (audience in ('all_workers','all_members','selected')),
  priority text not null default 'normal' check (priority in ('normal','urgent')),
  weather_action text,
  recipient_ids text[],
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_announcements_company on public.announcements(company_id, created_at desc);

create table public.announcement_reads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  read_at timestamptz not null default now(),
  unique (announcement_id, person_id)
);

create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  assignment_id uuid references public.assignments(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  timestamp timestamptz not null default now(),
  gps jsonb,
  within_radius boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_check_ins_person on public.check_ins(person_id, timestamp desc);

create table public.check_outs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  assignment_id uuid references public.assignments(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  timestamp timestamptz not null default now(),
  gps jsonb,
  created_at timestamptz not null default now()
);
create index idx_check_outs_person on public.check_outs(person_id, timestamp desc);

create table public.worker_activities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  assignment_id uuid references public.assignments(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  activity_type text not null,
  description text not null,
  metadata jsonb,
  timestamp timestamptz not null default now()
);
create index idx_worker_activities_person on public.worker_activities(person_id, timestamp desc);

create table public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  assignment_id uuid references public.assignments(id) on delete set null,
  check_in_time timestamptz not null,
  check_out_time timestamptz,
  duration_minutes numeric(8,2),
  check_in_gps jsonb,
  check_out_gps jsonb,
  offline_check_in timestamptz,
  offline_check_out timestamptz,
  synced_check_in_at timestamptz,
  synced_check_out_at timestamptz,
  status text not null default 'active' check (status in ('active','completed','corrected')),
  correction jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_work_sessions_company on public.work_sessions(company_id, check_in_time);

create table public.worker_hourly_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  hourly_rate numeric(8,2) not null,
  effective_date date not null,
  end_date date,
  set_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.worker_pay_settings (
  person_id uuid primary key references public.people(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  overtime_enabled boolean not null default true,
  overtime_after_hours numeric(5,2) not null default 40 check (overtime_after_hours > 0),
  overtime_multiplier numeric(4,2) not null default 1.5 check (overtime_multiplier >= 1),
  target_hourly_rate numeric(8,2) check (target_hourly_rate > 0),
  updated_at timestamptz not null default now()
);

create table public.overtime_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  rule_type text not null default 'weekly_40' check (rule_type in ('weekly_40','daily_8','custom','none')),
  weekly_threshold_hours numeric(5,2),
  daily_threshold_hours numeric(5,2),
  overtime_multiplier numeric(3,2) not null default 1.5,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_operations_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  missing_checkin_grace_minutes integer not null default 10,
  late_checkin_threshold_minutes integer not null default 0,
  past_end_alert_enabled boolean not null default true,
  overtime_rule_id uuid references public.overtime_rules(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid references public.people(id) on delete cascade,
  event_type text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (company_id, person_id, event_type)
);

create table public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  recipient_id uuid not null references public.people(id) on delete cascade,
  event_type text not null,
  title text not null,
  body text not null default '',
  status text not null default 'unread' check (status in ('unread','read','dismissed')),
  linked_entity_type text,
  linked_entity_id text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index idx_notifications_recipient on public.app_notifications(recipient_id, created_at desc);

create table public.worker_reminders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  assignment_id uuid references public.assignments(id) on delete cascade,
  reminder_type text not null,
  title text not null,
  body text not null default '',
  next_assignment jsonb,
  actions jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table public.worker_settings (
  person_id uuid primary key references public.people(id) on delete cascade,
  nav_app text not null default 'default',
  notifications_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.team_codes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null unique,
  is_active boolean not null default true,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  deactivated_at timestamptz
);

create table public.company_join_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  join_by_code_enabled boolean not null default true,
  direct_invitations_enabled boolean not null default true,
  require_email_verification boolean not null default false,
  current_team_code_id uuid references public.team_codes(id) on delete set null
);

create table public.company_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  name text,
  phone text,
  type text not null check (type in ('worker','customer')),
  status text not null default 'pending' check (status in ('pending','accepted','expired','revoked')),
  project_id uuid references public.projects(id) on delete set null,
  invited_by uuid references public.people(id) on delete set null,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_invitations_email on public.company_invitations(lower(email));

create table public.join_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  join_method text not null default 'team_code',
  invitation_id uuid references public.company_invitations(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','approved','declined','cancelled')),
  requested_role text check (requested_role in ('worker','customer')),
  assigned_role text check (assigned_role in ('worker','customer','admin')),
  reviewed_by uuid references public.people(id) on delete set null,
  reviewed_at timestamptz,
  decline_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index idx_join_requests_one_pending
  on public.join_requests(company_id, person_id) where status = 'pending';

create table public.membership_audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  event_type text not null,
  actor_id uuid references public.people(id) on delete set null,
  target_id uuid references public.people(id) on delete set null,
  metadata jsonb default '{}',
  created_at timestamptz not null default now()
);

-- ── updated_at triggers ─────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'companies','people','company_members','projects','project_tasks','project_settings',
    'project_updates','project_requests','trucks','assignments','announcements',
    'work_sessions','overtime_rules','company_operations_settings',
    'notification_preferences','worker_settings','join_requests','worker_pay_settings'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_updated_at', t);
  end loop;
end $$;

-- ── Project child tables inherit company_id from their project ──────────────
create or replace function public.set_company_from_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select company_id into new.company_id from public.projects where id = new.project_id;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'project_team','project_tasks','project_settings','project_photos','project_updates',
    'project_requests','project_history','customer_timeline'
  ] loop
    execute format('create trigger %I before insert or update of project_id on public.%I for each row execute function public.set_company_from_project()',
                   t || '_company', t);
  end loop;
end $$;

-- ============================================================================
-- Security helpers (SECURITY DEFINER so policies never recurse)
-- ============================================================================

create or replace function public.my_person_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.people where user_id = auth.uid() limit 1
$$;

create or replace function public.member_role(cid uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.company_members
  where company_id = cid and person_id = public.my_person_id() and status = 'active'
  limit 1
$$;

create or replace function public.is_member(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.member_role(cid) is not null
$$;

create or replace function public.is_staff(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.member_role(cid) in ('owner','admin'), false)
$$;

-- Owner, admin or worker (everyone except customers)
create or replace function public.is_crew(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.member_role(cid) in ('owner','admin','worker'), false)
$$;

create or replace function public.is_project_customer(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
    where p.id = pid
      and public.my_person_id() is not null
      and (p.customer_id = public.my_person_id() or p.customer_claimed_by = public.my_person_id())
  )
$$;

create or replace function public.can_see_person(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select pid = public.my_person_id()
    or exists (
      select 1 from public.company_members cm
      where cm.person_id = pid
        and (public.is_crew(cm.company_id)
             or (public.is_member(cm.company_id) and cm.role in ('owner','admin','worker')))
    )
    or exists (
      select 1 from public.join_requests jr
      where jr.person_id = pid and public.is_staff(jr.company_id)
    )
$$;

create or replace function public.staff_of_person(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_members cm
    where cm.person_id = pid and public.is_staff(cm.company_id)
  )
$$;

-- ============================================================================
-- Row Level Security policies
-- ============================================================================

alter table public.companies enable row level security;
create policy companies_select on public.companies for select using (public.is_member(id));
create policy companies_update on public.companies for update using (public.is_staff(id));

alter table public.people enable row level security;
create policy people_select on public.people for select using (public.can_see_person(id));
create policy people_insert on public.people for insert to authenticated with check (true);
create policy people_update on public.people for update using (
  id = public.my_person_id() or (user_id is null and public.staff_of_person(id))
);

alter table public.company_members enable row level security;
create policy members_select on public.company_members for select using (
  person_id = public.my_person_id()
  or public.is_crew(company_id)
  or (public.is_member(company_id) and role in ('owner','admin','worker'))
);
create policy members_write on public.company_members for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));

alter table public.projects enable row level security;
create policy projects_select on public.projects for select using (
  public.is_crew(company_id)
  or (public.my_person_id() is not null
      and (customer_id = public.my_person_id() or customer_claimed_by = public.my_person_id()))
);
create policy projects_write on public.projects for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));

-- Project children: crew sees everything, customers see their own project
do $$
declare t text;
begin
  foreach t in array array['project_team','project_tasks','project_settings','project_history','project_requests','customer_timeline'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (public.is_crew(company_id) or public.is_project_customer(project_id))',
                   t || '_select', t);
    execute format('create policy %I on public.%I for all using (public.is_staff(company_id)) with check (public.is_staff(company_id))',
                   t || '_staff', t);
  end loop;
end $$;

create policy project_tasks_crew_update on public.project_tasks for update
  using (public.is_crew(company_id)) with check (public.is_crew(company_id));
create policy project_history_insert on public.project_history for insert with check (
  public.is_crew((select company_id from public.projects where id = project_id))
  or public.is_project_customer(project_id)
);
create policy customer_timeline_crew_insert on public.customer_timeline for insert with check (
  public.is_crew((select company_id from public.projects where id = project_id))
);
create policy project_requests_customer_insert on public.project_requests for insert with check (
  public.is_project_customer(project_id) and requested_by = public.my_person_id()
);

alter table public.project_photos enable row level security;
create policy project_photos_select on public.project_photos for select using (
  public.is_crew(company_id) or (is_customer_visible and public.is_project_customer(project_id))
);
create policy project_photos_insert on public.project_photos for insert with check (
  public.is_crew((select company_id from public.projects where id = project_id))
);
create policy project_photos_update on public.project_photos for update using (
  public.is_staff(company_id) or uploaded_by = public.my_person_id()
);
create policy project_photos_delete on public.project_photos for delete using (
  public.is_staff(company_id) or uploaded_by = public.my_person_id()
);

alter table public.project_updates enable row level security;
create policy project_updates_select on public.project_updates for select using (
  public.is_crew(company_id) or (is_customer_visible and public.is_project_customer(project_id))
);
create policy project_updates_staff on public.project_updates for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));

-- Crew-only operational tables, staff write
do $$
declare t text;
begin
  foreach t in array array['trucks','schedule_changes','announcements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (public.is_crew(company_id))', t || '_select', t);
    execute format('create policy %I on public.%I for all using (public.is_staff(company_id)) with check (public.is_staff(company_id))',
                   t || '_staff', t);
  end loop;
end $$;
create policy schedule_changes_crew_insert on public.schedule_changes for insert with check (public.is_crew(company_id));

alter table public.assignments enable row level security;
create policy assignments_select on public.assignments for select using (public.is_crew(company_id));
create policy assignments_staff on public.assignments for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));
create policy assignments_own_update on public.assignments for update
  using (person_id = public.my_person_id()) with check (person_id = public.my_person_id());

alter table public.announcement_reads enable row level security;
create policy announcement_reads_select on public.announcement_reads for select using (public.is_crew(company_id));
create policy announcement_reads_insert on public.announcement_reads for insert with check (
  person_id = public.my_person_id() and public.is_member(company_id)
);

-- Worker-generated records: own rows, staff see all
do $$
declare t text;
begin
  foreach t in array array['check_ins','check_outs','worker_activities','work_sessions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (public.is_staff(company_id) or person_id = public.my_person_id())',
                   t || '_select', t);
    execute format('create policy %I on public.%I for insert with check (person_id = public.my_person_id() and public.is_crew(company_id))',
                   t || '_insert', t);
    execute format('create policy %I on public.%I for update using (public.is_staff(company_id) or person_id = public.my_person_id())',
                   t || '_update', t);
    execute format('create policy %I on public.%I for delete using (public.is_staff(company_id))',
                   t || '_delete', t);
  end loop;
end $$;

alter table public.worker_hourly_rates enable row level security;
create policy hourly_rates_staff on public.worker_hourly_rates for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));
alter table public.worker_pay_settings enable row level security;
create policy worker_pay_settings_staff on public.worker_pay_settings for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));

do $$
declare t text;
begin
  foreach t in array array['overtime_rules','company_operations_settings','notification_preferences'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (public.is_member(company_id))', t || '_select', t);
    execute format('create policy %I on public.%I for all using (public.is_staff(company_id)) with check (public.is_staff(company_id))',
                   t || '_staff', t);
  end loop;
end $$;

alter table public.app_notifications enable row level security;
create policy notifications_select on public.app_notifications for select using (recipient_id = public.my_person_id());
create policy notifications_update on public.app_notifications for update using (recipient_id = public.my_person_id());
create policy notifications_delete on public.app_notifications for delete using (recipient_id = public.my_person_id());
create policy notifications_insert on public.app_notifications for insert with check (public.is_member(company_id));

alter table public.worker_reminders enable row level security;
create policy reminders_select on public.worker_reminders for select using (person_id = public.my_person_id() or public.is_staff(company_id));
create policy reminders_update on public.worker_reminders for update using (person_id = public.my_person_id());
create policy reminders_insert on public.worker_reminders for insert with check (public.is_crew(company_id));

alter table public.worker_settings enable row level security;
create policy worker_settings_own on public.worker_settings for all
  using (person_id = public.my_person_id()) with check (person_id = public.my_person_id());

alter table public.team_codes enable row level security;
create policy team_codes_staff on public.team_codes for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));

alter table public.company_join_settings enable row level security;
create policy join_settings_select on public.company_join_settings for select using (public.is_member(company_id));
create policy join_settings_staff on public.company_join_settings for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));

alter table public.company_invitations enable row level security;
create policy invitations_staff on public.company_invitations for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));
create policy invitations_recipient on public.company_invitations for select
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

alter table public.join_requests enable row level security;
create policy join_requests_select on public.join_requests for select using (
  person_id = public.my_person_id() or public.is_staff(company_id)
);
create policy join_requests_insert on public.join_requests for insert with check (person_id = public.my_person_id());
create policy join_requests_update on public.join_requests for update using (
  person_id = public.my_person_id() or public.is_staff(company_id)
);

alter table public.membership_audit_log enable row level security;
create policy audit_select on public.membership_audit_log for select using (public.is_staff(company_id));
create policy audit_insert on public.membership_audit_log for insert with check (public.is_member(company_id));

-- ============================================================================
-- Sign-up and onboarding functions
-- ============================================================================

create or replace function public._random_code(len int)
returns text language plpgsql as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
begin
  for i in 1..len loop
    result := result || substr(chars, 1 + floor(random() * length(chars))::int, 1);
  end loop;
  return result;
end;
$$;

-- Creates a company with sensible defaults and makes pid its owner.
create or replace function public._create_company(pid uuid, data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  code_id uuid;
  rule_id uuid;
  ev text;
begin
  insert into public.companies (name, phone, email, address, city, state, zip)
  values (
    coalesce(nullif(trim(data->>'company_name'), ''), 'My Company'),
    nullif(data->>'company_phone', ''),
    nullif(data->>'company_email', ''),
    nullif(data->>'company_address', ''),
    nullif(data->>'company_city', ''),
    nullif(data->>'company_state', ''),
    nullif(data->>'company_zip', '')
  ) returning id into cid;

  insert into public.company_members (company_id, person_id, role, status, join_method, approved_at)
  values (cid, pid, 'owner', 'active', 'company_creator', now());

  insert into public.team_codes (company_id, code, created_by)
  values (cid, upper(left(regexp_replace(coalesce(data->>'company_name', 'TEAM'), '[^A-Za-z]', '', 'g') || 'TEAM', 8)) || '-' || public._random_code(4), pid)
  returning id into code_id;

  insert into public.company_join_settings (company_id, current_team_code_id) values (cid, code_id);

  insert into public.overtime_rules (company_id, rule_type, weekly_threshold_hours, overtime_multiplier)
  values (cid, 'weekly_40', 40, 1.5) returning id into rule_id;

  insert into public.company_operations_settings (company_id, overtime_rule_id) values (cid, rule_id);

  foreach ev in array array[
    'worker_checked_in','worker_checked_out','worker_checked_in_late','worker_outside_radius',
    'worker_not_checked_in','worker_past_scheduled_end','worker_completed_task','worker_completed_job',
    'photo_waiting_review','customer_request_submitted','customer_message','schedule_changed','schedule_conflict','announcement_posted'
  ] loop
    insert into public.notification_preferences (company_id, event_type, enabled) values (cid, ev, true);
  end loop;

  insert into public.membership_audit_log (company_id, event_type, actor_id) values (cid, 'company_created', pid);
  return cid;
end;
$$;

-- Files a pending join request for pid using a team code. Returns jsonb result.
create or replace function public._request_join(pid uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tc record;
  rid uuid;
begin
  select t.*, s.join_by_code_enabled into tc
  from public.team_codes t
  left join public.company_join_settings s on s.company_id = t.company_id
  where upper(t.code) = upper(trim(p_code)) and t.is_active;

  if tc.id is null then
    return jsonb_build_object('success', false, 'error', 'invalid_code');
  end if;
  if tc.join_by_code_enabled is false then
    return jsonb_build_object('success', false, 'error', 'code_disabled');
  end if;
  if exists (select 1 from public.company_members where company_id = tc.company_id and person_id = pid and status = 'active') then
    return jsonb_build_object('success', false, 'error', 'already_member');
  end if;

  select id into rid from public.join_requests
  where company_id = tc.company_id and person_id = pid and status = 'pending';
  if rid is null then
    insert into public.join_requests (company_id, person_id, join_method, requested_role)
    values (tc.company_id, pid, 'team_code', 'worker') returning id into rid;
    insert into public.membership_audit_log (company_id, event_type, actor_id, target_id)
    values (tc.company_id, 'join_request_submitted', pid, pid);
  end if;

  return jsonb_build_object('success', true, 'request_id', rid, 'company_id', tc.company_id);
end;
$$;

-- Gives pid customer access to the project with this portal code.
create or replace function public._claim_project(pid uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pr record;
begin
  select p.id, p.company_id, p.customer_claimed_by, coalesce(s.customer_interaction_enabled, true) as enabled
  into pr
  from public.projects p
  left join public.project_settings s on s.project_id = p.id
  where p.customer_project_code = upper(trim(p_code));

  if pr.id is null then
    return jsonb_build_object('success', false, 'error', 'invalid_code');
  end if;
  if not pr.enabled then
    return jsonb_build_object('success', false, 'error', 'portal_disabled');
  end if;
  if pr.customer_claimed_by is not null and pr.customer_claimed_by <> pid then
    return jsonb_build_object('success', false, 'error', 'already_claimed');
  end if;

  update public.projects
  set customer_claimed_by = pid, customer_claimed_at = coalesce(customer_claimed_at, now()), customer_id = pid
  where id = pr.id;

  insert into public.company_members (company_id, person_id, role, status, join_method)
  values (pr.company_id, pid, 'customer', 'active', 'invitation_link')
  on conflict (company_id, person_id) do update
    set status = 'active'
    where public.company_members.status <> 'active' and public.company_members.role = 'customer';

  return jsonb_build_object('success', true, 'project_id', pr.id);
end;
$$;

-- Accepts every pending invitation addressed to this person's email.
create or replace function public._accept_invitations(pid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  inv record;
  em text;
begin
  select lower(email) into em from public.people where id = pid;
  if em is null or em = '' then return; end if;

  for inv in
    select * from public.company_invitations
    where lower(email) = em and status = 'pending' and expires_at > now()
  loop
    insert into public.company_members (company_id, person_id, role, status, join_method, approved_by, approved_at)
    values (inv.company_id, pid, inv.type, 'active', 'email_invitation', inv.invited_by, now())
    on conflict (company_id, person_id) do update set status = 'active', role = excluded.role;

    if inv.type = 'customer' and inv.project_id is not null then
      update public.projects set customer_id = pid where id = inv.project_id and customer_id is null;
    end if;

    update public.company_invitations
    set status = 'accepted', accepted_at = now(), accepted_by = pid
    where id = inv.id;
  end loop;
end;
$$;

-- Runs whenever someone signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  pid uuid;
begin
  -- Link to a person the owner already added with this email, if any.
  select id into pid from public.people
  where lower(email) = lower(new.email) and user_id is null
  order by created_at limit 1;

  if pid is not null then
    update public.people set
      user_id = new.id,
      first_name = coalesce(nullif(meta->>'first_name', ''), first_name),
      last_name = coalesce(nullif(meta->>'last_name', ''), last_name),
      phone = coalesce(nullif(meta->>'phone', ''), phone)
    where id = pid;
    -- People the owner added become active once they have a login.
    update public.company_members set status = 'active'
    where person_id = pid and status = 'invited';
  else
    insert into public.people (user_id, email, first_name, last_name, phone)
    values (new.id, coalesce(new.email, ''), coalesce(meta->>'first_name', ''),
            coalesce(meta->>'last_name', ''), nullif(meta->>'phone', ''))
    returning id into pid;
  end if;

  -- Optional onboarding intents passed from the app at sign-up. Failures here
  -- must never block account creation, so each is isolated.
  begin
    if coalesce(meta->>'company_name', '') <> '' then
      perform public._create_company(pid, meta);
    end if;
  exception when others then raise warning 'create company failed: %', sqlerrm;
  end;

  begin
    if coalesce(meta->>'team_code', '') <> '' then
      perform public._request_join(pid, meta->>'team_code');
    end if;
  exception when others then raise warning 'join request failed: %', sqlerrm;
  end;

  begin
    if coalesce(meta->>'project_code', '') <> '' then
      perform public._claim_project(pid, meta->>'project_code');
    end if;
  exception when others then raise warning 'claim project failed: %', sqlerrm;
  end;

  begin
    perform public._accept_invitations(pid);
  exception when others then raise warning 'accept invitations failed: %', sqlerrm;
  end;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── App-callable functions ───────────────────────────────────────────────────

-- Everything the app needs to decide where a signed-in user goes.
create or replace function public.get_my_context()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
  au record;
begin
  if auth.uid() is null then return null; end if;

  pid := public.my_person_id();
  if pid is null then
    -- Account created before this schema existed: make the person now.
    select * into au from auth.users where id = auth.uid();
    insert into public.people (user_id, email, first_name, last_name)
    values (au.id, coalesce(au.email, ''), coalesce(au.raw_user_meta_data->>'first_name', ''),
            coalesce(au.raw_user_meta_data->>'last_name', ''))
    returning id into pid;
  end if;

  perform public._accept_invitations(pid);

  return jsonb_build_object(
    'person', (select to_jsonb(p) from public.people p where p.id = pid),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cm.id, 'company_id', cm.company_id, 'role', cm.role, 'status', cm.status,
        'company_name', c.name) order by cm.created_at)
      from public.company_members cm join public.companies c on c.id = cm.company_id
      where cm.person_id = pid
    ), '[]'::jsonb),
    'join_request', (
      select jsonb_build_object('id', jr.id, 'status', jr.status, 'company_id', jr.company_id,
                                'company_name', c.name, 'decline_reason', jr.decline_reason)
      from public.join_requests jr join public.companies c on c.id = jr.company_id
      where jr.person_id = pid and jr.status <> 'cancelled'
      order by jr.created_at desc limit 1
    )
  );
end;
$$;

create or replace function public.create_company(data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare pid uuid := public.my_person_id();
begin
  if pid is null then raise exception 'not signed in'; end if;
  return public._create_company(pid, data);
end;
$$;

-- Public: check a team code before signing up.
create or replace function public.lookup_team_code(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object('valid', coalesce(s.join_by_code_enabled, true),
                              'company_id', c.id, 'company_name', c.name)
    from public.team_codes t
    join public.companies c on c.id = t.company_id
    left join public.company_join_settings s on s.company_id = c.id
    where upper(t.code) = upper(trim(p_code)) and t.is_active
  ), jsonb_build_object('valid', false))
$$;

create or replace function public.request_join(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pid uuid := public.my_person_id();
begin
  if pid is null then raise exception 'not signed in'; end if;
  return public._request_join(pid, p_code);
end;
$$;

-- Public: check a customer project code before signing up.
create or replace function public.lookup_project_code(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'valid', true,
      'project_id', p.id,
      'project_name', p.name,
      'portal_enabled', coalesce(s.customer_interaction_enabled, true),
      'claimed', p.customer_claimed_by is not null)
    from public.projects p
    left join public.project_settings s on s.project_id = p.id
    where p.customer_project_code = upper(trim(p_code))
  ), jsonb_build_object('valid', false))
$$;

create or replace function public.claim_project(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pid uuid := public.my_person_id();
begin
  if pid is null then raise exception 'not signed in'; end if;
  return public._claim_project(pid, p_code);
end;
$$;

create or replace function public.approve_join_request(p_request_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  jr record;
  me uuid := public.my_person_id();
begin
  select * into jr from public.join_requests where id = p_request_id;
  if jr.id is null then raise exception 'request not found'; end if;
  if not public.is_staff(jr.company_id) then raise exception 'not allowed'; end if;
  if p_role not in ('worker','customer','admin') then raise exception 'bad role'; end if;

  update public.join_requests
  set status = 'approved', assigned_role = p_role, reviewed_by = me, reviewed_at = now()
  where id = p_request_id;

  insert into public.company_members (company_id, person_id, role, status, join_method, join_request_id, approved_by, approved_at)
  values (jr.company_id, jr.person_id, p_role, 'active', jr.join_method, jr.id, me, now())
  on conflict (company_id, person_id) do update
    set role = excluded.role, status = 'active', approved_by = me, approved_at = now(), join_request_id = jr.id;

  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
  values (jr.company_id, 'join_request_approved', me, jr.person_id, jsonb_build_object('role', p_role));
end;
$$;

create or replace function public.decline_join_request(p_request_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  jr record;
  me uuid := public.my_person_id();
begin
  select * into jr from public.join_requests where id = p_request_id;
  if jr.id is null then raise exception 'request not found'; end if;
  if not public.is_staff(jr.company_id) then raise exception 'not allowed'; end if;

  update public.join_requests
  set status = 'declined', decline_reason = p_reason, reviewed_by = me, reviewed_at = now()
  where id = p_request_id;

  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id)
  values (jr.company_id, 'join_request_declined', me, jr.person_id);
end;
$$;

-- Owner: a fresh customer portal code for a project (clears any claim).
create or replace function public.regenerate_project_code(p_project_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  new_code text;
begin
  select company_id into cid from public.projects where id = p_project_id;
  if cid is null or not public.is_staff(cid) then raise exception 'not allowed'; end if;
  loop
    new_code := public._random_code(8);
    exit when not exists (select 1 from public.projects where customer_project_code = new_code);
  end loop;
  update public.projects
  set customer_project_code = new_code, customer_claimed_by = null, customer_claimed_at = null
  where id = p_project_id;
  return new_code;
end;
$$;

grant execute on function public.lookup_team_code(text) to anon, authenticated;
grant execute on function public.lookup_project_code(text) to anon, authenticated;
grant execute on function
  public.get_my_context(), public.create_company(jsonb), public.request_join(text),
  public.claim_project(text), public.approve_join_request(uuid, text),
  public.decline_join_request(uuid, text), public.regenerate_project_code(uuid)
  to authenticated;
revoke execute on function
  public._create_company(uuid, jsonb), public._request_join(uuid, text),
  public._claim_project(uuid, text), public._accept_invitations(uuid)
  from public, anon, authenticated;

-- ============================================================================
-- Live updates: let the app hear about changes as they happen
-- ============================================================================
alter publication supabase_realtime add table
  public.companies, public.people, public.company_members, public.projects,
  public.project_team, public.project_tasks, public.project_settings, public.project_photos,
  public.project_updates, public.project_requests, public.project_history, public.customer_timeline,
  public.trucks, public.assignments, public.schedule_changes, public.announcements,
  public.announcement_reads, public.check_ins, public.check_outs, public.worker_activities,
  public.work_sessions, public.worker_hourly_rates, public.worker_pay_settings, public.app_notifications,
  public.join_requests, public.company_invitations, public.team_codes, public.company_join_settings;

-- ============================================================================
-- Photo storage: a public "media" bucket that signed-in users can upload to
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

create policy media_public_read on storage.objects for select
  using (bucket_id = 'media');
create policy media_authenticated_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'media');
create policy media_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and owner = auth.uid());

-- ── Updates (also shipped separately in supabase/updates/) ──────────────────


alter table public.projects  add column if not exists cover_photo_url text;
alter table public.companies add column if not exists cover_photo_url text;
alter table public.companies add column if not exists setup_state jsonb not null default '{}'::jsonb;
alter table public.companies add column if not exists setup_completed_at timestamptz;

-- Block deleting a company. The only way around it is a deliberate reset
-- script that first runs: set local app.allow_company_delete = 'on';
create or replace function public.prevent_company_delete()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.allow_company_delete', true), '') <> 'on' then
    raise exception 'Companies cannot be deleted.';
  end if;
  return old;
end;
$$;

drop trigger if exists companies_no_delete on public.companies;
create trigger companies_no_delete
  before delete on public.companies
  for each row execute function public.prevent_company_delete();

-- Same for wiping the whole table at once.
drop trigger if exists companies_no_truncate on public.companies;
create trigger companies_no_truncate
  before truncate on public.companies
  for each statement execute function public.prevent_company_delete();

create table if not exists public.project_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  sender_id uuid references public.people(id) on delete set null,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index if not exists idx_project_messages_project on public.project_messages(project_id, created_at);

-- company_id comes from the project, like the other project tables
drop trigger if exists project_messages_company on public.project_messages;
create trigger project_messages_company before insert or update of project_id on public.project_messages
  for each row execute function public.set_company_from_project();

-- Only the owner/admins and that project's customer can see or send messages (not workers).
alter table public.project_messages enable row level security;
drop policy if exists project_messages_select on public.project_messages;
create policy project_messages_select on public.project_messages for select using (
  public.is_staff(company_id) or public.is_project_customer(project_id)
);
drop policy if exists project_messages_insert on public.project_messages;
create policy project_messages_insert on public.project_messages for insert with check (
  sender_id = public.my_person_id()
  and (
    public.is_staff((select company_id from public.projects where id = project_id))
    or public.is_project_customer(project_id)
  )
);
drop policy if exists project_messages_delete on public.project_messages;
create policy project_messages_delete on public.project_messages for delete using (
  public.is_staff(company_id) or sender_id = public.my_person_id()
);

-- Live updates
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_messages'
  ) then
    alter publication supabase_realtime add table public.project_messages;
  end if;
end $$;

-- Alert setting for new customer messages, on for every existing company
insert into public.notification_preferences (company_id, event_type, enabled)
select c.id, 'customer_message', true from public.companies c
where not exists (
  select 1 from public.notification_preferences p
  where p.company_id = c.id and p.person_id is null and p.event_type = 'customer_message'
);

-- True when no company has an active owner who still has a login.
create or replace function public.company_slot_open()
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1
    from public.company_members m
    join public.people p on p.id = m.person_id
    join auth.users u on u.id = p.user_id
    where m.role = 'owner' and m.status = 'active'
  );
$$;
grant execute on function public.company_slot_open() to anon, authenticated;

-- Every way of creating a company goes through this check.
-- (A deliberate admin script can bypass it with: set local app.allow_company_create = 'on';)
create or replace function public.enforce_one_company()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.allow_company_create', true), '') = 'on' then
    return new;
  end if;
  -- Two sign-ups at the same moment can't both slip through.
  perform pg_advisory_xact_lock(hashtext('public.one_company'));
  if not public.company_slot_open() then
    raise exception 'A company already exists. Ask the owner for a team code to join it.';
  end if;
  return new;
end;
$$;

drop trigger if exists companies_one_only on public.companies;
create trigger companies_one_only
  before insert on public.companies
  for each row execute function public.enforce_one_company();

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  uid uuid := auth.uid();
  pid uuid;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select id into pid from public.people where user_id = uid;

  if pid is not null then
    -- Leave every team and drop personal contact details.
    update public.company_members
      set status = 'inactive', deactivated_at = now(), deactivated_by = pid
      where person_id = pid;
    update public.people
      set email = '', phone = null, avatar_url = null
      where id = pid;
    delete from public.notification_preferences where person_id = pid;
    delete from public.app_notifications where recipient_id = pid;
  end if;

  -- Removing the login also unlinks the person record (user_id → null).
  delete from auth.users where id = uid;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Repeating schedules (update 012): a worker on a job weekly, every 2 weeks,
-- monthly or custom. Days are filled in as assignments by extend_schedule_series().
create table if not exists public.schedule_series (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  frequency text not null,
  -- Custom repeats: days between visits (2–365).
  interval_days integer,
  -- How far ahead days are filled in.
  horizon_days integer not null default 56,
  start_date date not null,
  end_date date,
  start_time text,           -- 'HH:MM' company-local wall clock
  end_time text,
  is_full_day boolean not null default false,
  truck_id uuid references public.trucks(id) on delete set null,
  notes text,
  created_by uuid references public.people(id) on delete set null,
  stopped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
-- Earlier copies of this file had no custom repeats or schedule-ahead.
alter table public.schedule_series
  add column if not exists interval_days integer,
  add column if not exists horizon_days integer not null default 56;
alter table public.schedule_series drop constraint if exists schedule_series_frequency_check;
alter table public.schedule_series add constraint schedule_series_frequency_check
  check (frequency in ('weekly','biweekly','monthly','custom'));
alter table public.schedule_series drop constraint if exists schedule_series_interval_check;
alter table public.schedule_series add constraint schedule_series_interval_check
  check (frequency <> 'custom' or coalesce(interval_days between 2 and 365, false));
alter table public.schedule_series drop constraint if exists schedule_series_horizon_check;
alter table public.schedule_series add constraint schedule_series_horizon_check
  check (horizon_days between 7 and 366);

create index if not exists idx_schedule_series_company on public.schedule_series(company_id);

drop trigger if exists schedule_series_updated_at on public.schedule_series;
create trigger schedule_series_updated_at before update on public.schedule_series
  for each row execute function public.set_updated_at();

alter table public.schedule_series enable row level security;
drop policy if exists schedule_series_select on public.schedule_series;
create policy schedule_series_select on public.schedule_series for select using (public.is_crew(company_id));
drop policy if exists schedule_series_staff on public.schedule_series;
create policy schedule_series_staff on public.schedule_series for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));

-- Which repeat filled in this day, if any.
alter table public.assignments
  add column if not exists series_id uuid references public.schedule_series(id) on delete set null;

-- One day per repeat per date, cancelled or not, so a cancelled day isn't
-- filled in again.
create unique index if not exists uq_assignments_series_day
  on public.assignments (series_id, scheduled_date)
  where series_id is not null;

-- Fills in a repeat's days from p_today up to its schedule-ahead window
-- (p_horizon_days overrides it, for tests).
-- p_series = null tops up every running repeat the caller can manage.
-- p_today is the company's local date, passed by the app.
-- Returns how many days were added.
create or replace function public.extend_schedule_series(
  p_series uuid default null,
  p_today date default current_date,
  p_horizon_days integer default null
)
returns integer language plpgsql set search_path = public as $$
declare
  s public.schedule_series%rowtype;
  d date;
  last_day date;
  n integer;
  new_id uuid;
  added integer := 0;
  label text;
begin
  for s in
    select ss.* from public.schedule_series ss
    join public.projects p on p.id = ss.project_id
    where ss.stopped_at is null
      and (p_series is null or ss.id = p_series)
      and public.is_staff(ss.company_id)
      and p.status = 'active'
      -- Only workers still on the team.
      and exists (
        select 1 from public.company_members m
        where m.company_id = ss.company_id and m.person_id = ss.person_id and m.status = 'active'
      )
  loop
    last_day := least(coalesce(s.end_date, 'infinity'::date), p_today + coalesce(p_horizon_days, s.horizon_days, 56));
    label := case when s.is_full_day then 'Full Day' else coalesce(s.start_time, '') || '–' || coalesce(s.end_time, '') end;
    n := 0;
    loop
      d := case s.frequency
        when 'weekly'   then s.start_date + 7 * n
        when 'biweekly' then s.start_date + 14 * n
        when 'custom'   then s.start_date + s.interval_days * n
        else (s.start_date + make_interval(months => n))::date
      end;
      exit when d > last_day;
      if d >= p_today then
        new_id := null;
        -- Skips the day if this repeat already has it (even cancelled) or the
        -- worker is already on this job that day.
        insert into public.assignments (
          company_id, project_id, person_id, scheduled_date, start_time, end_time,
          is_full_day, status, confirmation_state, truck_id, notes, series_id
        ) values (
          s.company_id, s.project_id, s.person_id, d,
          case when s.is_full_day then null else s.start_time end,
          case when s.is_full_day then null else s.end_time end,
          s.is_full_day, 'scheduled', 'awaiting', s.truck_id, s.notes, s.id
        )
        on conflict do nothing
        returning id into new_id;

        if new_id is not null then
          added := added + 1;
          insert into public.schedule_changes (company_id, assignment_id, changed_by, change_type, new_value, notes)
          values (
            s.company_id, new_id, public.my_person_id(), 'created',
            jsonb_build_object('project', (select name from public.projects where id = s.project_id), 'time', label)::text,
            'Repeating schedule'
          );
        end if;
      end if;
      n := n + 1;
    end loop;
  end loop;
  return added;
end;
$$;

revoke execute on function public.extend_schedule_series(uuid, date, integer) from public, anon;
grant execute on function public.extend_schedule_series(uuid, date, integer) to authenticated;

-- Live updates
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'schedule_series'
  ) then
    alter publication supabase_realtime add table public.schedule_series;
  end if;
end $$;

-- Crews (update 014): owner groups workers into named, colored crews.
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

-- Task photos and videos (update 017): owner attaches media that shows what to do.
create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  media_type text not null default 'image' check (media_type in ('image', 'video')),
  file_url text not null,
  file_key text not null default '',
  size_bytes bigint,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_task_attachments_task on public.task_attachments (task_id);
create index if not exists idx_task_attachments_project on public.task_attachments (project_id);

alter table public.task_attachments enable row level security;
drop policy if exists task_attachments_select on public.task_attachments;
create policy task_attachments_select on public.task_attachments for select using (public.is_crew(company_id));
drop policy if exists task_attachments_staff on public.task_attachments;
create policy task_attachments_staff on public.task_attachments for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));

-- Live updates
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_attachments'
  ) then
    alter publication supabase_realtime add table public.task_attachments;
  end if;
end $$;
