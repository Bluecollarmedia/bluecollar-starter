-- ============================================================================
-- ⚠️  RESET — DELETES EVERYTHING. Run only to start over with an empty app.
--
-- Wipes every company, project, worker, customer, snow storm, truck, note, message and every login (all accounts must sign up
-- again, starting with Create a Company). There is no undo. Uploaded photo/ID files stay in storage (R2 / Supabase Storage).
--
-- Run in Supabase → SQL Editor, with plain "Run". It is all-or-nothing: if anything fails, nothing is deleted.
--
-- It empties the tables with TRUNCATE ... CASCADE (so the "keep history" protections on snow storms and the company delete guard
-- do not get in the way) and then removes every login.
-- ============================================================================

begin;
  -- Companies are protected from deletion; this script is the one exception.
  set local app.allow_company_delete = 'on';

  truncate table public.companies, public.people cascade;   -- everything that belongs to a company or a person
  delete from auth.users;                                    -- every login
commit;

select 'Reset done. Open the app and tap Create a Company.' as result;
