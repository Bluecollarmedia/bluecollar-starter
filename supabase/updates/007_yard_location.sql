-- ============================================================================
-- Update 7 — run once in Supabase → SQL Editor (safe to run again).
--  • Company yard location: the address crews start and end the day at.
--    The owner sets it under More → Settings → Yard Location; workers tap it
--    on their Today screen for directions. It's separate from the company's
--    office address and from every jobsite.
--  • No new access rules: everyone in the company can already read the
--    company row, and only the owner/admin can change it.
-- ============================================================================

alter table public.companies
  add column if not exists yard_address text,
  add column if not exists yard_city text,
  add column if not exists yard_state text,
  add column if not exists yard_zip text,
  add column if not exists yard_latitude double precision,
  add column if not exists yard_longitude double precision;
