-- ============================================================================
-- Update 53 — run once in Supabase → SQL Editor (safe to run again). NOT run yet; read it before running.
--
-- The owner sets the biggest single file (photo or video) people can upload: More → Settings → Storage → Max file size.
--  • Stored on the company: max_file_size_mb (whole MB, 1 to 200). Empty means the upload service's own maximum (200 MB).
--  • No new access rules: everyone in the company can already read the company row; only the owner/admin can change it.
--  • The app checks it before uploading, and the media Edge Function checks it again (redeploy that function after this update).
-- ============================================================================

alter table public.companies add column if not exists max_file_size_mb integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'companies_max_file_size_mb_check') then
    alter table public.companies
      add constraint companies_max_file_size_mb_check check (max_file_size_mb is null or max_file_size_mb between 1 and 200);
  end if;
end $$;
