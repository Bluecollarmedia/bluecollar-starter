-- ============================================================================
-- Update 13 — run once in Supabase → SQL Editor (safe to run again).
--  • Custom overtime for each worker: on or off, how many hours a week before
--    it starts, and the multiplier (e.g. 2x after 45h). Set on More → Payroll
--    Estimate by opening a worker's card. Hourly rates stay where they were
--    (worker_hourly_rates).
--  • Workers without a row here use the company default (1.5x after 40h).
--  • Target-Pay Mode: a company on/off switch (companies.target_pay_enabled)
--    and a target hourly rate per worker (worker_pay_settings.target_hourly_rate).
--    When on, the Payroll estimate pays the target × hours by back-solving
--    a lower base rate in overtime weeks.
--  • Only the owner/admin can see or change worker pay, like hourly rates.
-- ============================================================================

create table if not exists public.worker_pay_settings (
  person_id uuid primary key references public.people(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  overtime_enabled boolean not null default true,
  overtime_after_hours numeric(5,2) not null default 40 check (overtime_after_hours > 0),
  overtime_multiplier numeric(4,2) not null default 1.5 check (overtime_multiplier >= 1),
  updated_at timestamptz not null default now()
);

alter table public.worker_pay_settings
  add column if not exists target_hourly_rate numeric(8,2) check (target_hourly_rate > 0);

alter table public.companies
  add column if not exists target_pay_enabled boolean not null default false;

drop trigger if exists worker_pay_settings_updated_at on public.worker_pay_settings;
create trigger worker_pay_settings_updated_at before update on public.worker_pay_settings
  for each row execute function public.set_updated_at();

alter table public.worker_pay_settings enable row level security;
drop policy if exists worker_pay_settings_staff on public.worker_pay_settings;
create policy worker_pay_settings_staff on public.worker_pay_settings for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));

-- ── Live updates ────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'worker_pay_settings'
  ) then
    alter publication supabase_realtime add table public.worker_pay_settings;
  end if;
end $$;
