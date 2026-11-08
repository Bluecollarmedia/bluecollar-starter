-- ============================================================================
-- Update 5 — run once in Supabase → SQL Editor (safe to run again).
--  • A worker can only be scheduled on the same job once per day.
--  • Any doubles that already exist are cancelled (the oldest one is kept),
--    so the rule below can be added.
-- ============================================================================

-- Cancel the extra copies of a worker on the same job on the same day.
update public.assignments a
set status = 'cancelled',
    cancelled_at = now(),
    cancellation_reason = 'Duplicate: already scheduled on this job this day',
    updated_at = now()
where a.status not in ('cancelled', 'reassigned')
  and exists (
    select 1 from public.assignments b
    where b.person_id = a.person_id
      and b.project_id = a.project_id
      and b.scheduled_date = a.scheduled_date
      and b.status not in ('cancelled', 'reassigned')
      and (b.created_at, b.id) < (a.created_at, a.id)
  );

-- Block new doubles. Cancelled and moved assignments don't count.
create unique index if not exists uq_assignments_worker_job_day
  on public.assignments (person_id, project_id, scheduled_date)
  where status not in ('cancelled', 'reassigned');
