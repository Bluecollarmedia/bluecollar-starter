-- ============================================================================
-- Update 10 — run once in Supabase → SQL Editor (safe to run again).
--  • Storage limit: the owner picks the company's storage limit under
--    More → Settings → Storage (1 GB, 100 GB, 1 TB, Unlimited or any custom number of GB).
--    0 means no limit. Existing companies start at 1 GB, the Supabase
--    Free plan's limit; anything bigger needs the Supabase Pro plan.
--  • No new access rules: everyone in the company can already read the
--    company row, and only the owner/admin can change it.
-- ============================================================================

alter table public.companies
  add column if not exists storage_limit_gb integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'companies_storage_limit_gb_check'
  ) then
    alter table public.companies
      add constraint companies_storage_limit_gb_check check (storage_limit_gb >= 0);
  end if;
end $$;
