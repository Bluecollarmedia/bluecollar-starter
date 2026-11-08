-- ================================================================
-- 008: Onboarding, Membership & Join System
-- ================================================================

-- Add profile photo to persons
ALTER TABLE persons ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;

-- ── Team Codes ─────────────────────────────────────────────────
CREATE TABLE team_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code        TEXT NOT NULL UNIQUE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID NOT NULL REFERENCES persons(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at TIMESTAMPTZ
);

CREATE INDEX idx_team_codes_company ON team_codes(company_id);
CREATE INDEX idx_team_codes_code ON team_codes(code) WHERE is_active = TRUE;

-- ── Company Join Settings ──────────────────────────────────────
CREATE TABLE company_join_settings (
  company_id                UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  join_by_code_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  direct_invitations_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  require_email_verification BOOLEAN NOT NULL DEFAULT TRUE,
  current_team_code_id      UUID REFERENCES team_codes(id)
);

-- ── Company Invitations ────────────────────────────────────────
CREATE TABLE company_invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  name        TEXT,
  phone       TEXT,
  type        TEXT NOT NULL CHECK (type IN ('worker', 'customer')),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  project_id  UUID REFERENCES projects(id),
  invited_by  UUID NOT NULL REFERENCES persons(id),
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES persons(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invitations_company ON company_invitations(company_id);
CREATE INDEX idx_invitations_email ON company_invitations(email);
CREATE INDEX idx_invitations_token ON company_invitations(token) WHERE status = 'pending';

-- ── Join Requests ──────────────────────────────────────────────
CREATE TABLE join_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  person_id      UUID NOT NULL REFERENCES persons(id),
  join_method    TEXT NOT NULL CHECK (join_method IN ('team_code', 'email_invitation', 'invitation_link')),
  invitation_id  UUID REFERENCES company_invitations(id),
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  requested_role TEXT CHECK (requested_role IN ('worker', 'customer')),
  assigned_role  TEXT CHECK (assigned_role IN ('worker', 'customer', 'admin')),
  reviewed_by    UUID REFERENCES persons(id),
  reviewed_at    TIMESTAMPTZ,
  decline_reason TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, person_id, status) -- prevent duplicate pending requests
);

CREATE INDEX idx_join_requests_company ON join_requests(company_id);
CREATE INDEX idx_join_requests_person ON join_requests(person_id);
CREATE INDEX idx_join_requests_pending ON join_requests(company_id, status) WHERE status = 'pending';

-- ── Company Memberships (clean model) ──────────────────────────
-- Extends the existing company_members concept with join tracking
ALTER TABLE company_members ADD COLUMN IF NOT EXISTS join_method TEXT DEFAULT 'company_creator';
ALTER TABLE company_members ADD COLUMN IF NOT EXISTS join_request_id UUID REFERENCES join_requests(id);
ALTER TABLE company_members ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES persons(id);
ALTER TABLE company_members ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE company_members ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE company_members ADD COLUMN IF NOT EXISTS deactivated_by UUID REFERENCES persons(id);

-- ── Membership Audit Log ───────────────────────────────────────
CREATE TABLE membership_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  actor_id    UUID NOT NULL REFERENCES persons(id),
  target_id   UUID REFERENCES persons(id),
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_company ON membership_audit_log(company_id);
CREATE INDEX idx_audit_log_type ON membership_audit_log(event_type);

-- ── RLS Policies ───────────────────────────────────────────────

ALTER TABLE team_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_join_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_audit_log ENABLE ROW LEVEL SECURITY;

-- Team codes: public read for active codes (needed for join flow), owner/admin manage
CREATE POLICY "Anyone can validate active team codes"
  ON team_codes FOR SELECT
  USING (is_active = TRUE);

CREATE POLICY "Owner/admin manage team codes"
  ON team_codes FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM company_members
      WHERE company_id = team_codes.company_id
      AND person_id = auth.uid()
      AND role IN ('owner', 'admin')
      AND status = 'active'
    )
  );

-- Join settings: owner/admin only
CREATE POLICY "Owner/admin manage join settings"
  ON company_join_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM company_members
      WHERE company_id = company_join_settings.company_id
      AND person_id = auth.uid()
      AND role IN ('owner', 'admin')
      AND status = 'active'
    )
  );

-- Invitations: owner/admin create/manage, recipient can view their own
CREATE POLICY "Owner/admin manage invitations"
  ON company_invitations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM company_members
      WHERE company_id = company_invitations.company_id
      AND person_id = auth.uid()
      AND role IN ('owner', 'admin')
      AND status = 'active'
    )
  );

CREATE POLICY "Recipients can view their invitations"
  ON company_invitations FOR SELECT
  USING (
    email = (SELECT email FROM persons WHERE id = auth.uid())
  );

-- Join requests: person can see own, owner/admin can see all for company
CREATE POLICY "Person sees own join requests"
  ON join_requests FOR SELECT
  USING (person_id = auth.uid());

CREATE POLICY "Person can create join requests"
  ON join_requests FOR INSERT
  WITH CHECK (person_id = auth.uid());

CREATE POLICY "Person can cancel own pending requests"
  ON join_requests FOR UPDATE
  USING (person_id = auth.uid() AND status = 'pending');

CREATE POLICY "Owner/admin manage join requests"
  ON join_requests FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM company_members
      WHERE company_id = join_requests.company_id
      AND person_id = auth.uid()
      AND role IN ('owner', 'admin')
      AND status = 'active'
    )
  );

-- Audit log: owner/admin read only
CREATE POLICY "Owner/admin view audit log"
  ON membership_audit_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM company_members
      WHERE company_id = membership_audit_log.company_id
      AND person_id = auth.uid()
      AND role IN ('owner', 'admin')
      AND status = 'active'
    )
  );

CREATE POLICY "System inserts audit log"
  ON membership_audit_log FOR INSERT
  WITH CHECK (TRUE);
