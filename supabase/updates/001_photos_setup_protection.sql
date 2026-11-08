-- ============================================================================
-- Update 1 — run once in Supabase → SQL Editor (safe to run again).
--  • Your own photos: project cover photo + dashboard photo
--  • First-time setup progress for the owner
--  • The company can't be deleted (not from the app, not from Supabase)
-- ============================================================================

alter table public.projects  add column if not exists cover_photo_url text;
alter table public.companies add column if not exists cover_photo_url text;
alter table public.companies add column if not exists setup_state jsonb not null default '{}'::jsonb;
alter table public.companies add column if not exists setup_completed_at timestamptz;

-- Block deleting a company. The only way around it is a deliberate reset
-- script that first runs: set local app.allow_company_delete = 'on';
create or replace function public.prevent_company_delete()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.allow_company_delete', true), '') <> 'on' then
    raise exception 'Companies cannot be deleted.';
  end if;
  return old;
end;
$$;

drop trigger if exists companies_no_delete on public.companies;
create trigger companies_no_delete
  before delete on public.companies
  for each row execute function public.prevent_company_delete();

-- Same for wiping the whole table at once.
drop trigger if exists companies_no_truncate on public.companies;
create trigger companies_no_truncate
  before truncate on public.companies
  for each statement execute function public.prevent_company_delete();
