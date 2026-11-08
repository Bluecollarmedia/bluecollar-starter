-- ============================================================================
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
-- !!  DANGER: DELETES EVERYTHING. THERE IS NO UNDO.                          !!
-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
--
-- admin_reset_all_data.sql  -  empties the app's database to start over (for a TEST or DEMO project).
--
-- It deletes: the company, every job, job site, customer, worker, crew, truck, schedule, time record, quote, invoice, note,
-- message and notification, every person, and EVERY LOGIN (everyone must sign up again, starting with "Create a Company").
-- It keeps: the tables, functions and rules themselves (setup.sql does not need to be run again), the app_settings row
-- (functions_url), and the storage clean-up list. Files already uploaded to storage (Cloudflare R2) are NOT deleted.
--
-- NEVER run this on a client's live database unless the client asked for everything to be wiped.
-- It is NOT part of setup.sql and must never be pasted together with it.
--
-- Run: Supabase -> SQL Editor -> paste this file -> Run. All or nothing: if anything fails, nothing is deleted.
-- ============================================================================

begin;
  -- Companies are protected from deletion; this script (and "Delete company" in the app) are the only ways past that rule.
  set local app.allow_company_delete = 'on';

  -- Everything that belongs to a company or a person goes with them (TRUNCATE ... CASCADE skips the per-row triggers).
  truncate table public.companies, public.people, public.company_closure_log cascade;
  -- Every login (auth.identities rows go with them).
  delete from auth.users;
commit;

select 'Reset done. Open the app and tap Create a Company.' as result;
