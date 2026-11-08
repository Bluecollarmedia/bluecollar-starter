-- ============================================================================
-- setup.sql  -  builds the whole database for this app on a NEW, EMPTY Supabase project.
-- ============================================================================
--
-- WHAT THIS IS
--   One file that makes every table, database function, security rule (row level security), trigger, index, grant,
--   live-update setting and storage rule the app needs. It is the clean final version of the old numbered update files,
--   with the landscape-only parts left out (Snow, lawn maintenance routes, crew routes, "Our Work" portfolio, storm
--   outlooks). You never need the old update files for a new project.
--
-- WHAT YOU FILL IN (one line, just below this header)
--   functions_url: your Supabase project's Edge Functions address,  https://<your-project-ref>.supabase.co/functions/v1
--   (Project Settings -> General -> Reference ID). The database uses it to send phone pushes and owner emails.
--   If you leave the placeholder, everything else works, but no pushes are sent until you fix it (run this file again,
--   or change the row 'functions_url' in the app_settings table).
--
-- STEPS, IN THIS ORDER
--   1. Create a new Supabase project (use a NEW one for every client; never a project that already has data).
--   2. Database -> Extensions: make sure "pg_net" is ON (phone pushes and emails need it) and "supabase_vault" is ON
--      (it is on by default; the Company Resources codes are kept in the Vault). This file also tries to switch both
--      on by itself and only prints a notice if it cannot.
--   3. Edit the FILL IN line below.
--   4. SQL Editor -> New query -> paste ALL of this file -> Run. It runs top to bottom in one go. Running it again later
--      is safe (it skips what already exists and refreshes the functions and rules).
--   5. Optional, ONLY for a demo or test project: run supabase/demo_data.sql (a fake "Demo Company"). Never on a
--      client's real launch database.
--   6. Then the rest of the per-client setup (Edge Functions deploy, Auth settings, EAS values): see the setup notes.
--
-- NOT IN THIS FILE, ON PURPOSE
--   supabase/admin_reset_all_data.sql deletes EVERY company, person and login. It is a separate admin script.
--   Never paste it together with this file.
--
-- GOOD TO KNOW
--   * One company per database: the first person who taps "Create a Company" becomes the owner; after that, people
--     join ONLY through invite links the owner (or an allowed admin) sends. Nobody is ever joined by matching an email.
--   * No scheduled jobs (pg_cron) are needed. Deleted files are removed from storage when the app calls the
--     storage-cleanup Edge Function (it does so right after deletes).
--   * Photos and files live in Cloudflare R2 (through the "media" Edge Function), not in Supabase Storage. The old
--     Supabase "media" bucket is still made (private, nobody can upload) because the app's storage meter lists it.
-- ============================================================================


-- ============================================================================
-- FILL IN  (edit the one quoted address below, then run the whole file)
-- ============================================================================
create table if not exists public.app_settings (key text primary key, value text not null);
alter table public.app_settings enable row level security;   -- no rules: only the database itself reads it
insert into public.app_settings (key, value) values ('functions_url',
  'https://YOUR-PROJECT-REF.supabase.co/functions/v1'   -- <<< FILL IN: your project's Edge Functions address
) on conflict (key) do update set value = excluded.value where excluded.value not like '%YOUR-PROJECT-REF%';

do $$
begin
  if exists (select 1 from public.app_settings where key = 'functions_url' and value like '%YOUR-PROJECT-REF%') then
    raise notice 'FILL IN not done yet: functions_url still says YOUR-PROJECT-REF. Phone pushes and owner emails stay off until you set it.';
  end if;
end $$;


-- ============================================================================
-- EXTENSIONS (switched on if they are not already; a notice is printed if that is not allowed here)
-- ============================================================================
do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net is not on (%). Turn it on in Database -> Extensions, or phone pushes and emails will not be sent.', sqlerrm;
end $$;

do $$
begin
  create extension if not exists supabase_vault with schema vault;
exception when others then
  raise notice 'supabase_vault is not on (%). Turn it on in Database -> Extensions, or Company Resources codes cannot be saved.', sqlerrm;
end $$;


-- ============================================================================
-- PART 1. TABLES
-- Each table with its columns, defaults, primary key, unique rules and value checks.
-- Links between tables (foreign keys) are added in PART 3, once every table exists.
-- ============================================================================

-- One company per database (the trigger enforce_one_company refuses a second one).
create table if not exists public.companies (
  id uuid default gen_random_uuid() not null,
  name text not null,
  logo_url text,
  phone text,
  email text,
  address text,
  city text,
  state text,
  zip text,
  yard_address text,
  yard_city text,
  yard_state text,
  yard_zip text,
  yard_latitude double precision,
  yard_longitude double precision,
  cover_photo_url text,
  worker_cover_photo_url text,
  storage_limit_gb integer default 1 not null,
  target_pay_enabled boolean default false not null,
  setup_state jsonb default '{}'::jsonb not null,
  setup_completed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  max_file_size_mb integer,
  task_lead_only boolean default false not null,
  constraint companies_pkey PRIMARY KEY (id),
  constraint companies_max_file_size_mb_check CHECK (((max_file_size_mb IS NULL) OR ((max_file_size_mb >= 1) AND (max_file_size_mb <= 200)))),
  constraint companies_storage_limit_gb_check CHECK ((storage_limit_gb >= 0))
);

-- Everyone: owner, admins, workers and customers. A person may exist before they have a login (user_id is set when they use their invite link).
create table if not exists public.people (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  email text default ''::text not null,
  first_name text default ''::text not null,
  last_name text default ''::text not null,
  avatar_url text,
  phone text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  birthday date,
  hoodie_size text,
  language text default 'en'::text not null,
  constraint people_pkey PRIMARY KEY (id),
  constraint people_birthday_range CHECK (((birthday IS NULL) OR (birthday >= '1900-01-01'::date))),
  constraint people_hoodie_size_valid CHECK (((hoodie_size IS NULL) OR (hoodie_size = ANY (ARRAY['XS'::text, 'S'::text, 'M'::text, 'L'::text, 'XL'::text, '2XL'::text, '3XL'::text])))),
  constraint people_language_check CHECK ((language = ANY (ARRAY['en'::text, 'es'::text]))),
  constraint people_user_id_key UNIQUE (user_id)
);

-- Who belongs to the company and their role: owner, admin, worker or customer. Status: active, invited or inactive.
create table if not exists public.company_members (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  person_id uuid not null,
  role text not null,
  status text default 'active'::text not null,
  join_method text default 'company_creator'::text,
  join_request_id uuid,
  approved_by uuid,
  approved_at timestamp with time zone,
  deactivated_at timestamp with time zone,
  deactivated_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint company_members_pkey PRIMARY KEY (id),
  constraint company_members_company_id_person_id_key UNIQUE (company_id, person_id),
  constraint company_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'worker'::text, 'customer'::text]))),
  constraint company_members_status_check CHECK ((status = ANY (ARRAY['active'::text, 'invited'::text, 'inactive'::text])))
);

create table if not exists public.projects (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  customer_id uuid,
  name text not null,
  address text,
  city text,
  state text,
  zip text,
  latitude double precision,
  longitude double precision,
  status text default 'active'::text not null,
  progress integer default 0 not null,
  start_date date,
  estimated_end_date date,
  completed_at timestamp with time zone,
  notes text,
  cover_photo_url text,
  customer_claimed_by uuid,
  customer_claimed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  task_lead_id uuid,
  property_id uuid,
  constraint projects_pkey PRIMARY KEY (id),
  constraint projects_progress_check CHECK (((progress >= 0) AND (progress <= 100))),
  constraint projects_status_check CHECK ((status = ANY (ARRAY['prospect'::text, 'active'::text, 'on_hold'::text, 'completed'::text, 'archived'::text])))
);

create table if not exists public.project_team (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  project_id uuid not null,
  person_id uuid not null,
  added_at timestamp with time zone default now() not null,
  removed_at timestamp with time zone,
  constraint project_team_pkey PRIMARY KEY (id)
);

create table if not exists public.project_tasks (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  project_id uuid not null,
  title text not null,
  description text,
  status text default 'pending'::text not null,
  sort_order integer default 0 not null,
  assigned_to uuid,
  completed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  completed_by uuid,
  constraint project_tasks_pkey PRIMARY KEY (id),
  constraint project_tasks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text])))
);

create table if not exists public.project_settings (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  project_id uuid not null,
  customer_interaction_enabled boolean default true not null,
  completion_photo_required boolean default false not null,
  checkin_radius_meters integer,
  customer_can_request boolean default true not null,
  customer_can_view_photos boolean default true not null,
  customer_can_comment boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  auto_progress boolean default true not null,
  constraint project_settings_pkey PRIMARY KEY (id),
  constraint project_settings_project_id_key UNIQUE (project_id)
);

create table if not exists public.project_photos (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  project_id uuid not null,
  task_id uuid,
  assignment_id uuid,
  uploaded_by uuid,
  file_key text default ''::text not null,
  file_url text not null,
  caption text,
  customer_description text,
  is_customer_visible boolean default false not null,
  shared_by uuid,
  shared_at timestamp with time zone,
  photo_type text default 'general'::text not null,
  taken_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  time_phase text,
  constraint project_photos_pkey PRIMARY KEY (id),
  constraint project_photos_photo_type_check CHECK ((photo_type = ANY (ARRAY['progress'::text, 'before'::text, 'after'::text, 'issue'::text, 'general'::text]))),
  constraint project_photos_time_phase_check CHECK (((time_phase IS NULL) OR (time_phase = ANY (ARRAY['start'::text, 'complete'::text]))))
);

create table if not exists public.project_updates (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  project_id uuid not null,
  created_by uuid,
  title text not null,
  body text default ''::text not null,
  is_customer_visible boolean default true not null,
  photo_ids text[] default '{}'::text[],
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint project_updates_pkey PRIMARY KEY (id)
);

create table if not exists public.project_requests (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  project_id uuid not null,
  requested_by uuid,
  title text not null,
  description text,
  category text default 'other'::text not null,
  attachment_url text,
  status text default 'pending'::text not null,
  linked_task_id uuid,
  responded_at timestamp with time zone,
  response_note text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint project_requests_pkey PRIMARY KEY (id),
  constraint project_requests_category_check CHECK ((category = ANY (ARRAY['change_request'::text, 'question'::text, 'additional_work'::text, 'other'::text]))),
  constraint project_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'acknowledged'::text, 'completed'::text, 'declined'::text, 'converted'::text])))
);

create table if not exists public.project_history (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  project_id uuid not null,
  actor_id uuid,
  event_type text not null,
  description text not null,
  metadata jsonb,
  created_at timestamp with time zone default now() not null,
  constraint project_history_pkey PRIMARY KEY (id)
);

create table if not exists public.customer_timeline (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  project_id uuid not null,
  event_type text not null,
  title text not null,
  description text,
  photo_url text,
  timestamp timestamp with time zone default now() not null,
  constraint customer_timeline_pkey PRIMARY KEY (id)
);

create table if not exists public.trucks (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  name text not null,
  make text,
  model text,
  year integer,
  license_plate text,
  vin text,
  color text,
  photo_url text,
  status text default 'available'::text not null,
  notes text,
  assigned_to uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint trucks_pkey PRIMARY KEY (id),
  constraint trucks_status_check CHECK ((status = ANY (ARRAY['available'::text, 'assigned'::text, 'maintenance'::text, 'out_of_service'::text])))
);

create table if not exists public.assignments (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  project_id uuid not null,
  person_id uuid not null,
  scheduled_date date not null,
  start_time text,
  end_time text,
  is_full_day boolean default false not null,
  sort_order integer default 1 not null,
  status text default 'scheduled'::text not null,
  confirmation_state text default 'not_sent'::text not null,
  truck_id uuid,
  notes text,
  cancelled_at timestamp with time zone,
  cancelled_by uuid,
  cancellation_reason text,
  reassigned_from uuid,
  reassigned_to uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  series_id uuid,
  constraint assignments_pkey PRIMARY KEY (id),
  constraint assignments_confirmation_state_check CHECK ((confirmation_state = ANY (ARRAY['not_sent'::text, 'awaiting'::text, 'confirmed'::text, 'updated_since'::text, 'acknowledged'::text]))),
  constraint assignments_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'confirmed'::text, 'en_route'::text, 'checked_in'::text, 'working'::text, 'completed'::text, 'cancelled'::text, 'reassigned'::text])))
);

create table if not exists public.schedule_changes (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  assignment_id uuid not null,
  changed_by uuid,
  change_type text not null,
  previous_value text,
  new_value text,
  notes text,
  created_at timestamp with time zone default now() not null,
  constraint schedule_changes_pkey PRIMARY KEY (id)
);

create table if not exists public.announcements (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  created_by uuid,
  title text not null,
  body text default ''::text not null,
  audience text default 'all_workers'::text not null,
  priority text default 'normal'::text not null,
  weather_action text,
  recipient_ids text[],
  expires_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint announcements_pkey PRIMARY KEY (id),
  constraint announcements_audience_check CHECK ((audience = ANY (ARRAY['all_workers'::text, 'all_members'::text, 'selected'::text, 'customers_all'::text, 'customers_active'::text]))),
  constraint announcements_priority_check CHECK ((priority = ANY (ARRAY['normal'::text, 'urgent'::text])))
);

create table if not exists public.announcement_reads (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  announcement_id uuid not null,
  person_id uuid not null,
  read_at timestamp with time zone default now() not null,
  constraint announcement_reads_pkey PRIMARY KEY (id),
  constraint announcement_reads_announcement_id_person_id_key UNIQUE (announcement_id, person_id)
);

create table if not exists public.check_ins (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  assignment_id uuid,
  person_id uuid not null,
  project_id uuid,
  timestamp timestamp with time zone default now() not null,
  gps jsonb,
  within_radius boolean default true not null,
  created_at timestamp with time zone default now() not null,
  constraint check_ins_pkey PRIMARY KEY (id)
);

create table if not exists public.check_outs (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  assignment_id uuid,
  person_id uuid not null,
  project_id uuid,
  timestamp timestamp with time zone default now() not null,
  gps jsonb,
  created_at timestamp with time zone default now() not null,
  constraint check_outs_pkey PRIMARY KEY (id)
);

create table if not exists public.worker_activities (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  person_id uuid not null,
  assignment_id uuid,
  project_id uuid,
  activity_type text not null,
  description text not null,
  metadata jsonb,
  timestamp timestamp with time zone default now() not null,
  constraint worker_activities_pkey PRIMARY KEY (id)
);

create table if not exists public.work_sessions (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  person_id uuid not null,
  project_id uuid,
  assignment_id uuid,
  check_in_time timestamp with time zone not null,
  check_out_time timestamp with time zone,
  duration_minutes numeric(8,2),
  check_in_gps jsonb,
  check_out_gps jsonb,
  offline_check_in timestamp with time zone,
  offline_check_out timestamp with time zone,
  synced_check_in_at timestamp with time zone,
  synced_check_out_at timestamp with time zone,
  status text default 'active'::text not null,
  correction jsonb,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint work_sessions_pkey PRIMARY KEY (id),
  constraint work_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'corrected'::text])))
);

create table if not exists public.worker_hourly_rates (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  person_id uuid not null,
  hourly_rate numeric(8,2) not null,
  effective_date date not null,
  end_date date,
  set_by uuid,
  created_at timestamp with time zone default now() not null,
  constraint worker_hourly_rates_pkey PRIMARY KEY (id)
);

create table if not exists public.worker_pay_settings (
  person_id uuid not null,
  company_id uuid not null,
  overtime_enabled boolean default true not null,
  overtime_after_hours numeric(5,2) default 40 not null,
  overtime_multiplier numeric(4,2) default 1.5 not null,
  target_hourly_rate numeric(8,2),
  updated_at timestamp with time zone default now() not null,
  constraint worker_pay_settings_pkey PRIMARY KEY (person_id),
  constraint worker_pay_settings_overtime_after_hours_check CHECK ((overtime_after_hours > (0)::numeric)),
  constraint worker_pay_settings_overtime_multiplier_check CHECK ((overtime_multiplier >= (1)::numeric)),
  constraint worker_pay_settings_target_hourly_rate_check CHECK ((target_hourly_rate > (0)::numeric))
);

create table if not exists public.overtime_rules (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  rule_type text default 'weekly_40'::text not null,
  weekly_threshold_hours numeric(5,2),
  daily_threshold_hours numeric(5,2),
  overtime_multiplier numeric(3,2) default 1.5 not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint overtime_rules_pkey PRIMARY KEY (id),
  constraint overtime_rules_rule_type_check CHECK ((rule_type = ANY (ARRAY['weekly_40'::text, 'daily_8'::text, 'custom'::text, 'none'::text])))
);

create table if not exists public.company_operations_settings (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  missing_checkin_grace_minutes integer default 10 not null,
  late_checkin_threshold_minutes integer default 0 not null,
  past_end_alert_enabled boolean default true not null,
  overtime_rule_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint company_operations_settings_pkey PRIMARY KEY (id),
  constraint company_operations_settings_company_id_key UNIQUE (company_id)
);

create table if not exists public.notification_preferences (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  person_id uuid,
  event_type text not null,
  enabled boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint notification_preferences_pkey PRIMARY KEY (id),
  constraint notification_preferences_company_id_person_id_event_type_key UNIQUE NULLS NOT DISTINCT (company_id, person_id, event_type)
);

create table if not exists public.app_notifications (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  recipient_id uuid not null,
  event_type text not null,
  title text not null,
  body text default ''::text not null,
  status text default 'unread'::text not null,
  linked_entity_type text,
  linked_entity_id text,
  metadata jsonb,
  created_at timestamp with time zone default now() not null,
  read_at timestamp with time zone,
  pushed_at timestamp with time zone,
  constraint app_notifications_pkey PRIMARY KEY (id),
  constraint app_notifications_status_check CHECK ((status = ANY (ARRAY['unread'::text, 'read'::text, 'dismissed'::text])))
);

create table if not exists public.worker_reminders (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  person_id uuid not null,
  assignment_id uuid,
  reminder_type text not null,
  title text not null,
  body text default ''::text not null,
  next_assignment jsonb,
  actions jsonb,
  created_at timestamp with time zone default now() not null,
  read_at timestamp with time zone,
  constraint worker_reminders_pkey PRIMARY KEY (id)
);

create table if not exists public.worker_settings (
  person_id uuid not null,
  nav_app text default 'default'::text not null,
  notifications_enabled boolean default true not null,
  updated_at timestamp with time zone default now() not null,
  constraint worker_settings_pkey PRIMARY KEY (person_id)
);

-- Old join codes. Codes can no longer be used to join (invite links only); the table stays because older screens and
-- the company-delete step still read it.
create table if not exists public.team_codes (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  code text not null,
  is_active boolean default true not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  deactivated_at timestamp with time zone,
  constraint team_codes_pkey PRIMARY KEY (id),
  constraint team_codes_code_key UNIQUE (code)
);

create table if not exists public.company_join_settings (
  company_id uuid not null,
  join_by_code_enabled boolean default true not null,
  direct_invitations_enabled boolean default true not null,
  require_email_verification boolean default false not null,
  current_team_code_id uuid,
  constraint company_join_settings_pkey PRIMARY KEY (company_id)
);

create table if not exists public.company_invitations (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  email text not null,
  name text,
  phone text,
  type text not null,
  status text default 'pending'::text not null,
  project_id uuid,
  invited_by uuid,
  token text default replace((gen_random_uuid())::text, '-'::text, ''::text) not null,
  expires_at timestamp with time zone default (now() + '14 days'::interval) not null,
  accepted_at timestamp with time zone,
  accepted_by uuid,
  created_at timestamp with time zone default now() not null,
  constraint company_invitations_pkey PRIMARY KEY (id),
  constraint company_invitations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'expired'::text, 'revoked'::text]))),
  constraint company_invitations_token_key UNIQUE (token),
  constraint company_invitations_type_check CHECK ((type = ANY (ARRAY['worker'::text, 'customer'::text])))
);

-- Old join requests (from the code era). Kept for the same reason as team_codes.
create table if not exists public.join_requests (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  person_id uuid not null,
  join_method text default 'team_code'::text not null,
  invitation_id uuid,
  status text default 'pending'::text not null,
  requested_role text,
  assigned_role text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  decline_reason text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint join_requests_pkey PRIMARY KEY (id),
  constraint join_requests_assigned_role_check CHECK ((assigned_role = ANY (ARRAY['worker'::text, 'customer'::text, 'admin'::text]))),
  constraint join_requests_requested_role_check CHECK ((requested_role = ANY (ARRAY['worker'::text, 'customer'::text]))),
  constraint join_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text, 'cancelled'::text])))
);

create table if not exists public.membership_audit_log (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  event_type text not null,
  actor_id uuid,
  target_id uuid,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now() not null,
  constraint membership_audit_log_pkey PRIMARY KEY (id)
);

create table if not exists public.project_messages (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  project_id uuid not null,
  sender_id uuid,
  body text not null,
  created_at timestamp with time zone default now() not null,
  constraint project_messages_pkey PRIMARY KEY (id),
  constraint project_messages_body_check CHECK ((length(TRIM(BOTH FROM body)) > 0))
);

create table if not exists public.schedule_series (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  project_id uuid not null,
  person_id uuid not null,
  frequency text not null,
  interval_days integer,
  horizon_days integer default 56 not null,
  start_date date not null,
  end_date date,
  start_time text,
  end_time text,
  is_full_day boolean default false not null,
  truck_id uuid,
  notes text,
  created_by uuid,
  stopped_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint schedule_series_pkey PRIMARY KEY (id),
  constraint schedule_series_check CHECK (((end_date IS NULL) OR (end_date >= start_date))),
  constraint schedule_series_frequency_check CHECK ((frequency = ANY (ARRAY['weekly'::text, 'biweekly'::text, 'monthly'::text, 'custom'::text]))),
  constraint schedule_series_horizon_check CHECK (((horizon_days >= 7) AND (horizon_days <= 366))),
  constraint schedule_series_interval_check CHECK (((frequency <> 'custom'::text) OR COALESCE(((interval_days >= 2) AND (interval_days <= 365)), false)))
);

-- Crews of workers. A worker can be in several crews. New crews get a plain dark colour (#2B2B2B) unless one is picked.
create table if not exists public.crews (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  name text not null,
  color text default '#2B2B2B'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint crews_pkey PRIMARY KEY (id),
  constraint crews_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0))
);

create table if not exists public.crew_members (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  crew_id uuid not null,
  person_id uuid not null,
  created_at timestamp with time zone default now() not null,
  constraint crew_members_pkey PRIMARY KEY (id)
);

create table if not exists public.task_attachments (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  project_id uuid not null,
  task_id uuid not null,
  media_type text default 'image'::text not null,
  file_url text not null,
  file_key text default ''::text not null,
  size_bytes bigint,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  constraint task_attachments_pkey PRIMARY KEY (id),
  constraint task_attachments_media_type_check CHECK ((media_type = ANY (ARRAY['image'::text, 'video'::text])))
);

create table if not exists public.company_resources (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  category text not null,
  name text not null,
  description text,
  truck_id uuid,
  item_name text,
  card_last_four text,
  card_holder_id uuid,
  has_secret boolean default false not null,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint company_resources_pkey PRIMARY KEY (id),
  constraint company_resources_card_last_four_check CHECK (((card_last_four IS NULL) OR (card_last_four ~ '^[0-9]{4}$'::text))),
  constraint company_resources_category_check CHECK ((category = ANY (ARRAY['access_code'::text, 'vehicle'::text, 'equipment'::text, 'company_info'::text, 'company_card'::text]))),
  constraint company_resources_description_check CHECK (((description IS NULL) OR (length(description) <= 2000))),
  constraint company_resources_item_name_check CHECK (((item_name IS NULL) OR (length(item_name) <= 120))),
  constraint company_resources_name_check CHECK (((length(TRIM(BOTH FROM name)) > 0) AND (length(name) <= 120)))
);

create table if not exists public.resource_access (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  resource_id uuid not null,
  person_id uuid not null,
  granted_by uuid,
  created_at timestamp with time zone default now() not null,
  constraint resource_access_pkey PRIMARY KEY (id),
  constraint resource_access_resource_id_person_id_key UNIQUE (resource_id, person_id)
);

create table if not exists public.resource_secrets (
  resource_id uuid not null,
  vault_secret_id uuid not null,
  updated_at timestamp with time zone default now() not null,
  constraint resource_secrets_pkey PRIMARY KEY (resource_id)
);

create table if not exists public.resource_audit_log (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  resource_id uuid,
  resource_name text,
  actor_id uuid,
  event_type text not null,
  target_person_id uuid,
  metadata jsonb,
  created_at timestamp with time zone default now() not null,
  constraint resource_audit_log_pkey PRIMARY KEY (id),
  constraint resource_audit_log_event_type_check CHECK ((event_type = ANY (ARRAY['created'::text, 'updated'::text, 'deleted'::text, 'access_granted'::text, 'access_revoked'::text, 'code_changed'::text, 'code_removed'::text, 'code_revealed'::text])))
);

create table if not exists public.quotes (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  project_id uuid not null,
  customer_id uuid,
  number text not null,
  title text,
  status text default 'draft'::text not null,
  line_items jsonb default '[]'::jsonb not null,
  tax_rate numeric(6,3) default 0 not null,
  subtotal numeric(12,2) default 0 not null,
  tax_amount numeric(12,2) default 0 not null,
  total numeric(12,2) default 0 not null,
  notes text,
  exclusions text,
  terms text,
  issue_date date default CURRENT_DATE not null,
  valid_until date,
  snapshot jsonb,
  sent_at timestamp with time zone,
  approved_at timestamp with time zone,
  approved_by uuid,
  declined_at timestamp with time zone,
  declined_by uuid,
  decline_reason text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  share_token text,
  approved_name text,
  approved_signature text,
  constraint quotes_pkey PRIMARY KEY (id),
  constraint quotes_company_id_number_key UNIQUE (company_id, number),
  constraint quotes_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'approved'::text, 'declined'::text, 'expired'::text]))),
  constraint quotes_tax_rate_check CHECK (((tax_rate >= (0)::numeric) AND (tax_rate < (100)::numeric)))
);

create table if not exists public.change_orders (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  project_id uuid not null,
  quote_id uuid,
  customer_id uuid,
  number text not null,
  title text,
  description text,
  status text default 'draft'::text not null,
  line_items jsonb default '[]'::jsonb not null,
  tax_rate numeric(6,3) default 0 not null,
  subtotal numeric(12,2) default 0 not null,
  tax_amount numeric(12,2) default 0 not null,
  total numeric(12,2) default 0 not null,
  notes text,
  terms text,
  issue_date date default CURRENT_DATE not null,
  snapshot jsonb,
  sent_at timestamp with time zone,
  approved_at timestamp with time zone,
  approved_by uuid,
  declined_at timestamp with time zone,
  declined_by uuid,
  decline_reason text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  share_token text,
  approved_name text,
  approved_signature text,
  constraint change_orders_pkey PRIMARY KEY (id),
  constraint change_orders_company_id_number_key UNIQUE (company_id, number),
  constraint change_orders_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'approved'::text, 'declined'::text]))),
  constraint change_orders_tax_rate_check CHECK (((tax_rate >= (0)::numeric) AND (tax_rate < (100)::numeric)))
);

create table if not exists public.invoices (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  project_id uuid not null,
  quote_id uuid,
  change_order_ids uuid[] default '{}'::uuid[] not null,
  customer_id uuid,
  number text not null,
  title text,
  status text default 'draft'::text not null,
  line_items jsonb default '[]'::jsonb not null,
  tax_rate numeric(6,3) default 0 not null,
  subtotal numeric(12,2) default 0 not null,
  tax_amount numeric(12,2) default 0 not null,
  total numeric(12,2) default 0 not null,
  notes text,
  payment_instructions text,
  invoice_date date default CURRENT_DATE not null,
  due_date date,
  snapshot jsonb,
  issued_at timestamp with time zone,
  voided_at timestamp with time zone,
  void_reason text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  share_token text,
  constraint invoices_pkey PRIMARY KEY (id),
  constraint invoices_company_id_number_key UNIQUE (company_id, number),
  constraint invoices_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'issued'::text, 'void'::text]))),
  constraint invoices_tax_rate_check CHECK (((tax_rate >= (0)::numeric) AND (tax_rate < (100)::numeric)))
);

create table if not exists public.financial_events (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  project_id uuid not null,
  document_type text not null,
  document_id uuid not null,
  event_type text not null,
  actor_id uuid,
  note text,
  created_at timestamp with time zone default now() not null,
  metadata jsonb,
  constraint financial_events_pkey PRIMARY KEY (id),
  constraint financial_events_document_type_check CHECK ((document_type = ANY (ARRAY['quote'::text, 'change_order'::text, 'invoice'::text]))),
  constraint financial_events_event_type_check CHECK ((event_type = ANY (ARRAY['created'::text, 'sent'::text, 'approved'::text, 'declined'::text, 'expired'::text, 'issued'::text, 'voided'::text])))
);

create table if not exists public.push_tokens (
  token text not null,
  person_id uuid not null,
  platform text,
  updated_at timestamp with time zone default now() not null,
  constraint push_tokens_pkey PRIMARY KEY (token)
);

-- Server-only settings (no app access). functions_url is set by the FILL IN block at the top of this file.
create table if not exists public.app_settings (
  key text not null,
  value text not null,
  constraint app_settings_pkey PRIMARY KEY (key)
);

create table if not exists public.financial_settings (
  company_id uuid not null,
  default_tax_rate numeric(6,3),
  default_terms text,
  default_exclusions text,
  default_payment_instructions text,
  updated_at timestamp with time zone default now() not null,
  default_invoice_notes text,
  constraint financial_settings_pkey PRIMARY KEY (company_id),
  constraint financial_settings_default_tax_rate_check CHECK (((default_tax_rate >= (0)::numeric) AND (default_tax_rate < (100)::numeric)))
);

create table if not exists public.material_vendors (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  name text not null,
  contact_name text,
  phone text,
  email text,
  address text,
  pickup_instructions text,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint material_vendors_pkey PRIMARY KEY (id),
  constraint material_vendors_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0))
);

create table if not exists public.project_materials (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  project_id uuid not null,
  name text not null,
  quantity numeric(12,3),
  unit text,
  status text default 'needs_review'::text not null,
  vendor_id uuid,
  notes text,
  source jsonb,
  sort_order integer default 0 not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint project_materials_pkey PRIMARY KEY (id),
  constraint project_materials_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0)),
  constraint project_materials_quantity_check CHECK (((quantity IS NULL) OR (quantity > (0)::numeric))),
  constraint project_materials_status_check CHECK ((status = ANY (ARRAY['needs_review'::text, 'to_order'::text, 'ordered'::text, 'ready'::text, 'picked_up'::text, 'complete'::text])))
);

create table if not exists public.project_material_plans (
  project_id uuid not null,
  company_id uuid,
  vendor_id uuid,
  pickup_location text,
  pickup_instructions text,
  handling_notes text,
  reminder_at timestamp with time zone,
  reminder_job_date date,
  reminder_note text,
  dismissed_sources jsonb default '[]'::jsonb not null,
  updated_at timestamp with time zone default now() not null,
  constraint project_material_plans_pkey PRIMARY KEY (project_id)
);

create table if not exists public.property_issues (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  reported_by uuid,
  issue_type text not null,
  notes text,
  photos jsonb default '[]'::jsonb not null,
  project_id uuid not null,
  place_name text default ''::text not null,
  status text default 'open'::text not null,
  resolved_by uuid,
  resolved_at timestamp with time zone,
  resolution_note text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint property_issues_pkey PRIMARY KEY (id),
  constraint property_issues_issue_type_check CHECK ((issue_type = ANY (ARRAY['tree_down'::text, 'damage'::text, 'safety'::text, 'equipment'::text, 'customer_request'::text, 'other'::text]))),
  constraint property_issues_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text])))
);

create table if not exists public.content_reports (
  id uuid default gen_random_uuid() not null,
  company_id uuid,
  project_id uuid not null,
  reported_by uuid not null,
  content_type text not null,
  content_id uuid not null,
  reason text not null,
  details text,
  status text default 'open'::text not null,
  handled_by uuid,
  handled_at timestamp with time zone,
  handled_note text,
  created_at timestamp with time zone default now() not null,
  constraint content_reports_pkey PRIMARY KEY (id),
  constraint content_reports_content_type_check CHECK ((content_type = ANY (ARRAY['message'::text, 'photo'::text]))),
  constraint content_reports_reason_check CHECK ((reason = ANY (ARRAY['inappropriate'::text, 'harassment'::text, 'spam'::text, 'other'::text]))),
  constraint content_reports_reported_by_content_type_content_id_key UNIQUE (reported_by, content_type, content_id),
  constraint content_reports_status_check CHECK ((status = ANY (ARRAY['open'::text, 'handled'::text])))
);

create table if not exists public.truck_documents (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  truck_id uuid not null,
  kind text default 'other'::text not null,
  title text not null,
  file_url text not null,
  file_key text,
  content_type text,
  size_bytes bigint,
  expires_on date,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint truck_documents_pkey PRIMARY KEY (id),
  constraint truck_documents_kind_check CHECK ((kind = ANY (ARRAY['insurance'::text, 'registration'::text, 'inspection'::text, 'other'::text]))),
  constraint truck_documents_title_check CHECK ((length(TRIM(BOTH FROM title)) > 0))
);

create table if not exists public.truck_notes (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  truck_id uuid not null,
  body text not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint truck_notes_pkey PRIMARY KEY (id),
  constraint truck_notes_body_check CHECK ((length(TRIM(BOTH FROM body)) > 0))
);

create table if not exists public.owner_project_notes (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  project_id uuid not null,
  body text not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint owner_project_notes_pkey PRIMARY KEY (id),
  constraint owner_project_notes_body_check CHECK ((length(TRIM(BOTH FROM body)) > 0))
);

create table if not exists public.owner_project_photos (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  project_id uuid not null,
  file_url text not null,
  file_key text,
  caption text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint owner_project_photos_pkey PRIMARY KEY (id)
);

create table if not exists public.owner_material_lists (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  project_id uuid not null,
  title text default 'Materials list'::text not null,
  items jsonb default '[]'::jsonb not null,
  source_text text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint owner_material_lists_pkey PRIMARY KEY (id)
);

create table if not exists public.person_ids (
  person_id uuid not null,
  id_key text not null,
  updated_at timestamp with time zone default now() not null,
  constraint person_ids_pkey PRIMARY KEY (person_id),
  constraint person_ids_id_key_check CHECK ((id_key ~ '^ids/[A-Za-z0-9._/-]+$'::text))
);

-- Time clock settings per company. timezone = the company's time zone (default America/New_York): it decides which day a
-- clock-in belongs to and when an open workday is closed at midnight. Change it here for a company in another time zone.
create table if not exists public.time_settings (
  company_id uuid not null,
  breaks_enabled boolean default false not null,
  breaks_paid boolean default true not null,
  require_start_photo boolean default false not null,
  require_complete_photo boolean default false not null,
  target_alerts_enabled boolean default false not null,
  target_notify_crew boolean default false not null,
  overtime_alerts_enabled boolean default false not null,
  approach_percent integer default 90 not null,
  long_visit_hours numeric(5,2) default 6 not null,
  open_workday_hours numeric(5,2) default 14 not null,
  updated_by uuid,
  updated_at timestamp with time zone default now() not null,
  timezone text default 'America/New_York'::text not null,
  constraint time_settings_pkey PRIMARY KEY (company_id),
  constraint time_settings_approach_percent_check CHECK (((approach_percent >= 50) AND (approach_percent <= 100))),
  constraint time_settings_long_visit_hours_check CHECK ((long_visit_hours > (0)::numeric)),
  constraint time_settings_open_workday_hours_check CHECK ((open_workday_hours > (0)::numeric))
);

create table if not exists public.time_person_settings (
  person_id uuid not null,
  company_id uuid not null,
  daily_alert_hours numeric(5,2),
  updated_at timestamp with time zone default now() not null,
  constraint time_person_settings_pkey PRIMARY KEY (person_id),
  constraint time_person_settings_daily_alert_hours_check CHECK (((daily_alert_hours IS NULL) OR ((daily_alert_hours > (0)::numeric) AND (daily_alert_hours <= (24)::numeric))))
);

create table if not exists public.time_property_targets (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  project_id uuid not null,
  target_minutes integer not null,
  updated_by uuid,
  updated_at timestamp with time zone default now() not null,
  constraint time_property_targets_pkey PRIMARY KEY (id),
  constraint time_property_targets_target_minutes_check CHECK (((target_minutes >= 5) AND (target_minutes <= 1440)))
);

create table if not exists public.time_workdays (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  person_id uuid not null,
  work_date date not null,
  clock_in_at timestamp with time zone default now() not null,
  clock_out_at timestamp with time zone,
  status text default 'active'::text not null,
  truck_id uuid,
  truck_source text,
  approved_by uuid,
  approved_at timestamp with time zone,
  approval_version integer default 0 not null,
  client_request_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  flagged_at timestamp with time zone,
  flagged_reason text,
  claimed_out_at timestamp with time zone,
  claim_note text,
  claimed_at timestamp with time zone,
  constraint time_workdays_pkey PRIMARY KEY (id),
  constraint time_workdays_client_request_id_key UNIQUE (client_request_id),
  constraint time_workdays_status_check CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text, 'approved'::text, 'reopened'::text, 'needs_review'::text]))),
  constraint time_workdays_truck_source_check CHECK (((truck_source IS NULL) OR (truck_source = ANY (ARRAY['owner'::text, 'worker'::text]))))
);

create table if not exists public.time_workday_rates (
  workday_id uuid not null,
  company_id uuid not null,
  hourly_rate numeric(8,2),
  constraint time_workday_rates_pkey PRIMARY KEY (workday_id)
);

create table if not exists public.time_breaks (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  workday_id uuid not null,
  person_id uuid not null,
  started_at timestamp with time zone default now() not null,
  ended_at timestamp with time zone,
  paid boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint time_breaks_pkey PRIMARY KEY (id)
);

create table if not exists public.time_visits (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  source text not null,
  project_id uuid,
  visit_date date not null,
  label text,
  status text default 'in_progress'::text not null,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  billable boolean default true not null,
  target_minutes integer,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint time_visits_pkey PRIMARY KEY (id),
  constraint time_visits_source_check CHECK ((source = 'project_day'::text)),
  constraint time_visits_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'void'::text])))
);

create table if not exists public.time_intervals (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  visit_id uuid not null,
  workday_id uuid not null,
  person_id uuid not null,
  started_at timestamp with time zone default now() not null,
  ended_at timestamp with time zone,
  status text default 'active'::text not null,
  billable boolean default true not null,
  legacy_session_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint time_intervals_pkey PRIMARY KEY (id),
  constraint time_intervals_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'void'::text])))
);

create table if not exists public.time_interval_rates (
  interval_id uuid not null,
  company_id uuid not null,
  hourly_rate numeric(8,2),
  constraint time_interval_rates_pkey PRIMARY KEY (interval_id)
);

create table if not exists public.time_skip_requests (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  source text not null,
  assignment_id uuid not null,
  requested_by uuid not null,
  reason text not null,
  status text default 'pending'::text not null,
  decided_by uuid,
  decided_at timestamp with time zone,
  decision_note text,
  created_at timestamp with time zone default now() not null,
  constraint time_skip_requests_pkey PRIMARY KEY (id),
  constraint time_skip_requests_reason_check CHECK ((length(TRIM(BOTH FROM reason)) > 0)),
  constraint time_skip_requests_source_check CHECK ((source = 'assignment'::text)),
  constraint time_skip_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'denied'::text, 'withdrawn'::text])))
);

create table if not exists public.time_audit (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  entity text not null,
  entity_id uuid,
  person_id uuid,
  workday_id uuid,
  visit_id uuid,
  action text not null,
  field text,
  old_value jsonb,
  new_value jsonb,
  reason text,
  actor_id uuid,
  was_approved boolean default false not null,
  created_at timestamp with time zone default now() not null,
  constraint time_audit_pkey PRIMARY KEY (id)
);

create table if not exists public.time_alerts (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  kind text not null,
  person_id uuid,
  workday_id uuid,
  visit_id uuid,
  skip_request_id uuid,
  title text not null,
  detail text default ''::text not null,
  dedupe_key text not null,
  status text default 'open'::text not null,
  resolved_by uuid,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  constraint time_alerts_pkey PRIMARY KEY (id),
  constraint time_alerts_dedupe_key_key UNIQUE (dedupe_key),
  constraint time_alerts_kind_check CHECK ((kind = ANY (ARRAY['open_workday'::text, 'long_visit'::text, 'over_target'::text, 'overtime_approaching'::text, 'overtime_reached'::text, 'skip_request'::text, 'needs_review'::text]))),
  constraint time_alerts_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text])))
);

create table if not exists public.time_project_estimates (
  project_id uuid not null,
  company_id uuid not null,
  labor_hours numeric(8,2) not null,
  labor_cost numeric(10,2),
  updated_by uuid,
  updated_at timestamp with time zone default now() not null,
  constraint time_project_estimates_pkey PRIMARY KEY (project_id),
  constraint time_project_estimates_labor_cost_check CHECK (((labor_cost IS NULL) OR (labor_cost >= (0)::numeric))),
  constraint time_project_estimates_labor_hours_check CHECK (((labor_hours > (0)::numeric) AND (labor_hours <= (100000)::numeric)))
);

create table if not exists public.company_admin_permissions (
  company_id uuid not null,
  team boolean default true not null,
  invites boolean default true not null,
  time_corrections boolean default true not null,
  pay_rates boolean default true not null,
  updated_by uuid,
  updated_at timestamp with time zone default now() not null,
  constraint company_admin_permissions_pkey PRIMARY KEY (company_id)
);

-- One record per deleted company (kept after the company is gone). No app access.
create table if not exists public.company_closure_log (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  company_name text,
  closed_by uuid,
  closed_by_name text,
  counts jsonb default '{}'::jsonb not null,
  closed_at timestamp with time zone default now() not null,
  constraint company_closure_log_pkey PRIMARY KEY (id)
);

-- Files and folders waiting to be deleted from storage by the storage-cleanup Edge Function.
create table if not exists public.storage_cleanup_queue (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  source_table text not null,
  file_key text not null,
  enqueued_at timestamp with time zone default now() not null,
  processed_at timestamp with time zone,
  status text default 'pending'::text not null,
  attempts integer default 0 not null,
  last_error text,
  next_attempt_at timestamp with time zone default now() not null,
  locked_until timestamp with time zone,
  kind text default 'file'::text not null,
  constraint storage_cleanup_queue_pkey PRIMARY KEY (id),
  constraint storage_cleanup_kind_check CHECK ((kind = ANY (ARRAY['file'::text, 'prefix'::text]))),
  constraint storage_cleanup_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'done'::text, 'failed'::text])))
);

create table if not exists public.properties (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  customer_id uuid,
  name text,
  address text default ''::text not null,
  city text,
  state text,
  zip text,
  latitude double precision,
  longitude double precision,
  notes text,
  address_key text default ''::text not null,
  is_active boolean default true not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint properties_pkey PRIMARY KEY (id)
);

create table if not exists public.truck_maintenance (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  truck_id uuid not null,
  title text not null,
  serviced_on date not null,
  due_on date,
  notes text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint truck_maintenance_pkey PRIMARY KEY (id),
  constraint truck_maintenance_check CHECK (((due_on IS NULL) OR (due_on >= serviced_on))),
  constraint truck_maintenance_title_check CHECK ((length(TRIM(BOTH FROM title)) > 0))
);

-- Invite links. The ONLY way a new login is joined to an existing person record. Only the hash of each link is stored.
create table if not exists public.invites (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  person_id uuid not null,
  kind text not null,
  token_hash text not null,
  status text default 'pending'::text not null,
  expires_at timestamp with time zone not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  last_sent_at timestamp with time zone,
  used_at timestamp with time zone,
  revoked_at timestamp with time zone,
  constraint invites_pkey PRIMARY KEY (id),
  constraint invites_kind_check CHECK ((kind = ANY (ARRAY['worker'::text, 'customer'::text]))),
  constraint invites_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'used'::text, 'revoked'::text]))),
  constraint invites_token_hash_key UNIQUE (token_hash)
);

-- The public weather switch. It ONLY controls the signed-out (public visitor) area; signed-in people see the weather
-- whenever brand.js features.weather is on. Default OFF, to match brand.js features.publicVisitorArea = false.
create table if not exists public.public_weather_settings (
  company_id uuid not null,
  enabled boolean default false not null,
  updated_by uuid,
  updated_at timestamp with time zone default now() not null,
  constraint public_weather_settings_pkey PRIMARY KEY (company_id)
);

create table if not exists public.company_yard_alerts (
  company_id uuid not null,
  radius_m integer default 152 not null,
  alert_on boolean default false not null,
  alert_email text,
  updated_by uuid,
  updated_at timestamp with time zone default now() not null,
  constraint company_yard_alerts_pkey PRIMARY KEY (company_id),
  constraint company_yard_alerts_alert_email_check CHECK (((alert_email IS NULL) OR (char_length(alert_email) <= 200))),
  constraint company_yard_alerts_radius_m_check CHECK (((radius_m >= 30) AND (radius_m <= 5000)))
);

create table if not exists public.time_clock_locations (
  workday_id uuid not null,
  company_id uuid not null,
  person_id uuid not null,
  lat numeric(9,6),
  lng numeric(9,6),
  accuracy_m numeric(8,1),
  note text,
  yard_distance_m integer,
  outside_yard boolean,
  recorded_at timestamp with time zone default now() not null,
  alert_sent_at timestamp with time zone,
  constraint time_clock_locations_pkey PRIMARY KEY (workday_id),
  constraint time_clock_locations_note_check CHECK (((note IS NULL) OR (char_length(note) <= 160)))
);

-- Requests sent from the public "Request a service" form (see submit_service_request).
create table if not exists public.service_requests (
  id uuid default gen_random_uuid() not null,
  company_id uuid not null,
  property_type text not null,
  services text[] not null,
  details text default ''::text not null,
  town text not null,
  name text not null,
  phone text not null,
  phone_digits text not null,
  email text default ''::text not null,
  status text default 'new'::text not null,
  handled_by uuid,
  handled_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  emailed_at timestamp with time zone,
  constraint service_requests_pkey PRIMARY KEY (id),
  constraint service_requests_details_check CHECK ((char_length(details) <= 2000)),
  constraint service_requests_email_check CHECK ((char_length(email) <= 120)),
  constraint service_requests_name_check CHECK (((char_length(name) >= 2) AND (char_length(name) <= 80))),
  constraint service_requests_property_type_check CHECK ((property_type = ANY (ARRAY['residential'::text, 'commercial'::text]))),
  constraint service_requests_services_check CHECK (((cardinality(services) >= 1) AND (cardinality(services) <= 8))),
  constraint service_requests_status_check CHECK ((status = ANY (ARRAY['new'::text, 'contacted'::text, 'done'::text]))),
  constraint service_requests_town_check CHECK (((char_length(town) >= 2) AND (char_length(town) <= 80)))
);

-- R6: "Add customer" by email found a login with that email that has NOT confirmed it yet. The owner's customer record is kept
-- unlinked and noted here; the login is linked to it only when that SAME login confirms that SAME email (trigger
-- _link_customer_on_email_confirm on auth.users). Private: the app cannot read or change it (only the database functions do).
create table if not exists public.customer_email_links (
  company_id uuid not null,
  person_id uuid not null,
  user_id uuid not null,
  email text not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  constraint customer_email_links_pkey PRIMARY KEY (person_id, user_id)
);

-- Worker push on/off lives in worker_settings.notifications_enabled (each person's own row; see push_app_notification).

-- ============================================================================
-- PART 2. FUNCTIONS
-- Database functions: the helpers the security rules use (names starting with "_" are internal and
-- cannot be called from the app), the actions the app calls, and the trigger functions.
-- check_function_bodies is off so the order of the functions does not matter.
-- ============================================================================

set check_function_bodies = off;

-- Kept only because get_my_context() calls it. It does NOTHING on purpose: nobody is joined to a company by matching an email.
create or replace function public._accept_invitations(pid uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- Joining a company happens only through an invite link. Never by matching an email address.
  return;
end;
$function$;

create or replace function public._auto_task_lead(p_project uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  pr public.projects;
  only_person uuid;
  n integer;
begin
  select * into pr from public.projects where id = p_project;
  if not found or pr.task_lead_id is not null then return; end if;
  select count(distinct a.person_id), min(a.person_id::text)::uuid into n, only_person
    from public.assignments a
   where a.project_id = p_project and a.status not in ('cancelled', 'reassigned');
  if n <> 1 or only_person is null then return; end if;
  if not exists (select 1 from public.company_members m where m.company_id = pr.company_id and m.person_id = only_person and m.status = 'active' and m.role = 'worker') then return; end if;
  update public.projects set task_lead_id = only_person where id = p_project and task_lead_id is null;
end;
$function$;

create or replace function public._auto_task_lead_after_assignment()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform public._auto_task_lead(new.project_id);
  return new;
end;
$function$;

create or replace function public._check_account_target(p_person_id uuid)
 returns uuid
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  cid uuid := public._my_owned_company();
begin
  if cid is null then raise exception 'Only the owner can manage accounts.'; end if;
  if p_person_id = public.my_person_id() then
    raise exception 'Use Settings → Delete Account for your own account.';
  end if;
  if exists (select 1 from public.company_members
             where person_id = p_person_id and role = 'owner' and status = 'active') then
    raise exception 'Another owner''s account can''t be changed here.';
  end if;
  return cid;
end;
$function$;

create or replace function public._check_member_target(p_person_id uuid)
 returns uuid
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare cid uuid := public._team_manager_company(); trole text; arole text;
begin
  if cid is null then raise exception 'Only the owner (or an admin the owner allows) can manage the team.'; end if;
  if p_person_id = public.my_person_id() then raise exception 'You can''t change your own access here.'; end if;
  select role into trole from public.company_members where company_id = cid and person_id = p_person_id;
  if trole = 'owner' then raise exception 'The owner''s account can''t be changed here.'; end if;
  arole := public.member_role(cid);
  if trole = 'admin' and arole <> 'owner' then raise exception 'Only the owner can change an admin.'; end if;
  return cid;
end;
$function$;

create or replace function public._company_members_guard()
 returns trigger
 language plpgsql
as $function$
declare actor_role text; me uuid;
begin
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  me := public.my_person_id();
  if tg_op = 'DELETE' then
    raise exception 'Team members can''t be deleted. Deactivate them instead.';
  elsif tg_op = 'INSERT' then
    if new.role <> 'customer' or not public.is_staff(new.company_id) then
      raise exception 'People join the team through an invite link.';
    end if;
    return new;
  end if;
  -- UPDATE
  if new.company_id is distinct from old.company_id or new.person_id is distinct from old.person_id or new.role is distinct from old.role then
    raise exception 'Roles are changed with Make admin / Remove admin, not by editing the team list.';
  end if;
  if new.status is distinct from old.status then
    actor_role := public.member_role(old.company_id);
    if actor_role not in ('owner', 'admin') or not public.admin_can(old.company_id, 'team') then
      raise exception 'Only the owner (or an admin the owner allows) can do that.';
    end if;
    if not (old.status = 'active' and new.status = 'inactive') then
      raise exception 'Use Reactivate to bring someone back.';
    end if;
    if old.role = 'owner' then raise exception 'The owner can''t be deactivated.'; end if;
    if old.person_id = me then raise exception 'You can''t deactivate yourself here.'; end if;
    if old.role = 'admin' and actor_role <> 'owner' then raise exception 'Only the owner can deactivate an admin.'; end if;
  end if;
  return new;
end;
$function$;

create or replace function public._create_company(pid uuid, data jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  cid uuid;
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


  -- People join only through invite links; no team code is made.
  insert into public.company_join_settings (company_id) values (cid);

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
$function$;

create or replace function public._customer_audience(p_company uuid, p_audience text)
 returns uuid[]
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(array_agg(distinct r.pid), '{}') from (
    select p.customer_id as pid from public.projects p
     where p.company_id = p_company and p.status in ('active','on_hold') and p_audience in ('customers_all','customers_active')
    union
    select p.customer_claimed_by from public.projects p
     where p.company_id = p_company and p.status in ('active','on_hold') and p_audience in ('customers_all','customers_active')
    union
    select cm.person_id from public.company_members cm
     where cm.company_id = p_company and cm.role = 'customer' and cm.status = 'active' and p_audience = 'customers_all'
  ) r
  join public.people pe on pe.id = r.pid and pe.user_id is not null
  where r.pid is not null
    -- A customer whose access the owner turned off is not messaged.
    and not exists (select 1 from public.company_members x where x.company_id = p_company and x.person_id = r.pid and x.role = 'customer' and x.status = 'inactive');
$function$;

create or replace function public._customer_in_good_standing(p_company uuid, p_person uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (select 1 from public.company_members m
                  where m.company_id = p_company and m.person_id = p_person and m.role = 'customer' and m.status in ('active', 'invited'))
$function$;

create or replace function public._customer_same_company_guard()
 returns trigger
 language plpgsql
as $function$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if new.customer_id is not null and (tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id) then
    if new.company_id is not null and not exists (select 1 from public.company_members m where m.company_id = new.company_id and m.person_id = new.customer_id and m.role = 'customer') then
      raise exception 'That person is not a customer of this company.';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public._distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
 returns double precision
 language sql
 immutable
as $function$
  select 6371000 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$function$;

create or replace function public._document_project_company_guard()
 returns trigger
 language plpgsql
as $function$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if new.company_id is not null and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id) then
    if not exists (select 1 from public.projects p where p.id = new.project_id and p.company_id = new.company_id) then
      raise exception 'That project belongs to a different company.';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public._enqueue_company_files(p_company uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare t record; n integer := 0; c integer;
begin
  for t in
    select c1.relname from pg_class c1 join pg_namespace n1 on n1.oid = c1.relnamespace and n1.nspname = 'public'
     where c1.relkind = 'r' and c1.relname <> 'storage_cleanup_queue'
       and exists (select 1 from pg_attribute a where a.attrelid = c1.oid and a.attname = 'company_id' and not a.attisdropped)
       and exists (select 1 from pg_attribute a where a.attrelid = c1.oid and a.attname = 'file_key' and not a.attisdropped)
  loop
    execute format('insert into public.storage_cleanup_queue (company_id, source_table, file_key) select company_id, %L, file_key from public.%I where company_id = $1 and coalesce(file_key, '''') <> '''' on conflict (file_key) do nothing', t.relname, t.relname) using p_company;
    get diagnostics c = row_count;
    n := n + c;
  end loop;
  return n;
end;
$function$;

create or replace function public._enqueue_company_prefixes(p_company uuid, p_people uuid[])
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n integer := 0; c integer; pid uuid;
begin
  insert into public.storage_cleanup_queue (company_id, source_table, file_key, kind) values (p_company, 'company_folder', p_company::text || '/', 'prefix')
    on conflict (file_key) do nothing;
  get diagnostics c = row_count; n := n + c;
  foreach pid in array coalesce(p_people, '{}') loop
    insert into public.storage_cleanup_queue (company_id, source_table, file_key, kind) values (p_company, 'person_ids', 'ids/' || pid::text || '/', 'prefix') on conflict (file_key) do nothing;
    get diagnostics c = row_count; n := n + c;
    insert into public.storage_cleanup_queue (company_id, source_table, file_key, kind) values (p_company, 'person_avatars', 'avatars/' || pid::text || '/', 'prefix') on conflict (file_key) do nothing;
    get diagnostics c = row_count; n := n + c;
  end loop;
  return n;
end;
$function$;

create or replace function public._enqueue_deleted_file()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if coalesce(old.file_key, '') <> '' and old.company_id is not null then
    insert into public.storage_cleanup_queue (company_id, source_table, file_key)
    values (old.company_id, tg_table_name, old.file_key)
    on conflict (file_key) do nothing;
  end if;
  return old;
end;
$function$;

create or replace function public._enqueue_deleted_issue_files()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare p jsonb;
begin
  if old.company_id is null or old.photos is null or jsonb_typeof(old.photos) <> 'array' then return old; end if;
  for p in select * from jsonb_array_elements(old.photos) loop
    if coalesce(p->>'key', '') <> '' and (p->>'key') !~ '^https?://' then
      insert into public.storage_cleanup_queue (company_id, source_table, file_key)
      values (old.company_id, 'property_issues', p->>'key')
      on conflict (file_key) do nothing;
    end if;
  end loop;
  return old;
end;
$function$;

create or replace function public._has_card_number(t text)
 returns boolean
 language plpgsql
 immutable
 set search_path to ''
as $function$
declare
  m text[];
  digits text;
  total int;
  d int;
  i int;
begin
  if t is null then return false; end if;
  for m in select regexp_matches(t, '(?:[0-9][ -]?){12,18}[0-9]', 'g') loop
    digits := regexp_replace(m[1], '[^0-9]', '', 'g');
    total := 0;
    for i in 1..length(digits) loop
      d := substr(digits, length(digits) - i + 1, 1)::int;
      if i % 2 = 0 then
        d := d * 2;
        if d > 9 then d := d - 9; end if;
      end if;
      total := total + d;
    end loop;
    if total % 10 = 0 then return true; end if;
  end loop;
  return false;
end;
$function$;

create or replace function public._invite_hash(p_token text)
 returns text
 language sql
 immutable
as $function$ select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') $function$;

create or replace function public._invite_issue(p_company uuid, p_person uuid, p_kind text, p_actor uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare tok text; inv public.invites;
begin
  update public.invites set status = 'revoked', revoked_at = now() where person_id = p_person and status = 'pending';
  tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.invites (company_id, person_id, kind, token_hash, expires_at, created_by, last_sent_at)
  values (p_company, p_person, p_kind, public._invite_hash(tok), now() + interval '7 days', p_actor, now())
  returning * into inv;
  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
  values (p_company, 'invite_created', p_actor, p_person, jsonb_build_object('kind', p_kind, 'invite_id', inv.id));
  return jsonb_build_object('invite_id', inv.id, 'token', tok, 'expires_at', inv.expires_at, 'person_id', p_person);
end;
$function$;

create or replace function public._invite_staff_company()
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select company_id from public.company_members
   where person_id = public.my_person_id() and role in ('owner', 'admin') and status = 'active' and public.admin_can(company_id, 'invites')
   order by created_at limit 1
$function$;

create or replace function public._is_company_customer(p_company uuid, p_person uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (select 1 from public.company_members m where m.company_id = p_company and m.person_id = p_person and m.role = 'customer')
$function$;

create or replace function public._member_deactivated()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := public.my_person_id();
begin
  if new.status = 'inactive' and old.status is distinct from 'inactive' then
    update public.join_requests set status = 'cancelled', reviewed_by = me, reviewed_at = now()
     where company_id = new.company_id and person_id = new.person_id and status = 'pending';
    delete from public.push_tokens where person_id = new.person_id;
    insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
    values (new.company_id, 'member_deactivated', me, new.person_id, jsonb_build_object('role', new.role));
  end if;
  return null;
end;
$function$;

create or replace function public._member_deactivation_block()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.status = 'inactive' and old.status is distinct from 'inactive' and new.person_id is distinct from public.my_person_id() then
    if exists (select 1 from public.time_workdays w where w.person_id = new.person_id and w.company_id = new.company_id and w.clock_out_at is null) then
      raise exception 'They are clocked in. Set their clock-out in Hours & Labor first, then deactivate them.';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public._mentions_card_credential(t text)
 returns boolean
 language sql
 immutable
 set search_path to ''
as $function$
  select coalesce(
    t ~* '\m(cvv2?|cvc2?|cvn|security code)\M'
    or t ~* '\mcard\M.{0,30}\mpin\M'
    or t ~* '\mpin\M.{0,30}\mcard\M',
    false)
$function$;

create or replace function public._merge_placeholder_customer(p_company uuid, p_placeholder uuid, p_real uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare t record;
begin
  if p_placeholder is null or p_real is null or p_placeholder = p_real then return false; end if;
  -- Only an owner-created record: no login, and an invited customer of THIS company (and of no other company).
  if not exists (select 1 from public.people p where p.id = p_placeholder and p.user_id is null) then return false; end if;
  if not exists (select 1 from public.company_members m where m.company_id = p_company and m.person_id = p_placeholder and m.role = 'customer' and m.status = 'invited') then return false; end if;
  if exists (select 1 from public.company_members m where m.person_id = p_placeholder and m.company_id <> p_company) then return false; end if;

  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r'
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'customer_id' and not a.attisdropped)
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
  loop
    execute format('update public.%I set customer_id = $1 where customer_id = $2 and company_id = $3', t.relname) using p_real, p_placeholder, p_company;
  end loop;
  -- Their own timeline/records stay with the company; the invited membership and the empty person go.
  delete from public.company_members where company_id = p_company and person_id = p_placeholder and role = 'customer' and status = 'invited';
  begin
    delete from public.people where id = p_placeholder and user_id is null;
  exception when foreign_key_violation then
    null;   -- something outside the customer_id columns still points at it: keep the person rather than lose data
  end;
  return true;
end;
$function$;

-- R6: runs when a login CONFIRMS its email (auth.users.email_confirmed_at goes from empty to set). Links that login to each customer
-- record the owner added by that exact email while this same login was still unconfirmed (customer_email_links), with the same
-- company rules as add_customer: never someone on the team, never a customer whose access the owner removed, only a record that is
-- still unlinked and still "invited". Never blocks the confirmation itself. Needs Supabase "Confirm email" ON to mean anything.
create or replace function public._link_customer_on_email_confirm()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid;
  l record;
  m record;
begin
  if new.email_confirmed_at is null or old.email_confirmed_at is not null then return new; end if;
  begin
    select id into me from public.people where user_id = new.id order by created_at limit 1;
    if me is not null then
      for l in
        select k.company_id, k.person_id from public.customer_email_links k
          join public.people p on p.id = k.person_id and p.user_id is null
          join public.company_members cm on cm.company_id = k.company_id and cm.person_id = k.person_id and cm.role = 'customer' and cm.status = 'invited'
         where k.user_id = new.id and lower(k.email) = lower(coalesce(new.email, ''))
      loop
        select role, status into m from public.company_members where company_id = l.company_id and person_id = me;
        if found then
          if m.role <> 'customer' or m.status = 'inactive' then continue; end if;
          update public.company_members set status = 'active' where company_id = l.company_id and person_id = me and status = 'invited';
        else
          insert into public.company_members (company_id, person_id, role, status, join_method)
          values (l.company_id, me, 'customer', 'active', 'email_invitation');
        end if;
        if public._merge_placeholder_customer(l.company_id, l.person_id, me) then
          insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
          values (l.company_id, 'customer_linked_email_confirmed', me, me, jsonb_build_object('customer_record', l.person_id));
        end if;
      end loop;
    end if;
    delete from public.customer_email_links where user_id = new.id;
  exception when others then
    raise warning 'customer link on email confirm failed: %', sqlerrm;
  end;
  return new;
end;
$function$;

create or replace function public._my_owned_company()
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select company_id from public.company_members
  where person_id = public.my_person_id() and role = 'owner' and status = 'active'
  order by created_at limit 1
$function$;

create or replace function public._my_owned_or_staff_company()
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select company_id from public.company_members where person_id = public.my_person_id() and role in ('owner', 'admin') and status = 'active' order by created_at limit 1
$function$;

create or replace function public._my_staff_company()
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select m.company_id from public.company_members m
  where m.person_id = public.my_person_id() and m.role in ('owner','admin') and m.status = 'active'
  order by m.created_at limit 1
$function$;

-- Who may create an in-app notice (each one is also sent as a phone push). The recipient must be an ACTIVE member of the same
-- company. Owner/admin: any notice. Worker: only the worker notices, only to the owner/admins. Customer: only customer_message
-- and customer_request_submitted, only to the owner/admins. Notices made inside database functions are not limited by this.
create or replace function public._notification_insert_allowed(cid uuid, recipient uuid, ev text)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  my_role text := public.member_role(cid);   -- null unless I am an ACTIVE member of this company
  to_role text;
begin
  if my_role is null or recipient is null or ev is null then return false; end if;
  select role into to_role from public.company_members
   where company_id = cid and person_id = recipient and status = 'active'
   limit 1;
  if to_role is null then return false; end if;                        -- the recipient must be an active member of this company
  if my_role in ('owner', 'admin') then return true; end if;           -- owner/admin: any notice
  if to_role not in ('owner', 'admin') then return false; end if;      -- workers and customers only ever notify the owner/admins
  if my_role = 'worker' then
    return ev in ('worker_checked_in', 'worker_checked_in_late', 'worker_checked_out', 'worker_completed_task', 'photo_waiting_review');
  end if;
  if my_role = 'customer' then
    return ev in ('customer_message', 'customer_request_submitted');
  end if;
  return false;
end;
$function$;

create or replace function public._project_tasks_progress()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_op = 'DELETE' then perform public._recompute_project_progress(old.project_id);
  else perform public._recompute_project_progress(new.project_id); end if;
  return null;
end;
$function$;

create or replace function public._properties_before_write()
 returns trigger
 language plpgsql
as $function$
begin
  new.address_key := public.normalize_address(new.address, new.city, new.state, new.zip);
  new.updated_at := now();
  return new;
end;
$function$;

create or replace function public._property_address_follows()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if (new.address, new.city, new.state, new.zip, new.latitude, new.longitude)
     is distinct from (old.address, old.city, old.state, old.zip, old.latitude, old.longitude) then
    update public.projects set address = new.address, city = new.city, state = new.state, zip = new.zip,
           latitude = new.latitude, longitude = new.longitude where property_id = new.id;
  end if;
  return new;
end;
$function$;

create or replace function public._property_issues_notify()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  staff record;
  who text;
  label text;
begin
  select nullif(trim(concat_ws(' ', first_name, last_name)), '') into who from public.people where id = new.reported_by;
  label := case new.issue_type
    when 'tree_down' then 'Tree down'
    when 'damage' then 'Damage'
    when 'safety' then 'Safety hazard'
    when 'equipment' then 'Equipment problem'
    when 'customer_request' then 'Customer request'
    else 'Problem reported'
  end;
  for staff in
    select person_id from public.company_members
     where company_id = new.company_id and role in ('owner', 'admin') and status = 'active'
       and person_id is distinct from new.reported_by
  loop
    insert into public.app_notifications (company_id, recipient_id, event_type, title, body, linked_entity_type, linked_entity_id)
    values (new.company_id, staff.person_id, 'issue_reported',
            label || case when new.place_name <> '' then ' · ' || new.place_name else '' end,
            concat_ws(' · ', case when who is not null then 'By ' || who end, left(nullif(trim(coalesce(new.notes, '')), ''), 140)),
            'issue', new.id::text);
  end loop;
  return null;
end;
$function$;

create or replace function public._property_issues_touch()
 returns trigger
 language plpgsql
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

create or replace function public._property_link_guard()
 returns trigger
 language plpgsql
as $function$
declare prop record; cust uuid;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if new.property_id is not null and (tg_op = 'INSERT' or new.property_id is distinct from old.property_id) then
    select pr.company_id, pr.customer_id into prop from public.properties pr where pr.id = new.property_id;
    if not found or prop.company_id is distinct from new.company_id then
      raise exception 'That job site belongs to a different company.';
    end if;
    if tg_table_name = 'projects' then
      cust := new.customer_id;
      if cust is not null and prop.customer_id is distinct from cust then
        raise exception 'That job site belongs to a different customer.';
      end if;
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public._property_staff_company()
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select m.company_id from public.company_members m
   where m.person_id = public.my_person_id() and m.role in ('owner', 'admin') and m.status = 'active'
   order by m.created_at limit 1
$function$;

create or replace function public._recompute_project_progress(p_project uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  total integer; done integer; working integer; est integer; auto boolean; st text;
begin
  select status into st from public.projects where id = p_project;
  if not found or st in ('completed', 'cancelled') then return; end if;
  select coalesce((select s.auto_progress from public.project_settings s where s.project_id = p_project), true) into auto;
  if not auto then return; end if;
  select count(*), count(*) filter (where status = 'completed'), count(*) filter (where status = 'in_progress')
    into total, done, working from public.project_tasks where project_id = p_project;
  if total = 0 then return; end if;
  est := least(99, round(100.0 * (done + 0.5 * working) / total)::integer);
  update public.projects set progress = est where id = p_project and progress is distinct from est;
end;
$function$;

create or replace function public._team_manager_company()
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select m.company_id from public.company_members m
  where m.person_id = public.my_person_id() and m.role in ('owner', 'admin') and m.status = 'active' and public.admin_can(m.company_id, 'team')
  order by m.created_at limit 1
$function$;

create or replace function public._time_alert(p_company uuid, p_kind text, p_key text, p_person uuid, p_workday uuid, p_visit uuid, p_skip uuid, p_title text, p_detail text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n integer;
begin
  insert into public.time_alerts (company_id, kind, person_id, workday_id, visit_id, skip_request_id, title, detail, dedupe_key)
  values (p_company, p_kind, p_person, p_workday, p_visit, p_skip, p_title, p_detail, p_key)
  on conflict (dedupe_key) do nothing;
  get diagnostics n = row_count;
  return n > 0;
end;
$function$;

create or replace function public._time_any_work_count(p_person uuid, p_company uuid, p_date date)
 returns integer
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select count(*)::integer from public.assignments a
   where a.person_id = p_person and a.company_id = p_company and a.scheduled_date = p_date and a.status not in ('cancelled', 'reassigned')
$function$;

create or replace function public._time_assigned_truck(p_person uuid, p_date date)
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select a.truck_id from public.assignments a
   where a.person_id = p_person and a.scheduled_date = p_date and a.truck_id is not null and a.status not in ('cancelled', 'reassigned')
   order by a.sort_order, a.created_at limit 1
$function$;

create or replace function public._time_audit(p_company uuid, p_entity text, p_entity_id uuid, p_person uuid, p_workday uuid, p_visit uuid, p_action text, p_field text, p_old jsonb, p_new jsonb, p_reason text, p_was_approved boolean)
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  insert into public.time_audit (company_id, entity, entity_id, person_id, workday_id, visit_id, action, field, old_value, new_value, reason, actor_id, was_approved)
  values (p_company, p_entity, p_entity_id, p_person, p_workday, p_visit, p_action, p_field, p_old, p_new, p_reason, public.my_person_id(), coalesce(p_was_approved, false))
$function$;

create or replace function public._time_audit_immutable()
 returns trigger
 language plpgsql
as $function$
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; end if;
    if (to_jsonb(new) - 'person_id' - 'actor_id') = (to_jsonb(old) - 'person_id' - 'actor_id')
       and (new.person_id is null or new.person_id = old.person_id) and (new.actor_id is null or new.actor_id = old.actor_id) then
      return new;
    end if;
  end if;
  raise exception 'The time history can''t be changed or deleted.';
end;
$function$;

create or replace function public._time_auto_close_after_assignment()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform public._time_try_auto_close(new.person_id);
  return new;
end;
$function$;

create or replace function public._time_auto_close_after_end()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.ended_at is not null and old.ended_at is null then
    perform public._time_try_auto_close(new.person_id);
  end if;
  return new;
end;
$function$;

create or replace function public._time_blocking_stop(p_source text, p_ref uuid, p_person uuid)
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare a public.assignments; r text;
begin
  select * into a from public.assignments where id = p_ref;
  select (select pr.name from public.projects pr where pr.id = e.project_id) into r
    from public.assignments e
   where e.person_id = a.person_id and e.scheduled_date = a.scheduled_date and e.id <> a.id
     and e.status not in ('completed', 'cancelled', 'reassigned')
     and (e.is_full_day, coalesce(e.start_time, ''), e.sort_order, e.created_at) < (a.is_full_day, coalesce(a.start_time, ''), a.sort_order, a.created_at)
   order by e.is_full_day, coalesce(e.start_time, ''), e.sort_order, e.created_at limit 1;
  return r;
end;
$function$;

create or replace function public._time_check_break()
 returns trigger
 language plpgsql
as $function$
declare wd record;
begin
  if new.ended_at is not null and new.ended_at < new.started_at then
    raise exception 'A break can''t end before it starts.';
  end if;
  if exists (
    select 1 from public.time_breaks o
    where o.workday_id = new.workday_id and o.id <> new.id
      and new.started_at < coalesce(o.ended_at, 'infinity'::timestamptz)
      and coalesce(new.ended_at, 'infinity'::timestamptz) > o.started_at
  ) then
    raise exception 'Breaks can''t overlap each other.';
  end if;
  select clock_in_at, clock_out_at into wd from public.time_workdays where id = new.workday_id;
  if wd is null then raise exception 'Workday not found.'; end if;
  if new.started_at < wd.clock_in_at or (wd.clock_out_at is not null and (new.ended_at is null or new.ended_at > wd.clock_out_at or new.started_at > wd.clock_out_at)) then
    raise exception 'A break has to fall inside the workday.';
  end if;
  if exists (
    select 1 from public.time_intervals i
    where i.workday_id = new.workday_id and i.status <> 'void'
      and new.started_at < coalesce(i.ended_at, 'infinity'::timestamptz)
      and coalesce(new.ended_at, 'infinity'::timestamptz) > i.started_at
  ) then
    raise exception 'That break overlaps time at a job. Correct the job time first.';
  end if;
  return new;
end;
$function$;

create or replace function public._time_check_interval()
 returns trigger
 language plpgsql
as $function$
declare wd record;
begin
  if new.ended_at is not null and new.ended_at < new.started_at then
    raise exception 'A job visit can''t end before it starts.';
  end if;
  if new.status <> 'void' then
    new.status := case when new.ended_at is null then 'active' else 'completed' end;
  end if;
  if new.status <> 'void' then
    if exists (
      select 1 from public.time_intervals o
      where o.person_id = new.person_id and o.id <> new.id and o.status <> 'void'
        and new.started_at < coalesce(o.ended_at, 'infinity'::timestamptz)
        and coalesce(new.ended_at, 'infinity'::timestamptz) > o.started_at
    ) then
      raise exception 'That overlaps another job visit for the same person.';
    end if;
    select clock_in_at, clock_out_at, person_id, company_id into wd from public.time_workdays where id = new.workday_id;
    if wd is null then raise exception 'Workday not found.'; end if;
    if wd.person_id <> new.person_id or wd.company_id <> new.company_id then
      raise exception 'That job time doesn''t belong to this workday.';
    end if;
    if new.started_at < wd.clock_in_at or (wd.clock_out_at is not null and (new.ended_at is null or new.ended_at > wd.clock_out_at or new.started_at > wd.clock_out_at)) then
      raise exception 'A job visit has to fall inside the workday.';
    end if;
    -- A break is not job time: the two can't overlap (otherwise a property would be charged for the employee's break).
    if exists (
      select 1 from public.time_breaks b
      where b.workday_id = new.workday_id
        and new.started_at < coalesce(b.ended_at, 'infinity'::timestamptz)
        and coalesce(new.ended_at, 'infinity'::timestamptz) > b.started_at
    ) then
      raise exception 'That overlaps a break. Correct the break first.';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public._time_check_same_company()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_table_name = 'time_property_targets' then
    if new.project_id is not null and not exists (select 1 from public.projects p where p.id = new.project_id and p.company_id = new.company_id) then
      raise exception 'That job belongs to another company.';
    end if;
  elsif tg_table_name = 'time_person_settings' then
    if not exists (select 1 from public.company_members m where m.person_id = new.person_id and m.company_id = new.company_id) then
      raise exception 'That person is not on this company''s team.';
    end if;
  elsif tg_table_name = 'time_project_estimates' then
    if not exists (select 1 from public.projects p where p.id = new.project_id and p.company_id = new.company_id) then
      raise exception 'That job belongs to another company.';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public._time_check_workday()
 returns trigger
 language plpgsql
as $function$
begin
  if new.clock_out_at is not null and new.clock_out_at < new.clock_in_at then
    raise exception 'The clock-out can''t be before the clock-in.';
  end if;
  if new.truck_id is not null and not exists (select 1 from public.trucks t where t.id = new.truck_id and t.company_id = new.company_id) then
    raise exception 'That truck belongs to another company.';
  end if;
  if not exists (select 1 from public.company_members m where m.company_id = new.company_id and m.person_id = new.person_id) then
    raise exception 'That person is not on this company''s team.';
  end if;
  if exists (
    select 1 from public.time_workdays o
    where o.person_id = new.person_id and o.id <> new.id
      and new.clock_in_at < coalesce(o.clock_out_at, 'infinity'::timestamptz)
      and coalesce(new.clock_out_at, 'infinity'::timestamptz) > o.clock_in_at
  ) then
    raise exception 'That overlaps another workday for the same person.';
  end if;
  -- Everything recorded inside the day must still fit inside it (except while a stale day is being flagged).
  if tg_op = 'UPDATE' and coalesce(current_setting('app.time_flagging', true), '') <> 'on'
     and (new.clock_in_at is distinct from old.clock_in_at or new.clock_out_at is distinct from old.clock_out_at) then
    if exists (select 1 from public.time_intervals i where i.workday_id = new.id and i.status <> 'void'
                 and (i.started_at < new.clock_in_at or (new.clock_out_at is not null and coalesce(i.ended_at, new.clock_out_at + interval '1 second') > new.clock_out_at))) then
      raise exception 'A job visit in this workday falls outside those times. Correct the visit first.';
    end if;
    if exists (select 1 from public.time_breaks b where b.workday_id = new.id
                 and (b.started_at < new.clock_in_at or (new.clock_out_at is not null and coalesce(b.ended_at, new.clock_out_at + interval '1 second') > new.clock_out_at))) then
      raise exception 'A break in this workday falls outside those times. Correct the break first.';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public._time_company(p_person uuid)
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select company_id from public.company_members
  where person_id = p_person and status = 'active' and role in ('owner', 'admin', 'worker')
  order by created_at limit 1
$function$;

create or replace function public._time_day_json(p_person uuid, p_company uuid, p_date date)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  st public.time_settings := public._time_settings_row(p_company);
  days jsonb;
  cur jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', w.id, 'work_date', w.work_date, 'clock_in_at', w.clock_in_at, 'clock_out_at', w.clock_out_at, 'status', w.status,
      'flagged_at', w.flagged_at, 'claimed_out_at', w.claimed_out_at, 'claim_note', w.claim_note, 'claimed_at', w.claimed_at,
      'truck', case when w.truck_id is null then null else jsonb_build_object('id', w.truck_id, 'name', (select t.name from public.trucks t where t.id = w.truck_id), 'source', w.truck_source) end,
      'breaks', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'started_at', b.started_at, 'ended_at', b.ended_at, 'paid', b.paid) order by b.started_at)
                          from public.time_breaks b where b.workday_id = w.id), '[]'::jsonb)
    ) order by w.clock_in_at), '[]'::jsonb)
    into days
  from public.time_workdays w
  where w.person_id = p_person and (w.work_date = p_date or w.clock_out_at is null or w.status = 'needs_review');

  select jsonb_build_object('interval_id', i.id, 'visit_id', i.visit_id, 'started_at', i.started_at, 'workday_id', i.workday_id,
                            'source', v.source, 'project_id', v.project_id, 'label', v.label)
    into cur
  from public.time_intervals i join public.time_visits v on v.id = i.visit_id
  where i.person_id = p_person and i.ended_at is null and i.status = 'active' limit 1;

  return jsonb_build_object(
    'server_now', now(),
    'work_date', p_date,
    'can_clock_in', public._time_may_clock_in(p_person, p_company, p_date),
    'has_open_work', public._time_open_work_count(p_person, p_company, p_date) > 0,
    'settings', jsonb_build_object('breaks_enabled', st.breaks_enabled, 'require_start_photo', st.require_start_photo, 'require_complete_photo', st.require_complete_photo,
                                   'stale_after_hours', st.open_workday_hours),
    'days', days,
    'current', cur
  );
end;
$function$;

create or replace function public._time_flag_company(p_company uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record; n integer := 0;
begin
  for r in select distinct person_id from public.time_workdays where company_id = p_company and clock_out_at is null and status <> 'needs_review' loop
    n := n + public._time_flag_stale(r.person_id, p_company);
  end loop;
  return n;
end;
$function$;

create or replace function public._time_flag_stale(p_person uuid, p_company uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  st public.time_settings := public._time_settings_row(p_company);
  w public.time_workdays;
  n integer := 0;
  i record;
  b record;
  who text;
  why text;
begin
  for w in
    select * from public.time_workdays
     where person_id = p_person and company_id = p_company and clock_out_at is null and status <> 'needs_review'
       and (clock_in_at < now() - make_interval(secs => (st.open_workday_hours * 3600)::integer)
            or public._time_past_midnight(clock_in_at, p_company))
     for update
  loop
    why := 'No clock-out was recorded by midnight. Counts as zero hours until the real end time is set.';
    for i in select * from public.time_intervals where workday_id = w.id and ended_at is null and status = 'active' for update loop
      update public.time_intervals set ended_at = i.started_at where id = i.id;
      if i.legacy_session_id is not null then
        update public.work_sessions set check_out_time = i.started_at, duration_minutes = 0, status = 'corrected' where id = i.legacy_session_id;
      end if;
      perform public._time_refresh_visit(i.visit_id);
      perform public._time_audit(w.company_id, 'interval', i.id, w.person_id, w.id, i.visit_id, 'flagged', 'ended_at', null, to_jsonb(i.started_at),
                                 'Never stopped. Closed at zero length until the owner decides the real time.', false);
    end loop;
    for b in select * from public.time_breaks where workday_id = w.id and ended_at is null loop
      update public.time_breaks set ended_at = b.started_at where id = b.id;
    end loop;
    perform set_config('app.time_flagging', 'on', true);
    update public.time_workdays
       set clock_out_at = clock_in_at, status = 'needs_review', flagged_at = now(), flagged_reason = why
     where id = w.id;
    perform set_config('app.time_flagging', '', true);
    perform public._time_audit(w.company_id, 'workday', w.id, w.person_id, w.id, null, 'flagged', 'status', to_jsonb(w.status), to_jsonb('needs_review'::text), why, false);
    select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) into who from public.people where id = p_person;
    perform public._time_notify_staff(p_company, 'time_unusual', 'Needs your OK: no clock-out',
      coalesce(nullif(who, ''), 'An employee') || ' never clocked out of the workday that started ' || to_char(w.clock_in_at at time zone public._time_tz(p_company), 'Mon DD HH12:MI AM')
        || '. It counts as zero hours until you accept an end time.',
      'time_workday', w.id);
    n := n + 1;
  end loop;
  return n;
end;
$function$;

create or replace function public._time_may_clock_in(p_person uuid, p_company uuid, p_date date)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select true
$function$;

create or replace function public._time_need_staff(p_company uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if p_company is null or not public.is_staff(p_company) then raise exception 'Only the owner can do that.'; end if;
  if not public.admin_can(p_company, 'time_corrections') then raise exception 'The owner has not allowed admins to correct time.'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Enter a reason for this change.'; end if;
end;
$function$;

create or replace function public._time_net_ms(p_workday uuid)
 returns bigint
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select (extract(epoch from (coalesce(w.clock_out_at, now()) - w.clock_in_at)) * 1000)::bigint
         - coalesce((select sum(extract(epoch from (coalesce(b.ended_at, now()) - b.started_at)) * 1000)::bigint
                     from public.time_breaks b where b.workday_id = w.id and not b.paid), 0)
  from public.time_workdays w where w.id = p_workday
$function$;

create or replace function public._time_no_future(p_at timestamp with time zone)
 returns void
 language plpgsql
as $function$
begin
  if p_at is not null and p_at > now() + interval '1 minute' then raise exception 'That time is in the future.'; end if;
end;
$function$;

create or replace function public._time_notify_staff(p_company uuid, p_event text, p_title text, p_body text, p_type text, p_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into public.app_notifications (company_id, recipient_id, event_type, title, body, linked_entity_type, linked_entity_id)
  select p_company, m.person_id, p_event, p_title, p_body, p_type, p_id::text
  from public.company_members m where m.company_id = p_company and m.role in ('owner', 'admin') and m.status = 'active';
end;
$function$;

create or replace function public._time_open_work_count(p_person uuid, p_company uuid, p_date date)
 returns integer
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select count(*)::integer from public.assignments a
   where a.person_id = p_person and a.company_id = p_company and a.scheduled_date = p_date
     and a.status in ('scheduled', 'confirmed', 'en_route', 'checked_in', 'working')
$function$;

create or replace function public._time_past_midnight(p_clock_in timestamp with time zone, p_company uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select (p_clock_in at time zone public._time_tz(p_company))::date < (now() at time zone public._time_tz(p_company))::date
$function$;

create or replace function public._time_rate(p_company uuid, p_person uuid, p_date date)
 returns numeric
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select r.hourly_rate from public.worker_hourly_rates r
  where r.company_id = p_company and r.person_id = p_person and r.effective_date <= p_date
    and (r.end_date is null or r.end_date >= p_date)
  order by r.effective_date desc, r.created_at desc limit 1
$function$;

create or replace function public._time_refresh_visit(p_visit uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare s timestamptz; e timestamptz; open_n integer; any_n integer;
begin
  select min(started_at), max(ended_at), count(*) filter (where ended_at is null), count(*)
    into s, e, open_n, any_n
  from public.time_intervals where visit_id = p_visit and status <> 'void';
  update public.time_visits
     set started_at = s,
         ended_at = case when open_n > 0 or any_n = 0 then null else e end,
         status = case when any_n = 0 then 'void' when open_n > 0 then 'in_progress' else 'completed' end
   where id = p_visit;
end;
$function$;

create or replace function public._time_same_group(p_a uuid, p_b uuid, p_date date)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.assignments a join public.assignments b on b.project_id = a.project_id and b.scheduled_date = a.scheduled_date
    where a.person_id = p_a and b.person_id = p_b and a.scheduled_date = p_date
      and a.status not in ('cancelled', 'reassigned') and b.status not in ('cancelled', 'reassigned')
  )
$function$;

-- A workday is at most 24 hours, and its clock-in must fall on (or next to) its date as read in the COMPANY's time zone
-- (time_settings.timezone), so a late-evening clock-in is not mistaken for the next day.
create or replace function public._time_sane_workday(p_work_date date, p_in timestamp with time zone, p_out timestamp with time zone, p_company uuid)
 returns void
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if p_out is not null and p_out - p_in > interval '24 hours' then
    raise exception 'A workday can''t be longer than 24 hours. Check the clock-in and clock-out times.';
  end if;
  if abs((p_in at time zone public._time_tz(p_company))::date - p_work_date) > 1 then
    raise exception 'That clock-in is not on the workday''s date (%). Check the date and the time.', p_work_date;
  end if;
end;
$function$;

create or replace function public._time_scan(p_company uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  st public.time_settings := public._time_settings_row(p_company);
  w record; v record; n integer := 0; name_ text; hrs numeric; thr numeric; crew record;
begin
  -- A "still clocked in" alert is closed by itself once the workday has a clock-out (the owner fixed it, or the employee clocked out).
  update public.time_alerts a set status = 'resolved', resolved_at = now()
   where a.company_id = p_company and a.kind = 'open_workday' and a.status = 'open'
     and exists (select 1 from public.time_workdays x where x.id = a.workday_id and x.clock_out_at is not null);

  -- A workday left open far too long (probably a forgotten clock-out).
  for w in select * from public.time_workdays where company_id = p_company and clock_out_at is null
                 and clock_in_at < now() - make_interval(secs => (st.open_workday_hours * 3600)::integer) loop
    select first_name || ' ' || last_name into name_ from public.people where id = w.person_id;
    if public._time_alert(p_company, 'open_workday', 'open_workday:' || w.id, w.person_id, w.id, null, null,
                          'Still clocked in: ' || coalesce(name_, 'an employee'),
                          'Clocked in more than ' || st.open_workday_hours || ' hours ago with no clock-out. Needs review.') then
      perform public._time_notify_staff(p_company, 'time_unusual', 'Needs review: still clocked in', coalesce(name_, 'An employee') || ' has been clocked in for over ' || st.open_workday_hours || ' hours.', 'time_workday', w.id);
      n := n + 1;
    end if;
  end loop;

  -- Property visits that run unusually long, or past the owner's target.
  for v in select tv.*, (extract(epoch from (coalesce(tv.ended_at, now()) - tv.started_at)) / 60.0) as mins_
             from public.time_visits tv where tv.company_id = p_company and tv.status <> 'void' and tv.started_at is not null
              and tv.visit_date >= current_date - 1 loop
    if v.mins_ > st.long_visit_hours * 60 then
      if public._time_alert(p_company, 'long_visit', 'long_visit:' || v.id, null, null, v.id, null,
                            'Unusually long visit: ' || coalesce(v.label, 'a property'),
                            'This visit has run longer than ' || st.long_visit_hours || ' hours. Needs review.') then
        perform public._time_notify_staff(p_company, 'time_unusual', 'Unusual duration: ' || coalesce(v.label, 'a property'), 'Longer than ' || st.long_visit_hours || ' hours.', 'time_visit', v.id);
        n := n + 1;
      end if;
    end if;
    if st.target_alerts_enabled and v.status = 'in_progress' and v.target_minutes is not null and v.mins_ > v.target_minutes then
      if public._time_alert(p_company, 'over_target', 'over_target:' || v.id, null, null, v.id, null,
                            'Over target: ' || coalesce(v.label, 'a property'),
                            'Past the ' || v.target_minutes || '-minute target.') then
        perform public._time_notify_staff(p_company, 'time_over_target', 'Over target: ' || coalesce(v.label, 'a property'), 'This visit passed its ' || v.target_minutes || '-minute target.', 'time_visit', v.id);
        if st.target_notify_crew then
          -- A neutral prompt only: no target, average or estimate is shown to the crew.
          for crew in select distinct person_id from public.time_intervals where visit_id = v.id and ended_at is null and status = 'active' loop
            insert into public.app_notifications (company_id, recipient_id, event_type, title, body, linked_entity_type, linked_entity_id)
            values (p_company, crew.person_id, 'time_progress_check', 'Check your progress', 'Take a moment to check how the work at ' || coalesce(v.label, 'this property') || ' is going.', 'time_visit', v.id::text);
          end loop;
        end if;
        n := n + 1;
      end if;
    end if;
  end loop;

  -- Daily overtime alerts (the owner's per-employee alert hours; not the formal overtime rule). One total per person per date, across every
  -- session of that date. The alert is filed under the person's FIRST session of the date, so a one-session day keeps its existing key.
  if st.overtime_alerts_enabled then
    for w in select (array_agg(ws.id order by ws.clock_in_at))[1] as id, ws.person_id, ps.daily_alert_hours,
                    sum(public._time_net_ms(ws.id)) as ms
               from public.time_workdays ws join public.time_person_settings ps on ps.person_id = ws.person_id and ps.company_id = ws.company_id
              where ws.company_id = p_company and ps.daily_alert_hours is not null and ws.work_date >= current_date - 1
              group by ws.person_id, ws.work_date, ps.daily_alert_hours loop
      hrs := w.ms / 3600000.0;
      thr := w.daily_alert_hours;
      select first_name || ' ' || last_name into name_ from public.people where id = w.person_id;
      if hrs >= thr then
        if public._time_alert(p_company, 'overtime_reached', 'ot_reached:' || w.id, w.person_id, w.id, null, null,
                              'Daily alert hours reached: ' || coalesce(name_, 'an employee'), round(hrs, 2) || ' payable hours against ' || thr || '.') then
          perform public._time_notify_staff(p_company, 'time_overtime', 'Daily alert hours reached', coalesce(name_, 'An employee') || ' has reached ' || thr || ' hours today.', 'time_workday', w.id);
          n := n + 1;
        end if;
      elsif hrs >= thr * st.approach_percent / 100.0 then
        if public._time_alert(p_company, 'overtime_approaching', 'ot_approach:' || w.id, w.person_id, w.id, null, null,
                              'Approaching daily alert hours: ' || coalesce(name_, 'an employee'), round(hrs, 2) || ' of ' || thr || ' payable hours.') then
          perform public._time_notify_staff(p_company, 'time_overtime', 'Approaching daily alert hours', coalesce(name_, 'An employee') || ' is at ' || round(hrs, 1) || ' of ' || thr || ' hours.', 'time_workday', w.id);
          n := n + 1;
        end if;
      end if;
    end loop;
  end if;
  return n;
end;
$function$;

create or replace function public._time_settings_audit()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_table_name = 'time_settings' then
    perform public._time_audit(new.company_id, 'settings', null, null, null, null, case when tg_op = 'INSERT' then 'settings_created' else 'settings_changed' end, 'time_settings',
                               case when tg_op = 'INSERT' then null else to_jsonb(old) - 'updated_at' - 'updated_by' end, to_jsonb(new) - 'updated_at' - 'updated_by', null, false);
  else
    perform public._time_audit(new.company_id, 'target', new.id, null, null, null, case when tg_op = 'INSERT' then 'target_set' else 'target_changed' end, 'target_minutes',
                               case when tg_op = 'INSERT' then null else to_jsonb(old.target_minutes) end, to_jsonb(new.target_minutes), null, false);
  end if;
  return null;
end;
$function$;

create or replace function public._time_settings_row(p_company uuid)
 returns public.time_settings
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare s public.time_settings;
begin
  select * into s from public.time_settings where company_id = p_company;
  if not found then
    s.company_id := p_company; s.breaks_enabled := false; s.breaks_paid := true; s.require_start_photo := false;
    s.require_complete_photo := false; s.target_alerts_enabled := false; s.target_notify_crew := false;
    s.overtime_alerts_enabled := false; s.approach_percent := 90; s.long_visit_hours := 6; s.open_workday_hours := 14;
  end if;
  return s;
end;
$function$;

create or replace function public._time_skip_decided()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.status <> 'pending' and old.status = 'pending' then
    update public.time_alerts set status = 'resolved', resolved_at = now(), resolved_by = new.decided_by where skip_request_id = new.id and status = 'open';
  end if;
  return null;
end;
$function$;

create or replace function public._time_skip_requested()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare who text; what text;
begin
  select first_name || ' ' || last_name into who from public.people where id = new.requested_by;
  select coalesce((select pr.name from public.assignments a join public.projects pr on pr.id = a.project_id where a.id = new.assignment_id), 'a job') into what;
  if public._time_alert(new.company_id, 'skip_request', 'skip:' || new.id, new.requested_by, null, null, new.id, 'Skip requested: ' || what, coalesce(who, 'A worker') || ': ' || new.reason) then
    perform public._time_notify_staff(new.company_id, 'time_skip_request', 'Skip requested: ' || what, coalesce(who, 'A worker') || ': ' || new.reason, 'time_skip', new.id);
  end if;
  return null;
end;
$function$;

create or replace function public._time_suggest_end(p_workday uuid)
 returns table(suggested_at timestamp with time zone, source text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare w public.time_workdays; a timestamptz; b timestamptz; best timestamptz; src text;
begin
  select * into w from public.time_workdays where id = p_workday;
  if not found then return; end if;
  select max(i.ended_at) into a from public.time_intervals i where i.workday_id = w.id and i.status <> 'void' and i.ended_at > w.clock_in_at;
  select max(x.ended_at) into b from public.time_breaks x where x.workday_id = w.id and x.ended_at > w.clock_in_at;
  best := greatest(a, b);
  if best is not null then
    src := case when best = a then 'last_visit' else 'last_break' end;
  elsif w.claimed_out_at is not null and w.claimed_out_at > w.clock_in_at then
    best := w.claimed_out_at; src := 'worker_said';
  end if;
  if best is not null and best > w.clock_in_at and best <= now() then
    suggested_at := best; source := src; return next;
  end if;
end;
$function$;

create or replace function public._time_touch_approval(p_workday uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare was boolean;
begin
  select status = 'approved' into was from public.time_workdays where id = p_workday;
  if coalesce(was, false) then update public.time_workdays set status = 'reopened' where id = p_workday; end if;
  return coalesce(was, false);
end;
$function$;

create or replace function public._time_try_auto_close(p_person uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  w public.time_workdays;
  st public.time_settings;
begin
  if p_person is null then return false; end if;
  select * into w from public.time_workdays where person_id = p_person and clock_out_at is null and status = 'active' for update;
  if not found then return false; end if;
  st := public._time_settings_row(w.company_id);
  if w.clock_in_at < now() - make_interval(secs => (st.open_workday_hours * 3600)::integer) then return false; end if;
  if public._time_past_midnight(w.clock_in_at, w.company_id) then return false; end if;
  if exists (select 1 from public.time_intervals i where i.person_id = p_person and i.ended_at is null and i.status = 'active') then return false; end if;
  if exists (select 1 from public.time_breaks b where b.workday_id = w.id and b.ended_at is null) then return false; end if;
  if public._time_any_work_count(p_person, w.company_id, w.work_date) = 0 then return false; end if;
  if public._time_open_work_count(p_person, w.company_id, w.work_date) > 0 then return false; end if;
  update public.time_workdays set clock_out_at = greatest(now(), clock_in_at), status = 'closed' where id = w.id;
  perform public._time_audit(w.company_id, 'workday', w.id, w.person_id, w.id, null, 'auto_clock_out', 'clock_out_at', null, to_jsonb(now()),
                             'Closed automatically: the last stop of the day was finished.', false);
  return true;
end;
$function$;

create or replace function public._time_tz(p_company uuid)
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce((select s.timezone from public.time_settings s where s.company_id = p_company), 'America/New_York')
$function$;

create or replace function public._try_uuid(t text)
 returns uuid
 language plpgsql
 immutable
as $function$
begin
  return t::uuid;
exception when others then
  return null;
end $function$;

create or replace function public._yard_distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
 returns integer
 language sql
 immutable
as $function$
  select round(2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )))::integer
$function$;

create or replace function public._yard_owner_company()
 returns uuid
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare me uuid := public.my_person_id(); cid uuid;
begin
  if me is null then raise exception 'Only the owner can do that.'; end if;
  select m.company_id into cid from public.company_members m where m.person_id = me and m.role = 'owner' and m.status = 'active' limit 1;
  if cid is null then raise exception 'Only the owner can do that.'; end if;
  return cid;
end;
$function$;

create or replace function public.add_customer(p_first text, p_last text, p_email text default ''::text, p_phone text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  cid uuid := public._my_owned_or_staff_company();
  me uuid := public.my_person_id();
  first text := trim(coalesce(p_first, ''));
  last text := trim(coalesce(p_last, ''));
  mail text := lower(trim(coalesce(p_email, '')));
  phone text := nullif(trim(coalesce(p_phone, '')), '');
  m record;
  acct record;
  wait_uid uuid;
  pid uuid;
begin
  if cid is null then raise exception 'Only the owner or an admin can add customers.'; end if;
  if first = '' then raise exception 'Enter a first name.'; end if;
  if mail <> '' and mail !~ '^\S+@\S+\.\S+$' then raise exception 'That email address does not look right.'; end if;

  if mail <> '' then
    -- Already someone in THIS company with this email?
    select p.id as person_id, cm.role, cm.status, cm.deactivated_by into m
      from public.people p join public.company_members cm on cm.person_id = p.id and cm.company_id = cid
     where lower(p.email) = mail order by cm.created_at limit 1;
    if found then
      if m.role <> 'customer' then raise exception 'That email belongs to someone on your team, not a customer.'; end if;
      if m.status = 'inactive' and m.deactivated_by is not null then
        raise exception 'This customer''s access was removed earlier. Reactivate them on purpose instead of adding them again.';
      end if;
      return jsonb_build_object('person_id', m.person_id, 'outcome', 'already_customer');
    end if;

    -- R6: a login with this email is linked (that same person is reused, never a second one) ONLY when the login has CONFIRMED
    -- this email. An unconfirmed login (anyone can type someone else's email at sign-up) waits: the customer record below is made
    -- unlinked and noted in customer_email_links, and that login is linked when it confirms the email (_link_customer_on_email_confirm).
    -- This protection needs Supabase "Confirm email" ON (with it off, Supabase marks every email confirmed at sign-up).
    select p.id, (u.email_confirmed_at is not null) as confirmed, u.id as uid into acct
      from public.people p join auth.users u on u.id = p.user_id
     where lower(u.email) = mail
     order by (u.email_confirmed_at is not null) desc, p.created_at limit 1;
    if found and acct.confirmed then
      -- The login is now this company's customer, with access (as an invite link would give).
      insert into public.company_members (company_id, person_id, role, status, join_method, approved_by, approved_at)
      values (cid, acct.id, 'customer', 'active', 'email_invitation', me, now())
      on conflict (company_id, person_id) do nothing;
      return jsonb_build_object('person_id', acct.id, 'outcome', 'existing_account');
    elsif found then
      wait_uid := acct.uid;
    end if;
  end if;

  insert into public.people (email, first_name, last_name, phone) values (mail, first, last, phone) returning id into pid;
  insert into public.company_members (company_id, person_id, role, status, join_method, approved_by, approved_at)
  values (cid, pid, 'customer', 'invited', 'email_invitation', me, now());
  if wait_uid is not null then
    insert into public.customer_email_links (company_id, person_id, user_id, email, created_by)
    values (cid, pid, wait_uid, mail, me) on conflict do nothing;
    return jsonb_build_object('person_id', pid, 'outcome', 'waiting_for_email_confirmation');
  end if;
  return jsonb_build_object('person_id', pid, 'outcome', 'created');
end;
$function$;

create or replace function public.add_worker(p_first text, p_last text, p_phone text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  cid uuid := public._invite_staff_company();
  me uuid := public.my_person_id();
  first text := btrim(coalesce(p_first, ''));
  last text := btrim(coalesce(p_last, ''));
  phone text := btrim(coalesce(p_phone, ''));
  digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  pid uuid;
begin
  if cid is null then raise exception 'Only the owner (or an admin the owner allows) can add workers.'; end if;
  if first = '' then raise exception 'Enter the worker''s first name.'; end if;
  if length(digits) < 7 then raise exception 'Enter the worker''s phone number.'; end if;
  -- The same phone number twice in one company is almost certainly the same person: send that worker a new link instead.
  if exists (select 1 from public.company_members m join public.people p on p.id = m.person_id
              where m.company_id = cid and m.role = 'worker' and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = digits) then
    raise exception 'A worker with that phone number is already on your team. Open them to send a new link.';
  end if;
  insert into public.people (email, first_name, last_name, phone) values ('', first, last, phone) returning id into pid;
  insert into public.company_members (company_id, person_id, role, status, join_method, approved_by, approved_at)
  values (cid, pid, 'worker', 'invited', 'invitation_link', me, now());
  return public._invite_issue(cid, pid, 'worker', me) || jsonb_build_object('created', true);
end;
$function$;

create or replace function public.admin_can(cid uuid, perm text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case public.member_role(cid)
    when 'owner' then true
    when 'admin' then coalesce((select (to_jsonb(p) ->> perm)::boolean from public.company_admin_permissions p where p.company_id = cid), true)
    else false
  end
$function$;

create or replace function public.apply_document_response(p_type text, p_id uuid, p_approve boolean, p_note text, p_actor uuid, p_name text, p_meta jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  doc record;
  label text;
  v_note text := nullif(left(trim(coalesce(p_note, '')), 1000), '');
  v_name text := nullif(left(trim(coalesce(p_name, '')), 120), '');
  project_name text;
  staff record;
begin
  if p_type = 'quote' then
    select id, company_id, project_id, status, number, valid_until into doc from public.quotes where id = p_id for update;
    label := 'Quote';
  elsif p_type = 'change_order' then
    select id, company_id, project_id, status, number, null::date as valid_until into doc from public.change_orders where id = p_id for update;
    label := 'Change order';
  else
    return jsonb_build_object('success', false, 'error', 'invalid_type');
  end if;

  if not found then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  if doc.status <> 'sent' then
    return jsonb_build_object('success', false, 'error', 'not_open', 'status', doc.status);
  end if;
  if p_approve and doc.valid_until is not null and doc.valid_until < current_date then
    return jsonb_build_object('success', false, 'error', 'expired');
  end if;

  if p_type = 'quote' then
    if p_approve then
      update public.quotes set status = 'approved', approved_at = now(), approved_by = p_actor, approved_name = v_name where id = p_id;
    else
      update public.quotes set status = 'declined', declined_at = now(), declined_by = p_actor, decline_reason = v_note where id = p_id;
    end if;
  else
    if p_approve then
      update public.change_orders set status = 'approved', approved_at = now(), approved_by = p_actor, approved_name = v_name where id = p_id;
    else
      update public.change_orders set status = 'declined', declined_at = now(), declined_by = p_actor, decline_reason = v_note where id = p_id;
    end if;
  end if;

  insert into public.financial_events (company_id, project_id, document_type, document_id, event_type, actor_id, note, metadata)
  values (doc.company_id, doc.project_id, p_type, p_id,
          case when p_approve then 'approved' else 'declined' end, p_actor, v_note, p_meta);

  -- Alert the owner/admins (in the app, by push, and by email for these two events)
  select name into project_name from public.projects where id = doc.project_id;
  for staff in
    select person_id from public.company_members
    where company_id = doc.company_id and role in ('owner','admin') and status = 'active'
  loop
    insert into public.app_notifications (company_id, recipient_id, event_type, title, body, linked_entity_type, linked_entity_id, metadata)
    values (doc.company_id, staff.person_id,
            case when p_approve then 'quote_approved' else 'quote_declined' end,
            label || ' ' || doc.number || case when p_approve then ' approved' else ' declined' end,
            concat_ws(' · ', case when v_name is not null then 'By ' || v_name end, nullif(project_name, '')),
            p_type, p_id::text,
            jsonb_strip_nulls(jsonb_build_object('name', v_name, 'note', v_note)));
  end loop;

  return jsonb_build_object('success', true);
end;
$function$;

create or replace function public.can_see_person(pid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
$function$;

create or replace function public.can_view_resource(rid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.company_resources r
    where r.id = rid
      and (
        public.is_staff(r.company_id)
        or (
          public.member_role(r.company_id) = 'worker'
          and exists (
            select 1 from public.resource_access a
            where a.resource_id = r.id and a.person_id = public.my_person_id()
          )
        )
      )
  )
$function$;

create or replace function public.check_task_lead()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.task_lead_id is not null and new.task_lead_id is distinct from old.task_lead_id
     and not exists (
       select 1 from public.company_members
       where company_id = new.company_id and person_id = new.task_lead_id
         and status = 'active' and role = 'worker'
     ) then
    raise exception 'The Task Lead must be an active worker on your team.';
  end if;
  return new;
end;
$function$;

create or replace function public.clear_project_activity(p_project_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_dry_run boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare cid uuid; n int;
begin
  select company_id into cid from public.projects where id = p_project_id;
  if cid is null or not public.is_staff(cid) then raise exception 'Only the owner or an admin can clear a project''s activity.'; end if;
  if p_dry_run then
    select count(*) into n from public.project_history h
     where h.project_id = p_project_id and (p_from is null or h.created_at >= p_from) and (p_to is null or h.created_at < p_to);
    return jsonb_build_object('count', n, 'dry_run', true);
  end if;
  delete from public.project_history h
   where h.project_id = p_project_id and (p_from is null or h.created_at >= p_from) and (p_to is null or h.created_at < p_to);
  get diagnostics n = row_count;
  return jsonb_build_object('count', n, 'dry_run', false);
end;
$function$;

create or replace function public.company_closure_preview()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare me uuid := public.my_person_id(); cid uuid;
begin
  select company_id into cid from public.company_members where person_id = me and role = 'owner' and status = 'active' limit 1;
  if cid is null then raise exception 'Only the company owner can do that.'; end if;
  return jsonb_build_object(
    'on_the_clock', (select count(*) from public.time_workdays where company_id = cid and clock_out_at is null),
    'timing_a_property', (select count(*) from public.time_intervals where company_id = cid and ended_at is null and status = 'active'),
    'days_awaiting_approval', (select count(*) from public.time_workdays where company_id = cid and status in ('closed', 'reopened')),
    'pending_join_requests', (select count(*) from public.join_requests where company_id = cid and status = 'pending'),
    'open_codes', (select count(*) from public.team_codes where company_id = cid and is_active),
    'team_members', (select count(*) from public.company_members where company_id = cid and status = 'active')
  );
end;
$function$;

create or replace function public.company_resources_audit()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.resource_audit_log (company_id, resource_id, resource_name, actor_id, event_type, metadata)
    values (new.company_id, new.id, new.name, public.my_person_id(), 'created', jsonb_build_object('category', new.category));
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.name, new.category, new.description, new.truck_id, new.item_name, new.card_last_four, new.card_holder_id)
       is distinct from
       (old.name, old.category, old.description, old.truck_id, old.item_name, old.card_last_four, old.card_holder_id) then
      insert into public.resource_audit_log (company_id, resource_id, resource_name, actor_id, event_type)
      values (new.company_id, new.id, new.name, public.my_person_id(), 'updated');
    end if;
    return new;
  else
    -- Skip when the whole company is being wiped (reset script).
    if exists (select 1 from public.companies where id = old.company_id) then
      insert into public.resource_audit_log (company_id, resource_id, resource_name, actor_id, event_type)
      values (old.company_id, old.id, old.name, public.my_person_id(), 'deleted');
    end if;
    return old;
  end if;
end;
$function$;

create or replace function public.company_resources_check()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  new.name := trim(new.name);
  if public._has_card_number(new.name) or public._has_card_number(new.description) or public._has_card_number(new.item_name) then
    raise exception 'That looks like a payment card number. Card numbers can''t be stored in the app.';
  end if;
  if public._mentions_card_credential(new.name) or public._mentions_card_credential(new.description) then
    raise exception 'Card PINs and security codes can''t be stored in the app. Use the card issuer''s PIN process.';
  end if;

  if new.category = 'company_card' and (new.name ~* '\mpins?\M' or new.description ~* '\mpins?\M') then
    raise exception 'Card PINs can''t be stored in the app. Use the card issuer''s PIN process.';
  end if;
  if new.category <> 'company_card' then
    new.card_last_four := null;
    new.card_holder_id := null;
  end if;
  if new.category <> 'vehicle' then
    new.truck_id := null;
  end if;
  if new.truck_id is not null and not exists (
    select 1 from public.trucks t where t.id = new.truck_id and t.company_id = new.company_id
  ) then
    raise exception 'That truck isn''t part of this company.';
  end if;
  if new.card_holder_id is not null and not exists (
    select 1 from public.company_members m
    where m.person_id = new.card_holder_id and m.company_id = new.company_id and m.status = 'active'
  ) then
    raise exception 'The card holder must be an active member of this company.';
  end if;

  -- has_secret can only be changed from set_resource_secret().
  if coalesce(current_setting('app.resource_secret_write', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.has_secret := false;
    else
      new.has_secret := old.has_secret;
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := public.my_person_id();
  else
    new.company_id := old.company_id;
    new.created_by := old.created_by;
  end if;
  new.updated_by := coalesce(public.my_person_id(), new.updated_by);
  return new;
end;
$function$;

create or replace function public.company_slot_open()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select not exists (select 1 from public.companies);
$function$;

create or replace function public.content_reports_guard()
 returns trigger
 language plpgsql
as $function$
begin
  if new.project_id is distinct from old.project_id or new.reported_by is distinct from old.reported_by
     or new.content_type is distinct from old.content_type or new.content_id is distinct from old.content_id
     or new.reason is distinct from old.reason or new.details is distinct from old.details
     or new.created_at is distinct from old.created_at then
    raise exception 'A report''s contents can''t be changed.';
  end if;
  if new.status = 'handled' and old.status <> 'handled' then
    new.handled_by := public.my_person_id();
    new.handled_at := now();
  end if;
  return new;
end;
$function$;

create or replace function public.create_company(data jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare pid uuid := public.my_person_id();
begin
  if pid is null then raise exception 'not signed in'; end if;
  if not public.company_slot_open() then
    raise exception 'A company already exists. Ask the owner to send you an invite link.';
  end if;
  return public._create_company(pid, data);
end;
$function$;

create or replace function public.customer_message_reach()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  me uuid := public.my_person_id();
  cid uuid;
begin
  select company_id into cid from public.company_members
   where person_id = me and status = 'active' and role in ('owner','admin') limit 1;
  if cid is null then raise exception 'Only the owner or an admin can message customers.'; end if;
  return jsonb_build_object(
    'customers_all', cardinality(public._customer_audience(cid, 'customers_all')),
    'customers_active', cardinality(public._customer_audience(cid, 'customers_active'))
  );
end;
$function$;

create or replace function public.deactivate_member(p_person_id uuid, p_acknowledge boolean default false)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare cid uuid := public._check_member_target(p_person_id); chk jsonb; me uuid := public.my_person_id();
begin
  chk := public.member_deactivation_check(p_person_id);
  if jsonb_array_length(chk -> 'blocking') > 0 then raise exception '%', chk -> 'blocking' ->> 0; end if;
  if jsonb_array_length(chk -> 'warnings') > 0 and not coalesce(p_acknowledge, false) then
    raise exception 'Please read the warnings and confirm: %', chk -> 'warnings' ->> 0;
  end if;
  -- The trigger on company_members also cancels pending requests, removes their phones from push and writes the history.
  update public.company_members set status = 'inactive', deactivated_at = now(), deactivated_by = me
   where company_id = cid and person_id = p_person_id and status <> 'inactive';
  if not found then raise exception 'This person has no access to deactivate.'; end if;
end;
$function$;

create or replace function public.delete_account(p_person_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
declare
  cid uuid := public._check_account_target(p_person_id);
  me uuid := public.my_person_id();
  uid uuid;
begin
  select user_id into uid from public.people where id = p_person_id;
  if uid is null then raise exception 'This account was already deleted.'; end if;

  update public.company_members
    set status = 'inactive', deactivated_at = now(), deactivated_by = me
    where person_id = p_person_id;
  update public.join_requests set status = 'cancelled'
    where person_id = p_person_id and status = 'pending';
  update public.people set email = '', phone = null, avatar_url = null where id = p_person_id;
  delete from public.notification_preferences where person_id = p_person_id;
  delete from public.app_notifications where recipient_id = p_person_id;
  delete from public.push_tokens where person_id = p_person_id;
  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id)
    values (cid, 'account_deleted', me, p_person_id);

  delete from auth.users where id = uid;
end;
$function$;

create or replace function public.delete_my_account()
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
declare
  uid uuid := auth.uid();
  pid uuid;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select id into pid from public.people where user_id = uid;

  if pid is not null and exists (
    select 1 from public.company_members
     where person_id = pid and role = 'owner' and status = 'active'
  ) then
    raise exception 'You own the company. Delete the company first (More → Settings → Delete Company), then delete your account.';
  end if;

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
$function$;

-- DELETE THE COMPANY. Owner only, after typing the company name. All or nothing: the company and everything in it, plus the
-- logins of people who belonged ONLY to this company (the owner's too). A closure record is kept and every stored file is queued
-- for the storage-cleanup function. User triggers on the company's tables are switched off for this one step. There is no undo.
create or replace function public.delete_my_company(p_confirm_name text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  pid uuid := public.my_person_id();
  cid uuid;
  cname text;
  t text;
  prev jsonb;
  who text;
  gone_people uuid[];
  gone_users uuid[];
begin
  if pid is null then raise exception 'not signed in'; end if;

  select m.company_id into cid
    from public.company_members m
   where m.person_id = pid and m.role = 'owner' and m.status = 'active'
   limit 1;
  if cid is null then raise exception 'Only the company owner can delete the company.'; end if;

  select name into cname from public.companies where id = cid;
  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(coalesce(cname, ''))) then
    raise exception 'Type the company name exactly to confirm.';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.one_company'));

  prev := public.company_closure_preview();
  if (prev ->> 'on_the_clock')::int > 0 or (prev ->> 'timing_a_property')::int > 0 then
    raise exception 'Someone is still clocked in. Clock them out (Hours & Labor) before closing the company.';
  end if;

  -- Close every way back in first (if anything below fails, all of this is rolled back too).
  update public.team_codes set is_active = false where company_id = cid;
  update public.join_requests set status = 'cancelled', reviewed_by = pid, reviewed_at = now() where company_id = cid and status = 'pending';

  select trim(first_name || ' ' || last_name) into who from public.people where id = pid;
  insert into public.company_closure_log (company_id, company_name, closed_by, closed_by_name, counts)
  values (cid, cname, pid, who, prev);

  -- The company's stored files (photos, documents) live outside the database. Their names are written to a cleanup list BEFORE the rows
  -- are deleted, in this same all-or-nothing step, so nothing is left unlisted. The storage-cleanup function deletes the files.
  perform public._enqueue_company_files(cid);

  -- Deleting a company deletes everything inside it, including the accounts of the people who belonged ONLY to it (owner included), so
  -- nobody is left with a login that opens onto "Finish setting up". Anyone who also belongs to another company keeps their account.
  -- Decided now, before the memberships disappear.
  select coalesce(array_agg(distinct m.person_id), '{}') into gone_people
    from public.company_members m
   where m.company_id = cid
     and not exists (select 1 from public.company_members m2 where m2.person_id = m.person_id and m2.company_id <> cid);

  -- Everything stored for this company and for the people whose accounts go with it (every file key starts with the company id;
  -- ID photos and avatars start with the person id). The storage-cleanup function empties these folders, in both buckets.
  perform public._enqueue_company_prefixes(cid, gone_people);

  for t in
    select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r'
       and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
  loop
    execute format('alter table public.%I disable trigger user', t);
  end loop;

  perform set_config('app.allow_company_delete', 'on', true);
  delete from public.companies where id = cid;
  perform set_config('app.allow_company_delete', 'off', true);

  for t in
    select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r'
       and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
  loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;

  if exists (select 1 from public.companies where id = cid) then
    raise exception 'The company could not be deleted.';
  end if;

  -- Same all-or-nothing step: remove those people and their logins. If any of this fails, the company is NOT deleted either.
  select coalesce(array_agg(user_id) filter (where user_id is not null), '{}') into gone_users from public.people where id = any(gone_people);
  delete from public.people where id = any(gone_people);
  delete from auth.users where id = any(gone_users);
  update public.company_closure_log
     set counts = coalesce(counts, '{}'::jsonb) || jsonb_build_object('accounts_deleted', coalesce(array_length(gone_people, 1), 0))
   where company_id = cid;
end;
$function$;

create or replace function public.delete_unused_member(p_person_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := public.my_person_id();
  m record;
  p record;
  r record;
  has boolean;
  blocked text[] := '{}';
  -- Setup rows that only describe who is on a team or job. They are removed together with the person; nothing else may exist.
  safe text[] := array[
    'company_members', 'invites', 'crew_members', 'push_tokens', 'resource_access', 'worker_settings', 'worker_pay_settings',
    'worker_reminders', 'worker_hourly_rates', 'time_person_settings', 'project_team'
  ];
  tbl text;
  others integer;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  select * into m from public.company_members
   where person_id = p_person_id and role in ('worker', 'customer')
     and company_id in (select company_id from public.company_members where person_id = me and role in ('owner', 'admin') and status = 'active')
   limit 1;
  if m.id is null then raise exception 'not allowed'; end if;
  if not public.admin_can(m.company_id, 'team') then raise exception 'Only the owner (or an admin the owner allows) can do that.'; end if;
  select * into p from public.people where id = p_person_id;
  if p.id is null then raise exception 'Person not found.'; end if;
  if p.user_id is not null then
    raise exception 'HAS_HISTORY: This person has a login. Deactivate them instead so their history is kept.';
  end if;

  for r in
    select distinct c.conrelid::regclass::text as tbl, a.attname::text as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.confrelid = 'public.people'::regclass and c.contype = 'f'
  loop
    if regexp_replace(r.tbl, '^public\.', '') = any (safe) then continue; end if;
    -- The team history (who added or invited them) is not "work history": it is kept and only loses the link to this person.
    if regexp_replace(r.tbl, '^public\.', '') = 'membership_audit_log' then continue; end if;
    execute format('select exists (select 1 from %s where %I = $1)', r.tbl, r.col) using p_person_id into has;
    if has then blocked := array_append(blocked, regexp_replace(r.tbl, '^public\.', '')); end if;
  end loop;
  if cardinality(blocked) > 0 then
    raise exception 'HAS_HISTORY: % has records (%), so they cannot be deleted. Deactivate them instead and their history stays.',
      coalesce(nullif(trim(p.first_name), ''), 'This person'), array_to_string(blocked, ', ');
  end if;

  select count(*) into others from public.company_members where person_id = p_person_id and company_id <> m.company_id;

  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
  values (m.company_id, 'member_deleted', me, null,
          jsonb_build_object('role', m.role, 'first_name', p.first_name, 'last_name', p.last_name, 'email', p.email));

  if others > 0 then
    -- Also a member of another company: only this company's membership goes; the person stays for the other one.
    delete from public.company_members where id = m.id;
    return jsonb_build_object('deleted', true, 'kept_person', true);
  end if;

  foreach tbl in array safe loop
    for r in
      select a.attname::text as col
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
       where c.confrelid = 'public.people'::regclass and c.contype = 'f' and c.conrelid::regclass::text in (tbl, 'public.' || tbl)
    loop
      execute format('delete from public.%I where %I = $1', tbl, r.col) using p_person_id;
    end loop;
  end loop;
  delete from public.people where id = p_person_id;
  return jsonb_build_object('deleted', true, 'kept_person', false);
end;
$function$;

create or replace function public.enforce_checkin_radius()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_gps jsonb;
  v_row jsonb := to_jsonb(new);
  v_project uuid := nullif(v_row ->> 'project_id', '')::uuid;
  v_company uuid := nullif(v_row ->> 'company_id', '')::uuid;
  v_lat double precision;
  v_lon double precision;
  v_radius integer;
  v_glat double precision;
  v_glon double precision;
  v_acc double precision;
  v_dist double precision;
begin
  -- Not a signed-in app user (backend jobs, the SQL editor), or no project to measure against.
  if auth.uid() is null or v_project is null then return new; end if;
  -- Owners and admins add and correct records without being on site.
  if public.is_staff(v_company) then return new; end if;
  -- Only a fresh check-in is judged (not a later edit such as a check-out on the same row).
  if tg_table_name = 'work_sessions' and coalesce(v_row ->> 'status', 'active') <> 'active' then return new; end if;

  v_gps := case when tg_table_name = 'check_ins' then v_row -> 'gps' else v_row -> 'check_in_gps' end;

  select p.latitude, p.longitude, s.checkin_radius_meters
    into v_lat, v_lon, v_radius
    from public.projects p
    left join public.project_settings s on s.project_id = p.id
   where p.id = v_project;

  -- Anywhere (saved distance 0): the worker does not have to be at the project.
  if v_radius is not null and v_radius <= 0 then return new; end if;

  -- No saved coordinates for the project: nothing to measure against here.
  if v_lat is null or v_lon is null then return new; end if;

  v_glat := nullif(v_gps ->> 'latitude', '')::double precision;
  v_glon := nullif(v_gps ->> 'longitude', '')::double precision;
  if v_glat is null or v_glon is null or abs(v_glat) > 90 or abs(v_glon) > 180 or (v_glat = 0 and v_glon = 0) then
    raise exception 'Your location is needed to check in. Turn on location and try again.' using errcode = 'P0001';
  end if;

  v_acc := greatest(0, coalesce(nullif(v_gps ->> 'accuracy', '')::double precision, 0));
  if v_acc > 100 then
    raise exception 'Your location is not accurate enough to check in. Step into the open and try again.' using errcode = 'P0001';
  end if;

  v_dist := public.haversine_m(v_glat, v_glon, v_lat, v_lon);
  if v_dist - least(v_acc, 75) > coalesce(v_radius, 805) then
    raise exception 'You are too far from this project to check in.' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

-- One company per database: a second "Create a Company" is refused.
create or replace function public.enforce_one_company()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if coalesce(current_setting('app.allow_company_create', true), '') = 'on' then
    return new;
  end if;
  -- Two sign-ups at the same moment can't both slip through.
  perform pg_advisory_xact_lock(hashtext('public.one_company'));
  if not public.company_slot_open() then
    raise exception 'A company already exists. Ask the owner to send you an invite link.';
  end if;
  return new;
end;
$function$;

create or replace function public.enforce_task_lead()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := public.my_person_id();
  lead uuid;
  lead_only boolean;
begin
  -- Signed-in workers only; the owner/admin and the SQL editor are not limited.
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.is_staff(old.company_id) then
    if (new.title, new.description, new.sort_order, new.assigned_to, new.project_id, new.company_id)
       is distinct from
       (old.title, old.description, old.sort_order, old.assigned_to, old.project_id, old.company_id) then
      raise exception 'Only the owner can edit tasks.';
    end if;
    if new.status is distinct from old.status then
      select task_lead_id into lead from public.projects where id = old.project_id;
      select coalesce(task_lead_only, false) into lead_only from public.companies where id = old.company_id;
      if lead is not null and lead = me then
        null; -- the Task Lead always can
      elsif lead_only then
        if lead is null then
          raise exception 'This job has no Task Lead yet. Ask the owner to pick one.';
        end if;
        raise exception 'Only the Task Lead can change tasks on this job.';
      elsif not exists (
        select 1 from public.assignments a
         where a.project_id = old.project_id and a.person_id = me and a.status not in ('cancelled', 'reassigned')
      ) then
        raise exception 'Only people on this job can change its tasks.';
      end if;
    end if;
  end if;

  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status is distinct from 'completed' then
      new.completed_at := now();
      new.completed_by := coalesce(me, new.completed_by);
    else
      new.completed_at := old.completed_at;
      new.completed_by := old.completed_by;
    end if;
  else
    new.completed_at := null;
    new.completed_by := null;
  end if;
  return new;
end;
$function$;

create or replace function public.ensure_property(p_customer uuid, p_name text, p_address text, p_city text default null::text, p_state text default null::text, p_zip text default null::text, p_lat double precision default null::double precision, p_lng double precision default null::double precision)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  cid uuid := public._property_staff_company();
  key text;
  pid uuid;
begin
  if cid is null then raise exception 'not allowed'; end if;
  if p_customer is null then raise exception 'Choose the customer first.'; end if;
  if not exists (select 1 from public.company_members m where m.company_id = cid and m.person_id = p_customer and m.role = 'customer') then
    raise exception 'That customer is not in your company.';
  end if;
  if length(trim(coalesce(p_address, ''))) = 0 then raise exception 'Enter the street address.'; end if;

  key := public.normalize_address(p_address, p_city, p_state, p_zip);
  if key <> '' then
    select id into pid from public.properties where company_id = cid and customer_id = p_customer and address_key = key limit 1;
    if pid is not null then return jsonb_build_object('property_id', pid, 'created', false); end if;
  end if;

  insert into public.properties (company_id, customer_id, name, address, city, state, zip, latitude, longitude, created_by)
  values (cid, p_customer, nullif(trim(coalesce(p_name, '')), ''), trim(p_address), nullif(trim(coalesce(p_city, '')), ''),
          nullif(trim(coalesce(p_state, '')), ''), nullif(trim(coalesce(p_zip, '')), ''), p_lat, p_lng, public.my_person_id())
  returning id into pid;
  return jsonb_build_object('property_id', pid, 'created', true);
end;
$function$;

create or replace function public.extend_schedule_series(p_series uuid default null::uuid, p_today date default CURRENT_DATE, p_horizon_days integer default null::integer)
 returns integer
 language plpgsql
 set search_path to 'public'
as $function$
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
$function$;

create or replace function public.get_admin_permissions()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare cid uuid := public._my_staff_company(); r public.company_admin_permissions;
begin
  if cid is null then raise exception 'not allowed'; end if;
  select * into r from public.company_admin_permissions where company_id = cid;
  return jsonb_build_object('team', coalesce(r.team, true), 'invites', coalesce(r.invites, true),
                            'time_corrections', coalesce(r.time_corrections, true), 'pay_rates', coalesce(r.pay_rates, true));
end;
$function$;

create or replace function public.get_my_context()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
$function$;

create or replace function public.get_shared_document(p_token text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_kind text;
  v_doc jsonb;
  v_quote_number text;
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;
  select to_jsonb(q) into v_doc from public.quotes q where q.share_token = p_token and q.status <> 'draft';
  if v_doc is not null then
    v_kind := 'quote';
  else
    select to_jsonb(c) into v_doc from public.change_orders c where c.share_token = p_token and c.status <> 'draft';
    if v_doc is not null then
      v_kind := 'change_order';
    else
      select to_jsonb(i) into v_doc from public.invoices i where i.share_token = p_token and i.status <> 'draft';
      if v_doc is null then
        return null;
      end if;
      v_kind := 'invoice';
    end if;
  end if;
  if v_kind <> 'quote' and v_doc ? 'quote_id' then
    select number into v_quote_number from public.quotes where id = (v_doc->>'quote_id')::uuid;
  end if;

  return jsonb_build_object(
    'kind', v_kind,
    'document', v_doc - 'created_by' - 'approved_by' - 'declined_by',
    'quote_number', v_quote_number,
    'project_name', (select name from public.projects where id = (v_doc->>'project_id')::uuid),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event_type', e.event_type,
               'created_at', e.created_at,
               'name', coalesce(e.metadata->>'name', nullif(trim(p.first_name || ' ' || p.last_name), '')))
             order by e.created_at)
      from public.financial_events e
      left join public.people p on p.id = e.actor_id
      where e.document_id = (v_doc->>'id')::uuid and e.event_type in ('sent','approved','declined','expired','issued','voided')
    ), '[]'::jsonb)
  );
end;
$function$;

-- SIGN-UP. Runs when a new login is made. It links the login to an existing person ONLY through a valid, unused invite link
-- (never by matching an email address: email confirmation may be off, so anyone could sign up with someone else's email).
-- Everyone else gets a fresh person record. A sign-up that carries company_name creates the company (one per database).
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  pid uuid;
  inv public.invites;
begin
  if coalesce(meta->>'invite_token', '') <> '' then
    begin
      -- Using the link and making the login are one step: the link is marked used first, so it cannot be used twice.
      update public.invites set status = 'used', used_at = now()
       where token_hash = public._invite_hash(meta->>'invite_token') and status = 'pending' and expires_at > now()
      returning * into inv;
      if found then
        update public.people set
          user_id = new.id,
          email = coalesce(new.email, ''),
          -- A worker can correct their own name here. A customer keeps the name the owner typed (the form only fills in a part the owner left empty).
          first_name = case when inv.kind = 'customer' then coalesce(nullif(btrim(first_name), ''), nullif(btrim(meta->>'first_name'), ''), first_name)
                            else coalesce(nullif(btrim(meta->>'first_name'), ''), first_name) end,
          last_name = case when inv.kind = 'customer' then coalesce(nullif(btrim(last_name), ''), nullif(btrim(meta->>'last_name'), ''), last_name)
                           else coalesce(nullif(btrim(meta->>'last_name'), ''), last_name) end,
          phone = coalesce(nullif(btrim(meta->>'phone'), ''), phone)
        where id = inv.person_id and user_id is null
        returning id into pid;
        if pid is not null then
          update public.company_members set status = 'active' where person_id = pid and company_id = inv.company_id and status = 'invited';
          insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
          values (inv.company_id, 'invite_used', pid, pid, jsonb_build_object('kind', inv.kind, 'invite_id', inv.id));
        end if;
      end if;
    exception when others then raise warning 'invite link failed: %', sqlerrm;
    end;
  end if;

  if pid is null then
    insert into public.people (user_id, email, first_name, last_name, phone)
    values (new.id, coalesce(new.email, ''), coalesce(meta->>'first_name', ''), coalesce(meta->>'last_name', ''), nullif(meta->>'phone', ''))
    returning id into pid;
  end if;

  -- Someone starting their own company (unchanged).
  begin
    if coalesce(meta->>'company_name', '') <> '' then
      perform public._create_company(pid, meta);
    end if;
  exception when others then raise warning 'create company failed: %', sqlerrm;
  end;

  return new;
end;
$function$;

create or replace function public.haversine_m(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
 returns double precision
 language sql
 immutable
as $function$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)
  )))
$function$;

create or replace function public.invite_accept(p_token text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := public.my_person_id();
  inv public.invites;
  cname text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  update public.invites set status = 'used', used_at = now()
   where token_hash = public._invite_hash(p_token) and status = 'pending' and expires_at > now()
  returning * into inv;
  if not found then return jsonb_build_object('success', false, 'error', 'invalid_or_used'); end if;

  if inv.person_id <> me then
    if exists (select 1 from public.company_members where company_id = inv.company_id and person_id = me) then
      raise exception 'You are already part of this company.';
    end if;
    if inv.kind = 'customer' then
      -- The owner may already have attached projects to the record; everything moves to this account.
      insert into public.company_members (company_id, person_id, role, status, join_method)
        values (inv.company_id, me, 'customer', 'active', 'invitation_link') on conflict do nothing;
      perform public._merge_placeholder_customer(inv.company_id, inv.person_id, me);
    else
      update public.company_members set person_id = me, status = 'active', join_method = 'invitation_link'
       where company_id = inv.company_id and person_id = inv.person_id and role = 'worker';
      begin
        delete from public.people where id = inv.person_id and user_id is null;
      exception when foreign_key_violation then null;
      end;
    end if;
  end if;
  select name into cname from public.companies where id = inv.company_id;
  return jsonb_build_object('success', true, 'company_name', cname, 'kind', inv.kind);
end;
$function$;

create or replace function public.invite_lookup(p_token text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare inv public.invites; r record;
begin
  select * into inv from public.invites where token_hash = public._invite_hash(p_token);
  if not found then return jsonb_build_object('valid', false, 'reason', 'invalid'); end if;
  if inv.status = 'used' then return jsonb_build_object('valid', false, 'reason', 'used'); end if;
  if inv.status = 'revoked' then return jsonb_build_object('valid', false, 'reason', 'invalid'); end if;
  if inv.expires_at <= now() then return jsonb_build_object('valid', false, 'reason', 'expired'); end if;
  select p.first_name, p.last_name, p.phone, c.name as company_name into r
    from public.people p, public.companies c where p.id = inv.person_id and c.id = inv.company_id;
  return jsonb_build_object('valid', true, 'kind', inv.kind, 'company_name', r.company_name, 'first_name', r.first_name, 'last_name', r.last_name, 'phone', coalesce(r.phone, ''));
end;
$function$;

create or replace function public.invite_revoke(p_invite uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare cid uuid := public._invite_staff_company(); me uuid := public.my_person_id();
begin
  if cid is null then raise exception 'not allowed'; end if;
  update public.invites set status = 'revoked', revoked_at = now() where id = p_invite and company_id = cid and status = 'pending';
  if found then
    insert into public.membership_audit_log (company_id, event_type, actor_id, metadata) values (cid, 'invite_revoked', me, jsonb_build_object('invite_id', p_invite));
  end if;
end;
$function$;

create or replace function public.invite_send(p_person uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare cid uuid := public._invite_staff_company(); me uuid := public.my_person_id(); m record; has_login boolean;
begin
  if cid is null then raise exception 'Only the owner (or an admin the owner allows) can send invites.'; end if;
  select cm.role, cm.status, p.user_id is not null as has_login into m
    from public.company_members cm join public.people p on p.id = cm.person_id
   where cm.company_id = cid and cm.person_id = p_person and cm.role in ('worker', 'customer');
  if not found then raise exception 'Person not found.'; end if;
  if m.has_login then raise exception 'This person already has a login.'; end if;
  if m.status = 'inactive' then raise exception 'This person''s access was removed. Reactivate them first.'; end if;
  return public._invite_issue(cid, p_person, m.role, me);
end;
$function$;

create or replace function public.invites_pending()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare cid uuid := public._invite_staff_company();
begin
  if cid is null then raise exception 'not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', i.id, 'person_id', i.person_id, 'kind', i.kind, 'first_name', p.first_name, 'last_name', p.last_name,
             'phone', p.phone, 'expires_at', i.expires_at, 'expired', i.expires_at <= now(), 'created_at', i.created_at, 'last_sent_at', i.last_sent_at)
           order by i.created_at desc)
      from public.invites i join public.people p on p.id = i.person_id
     where i.company_id = cid and i.status = 'pending'
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.is_company_owner(cid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(public.member_role(cid) = 'owner', false)
$function$;

create or replace function public.is_crew(cid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(public.member_role(cid) in ('owner','admin','worker'), false)
$function$;

create or replace function public.is_member(cid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.member_role(cid) is not null
$function$;

create or replace function public.is_project_customer(pid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.projects p
    where p.id = pid
      and public.my_person_id() is not null
      and (p.customer_id = public.my_person_id() or p.customer_claimed_by = public.my_person_id())
      and public.is_member(p.company_id)
  )
$function$;

create or replace function public.is_staff(cid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(public.member_role(cid) in ('owner','admin'), false)
$function$;

create or replace function public.list_accounts()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'auth'
as $function$
declare
  cid uuid := public._my_owned_company();
begin
  if cid is null then raise exception 'not allowed'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'person_id', p.id,
      'first_name', p.first_name,
      'last_name', p.last_name,
      'email', coalesce(nullif(p.email, ''), u.email),
      'phone', p.phone,
      'avatar_url', p.avatar_url,
      'signed_up_at', u.created_at,
      'last_sign_in_at', u.last_sign_in_at,
      'role', cm.role,
      'member_status', cm.status,
      'removed_at', cm.deactivated_at,
      'request_status', jr.status,
      'requested_at', jr.created_at,
      'is_me', p.id = public.my_person_id()
    ) order by u.created_at desc)
    from public.people p
    join auth.users u on u.id = p.user_id
    left join public.company_members cm on cm.person_id = p.id and cm.company_id = cid
    left join lateral (
      select r.status, r.created_at from public.join_requests r
      where r.person_id = p.id and r.company_id = cid and r.status <> 'cancelled'
      order by r.created_at desc limit 1
    ) jr on true
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.lock_financial_document()
 returns trigger
 language plpgsql
as $function$
declare
  status_cols text[] := array['status','sent_at','approved_at','approved_by','declined_at','declined_by',
                              'decline_reason','issued_at','voided_at','void_reason','updated_at',
                              'approved_name','share_token','approved_signature'];
  allowed text[];
begin
  if old.status = 'draft' then
    if TG_TABLE_NAME = 'invoices' then allowed := array['draft','issued'];
    else allowed := array['draft','sent'];
    end if;
  elsif TG_TABLE_NAME = 'invoices' then
    allowed := case old.status when 'issued' then array['issued','void'] else array[old.status] end;
  else
    allowed := case old.status
      when 'sent' then array['sent','approved','declined','expired']
      else array[old.status] end;
  end if;

  if not (new.status = any(allowed)) then
    raise exception 'This % is % and can''t be changed to %.', replace(rtrim(TG_TABLE_NAME, 's'), '_', ' '), old.status, new.status;
  end if;

  if old.status <> 'draft'
     and (to_jsonb(new) - status_cols) is distinct from (to_jsonb(old) - status_cols) then
    raise exception 'This document was already sent, so its contents can''t be changed. Make a new one instead.';
  end if;

  -- A saved signature is part of the record of the approval and is never changed.
  if old.status <> 'draft' and (to_jsonb(old) ->> 'approved_signature') is not null
     and (to_jsonb(new) ->> 'approved_signature') is distinct from (to_jsonb(old) ->> 'approved_signature') then
    raise exception 'The approval signature can''t be changed.';
  end if;
  return new;
end;
$function$;

create or replace function public.member_deactivation_check(p_person_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare cid uuid := public._check_member_target(p_person_id); blocking jsonb := '[]'; warnings jsonb := '[]'; n integer;
begin
  if exists (select 1 from public.time_workdays w where w.person_id = p_person_id and w.company_id = cid and w.clock_out_at is null) then
    blocking := blocking || to_jsonb('They are clocked in right now. Set their clock-out in Hours & Labor first.'::text);
  end if;
  select count(*) into n from public.time_workdays w where w.person_id = p_person_id and w.company_id = cid and w.status in ('closed', 'reopened');
  if n > 0 then warnings := warnings || to_jsonb(n || ' workday(s) still need your approval. They stay in Hours & Labor.'); end if;
  select count(*) into n from public.assignments a where a.person_id = p_person_id and a.company_id = cid and a.scheduled_date >= current_date and a.status not in ('completed', 'cancelled', 'reassigned');
  if n > 0 then warnings := warnings || to_jsonb(n || ' upcoming job(s) are assigned to them. Reassign them.'); end if;
  select count(*) into n from public.time_skip_requests q where q.requested_by = p_person_id and q.company_id = cid and q.status = 'pending';
  if n > 0 then warnings := warnings || to_jsonb(n || ' skip request(s) from them are waiting for a decision.'); end if;
  return jsonb_build_object('blocking', blocking, 'warnings', warnings);
end;
$function$;

create or replace function public.member_role(cid uuid)
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select role from public.company_members
  where company_id = cid and person_id = public.my_person_id() and status = 'active'
  limit 1
$function$;

create or replace function public.my_person_id()
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select id from public.people where user_id = auth.uid() limit 1
$function$;

create or replace function public.new_share_token()
 returns text
 language sql
as $function$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$function$;

create or replace function public.normalize_address(p_street text, p_city text, p_state text, p_zip text)
 returns text
 language plpgsql
 immutable
as $function$
declare
  s text := lower(coalesce(p_street, ''));
  z text := substring(coalesce(p_zip, '') from '^\s*(\d{5})');
  pairs text[] := array[
    'street','st','avenue','ave','road','rd','drive','dr','lane','ln','boulevard','blvd','court','ct','place','pl','circle','cir',
    'terrace','ter','parkway','pkwy','highway','hwy','trail','trl','north','n','south','s','east','e','west','w',
    'northeast','ne','northwest','nw','southeast','se','southwest','sw','apartment','unit','apt','unit','suite','unit','ste','unit',
    'building','bldg','floor','fl'];
  i int;
begin
  s := regexp_replace(s, '#', ' unit ', 'g');
  s := regexp_replace(s, '[^a-z0-9 ]', ' ', 'g');
  s := ' ' || btrim(regexp_replace(s, '\s+', ' ', 'g')) || ' ';
  if btrim(s) = '' then return ''; end if;
  for pass in 1..2 loop
    i := 1;
    while i < array_length(pairs, 1) loop
      s := replace(s, ' ' || pairs[i] || ' ', ' ' || pairs[i + 1] || ' ');
      i := i + 2;
    end loop;
  end loop;
  s := btrim(regexp_replace(s, '\s+', ' ', 'g'));
  return s || '|' || coalesce(z, lower(btrim(coalesce(p_city, ''))) || '|' || lower(btrim(coalesce(p_state, ''))));
end;
$function$;

create or replace function public.owner_get_yard_alerts()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare cid uuid := public._yard_owner_company(); c public.companies; a public.company_yard_alerts;
begin
  select * into c from public.companies where id = cid;
  select * into a from public.company_yard_alerts where company_id = cid;
  return jsonb_build_object(
    'yard_set', c.yard_latitude is not null and c.yard_longitude is not null,
    'yard_address', concat_ws(', ', nullif(btrim(coalesce(c.yard_address, '')), ''), nullif(btrim(coalesce(c.yard_city, '')), ''), nullif(btrim(coalesce(c.yard_state, '')), '')),
    'radius_m', coalesce(a.radius_m, 152),
    'alert_on', coalesce(a.alert_on, false),
    'alert_email', a.alert_email
  );
end;
$function$;

create or replace function public.owner_of_person(pid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (select 1 from public.company_members cm where cm.person_id = pid and public.is_company_owner(cm.company_id))
      or exists (select 1 from public.join_requests jr where jr.person_id = pid and public.is_company_owner(jr.company_id))
$function$;

create or replace function public.owner_set_yard_alerts(p_radius_m integer, p_alert_on boolean, p_alert_email text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare cid uuid := public._yard_owner_company(); me uuid := public.my_person_id(); mail text := nullif(btrim(coalesce(p_alert_email, '')), '');
begin
  if p_radius_m is null or p_radius_m not between 30 and 5000 then raise exception 'Choose how close counts as at the yard.'; end if;
  if mail is not null and mail !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then raise exception 'That email address does not look right.'; end if;
  insert into public.company_yard_alerts (company_id, radius_m, alert_on, alert_email, updated_by, updated_at)
  values (cid, p_radius_m, coalesce(p_alert_on, false), mail, me, now())
  on conflict (company_id) do update set radius_m = excluded.radius_m, alert_on = excluded.alert_on, alert_email = excluded.alert_email,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return public.owner_get_yard_alerts();
end;
$function$;

create or replace function public.prevent_company_delete()
 returns trigger
 language plpgsql
as $function$
begin
  if coalesce(current_setting('app.allow_company_delete', true), '') <> 'on' then
    raise exception 'Companies cannot be deleted.';
  end if;
  return old;
end;
$function$;

-- Is the public weather area on? Anyone may ask; answers only {"enabled": true|false}. It only controls the signed-out area.
create or replace function public.public_weather_config()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object('enabled', coalesce((
    select bool_and(s.enabled)
      from public.public_weather_settings s
     where exists (select 1 from public.company_members m
                    where m.company_id = s.company_id and m.role = 'owner' and m.status = 'active')
  ), false))
$function$;

-- Sends a phone push for each new notice by calling the send-notification Edge Function at app_settings.functions_url
-- (see FILL IN at the top). Needs pg_net. Only the notice id is sent; a failed call never blocks the notice itself.
create or replace function public.push_app_notification()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare url text; push_on boolean;
begin
  -- The person's own "Push Notifications" switch (worker_settings.notifications_enabled; no row = on). Off = no phone push;
  -- the notice itself is still saved and shows in the app.
  select coalesce((select s.notifications_enabled from public.worker_settings s where s.person_id = new.recipient_id), true) into push_on;
  -- Only worth a call if the person wants pushes and has a phone registered, or it's an emailed event (the function then skips the push).
  if new.event_type not in ('quote_approved','quote_declined')
     and (not push_on or not exists (select 1 from public.push_tokens where person_id = new.recipient_id)) then
    return new;
  end if;
  select value into url from public.app_settings where key = 'functions_url';
  -- Not filled in yet (see the FILL IN block at the top of setup.sql): no push is attempted.
  if url is null or url like '%YOUR-PROJECT-REF%' then
    return new;
  end if;
  begin
    -- Only the id is sent; the function reads the notification itself and
    -- sends each one once, so the call can't be used to send anything else.
    perform net.http_post(
      url := url || '/send-notification',
      body := jsonb_build_object('id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
  exception when others then
    -- Never block the in-app notification because a push couldn't be queued.
    raise notice 'push not queued: %', sqlerrm;
  end;
  return new;
end;
$function$;

-- Gives a deactivated team member access again (as a worker).
create or replace function public.reactivate_member(p_person_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare cid uuid := public._check_member_target(p_person_id); me uuid := public.my_person_id(); m record;
begin
  select * into m from public.company_members where company_id = cid and person_id = p_person_id;
  if m.id is null then
    raise exception 'This person was never on your team. Add them and send them an invite link.';
  end if;
  if m.status = 'active' then raise exception 'They are already active.'; end if;
  update public.company_members
     set status = 'active', role = 'worker', deactivated_at = null, deactivated_by = null, approved_by = me, approved_at = now()
   where id = m.id;
  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
  values (cid, 'member_reactivated', me, p_person_id, jsonb_build_object('previous_role', m.role));
end;
$function$;

create or replace function public.register_push_token(p_token text, p_platform text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := public.my_person_id();
begin
  if me is null or p_token is null or length(p_token) > 300 then
    return;
  end if;
  insert into public.push_tokens (token, person_id, platform, updated_at)
  values (p_token, me, left(p_platform, 20), now())
  on conflict (token) do update set person_id = excluded.person_id, platform = excluded.platform, updated_at = now();
end;
$function$;

create or replace function public.remind_worker_assignment(p_assignment uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := public.my_person_id();
  a record;
  proj text;
  last_at timestamptz;
  devices integer;
  has_login boolean;
  when_text text;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  select * into a from public.assignments where id = p_assignment;
  if a.id is null then raise exception 'Job not found.'; end if;
  if not exists (
    select 1 from public.company_members m
     where m.company_id = a.company_id and m.person_id = me and m.role in ('owner', 'admin') and m.status = 'active'
  ) then raise exception 'not allowed'; end if;
  if a.status in ('completed', 'cancelled', 'reassigned') then
    return jsonb_build_object('sent', false, 'reason', 'done');
  end if;
  if a.confirmation_state = 'confirmed' then
    return jsonb_build_object('sent', false, 'reason', 'confirmed');
  end if;

  select exists (select 1 from public.people where id = a.person_id and user_id is not null) into has_login;
  if not has_login then
    return jsonb_build_object('sent', false, 'reason', 'no_login');
  end if;

  select max(created_at) into last_at from public.app_notifications
   where recipient_id = a.person_id and event_type = 'schedule_reminder' and linked_entity_id = a.id::text;
  if last_at is not null and last_at > now() - interval '1 hour' then
    return jsonb_build_object('sent', false, 'reason', 'recent', 'minutes_left', greatest(1, ceil(extract(epoch from (last_at + interval '1 hour' - now())) / 60)::int));
  end if;

  select coalesce(p.name, 'your job') into proj from public.projects p where p.id = a.project_id;
  when_text := case when a.scheduled_date = current_date then 'today' when a.scheduled_date = current_date + 1 then 'tomorrow' else to_char(a.scheduled_date, 'Mon DD') end;
  insert into public.app_notifications (company_id, recipient_id, event_type, title, body, linked_entity_type, linked_entity_id)
  values (a.company_id, a.person_id, 'schedule_reminder', 'Please confirm your schedule',
          proj || ' ' || when_text || case when a.is_full_day then ', full day' else ', starts ' || to_char(a.start_time::time, 'HH12:MI AM') end || '. Open the app to confirm.',
          'assignment', a.id::text);

  select count(*) into devices from public.push_tokens where person_id = a.person_id;
  return jsonb_build_object('sent', true, 'devices', devices);
end;
$function$;

create or replace function public.remove_account_access(p_person_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform public.deactivate_member(p_person_id, true);
end;
$function$;

create or replace function public.resource_access_audit()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  rname text;
begin
  if tg_op = 'INSERT' then
    select name into rname from public.company_resources where id = new.resource_id;
    insert into public.resource_audit_log (company_id, resource_id, resource_name, actor_id, event_type, target_person_id)
    values (new.company_id, new.resource_id, rname, public.my_person_id(), 'access_granted', new.person_id);
    return new;
  end if;
  -- A deleted resource takes its access rows with it; the 'deleted' entry covers that.
  select name into rname from public.company_resources where id = old.resource_id;
  if rname is not null then
    insert into public.resource_audit_log (company_id, resource_id, resource_name, actor_id, event_type, target_person_id, metadata)
    values (old.company_id, old.resource_id, rname, public.my_person_id(), 'access_revoked', old.person_id,
            case when coalesce(current_setting('app.resource_revoke_reason', true), '') <> ''
                 then jsonb_build_object('reason', current_setting('app.resource_revoke_reason', true)) end);
  end if;
  return old;
end;
$function$;

create or replace function public.resource_access_check()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  select company_id into new.company_id from public.company_resources where id = new.resource_id;
  if new.company_id is null then
    raise exception 'Resource not found.';
  end if;
  if not exists (
    select 1 from public.company_members m
    where m.person_id = new.person_id and m.company_id = new.company_id
      and m.role = 'worker' and m.status = 'active'
  ) then
    raise exception 'Access can only be given to active workers.';
  end if;
  new.granted_by := public.my_person_id();
  return new;
end;
$function$;

create or replace function public.resource_secrets_cleanup()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'vault'
as $function$
begin
  delete from vault.secrets where id = old.vault_secret_id;
  return old;
end;
$function$;

create or replace function public.respond_by_link(p_token text, p_approve boolean, p_name text, p_note text default null::text, p_signature text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_kind text;
  v_id uuid;
  v_name text := nullif(left(trim(coalesce(p_name, '')), 120), '');
  v_sig text := nullif(trim(coalesce(p_signature, '')), '');
  hdr jsonb;
  res jsonb;
begin
  if p_token is null or length(p_token) < 32 then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  select id into v_id from public.quotes where share_token = p_token;
  if v_id is not null then
    v_kind := 'quote';
  else
    select id into v_id from public.change_orders where share_token = p_token;
    v_kind := 'change_order';
  end if;
  if v_id is null then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  if p_approve and (v_name is null or length(v_name) < 2) then
    return jsonb_build_object('success', false, 'error', 'name_required');
  end if;
  -- Only path text: it is later drawn inside an SVG, so nothing else may be stored.
  if v_sig is not null and (length(v_sig) > 20000 or v_sig !~ '^[ML0-9.,[:space:]-]+$') then
    return jsonb_build_object('success', false, 'error', 'bad_signature');
  end if;

  begin
    hdr := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    hdr := null;
  end;

  res := public.apply_document_response(v_kind, v_id, p_approve, p_note, null, v_name,
    jsonb_strip_nulls(jsonb_build_object(
      'via', 'link',
      'name', v_name,
      'signed', v_sig is not null,
      'ip', nullif(trim(split_part(coalesce(hdr->>'x-forwarded-for', ''), ',', 1)), ''),
      'user_agent', left(hdr->>'user-agent', 300))));

  if p_approve and v_sig is not null and coalesce((res->>'success')::boolean, false) then
    if v_kind = 'quote' then
      update public.quotes set approved_signature = v_sig where id = v_id;
    else
      update public.change_orders set approved_signature = v_sig where id = v_id;
    end if;
  end if;
  return res;
end;
$function$;

create or replace function public.respond_to_financial_document(p_type text, p_id uuid, p_approve boolean, p_note text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := public.my_person_id();
  proj uuid;
  me_name text;
begin
  if p_type = 'quote' then
    select project_id into proj from public.quotes where id = p_id;
  elsif p_type = 'change_order' then
    select project_id into proj from public.change_orders where id = p_id;
  else
    return jsonb_build_object('success', false, 'error', 'invalid_type');
  end if;
  if me is null or proj is null or not public.is_project_customer(proj) then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  select nullif(trim(first_name || ' ' || last_name), '') into me_name from public.people where id = me;
  return public.apply_document_response(p_type, p_id, p_approve, p_note, me, me_name, jsonb_build_object('via', 'app'));
end;
$function$;

create or replace function public.restore_account_access(p_person_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  raise exception 'Use Reactivate on the Team access screen to give them access again.';
end;
$function$;

create or replace function public.reveal_resource_secret(p_resource_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public', 'vault'
as $function$
declare
  r public.company_resources;
  s text;
begin
  select * into r from public.company_resources where id = p_resource_id;
  if r.id is null or not public.can_view_resource(r.id) then
    raise exception 'This resource isn''t available.' using errcode = '42501';
  end if;
  select ds.decrypted_secret into s
  from public.resource_secrets rs
  join vault.decrypted_secrets ds on ds.id = rs.vault_secret_id
  where rs.resource_id = r.id;
  if s is null then
    return null;
  end if;
  insert into public.resource_audit_log (company_id, resource_id, resource_name, actor_id, event_type)
  values (r.company_id, r.id, r.name, public.my_person_id(), 'code_revealed');
  return s;
end;
$function$;

create or replace function public.revoke_resources_on_member_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_op = 'DELETE' then
    perform set_config('app.resource_revoke_reason', 'member_removed', true);
    delete from public.resource_access where person_id = old.person_id and company_id = old.company_id;
    perform set_config('app.resource_revoke_reason', '', true);
    return old;
  end if;
  if new.status <> 'active' or new.role <> 'worker' then
    perform set_config('app.resource_revoke_reason', 'deactivated', true);
    delete from public.resource_access where person_id = new.person_id and company_id = new.company_id;
    perform set_config('app.resource_revoke_reason', '', true);
  end if;
  return new;
end;
$function$;

create or replace function public.send_customer_announcement(p_title text, p_body text, p_audience text default 'customers_all'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := public.my_person_id();
  cid uuid;
  v_title text := nullif(left(trim(coalesce(p_title, '')), 120), '');
  v_body text := nullif(left(trim(coalesce(p_body, '')), 2000), '');
  ann uuid;
  recipients uuid[];
  n int;
begin
  if p_audience not in ('customers_all','customers_active') then
    raise exception 'Choose who this message is for.';
  end if;
  if v_title is null then raise exception 'Add a title.'; end if;
  if v_body is null then raise exception 'Write the message.'; end if;

  select company_id into cid from public.company_members
   where person_id = me and status = 'active' and role in ('owner','admin') limit 1;
  if cid is null then raise exception 'Only the owner or an admin can message customers.'; end if;

  recipients := public._customer_audience(cid, p_audience);

  insert into public.announcements (company_id, created_by, title, body, audience, priority, recipient_ids)
  values (cid, me, v_title, v_body, p_audience, 'normal', (select coalesce(array_agg(x::text), '{}') from unnest(recipients) x))
  returning id into ann;

  insert into public.app_notifications (company_id, recipient_id, event_type, title, body, linked_entity_type, linked_entity_id, metadata)
  select cid, x, 'announcement_posted', v_title, v_body, 'announcement', ann::text,
         jsonb_build_object('to', 'customers', 'audience', p_audience)
    from unnest(recipients) x;
  get diagnostics n = row_count;

  return jsonb_build_object('announcement_id', ann, 'recipients', n);
end;
$function$;

-- The owner decides what admins may do: team, invites, time corrections, pay rates.
create or replace function public.set_admin_permissions(p_team boolean, p_invites boolean, p_time_corrections boolean, p_pay_rates boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := public.my_person_id(); cid uuid;
begin
  select company_id into cid from public.company_members where person_id = me and role = 'owner' and status = 'active' limit 1;
  if cid is null then raise exception 'Only the owner can change what admins may do.'; end if;
  insert into public.company_admin_permissions (company_id, team, invites, time_corrections, pay_rates, updated_by, updated_at)
  values (cid, coalesce(p_team, true), coalesce(p_invites, true), coalesce(p_time_corrections, true), coalesce(p_pay_rates, true), me, now())
  on conflict (company_id) do update set team = excluded.team, invites = excluded.invites,
    time_corrections = excluded.time_corrections, pay_rates = excluded.pay_rates, updated_by = me, updated_at = now();
  insert into public.membership_audit_log (company_id, event_type, actor_id, metadata)
  values (cid, 'admin_permissions_changed', me, jsonb_build_object('team', p_team, 'invites', p_invites,
                                                                  'time_corrections', p_time_corrections, 'pay_rates', p_pay_rates));
end;
$function$;

create or replace function public.set_company_from_project()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  select company_id into new.company_id from public.projects where id = new.project_id;
  return new;
end;
$function$;

create or replace function public.set_customer_portal_access(p_person_id uuid, p_enabled boolean)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  cid uuid := public._invite_staff_company();
  me uuid := public.my_person_id();
  m record;
  has_login boolean;
  new_status text;
begin
  if cid is null then raise exception 'Only the owner (or an admin the owner allows) can change customer access.'; end if;
  if p_person_id = me then raise exception 'You can''t change your own access.'; end if;

  select cm.id, cm.status into m
    from public.company_members cm
   where cm.company_id = cid and cm.person_id = p_person_id and cm.role = 'customer';
  if m.id is null then raise exception 'That person is not one of your customers.'; end if;

  select (user_id is not null) into has_login from public.people where id = p_person_id;

  if coalesce(p_enabled, false) then
    if m.status <> 'inactive' then return m.status; end if;
    new_status := case when coalesce(has_login, false) then 'active' else 'invited' end;
    update public.company_members set status = new_status, deactivated_at = null, deactivated_by = null where id = m.id;
  else
    if m.status = 'inactive' then return 'inactive'; end if;
    update public.company_members set status = 'inactive', deactivated_at = now(), deactivated_by = me where id = m.id;
    update public.invites set status = 'revoked', revoked_at = now()
     where company_id = cid and person_id = p_person_id and status = 'pending';
    new_status := 'inactive';
  end if;

  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
  values (cid, case when coalesce(p_enabled, false) then 'customer_access_on' else 'customer_access_off' end, me, p_person_id,
          jsonb_build_object('status', new_status));
  return new_status;
end;
$function$;

create or replace function public.set_member_role(p_person_id uuid, p_role text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := public.my_person_id(); cid uuid; m record;
begin
  select company_id into cid from public.company_members where person_id = me and role = 'owner' and status = 'active' limit 1;
  if cid is null then raise exception 'Only the owner can make or remove an admin.'; end if;
  if p_role not in ('admin', 'worker') then raise exception 'bad role'; end if;
  if p_person_id = me then raise exception 'You can''t change your own role.'; end if;
  select * into m from public.company_members where company_id = cid and person_id = p_person_id;
  if m.id is null or m.status <> 'active' then raise exception 'Only active team members can be made an admin.'; end if;
  if m.role = 'owner' then raise exception 'The owner''s role can''t be changed.'; end if;
  if m.role not in ('worker', 'admin') then raise exception 'Only employees can be made an admin.'; end if;
  if m.role = p_role then return; end if;
  perform set_config('app.role_change', 'on', true);
  update public.company_members set role = p_role where id = m.id;
  perform set_config('app.role_change', '', true);
  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
  values (cid, case when p_role = 'admin' then 'admin_granted' else 'admin_removed' end, me, p_person_id, jsonb_build_object('from', m.role, 'to', p_role));
end;
$function$;

create or replace function public.set_my_language(p_language text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := public.my_person_id();
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  if p_language not in ('en', 'es') then raise exception 'Unknown language.'; end if;
  update public.people set language = p_language where id = me and language is distinct from p_language;
end;
$function$;

-- The owner turns the signed-out (public visitor) weather area on or off. It does not affect signed-in people.
create or replace function public.set_public_weather_enabled(p_enabled boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := public.my_person_id();
  cid uuid;
begin
  if p_enabled is null then raise exception 'Choose on or off.'; end if;
  if me is null then raise exception 'Only the owner can do that.'; end if;
  select m.company_id into cid
    from public.company_members m
   where m.person_id = me and m.role = 'owner' and m.status = 'active'
   limit 1;
  if cid is null then raise exception 'Only the owner can do that.'; end if;
  insert into public.public_weather_settings (company_id, enabled, updated_by, updated_at)
  values (cid, p_enabled, me, now())
  on conflict (company_id) do update
    set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return jsonb_build_object('enabled', p_enabled);
end;
$function$;

create or replace function public.set_resource_secret(p_resource_id uuid, p_secret text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'vault'
as $function$
declare
  r public.company_resources;
  sid uuid;
  v text := nullif(trim(coalesce(p_secret, '')), '');
begin
  select * into r from public.company_resources where id = p_resource_id;
  if r.id is null or not public.is_staff(r.company_id) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if v is not null then
    if r.category = 'company_card' then
      raise exception 'Card entries can''t hold a code or PIN. Use the card issuer''s PIN process.';
    end if;
    if length(v) > 500 then
      raise exception 'That code is too long.';
    end if;
    if public._has_card_number(v) then
      raise exception 'That looks like a payment card number. Card numbers can''t be stored in the app.';
    end if;
  end if;

  select vault_secret_id into sid from public.resource_secrets where resource_id = r.id;
  if v is null then
    delete from public.resource_secrets where resource_id = r.id;
  elsif sid is null then
    sid := vault.create_secret(v, 'company_resource_' || r.id::text, 'company resource code');
    insert into public.resource_secrets (resource_id, vault_secret_id) values (r.id, sid);
  else
    perform vault.update_secret(sid, v);
    update public.resource_secrets set updated_at = now() where resource_id = r.id;
  end if;

  perform set_config('app.resource_secret_write', 'on', true);
  update public.company_resources set has_secret = (v is not null) where id = r.id;
  perform set_config('app.resource_secret_write', '', true);

  insert into public.resource_audit_log (company_id, resource_id, resource_name, actor_id, event_type)
  values (r.company_id, r.id, r.name, public.my_person_id(), case when v is null then 'code_removed' else 'code_changed' end);
end;
$function$;

create or replace function public.set_updated_at()
 returns trigger
 language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create or replace function public.staff_of_person(pid uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.company_members cm
    where cm.person_id = pid and public.is_staff(cm.company_id)
  )
$function$;

create or replace function public.storage_cleanup_claim(p_limit integer default 25)
 returns table(id uuid, company_id uuid, kind text, file_key text, attempts integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  return query
  with due as (
    select q.id from public.storage_cleanup_queue q
     where q.status = 'pending' and q.next_attempt_at <= now() and (q.locked_until is null or q.locked_until < now())
     order by q.next_attempt_at limit greatest(1, least(coalesce(p_limit, 25), 100)) for update skip locked
  )
  update public.storage_cleanup_queue q set locked_until = now() + interval '10 minutes', attempts = q.attempts + 1
    from due where q.id = due.id
  returning q.id, q.company_id, q.kind, q.file_key, q.attempts;
end;
$function$;

create or replace function public.storage_cleanup_finish(p_id uuid, p_ok boolean, p_error text default null::text, p_more boolean default false)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare q public.storage_cleanup_queue;
begin
  select * into q from public.storage_cleanup_queue where id = p_id for update;
  if not found then raise exception 'No such cleanup item.'; end if;
  if p_ok then
    update public.storage_cleanup_queue set status = 'done', processed_at = now(), locked_until = null, last_error = null where id = p_id;
  elsif p_more then
    update public.storage_cleanup_queue set locked_until = null, next_attempt_at = now(), attempts = greatest(attempts - 1, 0) where id = p_id;
  elsif q.attempts >= 8 then
    update public.storage_cleanup_queue set status = 'failed', locked_until = null, last_error = left(coalesce(p_error, 'failed'), 500) where id = p_id;
  else
    update public.storage_cleanup_queue set locked_until = null, last_error = left(coalesce(p_error, 'failed'), 500),
      next_attempt_at = now() + least(power(2, q.attempts) * interval '1 minute', interval '6 hours') where id = p_id;
  end if;
end;
$function$;

create or replace function public.storage_cleanup_status()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object('pending', count(*) filter (where status = 'pending'), 'done', count(*) filter (where status = 'done'),
                            'failed', count(*) filter (where status = 'failed')) from public.storage_cleanup_queue
$function$;

-- PUBLIC "Request a service" form (anyone, signed in or not). The allowed service names MUST match
-- src/config/brand.js -> wording.serviceTypes word for word. If you change that list, change "allowed" below too
-- (scripts/checks/serviceRequests.check.cjs compares them).
create or replace function public.submit_service_request(p_property_type text, p_services text[], p_details text, p_town text, p_name text, p_phone text, p_email text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  -- Must match src/config/brand.js wording.serviceTypes exactly.
  allowed constant text[] := array['New installation', 'Repair', 'Maintenance', 'Inspection', 'Estimate request', 'Other'];
  v_name text := btrim(coalesce(p_name, ''));
  v_town text := btrim(coalesce(p_town, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_details text := btrim(coalesce(p_details, ''));
  v_services text[];
  cid uuid;
  rid uuid;
  mem record;
  one_hour constant interval := interval '1 hour';
begin
  if p_property_type is null or p_property_type not in ('residential','commercial') then raise exception 'Choose residential or commercial.'; end if;
  select coalesce(array_agg(distinct s), '{}') into v_services from unnest(coalesce(p_services, '{}')) s where s = any(allowed);
  if cardinality(v_services) < 1 then raise exception 'Choose at least one service.'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then raise exception 'Enter your name.'; end if;
  if char_length(v_town) < 2 or char_length(v_town) > 80 then raise exception 'Enter the town or ZIP code of the property.'; end if;
  if char_length(v_digits) < 10 or char_length(v_digits) > 15 then raise exception 'Enter a phone number we can reach you at.'; end if;
  if v_email <> '' and (char_length(v_email) > 120 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'That email address does not look right.'; end if;
  if char_length(v_details) > 2000 then raise exception 'Please keep the description under 2000 characters.'; end if;

  select m.company_id into cid from public.company_members m where m.role = 'owner' and m.status = 'active' limit 1;
  if cid is null then raise exception 'Requests are not available right now. Please call us.'; end if;

  if (select count(*) from public.service_requests r
       where r.created_at > now() - one_hour and (r.phone_digits = v_digits or (v_email <> '' and r.email = v_email))) >= 3 then
    raise exception 'We already have your requests. We will be in touch, or you can call us.';
  end if;
  if (select count(*) from public.service_requests r where r.created_at > now() - one_hour) >= 40 then
    raise exception 'Too many requests right now. Please call us instead.';
  end if;

  insert into public.service_requests (company_id, property_type, services, details, town, name, phone, phone_digits, email)
  values (cid, p_property_type, v_services, v_details, v_town, v_name, v_phone, v_digits, v_email)
  returning id into rid;

  for mem in select m.person_id from public.company_members m
              where m.company_id = cid and m.status = 'active' and m.role in ('owner','admin') loop
    insert into public.app_notifications (company_id, recipient_id, event_type, title, body, linked_entity_type, linked_entity_id)
    values (cid, mem.person_id, 'service_request', 'New service request',
            v_name || ' (' || v_town || '): ' || array_to_string(v_services, ', '), 'service_request', rid::text);
  end loop;

  return jsonb_build_object('ok', true, 'id', rid);
end;
$function$;

-- The owner's Team access list. has_access = an active owner, admin or worker.
create or replace function public.team_access_overview()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare cid uuid := public._my_staff_company();
begin
  if cid is null then raise exception 'not allowed'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(t)::jsonb order by t.last_name, t.first_name) from (
      select p.id as person_id, p.first_name, p.last_name, coalesce(nullif(p.email, ''), '') as email, p.avatar_url, p.phone,
             m.role, m.status as member_status,
             (m.status = 'active' and m.role in ('owner', 'admin', 'worker')) as has_access,
             (m.role in ('owner', 'admin') and m.status = 'active') as is_staff,
             false as pending_team_request,
             m.deactivated_at, (select trim(d.first_name || ' ' || d.last_name) from public.people d where d.id = m.deactivated_by) as deactivated_by_name,
             p.id = public.my_person_id() as is_me
        from public.people p
        join public.company_members m on m.person_id = p.id and m.company_id = cid
    ) t
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.time_accept_all_suggested_ends()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := public.my_person_id(); cid uuid; w record; ok integer := 0; left_ jsonb := '[]'::jsonb;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  if cid is null or not public.is_staff(cid) then raise exception 'Only the owner can do that.'; end if;
  for w in select id from public.time_workdays where company_id = cid and status = 'needs_review' order by clock_in_at loop
    begin
      perform public.time_accept_suggested_end(w.id);
      ok := ok + 1;
    exception when others then
      left_ := left_ || jsonb_build_object('workday_id', w.id, 'why', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('accepted', ok, 'left', left_);
end;
$function$;

create or replace function public.time_accept_suggested_end(p_workday uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare w public.time_workdays; sg record;
begin
  select * into w from public.time_workdays where id = p_workday;
  if not found or not public.is_staff(w.company_id) then raise exception 'Workday not found.'; end if;
  if w.status <> 'needs_review' then raise exception 'That day is already settled.'; end if;
  select * into sg from public._time_suggest_end(p_workday);
  if sg.suggested_at is null then raise exception 'There is no suggested end time for this day. Set the end time yourself.'; end if;
  perform public.time_staff_edit_workday(p_workday, null, sg.suggested_at, 'Accepted the suggested end time');
end;
$function$;

create or replace function public.time_alert_resolve(p_alert uuid, p_note text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare a public.time_alerts;
begin
  select * into a from public.time_alerts where id = p_alert;
  if not found or not public.is_staff(a.company_id) then raise exception 'Alert not found.'; end if;
  update public.time_alerts set status = 'resolved', resolved_by = public.my_person_id(), resolved_at = now() where id = p_alert;
end;
$function$;

create or replace function public.time_approve_workday(p_workday uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare w public.time_workdays; me uuid := public.my_person_id();
begin
  select * into w from public.time_workdays where id = p_workday for update;
  if not found or not public.is_staff(w.company_id) then raise exception 'Workday not found.'; end if;
  if w.status = 'approved' then return; end if;  -- already approved: a double tap changes nothing
  if w.status = 'needs_review' then raise exception 'This day is waiting for a real end time (the employee never clocked out). Set the end time first.'; end if;
  if w.clock_out_at is null then raise exception 'This day has no clock-out yet. Set the clock-out (or have the employee clock out) before approving.'; end if;
  if exists (select 1 from public.time_intervals where workday_id = w.id and ended_at is null and status = 'active') then
    raise exception 'A job visit is still running. Stop its timer before approving.';
  end if;
  if exists (select 1 from public.time_breaks where workday_id = w.id and ended_at is null) then
    raise exception 'A break is still running. End it before approving.';
  end if;
  update public.time_workdays set status = 'approved', approved_by = me, approved_at = now(), approval_version = approval_version + 1 where id = w.id;
  perform public._time_audit(w.company_id, 'workday', w.id, w.person_id, w.id, null, 'approved', 'status', to_jsonb(w.status), to_jsonb('approved'::text), null, false);
end;
$function$;

create or replace function public.time_break_end()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := public.my_person_id(); cid uuid; w public.time_workdays;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  select * into w from public.time_workdays where person_id = me and clock_out_at is null for update;
  if not found then raise exception 'You are not clocked in.'; end if;
  update public.time_breaks set ended_at = now() where workday_id = w.id and ended_at is null;
  return public._time_day_json(me, cid, w.work_date);
end;
$function$;

create or replace function public.time_break_start()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := public.my_person_id(); cid uuid; st public.time_settings; w public.time_workdays;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  st := public._time_settings_row(cid);
  if not st.breaks_enabled then raise exception 'Break tracking is turned off.'; end if;
  select * into w from public.time_workdays where person_id = me and clock_out_at is null for update;
  if not found then raise exception 'Clock in first.'; end if;
  if exists (select 1 from public.time_breaks b where b.workday_id = w.id and b.ended_at is null) then
    return public._time_day_json(me, cid, w.work_date);  -- already on a break
  end if;
  if exists (select 1 from public.time_intervals i where i.person_id = me and i.ended_at is null and i.status = 'active') then
    raise exception 'Complete the job you are working on before starting a break.';
  end if;
  insert into public.time_breaks (company_id, workday_id, person_id, paid) values (cid, w.id, me, st.breaks_paid);
  return public._time_day_json(me, cid, w.work_date);
end;
$function$;

create or replace function public.time_claim_stale_end(p_workday uuid, p_stopped_at timestamp with time zone default null::timestamp with time zone, p_note text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := public.my_person_id();
  cid uuid;
  w public.time_workdays;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  select * into w from public.time_workdays where id = p_workday and person_id = me for update;
  if not found then raise exception 'Workday not found.'; end if;
  if w.status <> 'needs_review' then raise exception 'That day is already settled.'; end if;
  if p_stopped_at is not null and (p_stopped_at < w.clock_in_at or p_stopped_at > now()) then
    raise exception 'The time you stopped has to be after you clocked in and not in the future.';
  end if;
  update public.time_workdays
     set claimed_out_at = p_stopped_at, claim_note = nullif(trim(coalesce(p_note, '')), ''), claimed_at = now()
   where id = w.id;
  perform public._time_audit(w.company_id, 'workday', w.id, w.person_id, w.id, null, 'claimed', 'claimed_out_at', null, to_jsonb(p_stopped_at),
                             coalesce(nullif(trim(coalesce(p_note, '')), ''), case when p_stopped_at is null then 'Not sure when they stopped.' else 'Says they stopped at this time.' end), false);
  perform public._time_notify_staff(w.company_id, 'time_unusual', 'Needs review: ' || coalesce((select first_name from public.people where id = me), 'a worker') || ' answered',
    case when p_stopped_at is null then 'They are not sure when they stopped. Set the end time.' else 'They say they stopped at ' || to_char(p_stopped_at at time zone 'UTC', 'Mon DD HH24:MI') || ' UTC. Use it or set another time.' end,
    'time_workday', w.id);
  return public._time_day_json(me, cid, w.work_date);
end;
$function$;

create or replace function public.time_clock_in(p_work_date date, p_truck_id uuid default null::uuid, p_request_id uuid default null::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := public.my_person_id();
  cid uuid;
  d date := coalesce(p_work_date, current_date);
  w public.time_workdays;
  assigned uuid;
  use_truck uuid;
  src text;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  if cid is null then raise exception 'You are not on a team yet.'; end if;
  if d < current_date - 1 or d > current_date + 1 then raise exception 'That date doesn''t look right. Check your phone''s date and try again.'; end if;

  if p_request_id is not null then
    select * into w from public.time_workdays where client_request_id = p_request_id and person_id = me;
    if found then return public._time_day_json(me, cid, d) || jsonb_build_object('already_active', true); end if;
  end if;
  perform public._time_flag_stale(me, cid);
  select * into w from public.time_workdays where person_id = me and clock_out_at is null;
  if found then return public._time_day_json(me, cid, d) || jsonb_build_object('already_active', true); end if;

  if not public._time_may_clock_in(me, cid, d) then
    raise exception 'You have no work scheduled today, so you can''t clock in yet. Once the owner puts you on a job, Clock In appears.';
  end if;

  assigned := public._time_assigned_truck(me, d);
  if assigned is not null then
    use_truck := assigned; src := 'owner';
  elsif p_truck_id is not null then
    if not exists (select 1 from public.trucks t where t.id = p_truck_id and t.company_id = cid and t.status in ('available', 'assigned')) then
      raise exception 'That truck isn''t available.';
    end if;
    if exists (select 1 from public.time_workdays o where o.truck_id = p_truck_id and o.clock_out_at is null and o.person_id <> me
                 and not public._time_same_group(me, o.person_id, d)) then
      raise exception 'That truck is already in use by someone else today. Pick another.';
    end if;
    use_truck := p_truck_id; src := 'worker';
  end if;

  begin
    insert into public.time_workdays (company_id, person_id, work_date, truck_id, truck_source, client_request_id)
    values (cid, me, d, use_truck, src, p_request_id)
    returning * into w;
  exception when unique_violation then
    return public._time_day_json(me, cid, d) || jsonb_build_object('already_active', true);
  end;
  insert into public.time_workday_rates (workday_id, company_id, hourly_rate) values (w.id, cid, public._time_rate(cid, me, d));
  return public._time_day_json(me, cid, d);
end;
$function$;

create or replace function public.time_clock_out(p_request_id uuid default null::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := public.my_person_id();
  cid uuid;
  w public.time_workdays;
  i public.time_intervals;
  v public.time_visits;
  a public.assignments;
  dur numeric;
  last_day date;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  perform public._time_flag_stale(me, cid);
  select * into w from public.time_workdays where person_id = me and clock_out_at is null for update;
  if not found then
    select work_date into last_day from public.time_workdays where person_id = me order by clock_in_at desc limit 1;
    return public._time_day_json(me, cid, coalesce(last_day, current_date)) || jsonb_build_object('already_closed', true);
  end if;

  -- A break still running ends now.
  update public.time_breaks set ended_at = now() where workday_id = w.id and ended_at is null;

  -- Whatever the worker is still on ends with the day.
  for i in select * from public.time_intervals where person_id = me and workday_id = w.id and ended_at is null and status = 'active' for update loop
    select * into v from public.time_visits where id = i.visit_id;
    if v.source = 'project_day' then
      select * into a from public.assignments where project_id = v.project_id and person_id = me and scheduled_date = v.visit_date
       order by (status in ('cancelled', 'reassigned')), created_at limit 1;
      if a.id is not null then
        insert into public.check_outs (company_id, assignment_id, person_id, project_id, gps) values (cid, a.id, me, v.project_id, null);
        update public.assignments set status = 'completed' where id = a.id and status not in ('cancelled', 'reassigned');
      end if;
      if i.legacy_session_id is not null then
        dur := round(extract(epoch from (now() - i.started_at)) / 60.0, 2);
        update public.work_sessions set check_out_time = now(), duration_minutes = dur, status = 'completed' where id = i.legacy_session_id;
      end if;
    end if;
    update public.time_intervals set ended_at = now() where id = i.id;
    perform public._time_refresh_visit(v.id);
  end loop;

  update public.time_workdays set clock_out_at = now(), status = 'closed' where id = w.id;
  return public._time_day_json(me, cid, w.work_date);
end;
$function$;

create or replace function public.time_complete_visit(p_visit_id uuid, p_note text default null::text, p_lat double precision default null::double precision, p_lng double precision default null::double precision, p_accuracy double precision default null::double precision, p_location_state text default 'ok'::text, p_gps jsonb default null::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := public.my_person_id();
  cid uuid;
  st public.time_settings;
  w public.time_workdays;
  v public.time_visits;
  i public.time_intervals;
  a public.assignments;
  dur numeric;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  st := public._time_settings_row(cid);
  select * into v from public.time_visits where id = p_visit_id and company_id = cid;
  if not found then raise exception 'Visit not found.'; end if;
  select * into i from public.time_intervals where visit_id = v.id and person_id = me and ended_at is null and status = 'active' for update;
  if not found then
    -- Already completed (a repeat tap) or never started.
    select * into w from public.time_workdays where id = (select workday_id from public.time_intervals where visit_id = v.id and person_id = me order by started_at desc limit 1);
    if found then return public._time_day_json(me, cid, w.work_date) || jsonb_build_object('already_completed', true); end if;
    raise exception 'You haven''t started this job.';
  end if;
  select * into w from public.time_workdays where id = i.workday_id;

  if st.require_complete_photo and not exists (select 1 from public.project_photos p where p.project_id = v.project_id and p.uploaded_by = me
                                                and p.time_phase = 'complete' and p.file_key <> '' and p.created_at >= i.started_at) then
    raise exception 'Take the completion photo for this job first.';
  end if;

  -- Prefer the live assignment; if the owner cancelled it while the worker was on site, the worker can still finish and clock out.
  select * into a from public.assignments where project_id = v.project_id and person_id = me and scheduled_date = v.visit_date
   order by (status in ('cancelled', 'reassigned')), created_at limit 1;
  if a.id is not null then
    insert into public.check_outs (company_id, assignment_id, person_id, project_id, gps)
    values (cid, a.id, me, v.project_id, p_gps);
  end if;
  if i.legacy_session_id is not null then
    dur := round(extract(epoch from (now() - i.started_at)) / 60.0, 2);
    update public.work_sessions set check_out_time = now(), check_out_gps = p_gps, duration_minutes = dur, status = 'completed'
     where id = i.legacy_session_id;
  end if;
  if a.id is not null then update public.assignments set status = 'completed' where id = a.id and status not in ('cancelled', 'reassigned'); end if;

  update public.time_intervals set ended_at = now() where id = i.id;
  perform public._time_refresh_visit(v.id);
  return public._time_day_json(me, cid, w.work_date);
end;
$function$;

create or replace function public.time_decide_skip(p_request_id uuid, p_approve boolean, p_note text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := public.my_person_id(); r public.time_skip_requests;
begin
  select * into r from public.time_skip_requests where id = p_request_id for update;
  if not found or not public.is_staff(r.company_id) then raise exception 'Request not found.'; end if;
  if r.status <> 'pending' then return jsonb_build_object('status', r.status); end if;

  -- Nothing left to skip: it was finished (or cancelled) after the request. Close the request instead of failing.
  if exists (select 1 from public.assignments a where a.id = r.assignment_id and a.status in ('completed', 'cancelled', 'reassigned')) then
    update public.time_skip_requests set status = 'withdrawn', decided_by = me, decided_at = now(), decision_note = 'Already finished before your decision' where id = r.id;
    return jsonb_build_object('status', 'withdrawn');
  end if;
  -- Approving a skip while someone is timing work on that job would strand their timer.
  if p_approve and exists (
    select 1 from public.time_intervals i join public.time_visits tv on tv.id = i.visit_id
     where i.ended_at is null and i.status = 'active'
       and tv.project_id = (select a.project_id from public.assignments a where a.id = r.assignment_id)
       and tv.visit_date = (select a.scheduled_date from public.assignments a where a.id = r.assignment_id)
  ) then
    raise exception 'Someone is timing work on this job right now. Stop that timer first, or deny the request.';
  end if;

  update public.time_skip_requests
     set status = case when p_approve then 'approved' else 'denied' end, decided_by = me, decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '')
   where id = r.id;
  if p_approve then
    update public.assignments set status = 'cancelled', cancelled_at = now(), cancelled_by = me, cancellation_reason = 'Skipped (approved): ' || r.reason
     where id = r.assignment_id and status not in ('completed', 'cancelled', 'reassigned');
    -- Any other pending request for the same job is answered by this one.
    update public.time_skip_requests set status = 'withdrawn', decided_by = me, decided_at = now(), decision_note = 'Another request for this job was approved'
     where id <> r.id and status = 'pending' and assignment_id = r.assignment_id;
  end if;
  perform public._time_audit(r.company_id, 'skip', r.id, r.requested_by, null, null, case when p_approve then 'skip_approved' else 'skip_denied' end,
                             'status', to_jsonb('pending'::text), to_jsonb(case when p_approve then 'approved' else 'denied' end), p_note, false);
  return jsonb_build_object('status', case when p_approve then 'approved' else 'denied' end);
end;
$function$;

create or replace function public.time_my_day(p_date date default null::date)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := public.my_person_id(); cid uuid;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  if cid is null then raise exception 'You are not on a team yet.'; end if;
  perform public._time_flag_stale(me, cid);
  perform public._time_scan(cid);
  return public._time_day_json(me, cid, coalesce(p_date, current_date));
end;
$function$;

create or replace function public.time_my_skip_requests()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'source', r.source, 'ref_id', r.assignment_id,
         'status', r.status, 'reason', r.reason, 'created_at', r.created_at, 'decision_note', r.decision_note) order by r.created_at desc), '[]'::jsonb)
  from public.time_skip_requests r
  where r.requested_by = public.my_person_id() and r.created_at > now() - interval '3 days'
$function$;

create or replace function public.time_record_clock_in_location(p_workday uuid, p_lat numeric, p_lng numeric, p_accuracy numeric, p_note text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := public.my_person_id(); w public.time_workdays; c public.companies; a public.company_yard_alerts;
  has_pt boolean := p_lat is not null and p_lng is not null and p_lat between -90 and 90 and p_lng between -180 and 180;
  yard_set boolean; radius integer; dist integer; outside boolean; need boolean;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  select * into w from public.time_workdays where id = p_workday and person_id = me;
  if not found then raise exception 'That workday was not found.'; end if;
  if exists (select 1 from public.time_clock_locations where workday_id = w.id) then
    return jsonb_build_object('recorded', false, 'alert_needed', false);
  end if;
  select * into c from public.companies where id = w.company_id;
  select * into a from public.company_yard_alerts where company_id = w.company_id;
  yard_set := c.yard_latitude is not null and c.yard_longitude is not null;
  radius := coalesce(a.radius_m, 152);
  if yard_set and has_pt then
    dist := public._yard_distance_m(p_lat::double precision, p_lng::double precision, c.yard_latitude, c.yard_longitude);
    outside := dist > radius;
  end if;
  insert into public.time_clock_locations (workday_id, company_id, person_id, lat, lng, accuracy_m, note, yard_distance_m, outside_yard)
  values (w.id, w.company_id, me, case when has_pt then p_lat end, case when has_pt then p_lng end, p_accuracy, left(p_note, 160), dist, outside);
  need := yard_set and coalesce(a.alert_on, false) and (not has_pt or coalesce(outside, false));
  return jsonb_build_object('recorded', true, 'yard_set', yard_set, 'outside', outside, 'distance_m', dist, 'alert_needed', coalesce(need, false));
end;
$function$;

create or replace function public.time_reopen_workday(p_workday uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare w public.time_workdays;
begin
  select * into w from public.time_workdays where id = p_workday for update;
  if not found then raise exception 'Workday not found.'; end if;
  perform public._time_need_staff(w.company_id, p_reason);
  if w.status <> 'approved' then return; end if;
  update public.time_workdays set status = 'reopened' where id = w.id;
  perform public._time_audit(w.company_id, 'workday', w.id, w.person_id, w.id, null, 'reopened', 'status', to_jsonb(w.status), to_jsonb('reopened'::text), p_reason, true);
end;
$function$;

create or replace function public.time_request_skip(p_source text, p_ref uuid, p_reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := public.my_person_id(); cid uuid;
  a public.assignments; blocked text; rid uuid;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  if cid is null then raise exception 'You are not on a team yet.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why this job can''t be done.'; end if;
  if length(p_reason) > 1000 then raise exception 'Keep the reason shorter.'; end if;
  -- p_source is kept for the app's call; only a scheduled job ('assignment') can be skipped.
  if p_source is distinct from 'assignment' then raise exception 'Unknown kind of work.'; end if;
  select * into a from public.assignments where id = p_ref;
  if not found or a.company_id <> cid or a.person_id <> me then raise exception 'Job not found.'; end if;
  if a.status in ('completed', 'cancelled', 'reassigned') then raise exception 'This job is already %.', a.status; end if;
  blocked := public._time_blocking_stop(p_source, p_ref, me);
  if blocked is not null then raise exception 'Finish % before asking to skip this one.', blocked; end if;
  if exists (select 1 from public.time_intervals i join public.time_visits tv on tv.id = i.visit_id
              where tv.project_id = a.project_id and tv.visit_date = a.scheduled_date and i.person_id = me and i.status = 'active') then
    raise exception 'You are working on this job right now. Complete it instead.';
  end if;
  insert into public.time_skip_requests (company_id, source, assignment_id, requested_by, reason)
  values (cid, p_source, p_ref, me, trim(p_reason))
  on conflict (assignment_id) where status = 'pending' and assignment_id is not null do nothing
  returning id into rid;
  return jsonb_build_object('request_id', coalesce(rid, (select id from public.time_skip_requests
      where requested_by = me and status = 'pending' and assignment_id = p_ref limit 1)));
end;
$function$;

create or replace function public.time_review_list()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := public.my_person_id(); cid uuid;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  if cid is null or not public.is_staff(cid) then raise exception 'Only the owner can do that.'; end if;
  perform public._time_flag_company(cid);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'workday_id', w.id, 'person_id', w.person_id,
        'name', coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), 'An employee'),
        'work_date', w.work_date, 'clock_in_at', w.clock_in_at, 'flagged_at', w.flagged_at,
        'claimed_out_at', w.claimed_out_at, 'claim_note', w.claim_note,
        'suggested_end_at', sg.suggested_at, 'suggestion_source', sg.source
      ) order by w.clock_in_at desc)
    from public.time_workdays w
    join public.people p on p.id = w.person_id
    left join lateral public._time_suggest_end(w.id) sg on true
    where w.company_id = cid and w.status = 'needs_review'
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.time_scan_alerts()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare cid uuid := public._time_company(public.my_person_id());
begin
  if cid is null or not public.is_staff(cid) then raise exception 'Only the owner can do that.'; end if;
  perform public._time_flag_company(cid);
  return public._time_scan(cid);
end;
$function$;

create or replace function public.time_set_hourly_rate(p_person uuid, p_rate numeric, p_effective date, p_reason text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare cid uuid := public._time_company(p_person); latest date; prev numeric; n_days integer; n_visits integer;
begin
  if cid is null or not public.is_staff(cid) then raise exception 'Only the owner can do that.'; end if;
  if not public.admin_can(cid, 'pay_rates') then raise exception 'The owner has not allowed admins to change pay rates.'; end if;
  if p_rate is null or p_rate <= 0 or p_rate > 1000 then raise exception 'Enter an hourly rate above zero.'; end if;
  if p_effective is null then raise exception 'Enter the date the new rate starts.'; end if;
  select max(effective_date) into latest from public.worker_hourly_rates where company_id = cid and person_id = p_person;
  if latest is not null and p_effective <= latest then
    raise exception 'The new rate has to start after the current rate''s start date (%).', latest;
  end if;
  select hourly_rate into prev from public.worker_hourly_rates where company_id = cid and person_id = p_person and end_date is null order by effective_date desc limit 1;
  update public.worker_hourly_rates set end_date = p_effective - 1 where company_id = cid and person_id = p_person and end_date is null;
  insert into public.worker_hourly_rates (company_id, person_id, hourly_rate, effective_date, set_by) values (cid, p_person, p_rate, p_effective, public.my_person_id());
  perform public._time_audit(cid, 'rate', null, p_person, null, null, 'rate_set', 'hourly_rate', to_jsonb(prev), to_jsonb(p_rate), p_reason, false);

  update public.time_workday_rates r set hourly_rate = p_rate
    from public.time_workdays w
   where r.workday_id = w.id and r.hourly_rate is null and w.person_id = p_person and w.company_id = cid
     and w.work_date >= p_effective and w.status <> 'approved';
  get diagnostics n_days = row_count;
  update public.time_interval_rates r set hourly_rate = p_rate
    from public.time_intervals i join public.time_workdays w on w.id = i.workday_id
   where r.interval_id = i.id and r.hourly_rate is null and i.person_id = p_person and i.company_id = cid
     and w.work_date >= p_effective and w.status <> 'approved';
  get diagnostics n_visits = row_count;
  if n_days + n_visits > 0 then
    perform public._time_audit(cid, 'rate', null, p_person, null, null, 'rate_filled', 'hourly_rate', null,
                               jsonb_build_object('rate', p_rate, 'workdays', n_days, 'property_times', n_visits), 'Filled in the blank rate on time recorded before a rate was set', false);
  end if;
end;
$function$;

create or replace function public.time_set_visit_billable(p_visit uuid, p_billable boolean, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v public.time_visits;
begin
  select * into v from public.time_visits where id = p_visit for update;
  if not found then raise exception 'Visit not found.'; end if;
  perform public._time_need_staff(v.company_id, p_reason);
  if v.billable = p_billable then return; end if;
  update public.time_visits set billable = p_billable where id = v.id;
  update public.time_intervals set billable = p_billable where visit_id = v.id and status <> 'void';
  perform public._time_audit(v.company_id, 'visit', v.id, null, null, v.id, 'billable_changed', 'billable', to_jsonb(v.billable), to_jsonb(p_billable), p_reason, false);
end;
$function$;

create or replace function public.time_settle_no_hours(p_workday uuid, p_reason text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare w public.time_workdays; why text := coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'No hours worked');
begin
  select * into w from public.time_workdays where id = p_workday for update;
  if not found or not public.is_staff(w.company_id) then raise exception 'Workday not found.'; end if;
  if w.status <> 'needs_review' then raise exception 'That day is already settled.'; end if;
  update public.time_workdays set status = 'closed' where id = w.id;
  perform public._time_audit(w.company_id, 'workday', w.id, w.person_id, w.id, null, 'settled_no_hours', 'status', to_jsonb(w.status), to_jsonb('closed'::text), why, false);
end;
$function$;

create or replace function public.time_staff_add_break(p_workday uuid, p_started timestamp with time zone, p_ended timestamp with time zone, p_paid boolean, p_reason text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare w public.time_workdays; bid uuid; was boolean;
begin
  select * into w from public.time_workdays where id = p_workday for update;
  if not found then raise exception 'Workday not found.'; end if;
  perform public._time_need_staff(w.company_id, p_reason);
  perform public._time_no_future(p_started); perform public._time_no_future(p_ended);
  was := public._time_touch_approval(w.id);
  insert into public.time_breaks (company_id, workday_id, person_id, started_at, ended_at, paid)
  values (w.company_id, w.id, w.person_id, p_started, p_ended, coalesce(p_paid, true)) returning id into bid;
  perform public._time_audit(w.company_id, 'break', bid, w.person_id, w.id, null, 'added', null, null, jsonb_build_object('started_at', p_started, 'ended_at', p_ended, 'paid', p_paid), p_reason, was);
  return bid;
end;
$function$;

create or replace function public.time_staff_add_interval(p_visit uuid, p_person uuid, p_started timestamp with time zone, p_ended timestamp with time zone, p_reason text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v public.time_visits; w public.time_workdays; iid uuid; was boolean;
begin
  select * into v from public.time_visits where id = p_visit;
  if not found then raise exception 'Visit not found.'; end if;
  perform public._time_need_staff(v.company_id, p_reason);
  perform public._time_no_future(p_started); perform public._time_no_future(p_ended);
  select * into w from public.time_workdays where person_id = p_person and company_id = v.company_id
     and clock_in_at <= p_started and (clock_out_at is null or clock_out_at >= coalesce(p_ended, p_started)) order by clock_in_at desc limit 1;
  if not found then raise exception 'That employee has no workday covering those times. Add or correct the workday first.'; end if;
  was := public._time_touch_approval(w.id);
  insert into public.time_intervals (company_id, visit_id, workday_id, person_id, started_at, ended_at, billable)
  values (v.company_id, v.id, w.id, p_person, p_started, p_ended, v.billable) returning id into iid;
  insert into public.time_interval_rates (interval_id, company_id, hourly_rate) values (iid, v.company_id, public._time_rate(v.company_id, p_person, w.work_date));
  perform public._time_refresh_visit(v.id);
  perform public._time_audit(v.company_id, 'interval', iid, p_person, w.id, v.id, 'added', null, null, jsonb_build_object('started_at', p_started, 'ended_at', p_ended), p_reason, was);
  return iid;
end;
$function$;

create or replace function public.time_staff_add_workday(p_person uuid, p_work_date date, p_clock_in timestamp with time zone, p_clock_out timestamp with time zone, p_reason text, p_truck uuid default null::uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare cid uuid := public._time_company(p_person); wid uuid;
begin
  perform public._time_need_staff(cid, p_reason);
  if p_clock_in is null or p_work_date is null then raise exception 'Enter the date and the clock-in time.'; end if;
  perform public._time_no_future(p_clock_in); perform public._time_no_future(p_clock_out);
  perform public._time_sane_workday(p_work_date, p_clock_in, p_clock_out, cid);
  insert into public.time_workdays (company_id, person_id, work_date, clock_in_at, clock_out_at, status, truck_id, truck_source)
  values (cid, p_person, p_work_date, p_clock_in, p_clock_out, case when p_clock_out is null then 'active' else 'closed' end, p_truck, case when p_truck is null then null else 'owner' end)
  returning id into wid;
  insert into public.time_workday_rates (workday_id, company_id, hourly_rate) values (wid, cid, public._time_rate(cid, p_person, p_work_date));
  perform public._time_audit(cid, 'workday', wid, p_person, wid, null, 'added', null, null, jsonb_build_object('clock_in_at', p_clock_in, 'clock_out_at', p_clock_out), p_reason, false);
  return wid;
end;
$function$;

create or replace function public.time_staff_edit_break(p_break uuid, p_started timestamp with time zone default null::timestamp with time zone, p_ended timestamp with time zone default null::timestamp with time zone, p_reason text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare b public.time_breaks; was boolean;
begin
  select * into b from public.time_breaks where id = p_break for update;
  if not found then raise exception 'Break not found.'; end if;
  perform public._time_need_staff(b.company_id, p_reason);
  perform public._time_no_future(p_started); perform public._time_no_future(p_ended);
  if coalesce(p_started, b.started_at) = b.started_at and coalesce(p_ended, b.ended_at) is not distinct from b.ended_at then return; end if;  -- nothing changed
  was := public._time_touch_approval(b.workday_id);
  update public.time_breaks set started_at = coalesce(p_started, started_at), ended_at = coalesce(p_ended, ended_at) where id = b.id;
  perform public._time_audit(b.company_id, 'break', b.id, b.person_id, b.workday_id, null, 'corrected', 'break',
                             jsonb_build_object('started_at', b.started_at, 'ended_at', b.ended_at), jsonb_build_object('started_at', coalesce(p_started, b.started_at), 'ended_at', coalesce(p_ended, b.ended_at)), p_reason, was);
end;
$function$;

create or replace function public.time_staff_edit_interval(p_interval uuid, p_started timestamp with time zone default null::timestamp with time zone, p_ended timestamp with time zone default null::timestamp with time zone, p_reason text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare i public.time_intervals; was boolean; new_s timestamptz; new_e timestamptz;
begin
  select * into i from public.time_intervals where id = p_interval for update;
  if not found then raise exception 'Property visit time not found.'; end if;
  perform public._time_need_staff(i.company_id, p_reason);
  if i.status = 'void' then raise exception 'That time was removed. Add a new job time instead.'; end if;
  new_s := coalesce(p_started, i.started_at); new_e := coalesce(p_ended, i.ended_at);
  if new_s = i.started_at and new_e is not distinct from i.ended_at then return; end if;  -- nothing changed
  perform public._time_no_future(new_s); perform public._time_no_future(new_e);
  was := public._time_touch_approval(i.workday_id);
  update public.time_intervals set started_at = new_s, ended_at = new_e where id = i.id;
  if i.legacy_session_id is not null then
    update public.work_sessions set check_in_time = new_s, check_out_time = new_e,
           duration_minutes = case when new_e is null then null else round(extract(epoch from (new_e - new_s)) / 60.0, 2) end,
           status = case when new_e is null then status else 'corrected' end
     where id = i.legacy_session_id;
  end if;
  perform public._time_refresh_visit(i.visit_id);
  if new_s is distinct from i.started_at then
    perform public._time_audit(i.company_id, 'interval', i.id, i.person_id, i.workday_id, i.visit_id, 'corrected', 'started_at', to_jsonb(i.started_at), to_jsonb(new_s), p_reason, was);
  end if;
  if new_e is distinct from i.ended_at then
    perform public._time_audit(i.company_id, 'interval', i.id, i.person_id, i.workday_id, i.visit_id, case when i.ended_at is null then 'timer_stopped' else 'corrected' end, 'ended_at', to_jsonb(i.ended_at), to_jsonb(new_e), p_reason, was);
  end if;
end;
$function$;

create or replace function public.time_staff_edit_workday(p_workday uuid, p_clock_in timestamp with time zone default null::timestamp with time zone, p_clock_out timestamp with time zone default null::timestamp with time zone, p_reason text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare w public.time_workdays; was boolean; new_in timestamptz; new_out timestamptz;
begin
  select * into w from public.time_workdays where id = p_workday for update;
  if not found then raise exception 'Workday not found.'; end if;
  perform public._time_need_staff(w.company_id, p_reason);
  new_in := coalesce(p_clock_in, w.clock_in_at);
  new_out := coalesce(p_clock_out, w.clock_out_at);
  if new_in is not distinct from w.clock_in_at and new_out is not distinct from w.clock_out_at then return; end if;  -- nothing changed: no reopen, no history row
  perform public._time_no_future(new_in); perform public._time_no_future(new_out);
  perform public._time_sane_workday(w.work_date, new_in, new_out, w.company_id);
  if p_clock_out is not null and w.clock_out_at is null then
    if exists (select 1 from public.time_intervals where workday_id = w.id and ended_at is null and status = 'active') then
      raise exception 'A job visit is still running. Stop its timer first, then set the clock-out.';
    end if;
    if exists (select 1 from public.time_breaks where workday_id = w.id and ended_at is null) then
      raise exception 'A break is still running. End it first, then set the clock-out.';
    end if;
  end if;
  was := (w.status = 'approved');
  update public.time_workdays
     set clock_in_at = new_in, clock_out_at = new_out,
         -- A flagged day with a real end time set is settled: back to a normal closed day waiting for approval.
         status = case when w.status = 'approved' then 'reopened'
                       when w.status = 'needs_review' and new_out is not null and new_out > new_in then 'closed'
                       when new_out is not null and w.status = 'active' then 'closed'
                       else w.status end
   where id = w.id;
  if new_in is distinct from w.clock_in_at then
    perform public._time_audit(w.company_id, 'workday', w.id, w.person_id, w.id, null, 'corrected', 'clock_in_at', to_jsonb(w.clock_in_at), to_jsonb(new_in), p_reason, was);
  end if;
  if new_out is distinct from w.clock_out_at then
    perform public._time_audit(w.company_id, 'workday', w.id, w.person_id, w.id, null, case when w.clock_out_at is null then 'clock_out_set' else 'corrected' end, 'clock_out_at', to_jsonb(w.clock_out_at), to_jsonb(new_out), p_reason, was);
  end if;
end;
$function$;

create or replace function public.time_staff_void_interval(p_interval uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare i public.time_intervals; was boolean;
begin
  select * into i from public.time_intervals where id = p_interval for update;
  if not found then raise exception 'Property visit time not found.'; end if;
  perform public._time_need_staff(i.company_id, p_reason);
  if i.status = 'void' then return; end if;  -- already removed: a repeat changes nothing and adds no history row
  was := public._time_touch_approval(i.workday_id);
  update public.time_intervals set status = 'void' where id = i.id;
  -- The older Hours / Payroll Estimate read the work session written alongside this time. Zero it (nothing is deleted: the original
  -- times are kept in the session's correction note and in the history) so the two systems agree.
  if i.legacy_session_id is not null then
    update public.work_sessions
       set correction = coalesce(correction, '{}'::jsonb) || jsonb_build_object('voided_by_time_tracking', true, 'original_check_in', check_in_time,
                          'original_check_out', check_out_time, 'original_duration_minutes', duration_minutes, 'reason', p_reason),
           check_out_time = check_in_time, duration_minutes = 0, status = 'corrected'
     where id = i.legacy_session_id;
  end if;
  perform public._time_refresh_visit(i.visit_id);
  perform public._time_audit(i.company_id, 'interval', i.id, i.person_id, i.workday_id, i.visit_id, 'voided', 'status', to_jsonb(i.status), to_jsonb('void'::text), p_reason, was);
end;
$function$;

create or replace function public.time_start_visit(p_source text, p_ref uuid, p_lat double precision default null::double precision, p_lng double precision default null::double precision, p_accuracy double precision default null::double precision, p_location_state text default 'ok'::text, p_gps jsonb default null::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := public.my_person_id();
  cid uuid;
  st public.time_settings;
  w public.time_workdays;
  staff boolean;
  a public.assignments;
  v public.time_visits;
  blocked text;
  tgt integer;
  vlabel text;
  sess uuid;
  iid uuid;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  if cid is null then raise exception 'You are not on a team yet.'; end if;
  st := public._time_settings_row(cid);
  staff := public.is_staff(cid);
  select * into w from public.time_workdays where person_id = me and clock_out_at is null for update;
  if not found then raise exception 'Clock in for the day first.'; end if;
  if exists (select 1 from public.time_breaks b where b.workday_id = w.id and b.ended_at is null) then
    raise exception 'End your break before starting a job.';
  end if;

  -- p_source is kept for the app's call; the only kind of work timed here is a scheduled job ('assignment').
  if p_source is distinct from 'assignment' then raise exception 'Unknown kind of work.'; end if;
  select * into a from public.assignments where id = p_ref;
  if not found or a.company_id <> cid then raise exception 'Job not found.'; end if;
  if a.person_id <> me then raise exception 'That job is not assigned to you.'; end if;
  if a.status in ('cancelled', 'reassigned') then raise exception 'That job was cancelled.'; end if;
  if a.scheduled_date <> w.work_date then raise exception 'That job is scheduled for another day.'; end if;
  blocked := public._time_blocking_stop(p_source, p_ref, me);
  if blocked is not null then
    -- The owner may work out of order (it is written to the history once the timer starts, below).
    if not staff then raise exception 'Finish % first. Jobs are worked in order.', blocked; end if;
  end if;
  -- Already working here? Return the day (a double tap changes nothing).
  if exists (select 1 from public.time_intervals i join public.time_visits tv on tv.id = i.visit_id
              where tv.project_id = a.project_id and tv.visit_date = a.scheduled_date and i.person_id = me and i.ended_at is null) then
    return public._time_day_json(me, cid, w.work_date);
  end if;
  if exists (select 1 from public.time_intervals i where i.person_id = me and i.ended_at is null and i.status = 'active') then
    raise exception 'You are already working on another job. Complete it first.';
  end if;
  -- The photo has to be one this worker took for this job today (created_at is stamped by the server; taken_at comes from the phone).
  if st.require_start_photo and not exists (select 1 from public.project_photos p where p.project_id = a.project_id and p.uploaded_by = me
                                             and p.time_phase = 'start' and p.file_key <> '' and p.created_at >= w.clock_in_at) then
    raise exception 'Take the start photo for this job first.';
  end if;
  -- Starting the work answers this worker's own pending "skip" request: it is withdrawn.
  update public.time_skip_requests set status = 'withdrawn', decided_at = now(), decision_note = 'Started the work'
   where assignment_id = a.id and requested_by = me and status = 'pending';
  select name into vlabel from public.projects where id = a.project_id;
  select target_minutes into tgt from public.time_property_targets where project_id = a.project_id and company_id = cid;
  insert into public.time_visits (company_id, source, project_id, visit_date, label, target_minutes)
  values (cid, 'project_day', a.project_id, a.scheduled_date, vlabel, tgt)
  on conflict (company_id, project_id, visit_date) where source = 'project_day' do nothing;
  select * into v from public.time_visits where company_id = cid and project_id = a.project_id and visit_date = a.scheduled_date and source = 'project_day';
  -- Keep the job check-in records right (check-in, session, assignment status): the check-in distance rule still applies to workers.
  insert into public.check_ins (company_id, assignment_id, person_id, project_id, gps)
  values (cid, a.id, me, a.project_id, p_gps);
  insert into public.work_sessions (company_id, person_id, project_id, assignment_id, check_in_time, check_in_gps, status)
  values (cid, me, a.project_id, a.id, now(), p_gps, 'active')
  returning id into sess;
  update public.assignments set status = 'checked_in' where id = a.id and status in ('scheduled', 'confirmed', 'en_route');

  insert into public.time_intervals (company_id, visit_id, workday_id, person_id, billable, legacy_session_id)
  values (cid, v.id, w.id, me, v.billable, sess)
  returning id into iid;
  insert into public.time_interval_rates (interval_id, company_id, hourly_rate) values (iid, cid, public._time_rate(cid, me, w.work_date));
  perform public._time_refresh_visit(v.id);
  if staff and blocked is not null then
    perform public._time_audit(cid, 'visit', v.id, me, w.id, v.id, 'order_override', 'job_order', null, to_jsonb(blocked), 'Started before ' || blocked || ' was finished', false);
  end if;
  return public._time_day_json(me, cid, w.work_date);
end;
$function$;

create or replace function public.time_trucks_for_clock_in(p_date date default null::date)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare me uuid := public.my_person_id(); cid uuid; d date := coalesce(p_date, current_date); assigned uuid;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  cid := public._time_company(me);
  if cid is null then raise exception 'You are not on a team yet.'; end if;
  assigned := public._time_assigned_truck(me, d);
  return jsonb_build_object(
    'assigned_truck_id', assigned,
    'assigned_truck_name', (select t.name from public.trucks t where t.id = assigned),
    'trucks', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'in_use', exists (
          select 1 from public.time_workdays w
          where w.truck_id = t.id and w.clock_out_at is null and w.person_id <> me and not public._time_same_group(me, w.person_id, d))
        ) order by t.name)
      from public.trucks t where t.company_id = cid and t.status in ('available', 'assigned')), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.time_withdraw_skip(p_request_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update public.time_skip_requests set status = 'withdrawn', decided_at = now()
   where id = p_request_id and requested_by = public.my_person_id() and status = 'pending';
end;
$function$;

create or replace function public.unregister_push_token(p_token text)
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  delete from public.push_tokens where token = p_token and person_id = public.my_person_id();
$function$;

-- ============================================================================
-- PART 3. DEFAULTS THAT USE A FUNCTION, AND LINKS BETWEEN TABLES (foreign keys)
-- ============================================================================

alter table public.quotes alter column share_token set default public.new_share_token();
alter table public.change_orders alter column share_token set default public.new_share_token();
alter table public.invoices alter column share_token set default public.new_share_token();

do $$ begin alter table public.people add constraint people_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.company_members add constraint company_members_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.company_members add constraint company_members_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.company_members add constraint company_members_deactivated_by_fkey FOREIGN KEY (deactivated_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.company_members add constraint company_members_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.projects add constraint projects_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.projects add constraint projects_customer_claimed_by_fkey FOREIGN KEY (customer_claimed_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.projects add constraint projects_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.projects add constraint projects_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.projects add constraint projects_task_lead_id_fkey FOREIGN KEY (task_lead_id) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_team add constraint project_team_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_team add constraint project_team_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_team add constraint project_team_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_tasks add constraint project_tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_tasks add constraint project_tasks_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_tasks add constraint project_tasks_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_tasks add constraint project_tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_settings add constraint project_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_settings add constraint project_settings_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_photos add constraint project_photos_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_photos add constraint project_photos_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_photos add constraint project_photos_shared_by_fkey FOREIGN KEY (shared_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_photos add constraint project_photos_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.project_tasks(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_photos add constraint project_photos_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_updates add constraint project_updates_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_updates add constraint project_updates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_updates add constraint project_updates_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_requests add constraint project_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_requests add constraint project_requests_linked_task_id_fkey FOREIGN KEY (linked_task_id) REFERENCES public.project_tasks(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_requests add constraint project_requests_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_requests add constraint project_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_history add constraint project_history_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_history add constraint project_history_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_history add constraint project_history_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.customer_timeline add constraint customer_timeline_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.customer_timeline add constraint customer_timeline_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.trucks add constraint trucks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.trucks add constraint trucks_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.assignments add constraint assignments_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.assignments add constraint assignments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.assignments add constraint assignments_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.assignments add constraint assignments_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.assignments add constraint assignments_series_id_fkey FOREIGN KEY (series_id) REFERENCES public.schedule_series(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.assignments add constraint assignments_truck_id_fkey FOREIGN KEY (truck_id) REFERENCES public.trucks(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.schedule_changes add constraint schedule_changes_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.assignments(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.schedule_changes add constraint schedule_changes_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.schedule_changes add constraint schedule_changes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.announcements add constraint announcements_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.announcements add constraint announcements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.announcement_reads add constraint announcement_reads_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcements(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.announcement_reads add constraint announcement_reads_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.announcement_reads add constraint announcement_reads_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.check_ins add constraint check_ins_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.assignments(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.check_ins add constraint check_ins_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.check_ins add constraint check_ins_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.check_ins add constraint check_ins_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.check_outs add constraint check_outs_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.assignments(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.check_outs add constraint check_outs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.check_outs add constraint check_outs_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.check_outs add constraint check_outs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.worker_activities add constraint worker_activities_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.assignments(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.worker_activities add constraint worker_activities_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.worker_activities add constraint worker_activities_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.worker_activities add constraint worker_activities_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.work_sessions add constraint work_sessions_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.assignments(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.work_sessions add constraint work_sessions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.work_sessions add constraint work_sessions_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.work_sessions add constraint work_sessions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.worker_hourly_rates add constraint worker_hourly_rates_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.worker_hourly_rates add constraint worker_hourly_rates_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.worker_hourly_rates add constraint worker_hourly_rates_set_by_fkey FOREIGN KEY (set_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.worker_pay_settings add constraint worker_pay_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.worker_pay_settings add constraint worker_pay_settings_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.overtime_rules add constraint overtime_rules_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.company_operations_settings add constraint company_operations_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.company_operations_settings add constraint company_operations_settings_overtime_rule_id_fkey FOREIGN KEY (overtime_rule_id) REFERENCES public.overtime_rules(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.notification_preferences add constraint notification_preferences_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.notification_preferences add constraint notification_preferences_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.app_notifications add constraint app_notifications_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.app_notifications add constraint app_notifications_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.worker_reminders add constraint worker_reminders_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.assignments(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.worker_reminders add constraint worker_reminders_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.worker_reminders add constraint worker_reminders_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.worker_settings add constraint worker_settings_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.team_codes add constraint team_codes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.team_codes add constraint team_codes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.company_join_settings add constraint company_join_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.company_join_settings add constraint company_join_settings_current_team_code_id_fkey FOREIGN KEY (current_team_code_id) REFERENCES public.team_codes(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.company_invitations add constraint company_invitations_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.company_invitations add constraint company_invitations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.company_invitations add constraint company_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.company_invitations add constraint company_invitations_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.join_requests add constraint join_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.join_requests add constraint join_requests_invitation_id_fkey FOREIGN KEY (invitation_id) REFERENCES public.company_invitations(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.join_requests add constraint join_requests_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.join_requests add constraint join_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.membership_audit_log add constraint membership_audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.membership_audit_log add constraint membership_audit_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.membership_audit_log add constraint membership_audit_log_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_messages add constraint project_messages_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_messages add constraint project_messages_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_messages add constraint project_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.schedule_series add constraint schedule_series_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.schedule_series add constraint schedule_series_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.schedule_series add constraint schedule_series_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.schedule_series add constraint schedule_series_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.schedule_series add constraint schedule_series_truck_id_fkey FOREIGN KEY (truck_id) REFERENCES public.trucks(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.crews add constraint crews_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.crew_members add constraint crew_members_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.crew_members add constraint crew_members_crew_id_fkey FOREIGN KEY (crew_id) REFERENCES public.crews(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.crew_members add constraint crew_members_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.task_attachments add constraint task_attachments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.task_attachments add constraint task_attachments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.task_attachments add constraint task_attachments_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.task_attachments add constraint task_attachments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.project_tasks(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.company_resources add constraint company_resources_card_holder_id_fkey FOREIGN KEY (card_holder_id) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.company_resources add constraint company_resources_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.company_resources add constraint company_resources_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.company_resources add constraint company_resources_truck_id_fkey FOREIGN KEY (truck_id) REFERENCES public.trucks(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.company_resources add constraint company_resources_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.resource_access add constraint resource_access_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.resource_access add constraint resource_access_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.resource_access add constraint resource_access_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.resource_access add constraint resource_access_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.company_resources(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.resource_secrets add constraint resource_secrets_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.company_resources(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.resource_audit_log add constraint resource_audit_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.quotes add constraint quotes_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.quotes add constraint quotes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.quotes add constraint quotes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.quotes add constraint quotes_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.quotes add constraint quotes_declined_by_fkey FOREIGN KEY (declined_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.quotes add constraint quotes_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.change_orders add constraint change_orders_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.change_orders add constraint change_orders_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.change_orders add constraint change_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.change_orders add constraint change_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.change_orders add constraint change_orders_declined_by_fkey FOREIGN KEY (declined_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.change_orders add constraint change_orders_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.change_orders add constraint change_orders_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES public.quotes(id) ON DELETE RESTRICT; exception when duplicate_object then null; end $$;
do $$ begin alter table public.invoices add constraint invoices_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.invoices add constraint invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.invoices add constraint invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.invoices add constraint invoices_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.invoices add constraint invoices_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES public.quotes(id) ON DELETE RESTRICT; exception when duplicate_object then null; end $$;
do $$ begin alter table public.financial_events add constraint financial_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.financial_events add constraint financial_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.financial_events add constraint financial_events_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.push_tokens add constraint push_tokens_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.financial_settings add constraint financial_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.material_vendors add constraint material_vendors_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_materials add constraint project_materials_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_materials add constraint project_materials_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_materials add constraint project_materials_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_materials add constraint project_materials_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.material_vendors(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_material_plans add constraint project_material_plans_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_material_plans add constraint project_material_plans_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.project_material_plans add constraint project_material_plans_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.material_vendors(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.property_issues add constraint property_issues_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.property_issues add constraint property_issues_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.property_issues add constraint property_issues_reported_by_fkey FOREIGN KEY (reported_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.property_issues add constraint property_issues_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.content_reports add constraint content_reports_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.content_reports add constraint content_reports_handled_by_fkey FOREIGN KEY (handled_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.content_reports add constraint content_reports_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.content_reports add constraint content_reports_reported_by_fkey FOREIGN KEY (reported_by) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.truck_documents add constraint truck_documents_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.truck_documents add constraint truck_documents_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.truck_documents add constraint truck_documents_truck_id_fkey FOREIGN KEY (truck_id) REFERENCES public.trucks(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.truck_notes add constraint truck_notes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.truck_notes add constraint truck_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.truck_notes add constraint truck_notes_truck_id_fkey FOREIGN KEY (truck_id) REFERENCES public.trucks(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.owner_project_notes add constraint owner_project_notes_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.owner_project_notes add constraint owner_project_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.owner_project_notes add constraint owner_project_notes_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.owner_project_photos add constraint owner_project_photos_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.owner_project_photos add constraint owner_project_photos_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.owner_project_photos add constraint owner_project_photos_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.owner_material_lists add constraint owner_material_lists_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.owner_material_lists add constraint owner_material_lists_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.owner_material_lists add constraint owner_material_lists_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.person_ids add constraint person_ids_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_settings add constraint time_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_settings add constraint time_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_person_settings add constraint time_person_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_person_settings add constraint time_person_settings_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_property_targets add constraint time_property_targets_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_property_targets add constraint time_property_targets_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_property_targets add constraint time_property_targets_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_workdays add constraint time_workdays_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_workdays add constraint time_workdays_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_workdays add constraint time_workdays_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE RESTRICT; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_workdays add constraint time_workdays_truck_id_fkey FOREIGN KEY (truck_id) REFERENCES public.trucks(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_workday_rates add constraint time_workday_rates_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_workday_rates add constraint time_workday_rates_workday_id_fkey FOREIGN KEY (workday_id) REFERENCES public.time_workdays(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_breaks add constraint time_breaks_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_breaks add constraint time_breaks_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE RESTRICT; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_breaks add constraint time_breaks_workday_id_fkey FOREIGN KEY (workday_id) REFERENCES public.time_workdays(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_visits add constraint time_visits_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_visits add constraint time_visits_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_intervals add constraint time_intervals_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_intervals add constraint time_intervals_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE RESTRICT; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_intervals add constraint time_intervals_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.time_visits(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_intervals add constraint time_intervals_workday_id_fkey FOREIGN KEY (workday_id) REFERENCES public.time_workdays(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_interval_rates add constraint time_interval_rates_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_interval_rates add constraint time_interval_rates_interval_id_fkey FOREIGN KEY (interval_id) REFERENCES public.time_intervals(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_skip_requests add constraint time_skip_requests_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.assignments(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_skip_requests add constraint time_skip_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_skip_requests add constraint time_skip_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_skip_requests add constraint time_skip_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.people(id) ON DELETE RESTRICT; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_audit add constraint time_audit_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_audit add constraint time_audit_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_audit add constraint time_audit_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_alerts add constraint time_alerts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_alerts add constraint time_alerts_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_alerts add constraint time_alerts_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_alerts add constraint time_alerts_skip_request_id_fkey FOREIGN KEY (skip_request_id) REFERENCES public.time_skip_requests(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_alerts add constraint time_alerts_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES public.time_visits(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_alerts add constraint time_alerts_workday_id_fkey FOREIGN KEY (workday_id) REFERENCES public.time_workdays(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_project_estimates add constraint time_project_estimates_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_project_estimates add constraint time_project_estimates_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_project_estimates add constraint time_project_estimates_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.company_admin_permissions add constraint company_admin_permissions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.company_admin_permissions add constraint company_admin_permissions_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.properties add constraint properties_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.properties add constraint properties_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.properties add constraint properties_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.truck_maintenance add constraint truck_maintenance_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.truck_maintenance add constraint truck_maintenance_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.truck_maintenance add constraint truck_maintenance_truck_id_fkey FOREIGN KEY (truck_id) REFERENCES public.trucks(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.invites add constraint invites_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.invites add constraint invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.invites add constraint invites_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.customer_email_links add constraint customer_email_links_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.customer_email_links add constraint customer_email_links_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.customer_email_links add constraint customer_email_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.public_weather_settings add constraint public_weather_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.public_weather_settings add constraint public_weather_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.company_yard_alerts add constraint company_yard_alerts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.company_yard_alerts add constraint company_yard_alerts_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_clock_locations add constraint time_clock_locations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_clock_locations add constraint time_clock_locations_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.time_clock_locations add constraint time_clock_locations_workday_id_fkey FOREIGN KEY (workday_id) REFERENCES public.time_workdays(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.service_requests add constraint service_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE; exception when duplicate_object then null; end $$;
do $$ begin alter table public.service_requests add constraint service_requests_handled_by_fkey FOREIGN KEY (handled_by) REFERENCES public.people(id) ON DELETE SET NULL; exception when duplicate_object then null; end $$;

-- ============================================================================
-- PART 4. INDEXES (speed, and some one-of-a-kind rules)
-- ============================================================================

create index if not exists idx_people_email ON public.people USING btree (lower(email));
create index if not exists idx_members_person ON public.company_members USING btree (person_id);
create index if not exists idx_projects_company ON public.projects USING btree (company_id);
create index if not exists idx_projects_property ON public.projects USING btree (property_id);
create index if not exists idx_project_team_project ON public.project_team USING btree (project_id);
create index if not exists idx_project_tasks_project ON public.project_tasks USING btree (project_id);
create index if not exists idx_project_photos_project ON public.project_photos USING btree (project_id);
create index if not exists idx_project_updates_project ON public.project_updates USING btree (project_id);
create index if not exists idx_project_requests_project ON public.project_requests USING btree (project_id);
create index if not exists idx_project_history_project ON public.project_history USING btree (project_id, created_at DESC);
create index if not exists idx_customer_timeline_project ON public.customer_timeline USING btree (project_id, "timestamp" DESC);
create index if not exists idx_trucks_company ON public.trucks USING btree (company_id);
create index if not exists idx_assignments_company_date ON public.assignments USING btree (company_id, scheduled_date);
create index if not exists idx_assignments_person_date ON public.assignments USING btree (person_id, scheduled_date);
create unique index if not exists uq_assignments_worker_job_day ON public.assignments USING btree (person_id, project_id, scheduled_date) WHERE (status <> ALL (ARRAY['cancelled'::text, 'reassigned'::text]));
create unique index if not exists uq_assignments_series_day ON public.assignments USING btree (series_id, scheduled_date) WHERE (series_id IS NOT NULL);
create index if not exists idx_schedule_changes_company ON public.schedule_changes USING btree (company_id, created_at DESC);
create index if not exists idx_announcements_company ON public.announcements USING btree (company_id, created_at DESC);
create index if not exists idx_check_ins_person ON public.check_ins USING btree (person_id, "timestamp" DESC);
create index if not exists idx_check_outs_person ON public.check_outs USING btree (person_id, "timestamp" DESC);
create index if not exists idx_worker_activities_person ON public.worker_activities USING btree (person_id, "timestamp" DESC);
create index if not exists idx_work_sessions_company ON public.work_sessions USING btree (company_id, check_in_time);
create index if not exists idx_notifications_recipient ON public.app_notifications USING btree (recipient_id, created_at DESC);
create index if not exists idx_invitations_email ON public.company_invitations USING btree (lower(email));
create unique index if not exists idx_join_requests_one_pending ON public.join_requests USING btree (company_id, person_id) WHERE (status = 'pending'::text);
create index if not exists idx_project_messages_project ON public.project_messages USING btree (project_id, created_at);
create index if not exists idx_schedule_series_company ON public.schedule_series USING btree (company_id);
create unique index if not exists uq_crews_company_name ON public.crews USING btree (company_id, lower(TRIM(BOTH FROM name)));
create index if not exists idx_crew_members_crew ON public.crew_members USING btree (crew_id);
create unique index if not exists uq_crew_members_crew_person ON public.crew_members USING btree (crew_id, person_id);
create index if not exists idx_task_attachments_task ON public.task_attachments USING btree (task_id);
create index if not exists idx_task_attachments_project ON public.task_attachments USING btree (project_id);
create index if not exists idx_company_resources_company ON public.company_resources USING btree (company_id);
create index if not exists idx_company_resources_truck ON public.company_resources USING btree (truck_id);
create index if not exists idx_resource_access_person ON public.resource_access USING btree (person_id);
create index if not exists idx_resource_audit_resource ON public.resource_audit_log USING btree (resource_id, created_at DESC);
create index if not exists idx_quotes_project ON public.quotes USING btree (project_id, created_at);
create unique index if not exists quotes_share_token_key ON public.quotes USING btree (share_token);
create index if not exists idx_change_orders_project ON public.change_orders USING btree (project_id, created_at);
create unique index if not exists change_orders_share_token_key ON public.change_orders USING btree (share_token);
create index if not exists idx_invoices_project ON public.invoices USING btree (project_id, created_at);
create unique index if not exists invoices_share_token_key ON public.invoices USING btree (share_token);
create index if not exists idx_financial_events_doc ON public.financial_events USING btree (document_id, created_at);
create index if not exists idx_push_tokens_person ON public.push_tokens USING btree (person_id);
create index if not exists idx_material_vendors_company ON public.material_vendors USING btree (company_id);
create index if not exists idx_project_materials_project ON public.project_materials USING btree (project_id, sort_order);
create index if not exists idx_property_issues_company ON public.property_issues USING btree (company_id, status, created_at DESC);
create index if not exists idx_property_issues_project ON public.property_issues USING btree (project_id);
create index if not exists idx_content_reports_company ON public.content_reports USING btree (company_id, status, created_at DESC);
create index if not exists idx_truck_documents_truck ON public.truck_documents USING btree (truck_id, created_at DESC);
create index if not exists idx_truck_notes_truck ON public.truck_notes USING btree (truck_id, created_at DESC);
create index if not exists idx_owner_project_notes_project ON public.owner_project_notes USING btree (project_id, created_at DESC);
create index if not exists idx_owner_project_photos_project ON public.owner_project_photos USING btree (project_id, created_at DESC);
create index if not exists idx_owner_material_lists_project ON public.owner_material_lists USING btree (project_id, created_at DESC);
create unique index if not exists uq_time_target_project ON public.time_property_targets USING btree (project_id) WHERE (project_id IS NOT NULL);
create index if not exists idx_time_workdays_company_date ON public.time_workdays USING btree (company_id, work_date);
create index if not exists idx_time_workdays_person_date ON public.time_workdays USING btree (person_id, work_date);
create unique index if not exists uq_time_workday_open ON public.time_workdays USING btree (person_id) WHERE (clock_out_at IS NULL);
create index if not exists idx_time_breaks_workday ON public.time_breaks USING btree (workday_id);
create unique index if not exists uq_time_break_open ON public.time_breaks USING btree (workday_id) WHERE (ended_at IS NULL);
create unique index if not exists uq_time_visit_project_day ON public.time_visits USING btree (company_id, project_id, visit_date) WHERE (source = 'project_day'::text);
create index if not exists idx_time_visits_company_date ON public.time_visits USING btree (company_id, visit_date);
create index if not exists idx_time_visits_project ON public.time_visits USING btree (project_id, visit_date);
create index if not exists idx_time_intervals_visit ON public.time_intervals USING btree (visit_id);
create index if not exists idx_time_intervals_workday ON public.time_intervals USING btree (workday_id);
create index if not exists idx_time_intervals_person ON public.time_intervals USING btree (person_id, started_at);
create unique index if not exists uq_time_interval_active ON public.time_intervals USING btree (person_id) WHERE ((ended_at IS NULL) AND (status = 'active'::text));
create unique index if not exists uq_time_skip_pending_assignment ON public.time_skip_requests USING btree (assignment_id) WHERE ((status = 'pending'::text) AND (assignment_id IS NOT NULL));
create index if not exists idx_time_skip_company ON public.time_skip_requests USING btree (company_id, status, created_at DESC);
create index if not exists idx_time_audit_company ON public.time_audit USING btree (company_id, created_at DESC);
create index if not exists idx_time_audit_workday ON public.time_audit USING btree (workday_id);
create index if not exists idx_time_audit_visit ON public.time_audit USING btree (visit_id);
create index if not exists idx_time_alerts_company ON public.time_alerts USING btree (company_id, status, created_at DESC);
create unique index if not exists uq_storage_cleanup_key ON public.storage_cleanup_queue USING btree (file_key);
create index if not exists idx_storage_cleanup_due ON public.storage_cleanup_queue USING btree (next_attempt_at) WHERE (status = 'pending'::text);
create index if not exists idx_properties_company ON public.properties USING btree (company_id);
create index if not exists idx_properties_customer ON public.properties USING btree (customer_id);
create unique index if not exists uq_properties_customer_address ON public.properties USING btree (company_id, customer_id, address_key) WHERE ((customer_id IS NOT NULL) AND (address_key <> ''::text));
create index if not exists idx_truck_maintenance_truck ON public.truck_maintenance USING btree (truck_id, serviced_on DESC);
create index if not exists idx_truck_maintenance_due ON public.truck_maintenance USING btree (company_id, due_on) WHERE (due_on IS NOT NULL);
create index if not exists idx_invites_person ON public.invites USING btree (person_id);
create index if not exists idx_invites_company ON public.invites USING btree (company_id, status);
create index if not exists idx_service_requests_company ON public.service_requests USING btree (company_id, created_at DESC);
create index if not exists idx_service_requests_phone ON public.service_requests USING btree (phone_digits, created_at DESC);

-- ============================================================================
-- PART 5. TRIGGERS (rules that run on every insert/update/delete)
-- ============================================================================

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
-- R6: a login that confirms its email is linked to a customer record the owner added by that email while it was unconfirmed.
drop trigger if exists on_auth_email_confirmed on auth.users;
create trigger on_auth_email_confirmed AFTER UPDATE OF email_confirmed_at ON auth.users FOR EACH ROW EXECUTE FUNCTION public._link_customer_on_email_confirm();
drop trigger if exists companies_no_delete on public.companies;
create trigger companies_no_delete BEFORE DELETE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.prevent_company_delete();
drop trigger if exists companies_no_truncate on public.companies;
create trigger companies_no_truncate BEFORE TRUNCATE ON public.companies FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_company_delete();
drop trigger if exists companies_one_only on public.companies;
create trigger companies_one_only BEFORE INSERT ON public.companies FOR EACH ROW EXECUTE FUNCTION public.enforce_one_company();
drop trigger if exists companies_updated_at on public.companies;
create trigger companies_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists people_updated_at on public.people;
create trigger people_updated_at BEFORE UPDATE ON public.people FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists company_members_deactivated on public.company_members;
create trigger company_members_deactivated AFTER UPDATE OF status ON public.company_members FOR EACH ROW EXECUTE FUNCTION public._member_deactivated();
drop trigger if exists company_members_deactivation_block on public.company_members;
create trigger company_members_deactivation_block BEFORE UPDATE OF status ON public.company_members FOR EACH ROW EXECUTE FUNCTION public._member_deactivation_block();
drop trigger if exists company_members_guard on public.company_members;
create trigger company_members_guard BEFORE INSERT OR DELETE OR UPDATE ON public.company_members FOR EACH ROW EXECUTE FUNCTION public._company_members_guard();
drop trigger if exists company_members_revoke_resources on public.company_members;
create trigger company_members_revoke_resources AFTER DELETE OR UPDATE OF status, role ON public.company_members FOR EACH ROW EXECUTE FUNCTION public.revoke_resources_on_member_change();
drop trigger if exists company_members_updated_at on public.company_members;
create trigger company_members_updated_at BEFORE UPDATE ON public.company_members FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists projects_customer_company_guard on public.projects;
create trigger projects_customer_company_guard BEFORE INSERT OR UPDATE OF customer_id ON public.projects FOR EACH ROW EXECUTE FUNCTION public._customer_same_company_guard();
drop trigger if exists projects_property_link_guard on public.projects;
create trigger projects_property_link_guard BEFORE INSERT OR UPDATE OF property_id ON public.projects FOR EACH ROW EXECUTE FUNCTION public._property_link_guard();
drop trigger if exists projects_task_lead_check on public.projects;
create trigger projects_task_lead_check BEFORE UPDATE OF task_lead_id ON public.projects FOR EACH ROW EXECUTE FUNCTION public.check_task_lead();
drop trigger if exists projects_updated_at on public.projects;
create trigger projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists project_team_company on public.project_team;
create trigger project_team_company BEFORE INSERT OR UPDATE OF project_id ON public.project_team FOR EACH ROW EXECUTE FUNCTION public.set_company_from_project();
drop trigger if exists project_tasks_company on public.project_tasks;
create trigger project_tasks_company BEFORE INSERT OR UPDATE OF project_id ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION public.set_company_from_project();
drop trigger if exists project_tasks_task_lead on public.project_tasks;
create trigger project_tasks_task_lead BEFORE INSERT OR UPDATE ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION public.enforce_task_lead();
drop trigger if exists project_tasks_updated_at on public.project_tasks;
create trigger project_tasks_updated_at BEFORE UPDATE ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists zz_project_tasks_progress on public.project_tasks;
create trigger zz_project_tasks_progress AFTER INSERT OR DELETE OR UPDATE OF status ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION public._project_tasks_progress();
drop trigger if exists project_settings_company on public.project_settings;
create trigger project_settings_company BEFORE INSERT OR UPDATE OF project_id ON public.project_settings FOR EACH ROW EXECUTE FUNCTION public.set_company_from_project();
drop trigger if exists project_settings_updated_at on public.project_settings;
create trigger project_settings_updated_at BEFORE UPDATE ON public.project_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists project_photos_company on public.project_photos;
create trigger project_photos_company BEFORE INSERT OR UPDATE OF project_id ON public.project_photos FOR EACH ROW EXECUTE FUNCTION public.set_company_from_project();
drop trigger if exists zz_enqueue_deleted_file on public.project_photos;
create trigger zz_enqueue_deleted_file AFTER DELETE ON public.project_photos FOR EACH ROW EXECUTE FUNCTION public._enqueue_deleted_file();
drop trigger if exists project_updates_company on public.project_updates;
create trigger project_updates_company BEFORE INSERT OR UPDATE OF project_id ON public.project_updates FOR EACH ROW EXECUTE FUNCTION public.set_company_from_project();
drop trigger if exists project_updates_updated_at on public.project_updates;
create trigger project_updates_updated_at BEFORE UPDATE ON public.project_updates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists project_requests_company on public.project_requests;
create trigger project_requests_company BEFORE INSERT OR UPDATE OF project_id ON public.project_requests FOR EACH ROW EXECUTE FUNCTION public.set_company_from_project();
drop trigger if exists project_requests_updated_at on public.project_requests;
create trigger project_requests_updated_at BEFORE UPDATE ON public.project_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists project_history_company on public.project_history;
create trigger project_history_company BEFORE INSERT OR UPDATE OF project_id ON public.project_history FOR EACH ROW EXECUTE FUNCTION public.set_company_from_project();
drop trigger if exists customer_timeline_company on public.customer_timeline;
create trigger customer_timeline_company BEFORE INSERT OR UPDATE OF project_id ON public.customer_timeline FOR EACH ROW EXECUTE FUNCTION public.set_company_from_project();
drop trigger if exists trucks_updated_at on public.trucks;
create trigger trucks_updated_at BEFORE UPDATE ON public.trucks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists assignments_updated_at on public.assignments;
create trigger assignments_updated_at BEFORE UPDATE ON public.assignments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists trg_auto_task_lead on public.assignments;
create trigger trg_auto_task_lead AFTER INSERT ON public.assignments FOR EACH ROW EXECUTE FUNCTION public._auto_task_lead_after_assignment();
drop trigger if exists trg_time_auto_close_assignment on public.assignments;
create trigger trg_time_auto_close_assignment AFTER UPDATE OF status ON public.assignments FOR EACH ROW WHEN (((new.status = ANY (ARRAY['completed'::text, 'cancelled'::text, 'reassigned'::text])) AND (old.status IS DISTINCT FROM new.status))) EXECUTE FUNCTION public._time_auto_close_after_assignment();
drop trigger if exists announcements_updated_at on public.announcements;
create trigger announcements_updated_at BEFORE UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists check_ins_enforce_radius on public.check_ins;
create trigger check_ins_enforce_radius BEFORE INSERT ON public.check_ins FOR EACH ROW EXECUTE FUNCTION public.enforce_checkin_radius();
drop trigger if exists work_sessions_enforce_radius on public.work_sessions;
create trigger work_sessions_enforce_radius BEFORE INSERT ON public.work_sessions FOR EACH ROW EXECUTE FUNCTION public.enforce_checkin_radius();
drop trigger if exists work_sessions_updated_at on public.work_sessions;
create trigger work_sessions_updated_at BEFORE UPDATE ON public.work_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists worker_pay_settings_updated_at on public.worker_pay_settings;
create trigger worker_pay_settings_updated_at BEFORE UPDATE ON public.worker_pay_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists overtime_rules_updated_at on public.overtime_rules;
create trigger overtime_rules_updated_at BEFORE UPDATE ON public.overtime_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists company_operations_settings_updated_at on public.company_operations_settings;
create trigger company_operations_settings_updated_at BEFORE UPDATE ON public.company_operations_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists notification_preferences_updated_at on public.notification_preferences;
create trigger notification_preferences_updated_at BEFORE UPDATE ON public.notification_preferences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists app_notifications_push on public.app_notifications;
create trigger app_notifications_push AFTER INSERT ON public.app_notifications FOR EACH ROW EXECUTE FUNCTION public.push_app_notification();
drop trigger if exists worker_settings_updated_at on public.worker_settings;
create trigger worker_settings_updated_at BEFORE UPDATE ON public.worker_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists join_requests_updated_at on public.join_requests;
create trigger join_requests_updated_at BEFORE UPDATE ON public.join_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists project_messages_company on public.project_messages;
create trigger project_messages_company BEFORE INSERT OR UPDATE OF project_id ON public.project_messages FOR EACH ROW EXECUTE FUNCTION public.set_company_from_project();
drop trigger if exists schedule_series_updated_at on public.schedule_series;
create trigger schedule_series_updated_at BEFORE UPDATE ON public.schedule_series FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists crews_updated_at on public.crews;
create trigger crews_updated_at BEFORE UPDATE ON public.crews FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists zz_enqueue_deleted_file on public.task_attachments;
create trigger zz_enqueue_deleted_file AFTER DELETE ON public.task_attachments FOR EACH ROW EXECUTE FUNCTION public._enqueue_deleted_file();
drop trigger if exists company_resources_audit on public.company_resources;
create trigger company_resources_audit AFTER INSERT OR DELETE OR UPDATE ON public.company_resources FOR EACH ROW EXECUTE FUNCTION public.company_resources_audit();
drop trigger if exists company_resources_check on public.company_resources;
create trigger company_resources_check BEFORE INSERT OR UPDATE ON public.company_resources FOR EACH ROW EXECUTE FUNCTION public.company_resources_check();
drop trigger if exists company_resources_updated_at on public.company_resources;
create trigger company_resources_updated_at BEFORE UPDATE ON public.company_resources FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists resource_access_audit on public.resource_access;
create trigger resource_access_audit AFTER INSERT OR DELETE ON public.resource_access FOR EACH ROW EXECUTE FUNCTION public.resource_access_audit();
drop trigger if exists resource_access_check on public.resource_access;
create trigger resource_access_check BEFORE INSERT OR UPDATE ON public.resource_access FOR EACH ROW EXECUTE FUNCTION public.resource_access_check();
drop trigger if exists resource_secrets_cleanup on public.resource_secrets;
create trigger resource_secrets_cleanup AFTER DELETE ON public.resource_secrets FOR EACH ROW EXECUTE FUNCTION public.resource_secrets_cleanup();
drop trigger if exists quotes_company on public.quotes;
create trigger quotes_company BEFORE INSERT OR UPDATE OF project_id ON public.quotes FOR EACH ROW EXECUTE FUNCTION public.set_company_from_project();
drop trigger if exists quotes_customer_company_guard on public.quotes;
create trigger quotes_customer_company_guard BEFORE INSERT OR UPDATE OF customer_id ON public.quotes FOR EACH ROW EXECUTE FUNCTION public._customer_same_company_guard();
drop trigger if exists quotes_lock on public.quotes;
create trigger quotes_lock BEFORE UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION public.lock_financial_document();
drop trigger if exists quotes_project_company_guard on public.quotes;
create trigger quotes_project_company_guard BEFORE INSERT OR UPDATE OF project_id ON public.quotes FOR EACH ROW EXECUTE FUNCTION public._document_project_company_guard();
drop trigger if exists quotes_updated_at on public.quotes;
create trigger quotes_updated_at BEFORE UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists change_orders_company on public.change_orders;
create trigger change_orders_company BEFORE INSERT OR UPDATE OF project_id ON public.change_orders FOR EACH ROW EXECUTE FUNCTION public.set_company_from_project();
drop trigger if exists change_orders_customer_company_guard on public.change_orders;
create trigger change_orders_customer_company_guard BEFORE INSERT OR UPDATE OF customer_id ON public.change_orders FOR EACH ROW EXECUTE FUNCTION public._customer_same_company_guard();
drop trigger if exists change_orders_lock on public.change_orders;
create trigger change_orders_lock BEFORE UPDATE ON public.change_orders FOR EACH ROW EXECUTE FUNCTION public.lock_financial_document();
drop trigger if exists change_orders_project_company_guard on public.change_orders;
create trigger change_orders_project_company_guard BEFORE INSERT OR UPDATE OF project_id ON public.change_orders FOR EACH ROW EXECUTE FUNCTION public._document_project_company_guard();
drop trigger if exists change_orders_updated_at on public.change_orders;
create trigger change_orders_updated_at BEFORE UPDATE ON public.change_orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists invoices_company on public.invoices;
create trigger invoices_company BEFORE INSERT OR UPDATE OF project_id ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.set_company_from_project();
drop trigger if exists invoices_customer_company_guard on public.invoices;
create trigger invoices_customer_company_guard BEFORE INSERT OR UPDATE OF customer_id ON public.invoices FOR EACH ROW EXECUTE FUNCTION public._customer_same_company_guard();
drop trigger if exists invoices_lock on public.invoices;
create trigger invoices_lock BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.lock_financial_document();
drop trigger if exists invoices_project_company_guard on public.invoices;
create trigger invoices_project_company_guard BEFORE INSERT OR UPDATE OF project_id ON public.invoices FOR EACH ROW EXECUTE FUNCTION public._document_project_company_guard();
drop trigger if exists invoices_updated_at on public.invoices;
create trigger invoices_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists financial_events_company on public.financial_events;
create trigger financial_events_company BEFORE INSERT OR UPDATE OF project_id ON public.financial_events FOR EACH ROW EXECUTE FUNCTION public.set_company_from_project();
drop trigger if exists financial_settings_updated_at on public.financial_settings;
create trigger financial_settings_updated_at BEFORE UPDATE ON public.financial_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists material_vendors_updated_at on public.material_vendors;
create trigger material_vendors_updated_at BEFORE UPDATE ON public.material_vendors FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists project_materials_company on public.project_materials;
create trigger project_materials_company BEFORE INSERT OR UPDATE OF project_id ON public.project_materials FOR EACH ROW EXECUTE FUNCTION public.set_company_from_project();
drop trigger if exists project_materials_updated_at on public.project_materials;
create trigger project_materials_updated_at BEFORE UPDATE ON public.project_materials FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists project_material_plans_company on public.project_material_plans;
create trigger project_material_plans_company BEFORE INSERT OR UPDATE OF project_id ON public.project_material_plans FOR EACH ROW EXECUTE FUNCTION public.set_company_from_project();
drop trigger if exists project_material_plans_updated_at on public.project_material_plans;
create trigger project_material_plans_updated_at BEFORE UPDATE ON public.project_material_plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists property_issues_notify on public.property_issues;
create trigger property_issues_notify AFTER INSERT ON public.property_issues FOR EACH ROW EXECUTE FUNCTION public._property_issues_notify();
drop trigger if exists property_issues_touch on public.property_issues;
create trigger property_issues_touch BEFORE UPDATE ON public.property_issues FOR EACH ROW EXECUTE FUNCTION public._property_issues_touch();
drop trigger if exists zz_enqueue_deleted_issue_files on public.property_issues;
create trigger zz_enqueue_deleted_issue_files AFTER DELETE ON public.property_issues FOR EACH ROW EXECUTE FUNCTION public._enqueue_deleted_issue_files();
drop trigger if exists content_reports_company on public.content_reports;
create trigger content_reports_company BEFORE INSERT OR UPDATE OF project_id ON public.content_reports FOR EACH ROW EXECUTE FUNCTION public.set_company_from_project();
drop trigger if exists content_reports_guard on public.content_reports;
create trigger content_reports_guard BEFORE UPDATE ON public.content_reports FOR EACH ROW EXECUTE FUNCTION public.content_reports_guard();
drop trigger if exists truck_documents_updated_at on public.truck_documents;
create trigger truck_documents_updated_at BEFORE UPDATE ON public.truck_documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists zz_enqueue_deleted_file on public.truck_documents;
create trigger zz_enqueue_deleted_file AFTER DELETE ON public.truck_documents FOR EACH ROW EXECUTE FUNCTION public._enqueue_deleted_file();
drop trigger if exists truck_notes_updated_at on public.truck_notes;
create trigger truck_notes_updated_at BEFORE UPDATE ON public.truck_notes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists owner_project_notes_updated_at on public.owner_project_notes;
create trigger owner_project_notes_updated_at BEFORE UPDATE ON public.owner_project_notes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists owner_project_photos_updated_at on public.owner_project_photos;
create trigger owner_project_photos_updated_at BEFORE UPDATE ON public.owner_project_photos FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists zz_enqueue_deleted_file on public.owner_project_photos;
create trigger zz_enqueue_deleted_file AFTER DELETE ON public.owner_project_photos FOR EACH ROW EXECUTE FUNCTION public._enqueue_deleted_file();
drop trigger if exists owner_material_lists_updated_at on public.owner_material_lists;
create trigger owner_material_lists_updated_at BEFORE UPDATE ON public.owner_material_lists FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists time_settings_audit on public.time_settings;
create trigger time_settings_audit AFTER INSERT OR UPDATE ON public.time_settings FOR EACH ROW EXECUTE FUNCTION public._time_settings_audit();
drop trigger if exists time_person_settings_same_company on public.time_person_settings;
create trigger time_person_settings_same_company BEFORE INSERT OR UPDATE ON public.time_person_settings FOR EACH ROW EXECUTE FUNCTION public._time_check_same_company();
drop trigger if exists time_targets_audit on public.time_property_targets;
create trigger time_targets_audit AFTER INSERT OR UPDATE ON public.time_property_targets FOR EACH ROW EXECUTE FUNCTION public._time_settings_audit();
drop trigger if exists time_targets_same_company on public.time_property_targets;
create trigger time_targets_same_company BEFORE INSERT OR UPDATE ON public.time_property_targets FOR EACH ROW EXECUTE FUNCTION public._time_check_same_company();
drop trigger if exists time_workdays_check on public.time_workdays;
create trigger time_workdays_check BEFORE INSERT OR UPDATE ON public.time_workdays FOR EACH ROW EXECUTE FUNCTION public._time_check_workday();
drop trigger if exists time_workdays_updated_at on public.time_workdays;
create trigger time_workdays_updated_at BEFORE UPDATE ON public.time_workdays FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists time_breaks_check on public.time_breaks;
create trigger time_breaks_check BEFORE INSERT OR UPDATE ON public.time_breaks FOR EACH ROW EXECUTE FUNCTION public._time_check_break();
drop trigger if exists time_breaks_updated_at on public.time_breaks;
create trigger time_breaks_updated_at BEFORE UPDATE ON public.time_breaks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists trg_time_auto_close_break on public.time_breaks;
create trigger trg_time_auto_close_break AFTER UPDATE OF ended_at ON public.time_breaks FOR EACH ROW EXECUTE FUNCTION public._time_auto_close_after_end();
drop trigger if exists time_visits_updated_at on public.time_visits;
create trigger time_visits_updated_at BEFORE UPDATE ON public.time_visits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists time_intervals_check on public.time_intervals;
create trigger time_intervals_check BEFORE INSERT OR UPDATE ON public.time_intervals FOR EACH ROW EXECUTE FUNCTION public._time_check_interval();
drop trigger if exists time_intervals_updated_at on public.time_intervals;
create trigger time_intervals_updated_at BEFORE UPDATE ON public.time_intervals FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
drop trigger if exists trg_time_auto_close_interval on public.time_intervals;
create trigger trg_time_auto_close_interval AFTER UPDATE OF ended_at ON public.time_intervals FOR EACH ROW WHEN ((new.status <> 'void'::text)) EXECUTE FUNCTION public._time_auto_close_after_end();
drop trigger if exists time_skip_requests_decided on public.time_skip_requests;
create trigger time_skip_requests_decided AFTER UPDATE ON public.time_skip_requests FOR EACH ROW EXECUTE FUNCTION public._time_skip_decided();
drop trigger if exists time_skip_requests_notify on public.time_skip_requests;
create trigger time_skip_requests_notify AFTER INSERT ON public.time_skip_requests FOR EACH ROW EXECUTE FUNCTION public._time_skip_requested();
drop trigger if exists time_audit_no_update on public.time_audit;
create trigger time_audit_no_update BEFORE DELETE OR UPDATE ON public.time_audit FOR EACH ROW EXECUTE FUNCTION public._time_audit_immutable();
drop trigger if exists time_project_estimates_same_company on public.time_project_estimates;
create trigger time_project_estimates_same_company BEFORE INSERT OR UPDATE ON public.time_project_estimates FOR EACH ROW EXECUTE FUNCTION public._time_check_same_company();
drop trigger if exists properties_address_follows on public.properties;
create trigger properties_address_follows AFTER UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION public._property_address_follows();
drop trigger if exists properties_before_write on public.properties;
create trigger properties_before_write BEFORE INSERT OR UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION public._properties_before_write();
drop trigger if exists properties_customer_company_guard on public.properties;
create trigger properties_customer_company_guard BEFORE INSERT OR UPDATE OF customer_id ON public.properties FOR EACH ROW EXECUTE FUNCTION public._customer_same_company_guard();
drop trigger if exists truck_maintenance_updated_at on public.truck_maintenance;
create trigger truck_maintenance_updated_at BEFORE UPDATE ON public.truck_maintenance FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- PART 6. ROW LEVEL SECURITY (who may read and change which rows)
-- A table with security on and no rule for a role is closed to that role.
-- ============================================================================

alter table public.companies enable row level security;
alter table public.people enable row level security;
alter table public.company_members enable row level security;
alter table public.projects enable row level security;
alter table public.project_team enable row level security;
alter table public.project_tasks enable row level security;
alter table public.project_settings enable row level security;
alter table public.project_photos enable row level security;
alter table public.project_updates enable row level security;
alter table public.project_requests enable row level security;
alter table public.project_history enable row level security;
alter table public.customer_timeline enable row level security;
alter table public.trucks enable row level security;
alter table public.assignments enable row level security;
alter table public.schedule_changes enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_reads enable row level security;
alter table public.check_ins enable row level security;
alter table public.check_outs enable row level security;
alter table public.worker_activities enable row level security;
alter table public.work_sessions enable row level security;
alter table public.worker_hourly_rates enable row level security;
alter table public.worker_pay_settings enable row level security;
alter table public.overtime_rules enable row level security;
alter table public.company_operations_settings enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.app_notifications enable row level security;
alter table public.worker_reminders enable row level security;
alter table public.worker_settings enable row level security;
alter table public.team_codes enable row level security;
alter table public.company_join_settings enable row level security;
alter table public.company_invitations enable row level security;
alter table public.join_requests enable row level security;
alter table public.membership_audit_log enable row level security;
alter table public.project_messages enable row level security;
alter table public.schedule_series enable row level security;
alter table public.crews enable row level security;
alter table public.crew_members enable row level security;
alter table public.task_attachments enable row level security;
alter table public.company_resources enable row level security;
alter table public.resource_access enable row level security;
alter table public.resource_secrets enable row level security;
alter table public.resource_audit_log enable row level security;
alter table public.quotes enable row level security;
alter table public.change_orders enable row level security;
alter table public.invoices enable row level security;
alter table public.financial_events enable row level security;
alter table public.push_tokens enable row level security;
alter table public.app_settings enable row level security;
alter table public.financial_settings enable row level security;
alter table public.material_vendors enable row level security;
alter table public.project_materials enable row level security;
alter table public.project_material_plans enable row level security;
alter table public.property_issues enable row level security;
alter table public.content_reports enable row level security;
alter table public.truck_documents enable row level security;
alter table public.truck_notes enable row level security;
alter table public.owner_project_notes enable row level security;
alter table public.owner_project_photos enable row level security;
alter table public.owner_material_lists enable row level security;
alter table public.person_ids enable row level security;
alter table public.time_settings enable row level security;
alter table public.time_person_settings enable row level security;
alter table public.time_property_targets enable row level security;
alter table public.time_workdays enable row level security;
alter table public.time_workday_rates enable row level security;
alter table public.time_breaks enable row level security;
alter table public.time_visits enable row level security;
alter table public.time_intervals enable row level security;
alter table public.time_interval_rates enable row level security;
alter table public.time_skip_requests enable row level security;
alter table public.time_audit enable row level security;
alter table public.time_alerts enable row level security;
alter table public.time_project_estimates enable row level security;
alter table public.company_admin_permissions enable row level security;
alter table public.company_closure_log enable row level security;
alter table public.storage_cleanup_queue enable row level security;
alter table public.properties enable row level security;
alter table public.truck_maintenance enable row level security;
alter table public.invites enable row level security;
alter table public.customer_email_links enable row level security;
alter table public.public_weather_settings enable row level security;
alter table public.company_yard_alerts enable row level security;
alter table public.time_clock_locations enable row level security;
alter table public.service_requests enable row level security;

drop policy if exists announcement_reads_insert on public.announcement_reads;
create policy announcement_reads_insert on public.announcement_reads for insert to public
  with check (((person_id = public.my_person_id()) AND public.is_member(company_id)));
drop policy if exists announcement_reads_select on public.announcement_reads;
create policy announcement_reads_select on public.announcement_reads for select to public
  using (public.is_crew(company_id));
drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements for select to public
  using (public.is_crew(company_id));
drop policy if exists announcements_staff on public.announcements;
create policy announcements_staff on public.announcements for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists notifications_delete on public.app_notifications;
create policy notifications_delete on public.app_notifications for delete to public
  using ((recipient_id = public.my_person_id()));
drop policy if exists notifications_insert on public.app_notifications;
create policy notifications_insert on public.app_notifications for insert to authenticated
  with check (public._notification_insert_allowed(company_id, recipient_id, event_type));
drop policy if exists notifications_select on public.app_notifications;
create policy notifications_select on public.app_notifications for select to public
  using ((recipient_id = public.my_person_id()));
drop policy if exists notifications_update on public.app_notifications;
create policy notifications_update on public.app_notifications for update to public
  using ((recipient_id = public.my_person_id()));
drop policy if exists assignments_own_update on public.assignments;
create policy assignments_own_update on public.assignments for update to public
  using ((person_id = public.my_person_id()))
  with check ((person_id = public.my_person_id()));
drop policy if exists assignments_select on public.assignments;
create policy assignments_select on public.assignments for select to public
  using (public.is_crew(company_id));
drop policy if exists assignments_staff on public.assignments;
create policy assignments_staff on public.assignments for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists change_orders_delete on public.change_orders;
create policy change_orders_delete on public.change_orders for delete to public
  using ((public.is_staff(company_id) AND (status = 'draft'::text)));
drop policy if exists change_orders_insert on public.change_orders;
create policy change_orders_insert on public.change_orders for insert to public
  with check (public.is_staff(( SELECT projects.company_id
   FROM public.projects
  WHERE (projects.id = change_orders.project_id))));
drop policy if exists change_orders_select on public.change_orders;
create policy change_orders_select on public.change_orders for select to public
  using ((public.is_staff(company_id) OR ((status <> 'draft'::text) AND public.is_project_customer(project_id))));
drop policy if exists change_orders_update on public.change_orders;
create policy change_orders_update on public.change_orders for update to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists check_ins_delete on public.check_ins;
create policy check_ins_delete on public.check_ins for delete to public
  using (public.is_staff(company_id));
drop policy if exists check_ins_insert on public.check_ins;
create policy check_ins_insert on public.check_ins for insert to public
  with check (((person_id = public.my_person_id()) AND public.is_crew(company_id)));
drop policy if exists check_ins_select on public.check_ins;
create policy check_ins_select on public.check_ins for select to public
  using ((public.is_staff(company_id) OR (person_id = public.my_person_id())));
drop policy if exists check_ins_update on public.check_ins;
create policy check_ins_update on public.check_ins for update to public
  using ((public.is_staff(company_id) OR (person_id = public.my_person_id())));
drop policy if exists check_outs_delete on public.check_outs;
create policy check_outs_delete on public.check_outs for delete to public
  using (public.is_staff(company_id));
drop policy if exists check_outs_insert on public.check_outs;
create policy check_outs_insert on public.check_outs for insert to public
  with check (((person_id = public.my_person_id()) AND public.is_crew(company_id)));
drop policy if exists check_outs_select on public.check_outs;
create policy check_outs_select on public.check_outs for select to public
  using ((public.is_staff(company_id) OR (person_id = public.my_person_id())));
drop policy if exists check_outs_update on public.check_outs;
create policy check_outs_update on public.check_outs for update to public
  using ((public.is_staff(company_id) OR (person_id = public.my_person_id())));
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to public
  using (public.is_member(id));
drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies for update to public
  using (public.is_staff(id));
drop policy if exists company_admin_permissions_staff_select on public.company_admin_permissions;
create policy company_admin_permissions_staff_select on public.company_admin_permissions for select to public
  using (public.is_staff(company_id));
drop policy if exists invitations_recipient on public.company_invitations;
create policy invitations_recipient on public.company_invitations for select to public
  using ((lower(email) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text))));
drop policy if exists invitations_staff on public.company_invitations;
create policy invitations_staff on public.company_invitations for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists join_settings_select on public.company_join_settings;
create policy join_settings_select on public.company_join_settings for select to public
  using (public.is_member(company_id));
drop policy if exists join_settings_staff on public.company_join_settings;
create policy join_settings_staff on public.company_join_settings for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists members_select on public.company_members;
create policy members_select on public.company_members for select to public
  using (((person_id = public.my_person_id()) OR public.is_crew(company_id) OR (public.is_member(company_id) AND (role = ANY (ARRAY['owner'::text, 'admin'::text, 'worker'::text])))));
drop policy if exists members_write on public.company_members;
create policy members_write on public.company_members for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists company_operations_settings_select on public.company_operations_settings;
create policy company_operations_settings_select on public.company_operations_settings for select to public
  using (public.is_member(company_id));
drop policy if exists company_operations_settings_staff on public.company_operations_settings;
create policy company_operations_settings_staff on public.company_operations_settings for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists company_resources_select on public.company_resources;
create policy company_resources_select on public.company_resources for select to public
  using (public.can_view_resource(id));
drop policy if exists company_resources_staff on public.company_resources;
create policy company_resources_staff on public.company_resources for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists content_reports_insert on public.content_reports;
create policy content_reports_insert on public.content_reports for insert to public
  with check (((reported_by = public.my_person_id()) AND (status = 'open'::text) AND (public.is_staff(( SELECT projects.company_id
   FROM public.projects
  WHERE (projects.id = content_reports.project_id))) OR public.is_project_customer(project_id))));
drop policy if exists content_reports_select on public.content_reports;
create policy content_reports_select on public.content_reports for select to public
  using ((public.is_staff(company_id) OR (reported_by = public.my_person_id())));
drop policy if exists content_reports_update on public.content_reports;
create policy content_reports_update on public.content_reports for update to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists crew_members_select on public.crew_members;
create policy crew_members_select on public.crew_members for select to public
  using (public.is_crew(company_id));
drop policy if exists crew_members_staff on public.crew_members;
create policy crew_members_staff on public.crew_members for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists crews_select on public.crews;
create policy crews_select on public.crews for select to public
  using (public.is_crew(company_id));
drop policy if exists crews_staff on public.crews;
create policy crews_staff on public.crews for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists customer_timeline_crew_insert on public.customer_timeline;
create policy customer_timeline_crew_insert on public.customer_timeline for insert to public
  with check (public.is_crew(( SELECT projects.company_id
   FROM public.projects
  WHERE (projects.id = customer_timeline.project_id))));
drop policy if exists customer_timeline_select on public.customer_timeline;
create policy customer_timeline_select on public.customer_timeline for select to public
  using ((public.is_crew(company_id) OR public.is_project_customer(project_id)));
drop policy if exists customer_timeline_staff on public.customer_timeline;
create policy customer_timeline_staff on public.customer_timeline for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists financial_events_insert on public.financial_events;
create policy financial_events_insert on public.financial_events for insert to public
  with check (public.is_staff(( SELECT projects.company_id
   FROM public.projects
  WHERE (projects.id = financial_events.project_id))));
drop policy if exists financial_events_select on public.financial_events;
create policy financial_events_select on public.financial_events for select to public
  using ((public.is_staff(company_id) OR (public.is_project_customer(project_id) AND (event_type <> 'created'::text))));
drop policy if exists financial_settings_staff on public.financial_settings;
create policy financial_settings_staff on public.financial_settings for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists invoices_delete on public.invoices;
create policy invoices_delete on public.invoices for delete to public
  using ((public.is_staff(company_id) AND (status = 'draft'::text)));
drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices for insert to public
  with check (public.is_staff(( SELECT projects.company_id
   FROM public.projects
  WHERE (projects.id = invoices.project_id))));
drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices for select to public
  using ((public.is_staff(company_id) OR ((status = 'issued'::text) AND public.is_project_customer(project_id))));
drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices for update to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists join_requests_insert on public.join_requests;
create policy join_requests_insert on public.join_requests for insert to public
  with check ((person_id = public.my_person_id()));
drop policy if exists join_requests_select on public.join_requests;
create policy join_requests_select on public.join_requests for select to public
  using (((person_id = public.my_person_id()) OR public.is_staff(company_id)));
drop policy if exists join_requests_update on public.join_requests;
create policy join_requests_update on public.join_requests for update to public
  using (((person_id = public.my_person_id()) OR public.is_staff(company_id)));
drop policy if exists material_vendors_staff on public.material_vendors;
create policy material_vendors_staff on public.material_vendors for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists audit_insert on public.membership_audit_log;
create policy audit_insert on public.membership_audit_log for insert to public
  with check ((public.is_member(company_id) AND (actor_id = public.my_person_id())));
drop policy if exists audit_select on public.membership_audit_log;
create policy audit_select on public.membership_audit_log for select to public
  using (public.is_staff(company_id));
drop policy if exists notification_preferences_select on public.notification_preferences;
create policy notification_preferences_select on public.notification_preferences for select to public
  using (public.is_member(company_id));
drop policy if exists notification_preferences_staff on public.notification_preferences;
create policy notification_preferences_staff on public.notification_preferences for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists overtime_rules_select on public.overtime_rules;
create policy overtime_rules_select on public.overtime_rules for select to public
  using (public.is_member(company_id));
drop policy if exists overtime_rules_staff on public.overtime_rules;
create policy overtime_rules_staff on public.overtime_rules for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists owner_material_lists_owner_delete on public.owner_material_lists;
create policy owner_material_lists_owner_delete on public.owner_material_lists for delete to public
  using (public.is_company_owner(company_id));
drop policy if exists owner_material_lists_owner_insert on public.owner_material_lists;
create policy owner_material_lists_owner_insert on public.owner_material_lists for insert to public
  with check ((public.is_company_owner(company_id) AND (EXISTS ( SELECT 1
   FROM public.projects pr
  WHERE ((pr.id = owner_material_lists.project_id) AND (pr.company_id = owner_material_lists.company_id))))));
drop policy if exists owner_material_lists_owner_select on public.owner_material_lists;
create policy owner_material_lists_owner_select on public.owner_material_lists for select to public
  using (public.is_company_owner(company_id));
drop policy if exists owner_material_lists_owner_update on public.owner_material_lists;
create policy owner_material_lists_owner_update on public.owner_material_lists for update to public
  using (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));
drop policy if exists owner_project_notes_owner_delete on public.owner_project_notes;
create policy owner_project_notes_owner_delete on public.owner_project_notes for delete to public
  using (public.is_company_owner(company_id));
drop policy if exists owner_project_notes_owner_insert on public.owner_project_notes;
create policy owner_project_notes_owner_insert on public.owner_project_notes for insert to public
  with check ((public.is_company_owner(company_id) AND (EXISTS ( SELECT 1
   FROM public.projects pr
  WHERE ((pr.id = owner_project_notes.project_id) AND (pr.company_id = owner_project_notes.company_id))))));
drop policy if exists owner_project_notes_owner_select on public.owner_project_notes;
create policy owner_project_notes_owner_select on public.owner_project_notes for select to public
  using (public.is_company_owner(company_id));
drop policy if exists owner_project_notes_owner_update on public.owner_project_notes;
create policy owner_project_notes_owner_update on public.owner_project_notes for update to public
  using (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));
drop policy if exists owner_project_photos_owner_delete on public.owner_project_photos;
create policy owner_project_photos_owner_delete on public.owner_project_photos for delete to public
  using (public.is_company_owner(company_id));
drop policy if exists owner_project_photos_owner_insert on public.owner_project_photos;
create policy owner_project_photos_owner_insert on public.owner_project_photos for insert to public
  with check ((public.is_company_owner(company_id) AND (EXISTS ( SELECT 1
   FROM public.projects pr
  WHERE ((pr.id = owner_project_photos.project_id) AND (pr.company_id = owner_project_photos.company_id))))));
drop policy if exists owner_project_photos_owner_select on public.owner_project_photos;
create policy owner_project_photos_owner_select on public.owner_project_photos for select to public
  using (public.is_company_owner(company_id));
drop policy if exists owner_project_photos_owner_update on public.owner_project_photos;
create policy owner_project_photos_owner_update on public.owner_project_photos for update to public
  using (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));
drop policy if exists people_select on public.people;
create policy people_select on public.people for select to public
  using (public.can_see_person(id));
drop policy if exists people_update on public.people;
create policy people_update on public.people for update to public
  using (((id = public.my_person_id()) OR ((user_id IS NULL) AND public.staff_of_person(id))));
drop policy if exists person_ids_delete on public.person_ids;
create policy person_ids_delete on public.person_ids for delete to public
  using ((person_id = public.my_person_id()));
drop policy if exists person_ids_insert on public.person_ids;
create policy person_ids_insert on public.person_ids for insert to public
  with check (((person_id = public.my_person_id()) AND (id_key ~~ (('ids/'::text || (person_id)::text) || '/%'::text))));
drop policy if exists person_ids_select on public.person_ids;
create policy person_ids_select on public.person_ids for select to public
  using (((person_id = public.my_person_id()) OR public.owner_of_person(person_id)));
drop policy if exists person_ids_update on public.person_ids;
create policy person_ids_update on public.person_ids for update to public
  using ((person_id = public.my_person_id()))
  with check (((person_id = public.my_person_id()) AND (id_key ~~ (('ids/'::text || (person_id)::text) || '/%'::text))));
drop policy if exists project_history_insert on public.project_history;
create policy project_history_insert on public.project_history for insert to public
  with check ((public.is_crew(( SELECT projects.company_id
   FROM public.projects
  WHERE (projects.id = project_history.project_id))) OR public.is_project_customer(project_id)));
drop policy if exists project_history_select on public.project_history;
create policy project_history_select on public.project_history for select to public
  using ((public.is_crew(company_id) OR public.is_project_customer(project_id)));
drop policy if exists project_history_staff on public.project_history;
create policy project_history_staff on public.project_history for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists project_material_plans_staff on public.project_material_plans;
create policy project_material_plans_staff on public.project_material_plans for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(( SELECT projects.company_id
   FROM public.projects
  WHERE (projects.id = project_material_plans.project_id))));
drop policy if exists project_materials_staff on public.project_materials;
create policy project_materials_staff on public.project_materials for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(( SELECT projects.company_id
   FROM public.projects
  WHERE (projects.id = project_materials.project_id))));
drop policy if exists project_messages_delete on public.project_messages;
create policy project_messages_delete on public.project_messages for delete to public
  using ((public.is_staff(company_id) OR (sender_id = public.my_person_id())));
drop policy if exists project_messages_insert on public.project_messages;
create policy project_messages_insert on public.project_messages for insert to public
  with check (((sender_id = public.my_person_id()) AND (public.is_staff(( SELECT projects.company_id
   FROM public.projects
  WHERE (projects.id = project_messages.project_id))) OR public.is_project_customer(project_id))));
drop policy if exists project_messages_select on public.project_messages;
create policy project_messages_select on public.project_messages for select to public
  using ((public.is_staff(company_id) OR public.is_project_customer(project_id)));
drop policy if exists project_photos_delete on public.project_photos;
create policy project_photos_delete on public.project_photos for delete to public
  using ((public.is_staff(company_id) OR (uploaded_by = public.my_person_id())));
drop policy if exists project_photos_insert on public.project_photos;
create policy project_photos_insert on public.project_photos for insert to public
  with check (public.is_crew(( SELECT projects.company_id
   FROM public.projects
  WHERE (projects.id = project_photos.project_id))));
drop policy if exists project_photos_select on public.project_photos;
create policy project_photos_select on public.project_photos for select to public
  using ((public.is_crew(company_id) OR (is_customer_visible AND public.is_project_customer(project_id))));
drop policy if exists project_photos_update on public.project_photos;
create policy project_photos_update on public.project_photos for update to public
  using ((public.is_staff(company_id) OR (uploaded_by = public.my_person_id())));
drop policy if exists project_requests_customer_insert on public.project_requests;
create policy project_requests_customer_insert on public.project_requests for insert to public
  with check ((public.is_project_customer(project_id) AND (requested_by = public.my_person_id())));
drop policy if exists project_requests_select on public.project_requests;
create policy project_requests_select on public.project_requests for select to public
  using ((public.is_crew(company_id) OR public.is_project_customer(project_id)));
drop policy if exists project_requests_staff on public.project_requests;
create policy project_requests_staff on public.project_requests for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists project_settings_select on public.project_settings;
create policy project_settings_select on public.project_settings for select to public
  using ((public.is_crew(company_id) OR public.is_project_customer(project_id)));
drop policy if exists project_settings_staff on public.project_settings;
create policy project_settings_staff on public.project_settings for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists project_tasks_crew_update on public.project_tasks;
create policy project_tasks_crew_update on public.project_tasks for update to public
  using (public.is_crew(company_id))
  with check (public.is_crew(company_id));
drop policy if exists project_tasks_customer_completed_read on public.project_tasks;
create policy project_tasks_customer_completed_read on public.project_tasks for select to public
  using (((status = 'completed'::text) AND public.is_project_customer(project_id)));
drop policy if exists project_tasks_select on public.project_tasks;
create policy project_tasks_select on public.project_tasks for select to public
  using (public.is_crew(company_id));
drop policy if exists project_tasks_staff on public.project_tasks;
create policy project_tasks_staff on public.project_tasks for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists project_team_select on public.project_team;
create policy project_team_select on public.project_team for select to public
  using ((public.is_crew(company_id) OR public.is_project_customer(project_id)));
drop policy if exists project_team_staff on public.project_team;
create policy project_team_staff on public.project_team for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists project_updates_select on public.project_updates;
create policy project_updates_select on public.project_updates for select to public
  using ((public.is_crew(company_id) OR (is_customer_visible AND public.is_project_customer(project_id))));
drop policy if exists project_updates_staff on public.project_updates;
create policy project_updates_staff on public.project_updates for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to public
  using ((public.is_crew(company_id) OR ((public.my_person_id() IS NOT NULL) AND ((customer_id = public.my_person_id()) OR (customer_claimed_by = public.my_person_id())) AND public.is_member(company_id))));
drop policy if exists projects_write on public.projects;
create policy projects_write on public.projects for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists properties_select on public.properties;
create policy properties_select on public.properties for select to public
  using ((public.is_staff(company_id) OR public.is_crew(company_id)));
drop policy if exists properties_staff on public.properties;
create policy properties_staff on public.properties for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists property_issues_insert on public.property_issues;
create policy property_issues_insert on public.property_issues for insert to public
  with check ((public.is_crew(company_id) AND (reported_by = public.my_person_id()) AND (status = 'open'::text)));
drop policy if exists property_issues_select on public.property_issues;
create policy property_issues_select on public.property_issues for select to public
  using ((public.is_staff(company_id) OR (public.is_crew(company_id) AND (reported_by = public.my_person_id()))));
drop policy if exists property_issues_staff_delete on public.property_issues;
create policy property_issues_staff_delete on public.property_issues for delete to public
  using (public.is_staff(company_id));
drop policy if exists property_issues_staff_update on public.property_issues;
create policy property_issues_staff_update on public.property_issues for update to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists push_tokens_own on public.push_tokens;
create policy push_tokens_own on public.push_tokens for select to public
  using ((person_id = public.my_person_id()));
drop policy if exists quotes_delete on public.quotes;
create policy quotes_delete on public.quotes for delete to public
  using ((public.is_staff(company_id) AND (status = 'draft'::text)));
drop policy if exists quotes_insert on public.quotes;
create policy quotes_insert on public.quotes for insert to public
  with check (public.is_staff(( SELECT projects.company_id
   FROM public.projects
  WHERE (projects.id = quotes.project_id))));
drop policy if exists quotes_select on public.quotes;
create policy quotes_select on public.quotes for select to public
  using ((public.is_staff(company_id) OR ((status <> 'draft'::text) AND public.is_project_customer(project_id))));
drop policy if exists quotes_update on public.quotes;
create policy quotes_update on public.quotes for update to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists resource_access_select on public.resource_access;
create policy resource_access_select on public.resource_access for select to public
  using ((public.is_staff(company_id) OR ((person_id = public.my_person_id()) AND (public.member_role(company_id) = 'worker'::text))));
drop policy if exists resource_access_staff on public.resource_access;
create policy resource_access_staff on public.resource_access for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists resource_audit_select on public.resource_audit_log;
create policy resource_audit_select on public.resource_audit_log for select to public
  using (public.is_staff(company_id));
drop policy if exists schedule_changes_crew_insert on public.schedule_changes;
create policy schedule_changes_crew_insert on public.schedule_changes for insert to public
  with check (public.is_crew(company_id));
drop policy if exists schedule_changes_select on public.schedule_changes;
create policy schedule_changes_select on public.schedule_changes for select to public
  using (public.is_crew(company_id));
drop policy if exists schedule_changes_staff on public.schedule_changes;
create policy schedule_changes_staff on public.schedule_changes for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists schedule_series_select on public.schedule_series;
create policy schedule_series_select on public.schedule_series for select to public
  using (public.is_crew(company_id));
drop policy if exists schedule_series_staff on public.schedule_series;
create policy schedule_series_staff on public.schedule_series for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists service_requests_select on public.service_requests;
create policy service_requests_select on public.service_requests for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.company_members m
  WHERE ((m.company_id = service_requests.company_id) AND (m.person_id = public.my_person_id()) AND (m.status = 'active'::text) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));
drop policy if exists service_requests_update on public.service_requests;
create policy service_requests_update on public.service_requests for update to authenticated
  using ((EXISTS ( SELECT 1
   FROM public.company_members m
  WHERE ((m.company_id = service_requests.company_id) AND (m.person_id = public.my_person_id()) AND (m.status = 'active'::text) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))
  with check ((EXISTS ( SELECT 1
   FROM public.company_members m
  WHERE ((m.company_id = service_requests.company_id) AND (m.person_id = public.my_person_id()) AND (m.status = 'active'::text) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));
drop policy if exists task_attachments_select on public.task_attachments;
create policy task_attachments_select on public.task_attachments for select to public
  using (public.is_crew(company_id));
drop policy if exists task_attachments_staff on public.task_attachments;
create policy task_attachments_staff on public.task_attachments for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists team_codes_staff on public.team_codes;
create policy team_codes_staff on public.team_codes for all to public
  using (public.admin_can(company_id, 'invites'::text))
  with check (public.admin_can(company_id, 'invites'::text));
drop policy if exists time_alerts_staff_select on public.time_alerts;
create policy time_alerts_staff_select on public.time_alerts for select to public
  using (public.is_staff(company_id));
drop policy if exists time_audit_staff_select on public.time_audit;
create policy time_audit_staff_select on public.time_audit for select to public
  using (public.is_staff(company_id));
drop policy if exists time_breaks_staff_select on public.time_breaks;
create policy time_breaks_staff_select on public.time_breaks for select to public
  using (public.is_staff(company_id));
drop policy if exists time_interval_rates_staff_select on public.time_interval_rates;
create policy time_interval_rates_staff_select on public.time_interval_rates for select to public
  using (public.is_staff(company_id));
drop policy if exists time_intervals_staff_select on public.time_intervals;
create policy time_intervals_staff_select on public.time_intervals for select to public
  using (public.is_staff(company_id));
drop policy if exists time_person_settings_staff_select on public.time_person_settings;
create policy time_person_settings_staff_select on public.time_person_settings for select to public
  using (public.is_staff(company_id));
drop policy if exists time_person_settings_staff_write on public.time_person_settings;
create policy time_person_settings_staff_write on public.time_person_settings for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists time_project_estimates_staff on public.time_project_estimates;
create policy time_project_estimates_staff on public.time_project_estimates for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists time_property_targets_staff_select on public.time_property_targets;
create policy time_property_targets_staff_select on public.time_property_targets for select to public
  using (public.is_staff(company_id));
drop policy if exists time_property_targets_staff_write on public.time_property_targets;
create policy time_property_targets_staff_write on public.time_property_targets for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists time_settings_staff_select on public.time_settings;
create policy time_settings_staff_select on public.time_settings for select to public
  using (public.is_staff(company_id));
drop policy if exists time_settings_staff_write on public.time_settings;
create policy time_settings_staff_write on public.time_settings for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists time_skip_requests_staff_select on public.time_skip_requests;
create policy time_skip_requests_staff_select on public.time_skip_requests for select to public
  using (public.is_staff(company_id));
drop policy if exists time_visits_staff_select on public.time_visits;
create policy time_visits_staff_select on public.time_visits for select to public
  using (public.is_staff(company_id));
drop policy if exists time_workday_rates_staff_select on public.time_workday_rates;
create policy time_workday_rates_staff_select on public.time_workday_rates for select to public
  using (public.is_staff(company_id));
drop policy if exists time_workdays_staff_select on public.time_workdays;
create policy time_workdays_staff_select on public.time_workdays for select to public
  using (public.is_staff(company_id));
drop policy if exists truck_documents_owner_delete on public.truck_documents;
create policy truck_documents_owner_delete on public.truck_documents for delete to public
  using (public.is_company_owner(company_id));
drop policy if exists truck_documents_owner_insert on public.truck_documents;
create policy truck_documents_owner_insert on public.truck_documents for insert to public
  with check ((public.is_company_owner(company_id) AND (EXISTS ( SELECT 1
   FROM public.trucks tr
  WHERE ((tr.id = truck_documents.truck_id) AND (tr.company_id = truck_documents.company_id))))));
drop policy if exists truck_documents_owner_select on public.truck_documents;
create policy truck_documents_owner_select on public.truck_documents for select to public
  using (public.is_company_owner(company_id));
drop policy if exists truck_documents_owner_update on public.truck_documents;
create policy truck_documents_owner_update on public.truck_documents for update to public
  using (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));
drop policy if exists truck_maintenance_owner_delete on public.truck_maintenance;
create policy truck_maintenance_owner_delete on public.truck_maintenance for delete to public
  using (public.is_company_owner(company_id));
drop policy if exists truck_maintenance_owner_insert on public.truck_maintenance;
create policy truck_maintenance_owner_insert on public.truck_maintenance for insert to public
  with check ((public.is_company_owner(company_id) AND (EXISTS ( SELECT 1
   FROM public.trucks tr
  WHERE ((tr.id = truck_maintenance.truck_id) AND (tr.company_id = truck_maintenance.company_id))))));
drop policy if exists truck_maintenance_owner_select on public.truck_maintenance;
create policy truck_maintenance_owner_select on public.truck_maintenance for select to public
  using (public.is_company_owner(company_id));
drop policy if exists truck_maintenance_owner_update on public.truck_maintenance;
create policy truck_maintenance_owner_update on public.truck_maintenance for update to public
  using (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));
drop policy if exists truck_notes_owner_delete on public.truck_notes;
create policy truck_notes_owner_delete on public.truck_notes for delete to public
  using (public.is_company_owner(company_id));
drop policy if exists truck_notes_owner_insert on public.truck_notes;
create policy truck_notes_owner_insert on public.truck_notes for insert to public
  with check ((public.is_company_owner(company_id) AND (EXISTS ( SELECT 1
   FROM public.trucks tr
  WHERE ((tr.id = truck_notes.truck_id) AND (tr.company_id = truck_notes.company_id))))));
drop policy if exists truck_notes_owner_select on public.truck_notes;
create policy truck_notes_owner_select on public.truck_notes for select to public
  using (public.is_company_owner(company_id));
drop policy if exists truck_notes_owner_update on public.truck_notes;
create policy truck_notes_owner_update on public.truck_notes for update to public
  using (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));
drop policy if exists trucks_select on public.trucks;
create policy trucks_select on public.trucks for select to public
  using (public.is_crew(company_id));
drop policy if exists trucks_staff on public.trucks;
create policy trucks_staff on public.trucks for all to public
  using (public.is_staff(company_id))
  with check (public.is_staff(company_id));
drop policy if exists work_sessions_delete on public.work_sessions;
create policy work_sessions_delete on public.work_sessions for delete to public
  using (public.is_staff(company_id));
drop policy if exists work_sessions_insert on public.work_sessions;
create policy work_sessions_insert on public.work_sessions for insert to public
  with check (((person_id = public.my_person_id()) AND public.is_crew(company_id)));
drop policy if exists work_sessions_select on public.work_sessions;
create policy work_sessions_select on public.work_sessions for select to public
  using ((public.is_staff(company_id) OR (person_id = public.my_person_id())));
drop policy if exists work_sessions_update on public.work_sessions;
create policy work_sessions_update on public.work_sessions for update to public
  using ((public.is_staff(company_id) OR (person_id = public.my_person_id())));
drop policy if exists worker_activities_delete on public.worker_activities;
create policy worker_activities_delete on public.worker_activities for delete to public
  using (public.is_staff(company_id));
drop policy if exists worker_activities_insert on public.worker_activities;
create policy worker_activities_insert on public.worker_activities for insert to public
  with check (((person_id = public.my_person_id()) AND public.is_crew(company_id)));
drop policy if exists worker_activities_select on public.worker_activities;
create policy worker_activities_select on public.worker_activities for select to public
  using ((public.is_staff(company_id) OR (person_id = public.my_person_id())));
drop policy if exists worker_activities_update on public.worker_activities;
create policy worker_activities_update on public.worker_activities for update to public
  using ((public.is_staff(company_id) OR (person_id = public.my_person_id())));
drop policy if exists hourly_rates_staff on public.worker_hourly_rates;
create policy hourly_rates_staff on public.worker_hourly_rates for all to public
  using (public.admin_can(company_id, 'pay_rates'::text))
  with check (public.admin_can(company_id, 'pay_rates'::text));
drop policy if exists worker_pay_settings_staff on public.worker_pay_settings;
create policy worker_pay_settings_staff on public.worker_pay_settings for all to public
  using (public.admin_can(company_id, 'pay_rates'::text))
  with check (public.admin_can(company_id, 'pay_rates'::text));
drop policy if exists reminders_insert on public.worker_reminders;
create policy reminders_insert on public.worker_reminders for insert to public
  with check (public.is_crew(company_id));
drop policy if exists reminders_select on public.worker_reminders;
create policy reminders_select on public.worker_reminders for select to public
  using (((person_id = public.my_person_id()) OR public.is_staff(company_id)));
drop policy if exists reminders_update on public.worker_reminders;
create policy reminders_update on public.worker_reminders for update to public
  using ((person_id = public.my_person_id()));
drop policy if exists worker_settings_own on public.worker_settings;
create policy worker_settings_own on public.worker_settings for all to public
  using ((person_id = public.my_person_id()))
  with check ((person_id = public.my_person_id()));

-- ============================================================================
-- PART 7. WHO MAY CALL WHAT (grants)
-- Functions: every function is first closed to everyone, then opened only to the roles that need it.
--   anon = not signed in, authenticated = signed in, service_role = the server functions.
-- Tables: Supabase gives the app roles full table rights by default (the row rules above still apply);
--   the tables listed here are closed further, so even a mistaken rule could not open them.
-- ============================================================================

revoke all on table public.resource_secrets from anon, authenticated;
revoke all on table public.resource_audit_log from anon, authenticated;
grant select on table public.resource_audit_log to anon;
grant select on table public.resource_audit_log to authenticated;
revoke all on table public.content_reports from anon;
revoke all on table public.time_settings from anon;
revoke all on table public.time_person_settings from anon;
revoke all on table public.time_property_targets from anon;
revoke all on table public.time_workdays from anon, authenticated;
grant select on table public.time_workdays to authenticated;
revoke all on table public.time_workday_rates from anon, authenticated;
grant select on table public.time_workday_rates to authenticated;
revoke all on table public.time_breaks from anon, authenticated;
grant select on table public.time_breaks to authenticated;
revoke all on table public.time_visits from anon, authenticated;
grant select on table public.time_visits to authenticated;
revoke all on table public.time_intervals from anon, authenticated;
grant select on table public.time_intervals to authenticated;
revoke all on table public.time_interval_rates from anon, authenticated;
grant select on table public.time_interval_rates to authenticated;
revoke all on table public.time_skip_requests from anon, authenticated;
grant select on table public.time_skip_requests to authenticated;
revoke all on table public.time_audit from anon, authenticated;
grant select on table public.time_audit to authenticated;
revoke all on table public.time_alerts from anon, authenticated;
grant select on table public.time_alerts to authenticated;
revoke all on table public.time_project_estimates from anon;
revoke all on table public.company_admin_permissions from anon, authenticated;
grant select on table public.company_admin_permissions to authenticated;
revoke all on table public.company_closure_log from anon, authenticated;
revoke all on table public.storage_cleanup_queue from anon, authenticated;
revoke all on table public.invites from anon, authenticated;
revoke all on table public.customer_email_links from anon, authenticated;
revoke all on table public.public_weather_settings from anon, authenticated;
revoke all on table public.company_yard_alerts from anon, authenticated;
revoke all on table public.time_clock_locations from anon, authenticated;
revoke all on table public.service_requests from anon, authenticated;
grant select on table public.service_requests to authenticated;
grant update (status, handled_by, handled_at) on table public.service_requests to authenticated;

revoke all on function public._accept_invitations(pid uuid) from public, anon, authenticated, service_role;
grant execute on function public._accept_invitations(pid uuid) to service_role;
revoke all on function public._auto_task_lead(p_project uuid) from public, anon, authenticated, service_role;
grant execute on function public._auto_task_lead(p_project uuid) to service_role;
revoke all on function public._auto_task_lead_after_assignment() from public, anon, authenticated, service_role;
grant execute on function public._auto_task_lead_after_assignment() to service_role;
revoke all on function public._check_account_target(p_person_id uuid) from public, anon, authenticated, service_role;
grant execute on function public._check_account_target(p_person_id uuid) to service_role;
revoke all on function public._check_member_target(p_person_id uuid) from public, anon, authenticated, service_role;
grant execute on function public._check_member_target(p_person_id uuid) to service_role;
revoke all on function public._company_members_guard() from public, anon, authenticated, service_role;
grant execute on function public._company_members_guard() to service_role;
revoke all on function public._create_company(pid uuid, data jsonb) from public, anon, authenticated, service_role;
grant execute on function public._create_company(pid uuid, data jsonb) to service_role;
revoke all on function public._customer_audience(p_company uuid, p_audience text) from public, anon, authenticated, service_role;
grant execute on function public._customer_audience(p_company uuid, p_audience text) to service_role;
revoke all on function public._customer_in_good_standing(p_company uuid, p_person uuid) from public, anon, authenticated, service_role;
grant execute on function public._customer_in_good_standing(p_company uuid, p_person uuid) to service_role;
revoke all on function public._customer_same_company_guard() from public, anon, authenticated, service_role;
grant execute on function public._customer_same_company_guard() to service_role;
revoke all on function public._distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision) from public, anon, authenticated, service_role;
grant execute on function public._distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision) to service_role;
revoke all on function public._document_project_company_guard() from public, anon, authenticated, service_role;
grant execute on function public._document_project_company_guard() to service_role;
revoke all on function public._enqueue_company_files(p_company uuid) from public, anon, authenticated, service_role;
grant execute on function public._enqueue_company_files(p_company uuid) to service_role;
revoke all on function public._enqueue_company_prefixes(p_company uuid, p_people uuid[]) from public, anon, authenticated, service_role;
grant execute on function public._enqueue_company_prefixes(p_company uuid, p_people uuid[]) to service_role;
revoke all on function public._enqueue_deleted_file() from public, anon, authenticated, service_role;
grant execute on function public._enqueue_deleted_file() to service_role;
revoke all on function public._enqueue_deleted_issue_files() from public, anon, authenticated, service_role;
grant execute on function public._enqueue_deleted_issue_files() to service_role;
revoke all on function public._has_card_number(t text) from public, anon, authenticated, service_role;
grant execute on function public._has_card_number(t text) to service_role;
revoke all on function public._invite_hash(p_token text) from public, anon, authenticated, service_role;
grant execute on function public._invite_hash(p_token text) to service_role;
revoke all on function public._invite_issue(p_company uuid, p_person uuid, p_kind text, p_actor uuid) from public, anon, authenticated, service_role;
grant execute on function public._invite_issue(p_company uuid, p_person uuid, p_kind text, p_actor uuid) to service_role;
revoke all on function public._invite_staff_company() from public, anon, authenticated, service_role;
grant execute on function public._invite_staff_company() to service_role;
revoke all on function public._is_company_customer(p_company uuid, p_person uuid) from public, anon, authenticated, service_role;
grant execute on function public._is_company_customer(p_company uuid, p_person uuid) to service_role;
revoke all on function public._member_deactivated() from public, anon, authenticated, service_role;
grant execute on function public._member_deactivated() to service_role;
revoke all on function public._member_deactivation_block() from public, anon, authenticated, service_role;
grant execute on function public._member_deactivation_block() to service_role;
revoke all on function public._mentions_card_credential(t text) from public, anon, authenticated, service_role;
grant execute on function public._mentions_card_credential(t text) to service_role;
revoke all on function public._merge_placeholder_customer(p_company uuid, p_placeholder uuid, p_real uuid) from public, anon, authenticated, service_role;
grant execute on function public._merge_placeholder_customer(p_company uuid, p_placeholder uuid, p_real uuid) to service_role;
revoke all on function public._link_customer_on_email_confirm() from public, anon, authenticated, service_role;
grant execute on function public._link_customer_on_email_confirm() to service_role;
revoke all on function public._my_owned_company() from public, anon, authenticated, service_role;
grant execute on function public._my_owned_company() to service_role;
revoke all on function public._my_owned_or_staff_company() from public, anon, authenticated, service_role;
grant execute on function public._my_owned_or_staff_company() to service_role;
revoke all on function public._my_staff_company() from public, anon, authenticated, service_role;
grant execute on function public._my_staff_company() to service_role;
revoke all on function public._notification_insert_allowed(cid uuid, recipient uuid, ev text) from public, anon, authenticated, service_role;
grant execute on function public._notification_insert_allowed(cid uuid, recipient uuid, ev text) to authenticated, service_role;
revoke all on function public._project_tasks_progress() from public, anon, authenticated, service_role;
grant execute on function public._project_tasks_progress() to service_role;
revoke all on function public._properties_before_write() from public, anon, authenticated, service_role;
grant execute on function public._properties_before_write() to service_role;
revoke all on function public._property_address_follows() from public, anon, authenticated, service_role;
grant execute on function public._property_address_follows() to service_role;
revoke all on function public._property_issues_notify() from public, anon, authenticated, service_role;
grant execute on function public._property_issues_notify() to service_role;
revoke all on function public._property_issues_touch() from public, anon, authenticated, service_role;
grant execute on function public._property_issues_touch() to service_role;
revoke all on function public._property_link_guard() from public, anon, authenticated, service_role;
grant execute on function public._property_link_guard() to service_role;
revoke all on function public._property_staff_company() from public, anon, authenticated, service_role;
grant execute on function public._property_staff_company() to service_role;
revoke all on function public._recompute_project_progress(p_project uuid) from public, anon, authenticated, service_role;
grant execute on function public._recompute_project_progress(p_project uuid) to service_role;
revoke all on function public._team_manager_company() from public, anon, authenticated, service_role;
grant execute on function public._team_manager_company() to service_role;
revoke all on function public._time_alert(p_company uuid, p_kind text, p_key text, p_person uuid, p_workday uuid, p_visit uuid, p_skip uuid, p_title text, p_detail text) from public, anon, authenticated, service_role;
grant execute on function public._time_alert(p_company uuid, p_kind text, p_key text, p_person uuid, p_workday uuid, p_visit uuid, p_skip uuid, p_title text, p_detail text) to service_role;
revoke all on function public._time_any_work_count(p_person uuid, p_company uuid, p_date date) from public, anon, authenticated, service_role;
grant execute on function public._time_any_work_count(p_person uuid, p_company uuid, p_date date) to service_role;
revoke all on function public._time_assigned_truck(p_person uuid, p_date date) from public, anon, authenticated, service_role;
grant execute on function public._time_assigned_truck(p_person uuid, p_date date) to service_role;
revoke all on function public._time_audit(p_company uuid, p_entity text, p_entity_id uuid, p_person uuid, p_workday uuid, p_visit uuid, p_action text, p_field text, p_old jsonb, p_new jsonb, p_reason text, p_was_approved boolean) from public, anon, authenticated, service_role;
grant execute on function public._time_audit(p_company uuid, p_entity text, p_entity_id uuid, p_person uuid, p_workday uuid, p_visit uuid, p_action text, p_field text, p_old jsonb, p_new jsonb, p_reason text, p_was_approved boolean) to service_role;
revoke all on function public._time_audit_immutable() from public, anon, authenticated, service_role;
grant execute on function public._time_audit_immutable() to service_role;
revoke all on function public._time_auto_close_after_assignment() from public, anon, authenticated, service_role;
grant execute on function public._time_auto_close_after_assignment() to service_role;
revoke all on function public._time_auto_close_after_end() from public, anon, authenticated, service_role;
grant execute on function public._time_auto_close_after_end() to service_role;
revoke all on function public._time_blocking_stop(p_source text, p_ref uuid, p_person uuid) from public, anon, authenticated, service_role;
grant execute on function public._time_blocking_stop(p_source text, p_ref uuid, p_person uuid) to service_role;
revoke all on function public._time_check_break() from public, anon, authenticated, service_role;
grant execute on function public._time_check_break() to service_role;
revoke all on function public._time_check_interval() from public, anon, authenticated, service_role;
grant execute on function public._time_check_interval() to service_role;
revoke all on function public._time_check_same_company() from public, anon, authenticated, service_role;
grant execute on function public._time_check_same_company() to service_role;
revoke all on function public._time_check_workday() from public, anon, authenticated, service_role;
grant execute on function public._time_check_workday() to service_role;
revoke all on function public._time_company(p_person uuid) from public, anon, authenticated, service_role;
grant execute on function public._time_company(p_person uuid) to service_role;
revoke all on function public._time_day_json(p_person uuid, p_company uuid, p_date date) from public, anon, authenticated, service_role;
grant execute on function public._time_day_json(p_person uuid, p_company uuid, p_date date) to service_role;
revoke all on function public._time_flag_company(p_company uuid) from public, anon, authenticated, service_role;
grant execute on function public._time_flag_company(p_company uuid) to service_role;
revoke all on function public._time_flag_stale(p_person uuid, p_company uuid) from public, anon, authenticated, service_role;
grant execute on function public._time_flag_stale(p_person uuid, p_company uuid) to service_role;
revoke all on function public._time_may_clock_in(p_person uuid, p_company uuid, p_date date) from public, anon, authenticated, service_role;
grant execute on function public._time_may_clock_in(p_person uuid, p_company uuid, p_date date) to service_role;
revoke all on function public._time_need_staff(p_company uuid, p_reason text) from public, anon, authenticated, service_role;
grant execute on function public._time_need_staff(p_company uuid, p_reason text) to service_role;
revoke all on function public._time_net_ms(p_workday uuid) from public, anon, authenticated, service_role;
grant execute on function public._time_net_ms(p_workday uuid) to service_role;
revoke all on function public._time_no_future(p_at timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function public._time_no_future(p_at timestamp with time zone) to service_role;
revoke all on function public._time_notify_staff(p_company uuid, p_event text, p_title text, p_body text, p_type text, p_id uuid) from public, anon, authenticated, service_role;
grant execute on function public._time_notify_staff(p_company uuid, p_event text, p_title text, p_body text, p_type text, p_id uuid) to service_role;
revoke all on function public._time_open_work_count(p_person uuid, p_company uuid, p_date date) from public, anon, authenticated, service_role;
grant execute on function public._time_open_work_count(p_person uuid, p_company uuid, p_date date) to service_role;
revoke all on function public._time_past_midnight(p_clock_in timestamp with time zone, p_company uuid) from public, anon, authenticated, service_role;
grant execute on function public._time_past_midnight(p_clock_in timestamp with time zone, p_company uuid) to service_role;
revoke all on function public._time_rate(p_company uuid, p_person uuid, p_date date) from public, anon, authenticated, service_role;
grant execute on function public._time_rate(p_company uuid, p_person uuid, p_date date) to service_role;
revoke all on function public._time_refresh_visit(p_visit uuid) from public, anon, authenticated, service_role;
grant execute on function public._time_refresh_visit(p_visit uuid) to service_role;
revoke all on function public._time_same_group(p_a uuid, p_b uuid, p_date date) from public, anon, authenticated, service_role;
grant execute on function public._time_same_group(p_a uuid, p_b uuid, p_date date) to service_role;
revoke all on function public._time_sane_workday(p_work_date date, p_in timestamp with time zone, p_out timestamp with time zone, p_company uuid) from public, anon, authenticated, service_role;
grant execute on function public._time_sane_workday(p_work_date date, p_in timestamp with time zone, p_out timestamp with time zone, p_company uuid) to service_role;
revoke all on function public._time_scan(p_company uuid) from public, anon, authenticated, service_role;
grant execute on function public._time_scan(p_company uuid) to service_role;
revoke all on function public._time_settings_audit() from public, anon, authenticated, service_role;
grant execute on function public._time_settings_audit() to service_role;
revoke all on function public._time_settings_row(p_company uuid) from public, anon, authenticated, service_role;
grant execute on function public._time_settings_row(p_company uuid) to service_role;
revoke all on function public._time_skip_decided() from public, anon, authenticated, service_role;
grant execute on function public._time_skip_decided() to service_role;
revoke all on function public._time_skip_requested() from public, anon, authenticated, service_role;
grant execute on function public._time_skip_requested() to service_role;
revoke all on function public._time_suggest_end(p_workday uuid) from public, anon, authenticated, service_role;
grant execute on function public._time_suggest_end(p_workday uuid) to service_role;
revoke all on function public._time_touch_approval(p_workday uuid) from public, anon, authenticated, service_role;
grant execute on function public._time_touch_approval(p_workday uuid) to service_role;
revoke all on function public._time_try_auto_close(p_person uuid) from public, anon, authenticated, service_role;
grant execute on function public._time_try_auto_close(p_person uuid) to service_role;
revoke all on function public._time_tz(p_company uuid) from public, anon, authenticated, service_role;
grant execute on function public._time_tz(p_company uuid) to service_role;
revoke all on function public._try_uuid(t text) from public, anon, authenticated, service_role;
grant execute on function public._try_uuid(t text) to service_role;
revoke all on function public._yard_distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision) from public, anon, authenticated, service_role;
grant execute on function public._yard_distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision) to service_role;
revoke all on function public._yard_owner_company() from public, anon, authenticated, service_role;
grant execute on function public._yard_owner_company() to service_role;
revoke all on function public.add_customer(p_first text, p_last text, p_email text, p_phone text) from public, anon, authenticated, service_role;
grant execute on function public.add_customer(p_first text, p_last text, p_email text, p_phone text) to authenticated, service_role;
revoke all on function public.add_worker(p_first text, p_last text, p_phone text) from public, anon, authenticated, service_role;
grant execute on function public.add_worker(p_first text, p_last text, p_phone text) to authenticated, service_role;
revoke all on function public.admin_can(cid uuid, perm text) from public, anon, authenticated, service_role;
grant execute on function public.admin_can(cid uuid, perm text) to authenticated, service_role;
revoke all on function public.apply_document_response(p_type text, p_id uuid, p_approve boolean, p_note text, p_actor uuid, p_name text, p_meta jsonb) from public, anon, authenticated, service_role;
grant execute on function public.apply_document_response(p_type text, p_id uuid, p_approve boolean, p_note text, p_actor uuid, p_name text, p_meta jsonb) to service_role;
revoke all on function public.can_see_person(pid uuid) from public, anon, authenticated, service_role;
grant execute on function public.can_see_person(pid uuid) to public, anon, authenticated, service_role;
revoke all on function public.can_view_resource(rid uuid) from public, anon, authenticated, service_role;
grant execute on function public.can_view_resource(rid uuid) to public, anon, authenticated, service_role;
revoke all on function public.check_task_lead() from public, anon, authenticated, service_role;
grant execute on function public.check_task_lead() to service_role;
revoke all on function public.clear_project_activity(p_project_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_dry_run boolean) from public, anon, authenticated, service_role;
grant execute on function public.clear_project_activity(p_project_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_dry_run boolean) to authenticated, service_role;
revoke all on function public.company_closure_preview() from public, anon, authenticated, service_role;
grant execute on function public.company_closure_preview() to authenticated, service_role;
revoke all on function public.company_resources_audit() from public, anon, authenticated, service_role;
grant execute on function public.company_resources_audit() to service_role;
revoke all on function public.company_resources_check() from public, anon, authenticated, service_role;
grant execute on function public.company_resources_check() to service_role;
revoke all on function public.company_slot_open() from public, anon, authenticated, service_role;
grant execute on function public.company_slot_open() to public, anon, authenticated, service_role;
revoke all on function public.content_reports_guard() from public, anon, authenticated, service_role;
grant execute on function public.content_reports_guard() to service_role;
revoke all on function public.create_company(data jsonb) from public, anon, authenticated, service_role;
grant execute on function public.create_company(data jsonb) to public, anon, authenticated, service_role;
revoke all on function public.customer_message_reach() from public, anon, authenticated, service_role;
grant execute on function public.customer_message_reach() to authenticated, service_role;
revoke all on function public.deactivate_member(p_person_id uuid, p_acknowledge boolean) from public, anon, authenticated, service_role;
grant execute on function public.deactivate_member(p_person_id uuid, p_acknowledge boolean) to authenticated, service_role;
revoke all on function public.delete_account(p_person_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_account(p_person_id uuid) to authenticated, service_role;
revoke all on function public.delete_my_account() from public, anon, authenticated, service_role;
grant execute on function public.delete_my_account() to authenticated, service_role;
revoke all on function public.delete_my_company(p_confirm_name text) from public, anon, authenticated, service_role;
grant execute on function public.delete_my_company(p_confirm_name text) to authenticated, service_role;
revoke all on function public.delete_unused_member(p_person_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_unused_member(p_person_id uuid) to authenticated, service_role;
revoke all on function public.enforce_checkin_radius() from public, anon, authenticated, service_role;
grant execute on function public.enforce_checkin_radius() to service_role;
revoke all on function public.enforce_one_company() from public, anon, authenticated, service_role;
grant execute on function public.enforce_one_company() to service_role;
revoke all on function public.enforce_task_lead() from public, anon, authenticated, service_role;
grant execute on function public.enforce_task_lead() to service_role;
revoke all on function public.ensure_property(p_customer uuid, p_name text, p_address text, p_city text, p_state text, p_zip text, p_lat double precision, p_lng double precision) from public, anon, authenticated, service_role;
grant execute on function public.ensure_property(p_customer uuid, p_name text, p_address text, p_city text, p_state text, p_zip text, p_lat double precision, p_lng double precision) to authenticated, service_role;
revoke all on function public.extend_schedule_series(p_series uuid, p_today date, p_horizon_days integer) from public, anon, authenticated, service_role;
grant execute on function public.extend_schedule_series(p_series uuid, p_today date, p_horizon_days integer) to authenticated, service_role;
revoke all on function public.get_admin_permissions() from public, anon, authenticated, service_role;
grant execute on function public.get_admin_permissions() to authenticated, service_role;
revoke all on function public.get_my_context() from public, anon, authenticated, service_role;
grant execute on function public.get_my_context() to public, anon, authenticated, service_role;
revoke all on function public.get_shared_document(p_token text) from public, anon, authenticated, service_role;
grant execute on function public.get_shared_document(p_token text) to anon, authenticated, service_role;
revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;
grant execute on function public.handle_new_user() to service_role;
revoke all on function public.haversine_m(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision) from public, anon, authenticated, service_role;
grant execute on function public.haversine_m(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision) to public, anon, authenticated, service_role;
revoke all on function public.invite_accept(p_token text) from public, anon, authenticated, service_role;
grant execute on function public.invite_accept(p_token text) to authenticated, service_role;
revoke all on function public.invite_lookup(p_token text) from public, anon, authenticated, service_role;
grant execute on function public.invite_lookup(p_token text) to anon, authenticated, service_role;
revoke all on function public.invite_revoke(p_invite uuid) from public, anon, authenticated, service_role;
grant execute on function public.invite_revoke(p_invite uuid) to authenticated, service_role;
revoke all on function public.invite_send(p_person uuid) from public, anon, authenticated, service_role;
grant execute on function public.invite_send(p_person uuid) to authenticated, service_role;
revoke all on function public.invites_pending() from public, anon, authenticated, service_role;
grant execute on function public.invites_pending() to authenticated, service_role;
revoke all on function public.is_company_owner(cid uuid) from public, anon, authenticated, service_role;
grant execute on function public.is_company_owner(cid uuid) to public, anon, authenticated, service_role;
revoke all on function public.is_crew(cid uuid) from public, anon, authenticated, service_role;
grant execute on function public.is_crew(cid uuid) to public, anon, authenticated, service_role;
revoke all on function public.is_member(cid uuid) from public, anon, authenticated, service_role;
grant execute on function public.is_member(cid uuid) to public, anon, authenticated, service_role;
revoke all on function public.is_project_customer(pid uuid) from public, anon, authenticated, service_role;
grant execute on function public.is_project_customer(pid uuid) to public, anon, authenticated, service_role;
revoke all on function public.is_staff(cid uuid) from public, anon, authenticated, service_role;
grant execute on function public.is_staff(cid uuid) to public, anon, authenticated, service_role;
revoke all on function public.list_accounts() from public, anon, authenticated, service_role;
grant execute on function public.list_accounts() to authenticated, service_role;
revoke all on function public.lock_financial_document() from public, anon, authenticated, service_role;
grant execute on function public.lock_financial_document() to service_role;
revoke all on function public.member_deactivation_check(p_person_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.member_deactivation_check(p_person_id uuid) to authenticated, service_role;
revoke all on function public.member_role(cid uuid) from public, anon, authenticated, service_role;
grant execute on function public.member_role(cid uuid) to public, anon, authenticated, service_role;
revoke all on function public.my_person_id() from public, anon, authenticated, service_role;
grant execute on function public.my_person_id() to public, anon, authenticated, service_role;
revoke all on function public.new_share_token() from public, anon, authenticated, service_role;
grant execute on function public.new_share_token() to public, anon, authenticated, service_role;
revoke all on function public.normalize_address(p_street text, p_city text, p_state text, p_zip text) from public, anon, authenticated, service_role;
grant execute on function public.normalize_address(p_street text, p_city text, p_state text, p_zip text) to public, anon, authenticated, service_role;
revoke all on function public.owner_get_yard_alerts() from public, anon, authenticated, service_role;
grant execute on function public.owner_get_yard_alerts() to authenticated, service_role;
revoke all on function public.owner_of_person(pid uuid) from public, anon, authenticated, service_role;
grant execute on function public.owner_of_person(pid uuid) to public, anon, authenticated, service_role;
revoke all on function public.owner_set_yard_alerts(p_radius_m integer, p_alert_on boolean, p_alert_email text) from public, anon, authenticated, service_role;
grant execute on function public.owner_set_yard_alerts(p_radius_m integer, p_alert_on boolean, p_alert_email text) to authenticated, service_role;
revoke all on function public.prevent_company_delete() from public, anon, authenticated, service_role;
grant execute on function public.prevent_company_delete() to service_role;
revoke all on function public.public_weather_config() from public, anon, authenticated, service_role;
grant execute on function public.public_weather_config() to anon, authenticated, service_role;
revoke all on function public.push_app_notification() from public, anon, authenticated, service_role;
grant execute on function public.push_app_notification() to service_role;
revoke all on function public.reactivate_member(p_person_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.reactivate_member(p_person_id uuid) to authenticated, service_role;
revoke all on function public.register_push_token(p_token text, p_platform text) from public, anon, authenticated, service_role;
grant execute on function public.register_push_token(p_token text, p_platform text) to authenticated, service_role;
revoke all on function public.remind_worker_assignment(p_assignment uuid) from public, anon, authenticated, service_role;
grant execute on function public.remind_worker_assignment(p_assignment uuid) to authenticated, service_role;
revoke all on function public.remove_account_access(p_person_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.remove_account_access(p_person_id uuid) to authenticated, service_role;
revoke all on function public.resource_access_audit() from public, anon, authenticated, service_role;
grant execute on function public.resource_access_audit() to service_role;
revoke all on function public.resource_access_check() from public, anon, authenticated, service_role;
grant execute on function public.resource_access_check() to service_role;
revoke all on function public.resource_secrets_cleanup() from public, anon, authenticated, service_role;
grant execute on function public.resource_secrets_cleanup() to service_role;
revoke all on function public.respond_by_link(p_token text, p_approve boolean, p_name text, p_note text, p_signature text) from public, anon, authenticated, service_role;
grant execute on function public.respond_by_link(p_token text, p_approve boolean, p_name text, p_note text, p_signature text) to anon, authenticated, service_role;
revoke all on function public.respond_to_financial_document(p_type text, p_id uuid, p_approve boolean, p_note text) from public, anon, authenticated, service_role;
grant execute on function public.respond_to_financial_document(p_type text, p_id uuid, p_approve boolean, p_note text) to authenticated, service_role;
revoke all on function public.restore_account_access(p_person_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.restore_account_access(p_person_id uuid) to authenticated, service_role;
revoke all on function public.reveal_resource_secret(p_resource_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.reveal_resource_secret(p_resource_id uuid) to authenticated, service_role;
revoke all on function public.revoke_resources_on_member_change() from public, anon, authenticated, service_role;
grant execute on function public.revoke_resources_on_member_change() to service_role;
revoke all on function public.send_customer_announcement(p_title text, p_body text, p_audience text) from public, anon, authenticated, service_role;
grant execute on function public.send_customer_announcement(p_title text, p_body text, p_audience text) to authenticated, service_role;
revoke all on function public.set_admin_permissions(p_team boolean, p_invites boolean, p_time_corrections boolean, p_pay_rates boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_admin_permissions(p_team boolean, p_invites boolean, p_time_corrections boolean, p_pay_rates boolean) to authenticated, service_role;
revoke all on function public.set_company_from_project() from public, anon, authenticated, service_role;
grant execute on function public.set_company_from_project() to service_role;
revoke all on function public.set_customer_portal_access(p_person_id uuid, p_enabled boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_customer_portal_access(p_person_id uuid, p_enabled boolean) to authenticated, service_role;
revoke all on function public.set_member_role(p_person_id uuid, p_role text) from public, anon, authenticated, service_role;
grant execute on function public.set_member_role(p_person_id uuid, p_role text) to authenticated, service_role;
revoke all on function public.set_my_language(p_language text) from public, anon, authenticated, service_role;
grant execute on function public.set_my_language(p_language text) to authenticated, service_role;
revoke all on function public.set_public_weather_enabled(p_enabled boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_public_weather_enabled(p_enabled boolean) to authenticated, service_role;
revoke all on function public.set_resource_secret(p_resource_id uuid, p_secret text) from public, anon, authenticated, service_role;
grant execute on function public.set_resource_secret(p_resource_id uuid, p_secret text) to authenticated, service_role;
revoke all on function public.set_updated_at() from public, anon, authenticated, service_role;
grant execute on function public.set_updated_at() to service_role;
revoke all on function public.staff_of_person(pid uuid) from public, anon, authenticated, service_role;
grant execute on function public.staff_of_person(pid uuid) to public, anon, authenticated, service_role;
revoke all on function public.storage_cleanup_claim(p_limit integer) from public, anon, authenticated, service_role;
grant execute on function public.storage_cleanup_claim(p_limit integer) to service_role;
revoke all on function public.storage_cleanup_finish(p_id uuid, p_ok boolean, p_error text, p_more boolean) from public, anon, authenticated, service_role;
grant execute on function public.storage_cleanup_finish(p_id uuid, p_ok boolean, p_error text, p_more boolean) to service_role;
revoke all on function public.storage_cleanup_status() from public, anon, authenticated, service_role;
grant execute on function public.storage_cleanup_status() to service_role;
revoke all on function public.submit_service_request(p_property_type text, p_services text[], p_details text, p_town text, p_name text, p_phone text, p_email text) from public, anon, authenticated, service_role;
grant execute on function public.submit_service_request(p_property_type text, p_services text[], p_details text, p_town text, p_name text, p_phone text, p_email text) to anon, authenticated, service_role;
revoke all on function public.team_access_overview() from public, anon, authenticated, service_role;
grant execute on function public.team_access_overview() to authenticated, service_role;
revoke all on function public.time_accept_all_suggested_ends() from public, anon, authenticated, service_role;
grant execute on function public.time_accept_all_suggested_ends() to authenticated, service_role;
revoke all on function public.time_accept_suggested_end(p_workday uuid) from public, anon, authenticated, service_role;
grant execute on function public.time_accept_suggested_end(p_workday uuid) to authenticated, service_role;
revoke all on function public.time_alert_resolve(p_alert uuid, p_note text) from public, anon, authenticated, service_role;
grant execute on function public.time_alert_resolve(p_alert uuid, p_note text) to authenticated, service_role;
revoke all on function public.time_approve_workday(p_workday uuid) from public, anon, authenticated, service_role;
grant execute on function public.time_approve_workday(p_workday uuid) to authenticated, service_role;
revoke all on function public.time_break_end() from public, anon, authenticated, service_role;
grant execute on function public.time_break_end() to authenticated, service_role;
revoke all on function public.time_break_start() from public, anon, authenticated, service_role;
grant execute on function public.time_break_start() to authenticated, service_role;
revoke all on function public.time_claim_stale_end(p_workday uuid, p_stopped_at timestamp with time zone, p_note text) from public, anon, authenticated, service_role;
grant execute on function public.time_claim_stale_end(p_workday uuid, p_stopped_at timestamp with time zone, p_note text) to authenticated, service_role;
revoke all on function public.time_clock_in(p_work_date date, p_truck_id uuid, p_request_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.time_clock_in(p_work_date date, p_truck_id uuid, p_request_id uuid) to authenticated, service_role;
revoke all on function public.time_clock_out(p_request_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.time_clock_out(p_request_id uuid) to authenticated, service_role;
revoke all on function public.time_complete_visit(p_visit_id uuid, p_note text, p_lat double precision, p_lng double precision, p_accuracy double precision, p_location_state text, p_gps jsonb) from public, anon, authenticated, service_role;
grant execute on function public.time_complete_visit(p_visit_id uuid, p_note text, p_lat double precision, p_lng double precision, p_accuracy double precision, p_location_state text, p_gps jsonb) to authenticated, service_role;
revoke all on function public.time_decide_skip(p_request_id uuid, p_approve boolean, p_note text) from public, anon, authenticated, service_role;
grant execute on function public.time_decide_skip(p_request_id uuid, p_approve boolean, p_note text) to authenticated, service_role;
revoke all on function public.time_my_day(p_date date) from public, anon, authenticated, service_role;
grant execute on function public.time_my_day(p_date date) to authenticated, service_role;
revoke all on function public.time_my_skip_requests() from public, anon, authenticated, service_role;
grant execute on function public.time_my_skip_requests() to authenticated, service_role;
revoke all on function public.time_record_clock_in_location(p_workday uuid, p_lat numeric, p_lng numeric, p_accuracy numeric, p_note text) from public, anon, authenticated, service_role;
grant execute on function public.time_record_clock_in_location(p_workday uuid, p_lat numeric, p_lng numeric, p_accuracy numeric, p_note text) to authenticated, service_role;
revoke all on function public.time_reopen_workday(p_workday uuid, p_reason text) from public, anon, authenticated, service_role;
grant execute on function public.time_reopen_workday(p_workday uuid, p_reason text) to authenticated, service_role;
revoke all on function public.time_request_skip(p_source text, p_ref uuid, p_reason text) from public, anon, authenticated, service_role;
grant execute on function public.time_request_skip(p_source text, p_ref uuid, p_reason text) to authenticated, service_role;
revoke all on function public.time_review_list() from public, anon, authenticated, service_role;
grant execute on function public.time_review_list() to authenticated, service_role;
revoke all on function public.time_scan_alerts() from public, anon, authenticated, service_role;
grant execute on function public.time_scan_alerts() to authenticated, service_role;
revoke all on function public.time_set_hourly_rate(p_person uuid, p_rate numeric, p_effective date, p_reason text) from public, anon, authenticated, service_role;
grant execute on function public.time_set_hourly_rate(p_person uuid, p_rate numeric, p_effective date, p_reason text) to authenticated, service_role;
revoke all on function public.time_set_visit_billable(p_visit uuid, p_billable boolean, p_reason text) from public, anon, authenticated, service_role;
grant execute on function public.time_set_visit_billable(p_visit uuid, p_billable boolean, p_reason text) to authenticated, service_role;
revoke all on function public.time_settle_no_hours(p_workday uuid, p_reason text) from public, anon, authenticated, service_role;
grant execute on function public.time_settle_no_hours(p_workday uuid, p_reason text) to authenticated, service_role;
revoke all on function public.time_staff_add_break(p_workday uuid, p_started timestamp with time zone, p_ended timestamp with time zone, p_paid boolean, p_reason text) from public, anon, authenticated, service_role;
grant execute on function public.time_staff_add_break(p_workday uuid, p_started timestamp with time zone, p_ended timestamp with time zone, p_paid boolean, p_reason text) to authenticated, service_role;
revoke all on function public.time_staff_add_interval(p_visit uuid, p_person uuid, p_started timestamp with time zone, p_ended timestamp with time zone, p_reason text) from public, anon, authenticated, service_role;
grant execute on function public.time_staff_add_interval(p_visit uuid, p_person uuid, p_started timestamp with time zone, p_ended timestamp with time zone, p_reason text) to authenticated, service_role;
revoke all on function public.time_staff_add_workday(p_person uuid, p_work_date date, p_clock_in timestamp with time zone, p_clock_out timestamp with time zone, p_reason text, p_truck uuid) from public, anon, authenticated, service_role;
grant execute on function public.time_staff_add_workday(p_person uuid, p_work_date date, p_clock_in timestamp with time zone, p_clock_out timestamp with time zone, p_reason text, p_truck uuid) to authenticated, service_role;
revoke all on function public.time_staff_edit_break(p_break uuid, p_started timestamp with time zone, p_ended timestamp with time zone, p_reason text) from public, anon, authenticated, service_role;
grant execute on function public.time_staff_edit_break(p_break uuid, p_started timestamp with time zone, p_ended timestamp with time zone, p_reason text) to authenticated, service_role;
revoke all on function public.time_staff_edit_interval(p_interval uuid, p_started timestamp with time zone, p_ended timestamp with time zone, p_reason text) from public, anon, authenticated, service_role;
grant execute on function public.time_staff_edit_interval(p_interval uuid, p_started timestamp with time zone, p_ended timestamp with time zone, p_reason text) to authenticated, service_role;
revoke all on function public.time_staff_edit_workday(p_workday uuid, p_clock_in timestamp with time zone, p_clock_out timestamp with time zone, p_reason text) from public, anon, authenticated, service_role;
grant execute on function public.time_staff_edit_workday(p_workday uuid, p_clock_in timestamp with time zone, p_clock_out timestamp with time zone, p_reason text) to authenticated, service_role;
revoke all on function public.time_staff_void_interval(p_interval uuid, p_reason text) from public, anon, authenticated, service_role;
grant execute on function public.time_staff_void_interval(p_interval uuid, p_reason text) to authenticated, service_role;
revoke all on function public.time_start_visit(p_source text, p_ref uuid, p_lat double precision, p_lng double precision, p_accuracy double precision, p_location_state text, p_gps jsonb) from public, anon, authenticated, service_role;
grant execute on function public.time_start_visit(p_source text, p_ref uuid, p_lat double precision, p_lng double precision, p_accuracy double precision, p_location_state text, p_gps jsonb) to authenticated, service_role;
revoke all on function public.time_trucks_for_clock_in(p_date date) from public, anon, authenticated, service_role;
grant execute on function public.time_trucks_for_clock_in(p_date date) to authenticated, service_role;
revoke all on function public.time_withdraw_skip(p_request_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.time_withdraw_skip(p_request_id uuid) to authenticated, service_role;
revoke all on function public.unregister_push_token(p_token text) from public, anon, authenticated, service_role;
grant execute on function public.unregister_push_token(p_token text) to authenticated, service_role;

-- No app role may EMPTY a table (TRUNCATE skips the row rules) or needs REFERENCES / TRIGGER rights. Supabase grants all three by
-- default; they are taken back from the app roles on every table here, and for tables made later (default privileges).
-- The app keeps select / insert / update / delete exactly as above (row level security still decides which rows).
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') loop
    execute format('revoke truncate, references, trigger on table public.%I from public, anon, authenticated', t);
  end loop;
end $$;
alter default privileges in schema public revoke truncate, references, trigger on tables from public, anon, authenticated;

-- ============================================================================
-- PART 8. LIVE UPDATES (Supabase Realtime): the app listens to these tables
-- ============================================================================

do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'No supabase_realtime publication: live updates are not switched on.';
    return;
  end if;
  foreach t in array array['announcement_reads', 'announcements', 'app_notifications', 'assignments', 'change_orders', 'check_ins', 'check_outs', 'companies', 'company_invitations', 'company_join_settings', 'company_members', 'company_resources', 'content_reports', 'crew_members', 'crews', 'customer_timeline', 'financial_events', 'financial_settings', 'invoices', 'join_requests', 'material_vendors', 'people', 'project_history', 'project_material_plans', 'project_materials', 'project_messages', 'project_photos', 'project_requests', 'project_settings', 'project_tasks', 'project_team', 'project_updates', 'projects', 'property_issues', 'quotes', 'resource_access', 'schedule_changes', 'schedule_series', 'task_attachments', 'team_codes', 'trucks', 'work_sessions', 'worker_activities', 'worker_hourly_rates', 'worker_pay_settings'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ============================================================================
-- PART 9. FILE STORAGE (the old Supabase "media" bucket)
-- ============================================================================
-- The app keeps photos and files in Cloudflare R2. This old Supabase bucket stays only because the app's storage meter
-- (src/lib/storage.ts) lists it. Private, and signed-in people can NOT upload, change or delete anything in it (no insert,
-- update or delete rules); they can only list their own company's folders ({companyId}/...). Server functions using the
-- service key are not limited by these rules.
insert into storage.buckets (id, name, public) values ('media', 'media', false)
on conflict (id) do nothing;

drop policy if exists media_public_read on storage.objects;
drop policy if exists media_authenticated_upload on storage.objects;
drop policy if exists media_owner_delete on storage.objects;
drop policy if exists media_company_read on storage.objects;
-- The CASE makes sure a folder name that is not an id is never cast.
create policy media_company_read on storage.objects for select to authenticated using (
  bucket_id = 'media'
  and case
        when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then public.is_member(((storage.foldername(name))[1])::uuid)
        else false
      end
);


-- ============================================================================
-- DONE
-- ============================================================================
-- Tell the Supabase API to read the new functions and tables right away.
notify pgrst, 'reload schema';

select 'setup.sql finished. Next: deploy the Edge Functions, then open the app and tap Create a Company.' as result;
