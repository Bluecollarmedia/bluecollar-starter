-- Phase 9: Storage Security & Production Hardening
-- Adds storage usage tracking, upload audit log, storage settings,
-- and fixes RLS gaps from prior migrations.

-- ── Storage Settings (company-level quota & limits) ────────────────
CREATE TABLE IF NOT EXISTS storage_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  max_storage_bytes BIGINT NOT NULL DEFAULT 5368709120, -- 5 GB default
  max_file_size_bytes BIGINT NOT NULL DEFAULT 10485760,  -- 10 MB default
  allowed_mime_types TEXT[] NOT NULL DEFAULT ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
  ],
  rate_limit_uploads_per_minute INT NOT NULL DEFAULT 10,
  rate_limit_uploads_per_hour INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE storage_settings ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER storage_settings_updated_at
  BEFORE UPDATE ON storage_settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── Storage Usage (running totals per company) ─────────────────────
CREATE TABLE IF NOT EXISTS storage_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  total_bytes BIGINT NOT NULL DEFAULT 0,
  file_count INT NOT NULL DEFAULT 0,
  photo_count INT NOT NULL DEFAULT 0,
  avatar_count INT NOT NULL DEFAULT 0,
  document_count INT NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE storage_usage ENABLE ROW LEVEL SECURITY;

-- ── Upload Log (audit trail for every upload/delete) ───────────────
CREATE TABLE IF NOT EXISTS upload_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES profiles(id),
  action TEXT NOT NULL CHECK (action IN ('upload', 'delete', 'failed')),
  file_key TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  content_type TEXT,
  purpose TEXT NOT NULL,
  entity_id UUID,
  error_message TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_upload_log_company ON upload_log(company_id, created_at DESC);
CREATE INDEX idx_upload_log_person ON upload_log(person_id, created_at DESC);
CREATE INDEX idx_upload_log_idempotency ON upload_log(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE upload_log ENABLE ROW LEVEL SECURITY;

-- ── Add file metadata columns to project_photos ────────────────────
ALTER TABLE project_photos ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;
ALTER TABLE project_photos ADD COLUMN IF NOT EXISTS content_type TEXT;
ALTER TABLE project_photos ADD COLUMN IF NOT EXISTS width INT;
ALTER TABLE project_photos ADD COLUMN IF NOT EXISTS height INT;
ALTER TABLE project_photos ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
ALTER TABLE project_photos ADD COLUMN IF NOT EXISTS blurhash TEXT;

-- ── Add file metadata columns to worker_photos ─────────────────────
ALTER TABLE worker_photos ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;
ALTER TABLE worker_photos ADD COLUMN IF NOT EXISTS content_type TEXT;
ALTER TABLE worker_photos ADD COLUMN IF NOT EXISTS width INT;
ALTER TABLE worker_photos ADD COLUMN IF NOT EXISTS height INT;
ALTER TABLE worker_photos ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
ALTER TABLE worker_photos ADD COLUMN IF NOT EXISTS blurhash TEXT;

-- ── Add avatar metadata to people ──────────────────────────────────
ALTER TABLE people ADD COLUMN IF NOT EXISTS avatar_file_key TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS avatar_file_size_bytes BIGINT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS avatar_blurhash TEXT;

-- ══════════════════════════════════════════════════════════════════
-- RLS POLICIES — NEW TABLES
-- ══════════════════════════════════════════════════════════════════

-- Storage settings: owner/admin can read and manage
CREATE POLICY storage_settings_read ON storage_settings
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM company_members
      WHERE person_id = auth.uid() AND status = 'active'
    )
  );

CREATE POLICY storage_settings_manage ON storage_settings
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM company_members
      WHERE person_id = auth.uid() AND role IN ('owner', 'admin') AND status = 'active'
    )
  );

-- Storage usage: any company member can read, only server (service role) writes
CREATE POLICY storage_usage_read ON storage_usage
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM company_members
      WHERE person_id = auth.uid() AND status = 'active'
    )
  );

-- Upload log: owner/admin can read the full log
CREATE POLICY upload_log_read ON upload_log
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM company_members
      WHERE person_id = auth.uid() AND role IN ('owner', 'admin') AND status = 'active'
    )
  );

-- Upload log: users can see their own uploads
CREATE POLICY upload_log_own ON upload_log
  FOR SELECT USING (person_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════
-- RLS FIXES — PRIOR MIGRATION GAPS
-- ══════════════════════════════════════════════════════════════════

-- FIX: 005_worker_checkins — 5 tables had RLS enabled but ZERO policies

-- check_ins: workers can see/insert their own, owner/admin can see all in company
CREATE POLICY check_ins_own ON check_ins
  FOR SELECT USING (person_id = auth.uid());

CREATE POLICY check_ins_insert_own ON check_ins
  FOR INSERT WITH CHECK (person_id = auth.uid());

CREATE POLICY check_ins_company_read ON check_ins
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM company_members
      WHERE person_id = auth.uid() AND role IN ('owner', 'admin') AND status = 'active'
    )
  );

-- check_outs: same pattern
CREATE POLICY check_outs_own ON check_outs
  FOR SELECT USING (person_id = auth.uid());

CREATE POLICY check_outs_insert_own ON check_outs
  FOR INSERT WITH CHECK (person_id = auth.uid());

CREATE POLICY check_outs_company_read ON check_outs
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM company_members
      WHERE person_id = auth.uid() AND role IN ('owner', 'admin') AND status = 'active'
    )
  );

-- worker_photos: uploader can see own, company members can read, only uploader inserts
CREATE POLICY worker_photos_own ON worker_photos
  FOR SELECT USING (uploaded_by = auth.uid());

CREATE POLICY worker_photos_insert ON worker_photos
  FOR INSERT WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY worker_photos_company_read ON worker_photos
  FOR SELECT USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN company_members cm ON cm.company_id = p.company_id
      WHERE cm.person_id = auth.uid() AND cm.status = 'active'
    )
  );

-- offline_actions: only own records
CREATE POLICY offline_actions_own ON offline_actions
  FOR ALL USING (person_id = auth.uid());

-- worker_activities: own records + owner/admin can read company
CREATE POLICY worker_activities_own ON worker_activities
  FOR SELECT USING (person_id = auth.uid());

CREATE POLICY worker_activities_insert_own ON worker_activities
  FOR INSERT WITH CHECK (person_id = auth.uid());

CREATE POLICY worker_activities_company_read ON worker_activities
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM company_members
      WHERE person_id = auth.uid() AND role IN ('owner', 'admin') AND status = 'active'
    )
  );

-- FIX: 007_operations_payroll — 4 tables had NO RLS at all

ALTER TABLE overtime_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_operations_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY overtime_rules_manage ON overtime_rules
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM company_members
      WHERE person_id = auth.uid() AND role IN ('owner', 'admin') AND status = 'active'
    )
  );

CREATE POLICY notification_prefs_own ON notification_preferences
  FOR ALL USING (
    person_id = auth.uid()
    OR (person_id IS NULL AND company_id IN (
      SELECT company_id FROM company_members
      WHERE person_id = auth.uid() AND role IN ('owner', 'admin') AND status = 'active'
    ))
  );

CREATE POLICY operations_settings_read ON company_operations_settings
  FOR SELECT USING (
    company_id IN (
      SELECT company_id FROM company_members
      WHERE person_id = auth.uid() AND status = 'active'
    )
  );

CREATE POLICY operations_settings_manage ON company_operations_settings
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM company_members
      WHERE person_id = auth.uid() AND role IN ('owner', 'admin') AND status = 'active'
    )
  );

CREATE POLICY worker_reminders_own ON worker_reminders
  FOR ALL USING (person_id = auth.uid());

-- FIX: work_sessions — restrict to own records for workers, full for owner/admin
DROP POLICY IF EXISTS work_sessions_company ON work_sessions;

CREATE POLICY work_sessions_own ON work_sessions
  FOR SELECT USING (person_id = auth.uid());

CREATE POLICY work_sessions_insert_own ON work_sessions
  FOR INSERT WITH CHECK (person_id = auth.uid());

CREATE POLICY work_sessions_manage ON work_sessions
  FOR ALL USING (
    company_id IN (
      SELECT company_id FROM company_members
      WHERE person_id = auth.uid() AND role IN ('owner', 'admin') AND status = 'active'
    )
  );

-- FIX: membership_audit_log — restrict INSERT to company members
DROP POLICY IF EXISTS "Anyone can append audit log" ON membership_audit_log;

CREATE POLICY audit_log_insert_members ON membership_audit_log
  FOR INSERT WITH CHECK (
    company_id IN (
      SELECT company_id FROM company_members
      WHERE person_id = auth.uid() AND status = 'active'
    )
  );
