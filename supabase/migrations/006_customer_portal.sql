-- 006_customer_portal.sql
-- Customer-facing portal: shared photos tracking, customer timeline, project requests

-- ── Shared photos audit trail ──────────────────────────────────
-- Photos live in project_photos (003). This adds the customer-visibility columns.
ALTER TABLE project_photos
  ADD COLUMN IF NOT EXISTS customer_description text,
  ADD COLUMN IF NOT EXISTS is_customer_visible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shared_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS shared_at timestamptz;

CREATE INDEX idx_project_photos_customer_visible
  ON project_photos (project_id, is_customer_visible)
  WHERE is_customer_visible = true;

-- ── Project updates — customer visibility ──────────────────────
ALTER TABLE project_updates
  ADD COLUMN IF NOT EXISTS is_customer_visible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS photo_ids uuid[] DEFAULT '{}';

-- ── Customer timeline ──────────────────────────────────────────
CREATE TABLE customer_timeline (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_type    text NOT NULL CHECK (event_type IN (
    'update_shared', 'photo_shared', 'progress_updated',
    'project_started', 'project_completed', 'request_responded'
  )),
  title         text NOT NULL,
  description   text,
  photo_url     text,
  timestamp     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_customer_timeline_project ON customer_timeline (project_id, timestamp DESC);

-- ── Project requests — add category + linked task ──────────────
ALTER TABLE project_requests
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('change_request', 'question', 'additional_work', 'other')),
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS linked_task_id uuid REFERENCES project_tasks(id);

-- Allow 'converted' as a request status
ALTER TABLE project_requests
  DROP CONSTRAINT IF EXISTS project_requests_status_check;
ALTER TABLE project_requests
  ADD CONSTRAINT project_requests_status_check
    CHECK (status IN ('pending', 'acknowledged', 'completed', 'declined', 'converted'));

-- ── RLS policies ───────────────────────────────────────────────

ALTER TABLE customer_timeline ENABLE ROW LEVEL SECURITY;

-- Customers see their own project timeline
CREATE POLICY customer_timeline_customer_read ON customer_timeline
  FOR SELECT USING (
    project_id IN (
      SELECT id FROM projects WHERE customer_id = auth.uid()
    )
  );

-- Owner/workers can read all timelines in their company
CREATE POLICY customer_timeline_company_read ON customer_timeline
  FOR SELECT USING (
    project_id IN (
      SELECT id FROM projects WHERE company_id IN (
        SELECT company_id FROM company_members WHERE person_id = auth.uid()
      )
    )
  );

-- Only owners can insert timeline events
CREATE POLICY customer_timeline_owner_insert ON customer_timeline
  FOR INSERT WITH CHECK (
    project_id IN (
      SELECT id FROM projects WHERE company_id IN (
        SELECT company_id FROM company_members
        WHERE person_id = auth.uid() AND role = 'owner'
      )
    )
  );

-- Customers can only see photos marked customer_visible
CREATE POLICY project_photos_customer_read ON project_photos
  FOR SELECT USING (
    is_customer_visible = true
    AND project_id IN (
      SELECT id FROM projects WHERE customer_id = auth.uid()
    )
  );
