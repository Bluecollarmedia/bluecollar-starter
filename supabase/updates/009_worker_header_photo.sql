-- ============================================================================
-- Update 9 — run once in Supabase → SQL Editor (safe to run again).
--  • Workers' home header photo: the owner can pick a photo for the top of
--    the workers' Today, Jobs and Activity screens, separate from their own
--    dashboard photo. Set under More → Settings → Company Info & Header
--    Photos. With no photo, the app shows the Brighton green header.
--  • No new access rules: everyone in the company can already read the
--    company row, and only the owner/admin can change it.
-- ============================================================================

alter table public.companies
  add column if not exists worker_cover_photo_url text;
