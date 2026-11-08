-- ============================================================================
-- Update 21 — Landscaping Mode / Snow Mode switch. Run once in Supabase → SQL
-- Editor (safe to run again). Doesn't depend on any other snow update.
--  • companies.active_mode: 'landscaping' (default) or 'snow'. The owner
--    switches it under Settings → Mode; the app then shows the owner, and
--    every worker who is on the snow team, the Snow Mode screens.
--  • The mode is NOT permission. It only picks between experiences a person
--    already has access to. Snow access comes from the snow team tables
--    (update 20), landscaping access from company_members, as before.
--  • Only the owner/admin can change it (the existing companies_update rule),
--    and the database stamps who changed it and when.
--  • Switching deletes, moves or merges nothing.
-- ============================================================================

alter table public.companies
  add column if not exists active_mode text not null default 'landscaping',
  add column if not exists active_mode_changed_at timestamptz,
  add column if not exists active_mode_changed_by uuid references public.people(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'companies_active_mode_check') then
    alter table public.companies
      add constraint companies_active_mode_check check (active_mode in ('landscaping', 'snow'));
  end if;
end $$;

-- Stamp the change, and keep anyone from forging the stamp.
create or replace function public.companies_stamp_mode_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.active_mode is distinct from old.active_mode then
    -- auth.uid() is null in the SQL Editor (service role); allow that.
    if auth.uid() is not null and not public.is_staff(new.id) then
      raise exception 'Only the owner can switch between Landscaping and Snow Mode';
    end if;
    new.active_mode_changed_at := now();
    new.active_mode_changed_by := public.my_person_id();
  else
    new.active_mode_changed_at := old.active_mode_changed_at;
    new.active_mode_changed_by := old.active_mode_changed_by;
  end if;
  return new;
end;
$$;

drop trigger if exists companies_stamp_mode_change on public.companies;
create trigger companies_stamp_mode_change
  before update on public.companies
  for each row execute function public.companies_stamp_mode_change();
