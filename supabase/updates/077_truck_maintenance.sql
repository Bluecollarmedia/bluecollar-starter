-- ============================================================================
-- Update 77 — truck Maintenance log (title, date serviced, next service due, notes).
-- Run once in Supabase → SQL Editor, AFTER update 56 (safe to run again). NOT run yet; read it before running.
--
-- The owner keeps a maintenance log for each truck: what was done (title and notes), the date it was done, and when it is next due.
-- When the due date comes, the owner's phone shows a reminder (set up on the phone from this saved date, like the materials reminders).
--  • PRIVATE like the truck's insurance papers (update 56): only the company OWNER can see, add, change or delete a record. Admins,
--    workers and customers get nothing back, even if they ask the database directly.
--  • Nothing existing is changed. The older "private notes" (truck_notes) are no longer shown in the app; their rows are kept.
-- ============================================================================
create table if not exists public.truck_maintenance (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  truck_id uuid not null references public.trucks(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  -- The date the service was done.
  serviced_on date not null,
  -- When it is next due (optional): the owner is reminded on this date.
  due_on date,
  -- What was done.
  notes text,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_on is null or due_on >= serviced_on)
);
create index if not exists idx_truck_maintenance_truck on public.truck_maintenance (truck_id, serviced_on desc);
create index if not exists idx_truck_maintenance_due on public.truck_maintenance (company_id, due_on) where due_on is not null;

alter table public.truck_maintenance enable row level security;
drop policy if exists truck_maintenance_owner_select on public.truck_maintenance;
drop policy if exists truck_maintenance_owner_insert on public.truck_maintenance;
drop policy if exists truck_maintenance_owner_update on public.truck_maintenance;
drop policy if exists truck_maintenance_owner_delete on public.truck_maintenance;
create policy truck_maintenance_owner_select on public.truck_maintenance for select using (public.is_company_owner(company_id));
-- The truck must belong to the same company, so nobody can attach a record to another company's truck.
create policy truck_maintenance_owner_insert on public.truck_maintenance for insert with check (
  public.is_company_owner(company_id) and exists (select 1 from public.trucks tr where tr.id = truck_id and tr.company_id = truck_maintenance.company_id));
create policy truck_maintenance_owner_update on public.truck_maintenance for update using (public.is_company_owner(company_id)) with check (public.is_company_owner(company_id));
create policy truck_maintenance_owner_delete on public.truck_maintenance for delete using (public.is_company_owner(company_id));
drop trigger if exists truck_maintenance_updated_at on public.truck_maintenance;
create trigger truck_maintenance_updated_at before update on public.truck_maintenance for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
