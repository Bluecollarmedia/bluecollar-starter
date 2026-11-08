-- Phase 7: Operations, Payroll, Notifications, Announcements
-- Migration 007

-- ── Work Sessions ──────────────────────────────────────────────
-- Derived from check-in/out records. Original check-in/out evidence is preserved.

CREATE TABLE IF NOT EXISTS work_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  person_id UUID NOT NULL REFERENCES people(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  assignment_id UUID NOT NULL REFERENCES assignments(id),
  check_in_time TIMESTAMPTZ NOT NULL,
  check_out_time TIMESTAMPTZ,
  duration_minutes NUMERIC(8,2),
  check_in_gps JSONB,
  check_out_gps JSONB,
  offline_check_in TIMESTAMPTZ,
  offline_check_out TIMESTAMPTZ,
  synced_check_in_at TIMESTAMPTZ,
  synced_check_out_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'corrected')),
  correction JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_work_sessions_person_date ON work_sessions (person_id, check_in_time);
CREATE INDEX idx_work_sessions_company ON work_sessions (company_id, check_in_time);

-- ── Worker Hourly Rates (effective-dated) ──────────────────────
-- Rate changes create new rows; historical rates are preserved.

CREATE TABLE IF NOT EXISTS worker_hourly_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  person_id UUID NOT NULL REFERENCES people(id),
  hourly_rate NUMERIC(8,2) NOT NULL,
  effective_date DATE NOT NULL,
  end_date DATE,
  set_by UUID NOT NULL REFERENCES people(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_rate_per_person_date UNIQUE (person_id, effective_date)
);

CREATE INDEX idx_hourly_rates_person ON worker_hourly_rates (person_id, effective_date);

-- ── Overtime Rules ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS overtime_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  rule_type TEXT NOT NULL CHECK (rule_type IN ('weekly_40', 'daily_8', 'custom', 'none')),
  weekly_threshold_hours NUMERIC(5,2),
  daily_threshold_hours NUMERIC(5,2),
  overtime_multiplier NUMERIC(3,2) NOT NULL DEFAULT 1.5,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Notification Preferences ───────────────────────────────────
-- Company-wide defaults have person_id NULL.
-- Worker-specific overrides have person_id set.

CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  person_id UUID REFERENCES people(id),
  event_type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_pref UNIQUE (company_id, person_id, event_type)
);

-- ── App Notifications ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  recipient_id UUID NOT NULL REFERENCES people(id),
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'dismissed')),
  linked_entity_type TEXT,
  linked_entity_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE INDEX idx_notifications_recipient ON app_notifications (recipient_id, status, created_at DESC);

-- ── Company Operations Settings ────────────────────────────────

CREATE TABLE IF NOT EXISTS company_operations_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL UNIQUE REFERENCES companies(id),
  missing_checkin_grace_minutes INTEGER NOT NULL DEFAULT 10,
  late_checkin_threshold_minutes INTEGER NOT NULL DEFAULT 0,
  past_end_alert_enabled BOOLEAN NOT NULL DEFAULT true,
  overtime_rule_id UUID REFERENCES overtime_rules(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Extend Announcements ───────────────────────────────────────

ALTER TABLE announcements ADD COLUMN IF NOT EXISTS recipient_ids UUID[];
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS weather_action TEXT;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS schedule_action JSONB;

-- ── Worker Reminders ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS worker_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES people(id),
  assignment_id UUID NOT NULL REFERENCES assignments(id),
  reminder_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  next_assignment JSONB,
  actions JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE INDEX idx_reminders_person ON worker_reminders (person_id, created_at DESC);

-- ── RLS Policies ───────────────────────────────────────────────

ALTER TABLE work_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_hourly_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY work_sessions_company ON work_sessions
  FOR ALL USING (company_id IN (SELECT company_id FROM company_members WHERE person_id = auth.uid()));

CREATE POLICY hourly_rates_owner_only ON worker_hourly_rates
  FOR ALL USING (company_id IN (
    SELECT company_id FROM company_members WHERE person_id = auth.uid() AND role IN ('owner', 'admin')
  ));

CREATE POLICY notifications_own ON app_notifications
  FOR ALL USING (recipient_id = auth.uid());
