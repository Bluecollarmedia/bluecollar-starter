-- ============================================================
-- 003 · Owner Management: Trucks, Announcements, Daily Assignments
-- ============================================================

-- ── Trucks ──────────────────────────────────────────────────────
create table if not exists public.trucks (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null,
  make         text,
  model        text,
  year         smallint,
  license_plate text,
  vin          text,
  color        text,
  status       text not null default 'available'
                 check (status in ('available','assigned','maintenance','out_of_service')),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index idx_trucks_company on public.trucks(company_id);

-- ── Daily Truck Assignments ─────────────────────────────────────
create table if not exists public.daily_truck_assignments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  truck_id      uuid not null references public.trucks(id) on delete cascade,
  person_id     uuid not null references public.people(id) on delete cascade,
  assigned_date date not null,
  created_at    timestamptz not null default now(),
  unique (truck_id, assigned_date),
  unique (person_id, assigned_date)
);

create index idx_truck_assignments_date on public.daily_truck_assignments(assigned_date);
create index idx_truck_assignments_company on public.daily_truck_assignments(company_id);

-- ── Announcements ───────────────────────────────────────────────
create table if not exists public.announcements (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  created_by    uuid not null references public.people(id),
  title         text not null,
  body          text not null,
  audience      text not null default 'all_workers'
                  check (audience in ('all_workers','all_members','selected')),
  priority      text not null default 'normal'
                  check (priority in ('normal','urgent')),
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_announcements_company on public.announcements(company_id);
create index idx_announcements_created on public.announcements(created_at desc);

-- ── Announcement Read Receipts ──────────────────────────────────
create table if not exists public.announcement_reads (
  id              uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  person_id       uuid not null references public.people(id) on delete cascade,
  read_at         timestamptz not null default now(),
  unique (announcement_id, person_id)
);

-- ── Add truck_id to schedule_entries ────────────────────────────
alter table public.schedule_entries
  add column if not exists truck_id uuid references public.trucks(id);

-- ── RLS Policies ────────────────────────────────────────────────

alter table public.trucks enable row level security;
alter table public.daily_truck_assignments enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_reads enable row level security;

-- Trucks: company-scoped read, owner/admin write
create policy "trucks_select" on public.trucks for select using (
  company_id in (select company_id from public.company_members where person_id = auth.uid())
);
create policy "trucks_insert" on public.trucks for insert with check (
  company_id in (
    select company_id from public.company_members
    where person_id = auth.uid() and role in ('owner','admin')
  )
);
create policy "trucks_update" on public.trucks for update using (
  company_id in (
    select company_id from public.company_members
    where person_id = auth.uid() and role in ('owner','admin')
  )
);

-- Daily truck assignments: company-scoped read, owner/admin write
create policy "truck_assign_select" on public.daily_truck_assignments for select using (
  company_id in (select company_id from public.company_members where person_id = auth.uid())
);
create policy "truck_assign_insert" on public.daily_truck_assignments for insert with check (
  company_id in (
    select company_id from public.company_members
    where person_id = auth.uid() and role in ('owner','admin')
  )
);
create policy "truck_assign_delete" on public.daily_truck_assignments for delete using (
  company_id in (
    select company_id from public.company_members
    where person_id = auth.uid() and role in ('owner','admin')
  )
);

-- Announcements: company-scoped read, owner/admin write
create policy "announcements_select" on public.announcements for select using (
  company_id in (select company_id from public.company_members where person_id = auth.uid())
);
create policy "announcements_insert" on public.announcements for insert with check (
  company_id in (
    select company_id from public.company_members
    where person_id = auth.uid() and role in ('owner','admin')
  )
);
create policy "announcements_update" on public.announcements for update using (
  company_id in (
    select company_id from public.company_members
    where person_id = auth.uid() and role in ('owner','admin')
  )
);

-- Announcement reads: users can read their own, insert their own
create policy "reads_select" on public.announcement_reads for select using (
  person_id = auth.uid()
);
create policy "reads_insert" on public.announcement_reads for insert with check (
  person_id = auth.uid()
);
