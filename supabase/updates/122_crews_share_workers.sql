-- ============================================================================
-- Update 122 - run once in Supabase -> SQL Editor (safe to run again).
--  * A worker can now be in more than one crew (for example a Lawn Crew and a
--    Snow Crew). Before, the database allowed one crew per worker.
--  * A worker still cannot be in the same crew twice.
--  * Nothing else changes: who can see or edit crews, and the rule that only
--    maintenance workers can be in the Maintenance Crew, stay as they were.
-- ============================================================================

-- Add the new rule first, so the table is never without a guard.
create unique index if not exists uq_crew_members_crew_person
  on public.crew_members (crew_id, person_id);

-- Now the old one-crew-per-worker rule can go.
drop index if exists public.uq_crew_members_person;
