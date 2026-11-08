-- ============================================================================
-- Update 56 — run once in Supabase → SQL Editor (safe to run again). NOT run yet; read it before running.
--
-- Truck documents (insurance, registration, inspection, any PDF or photo) and the owner's private notes for each truck.
--  • truck_documents: the file's address and details (title, kind, expiry date). The file itself lives in the company's photo
--    storage (R2), like every other upload.
--  • truck_notes: the owner's own dated notes for one truck ("where I'm at"): needs a new battery, insurance renewing, etc.
--  • PRIVATE: only the company OWNER can see, add, change or delete either one. Admins, workers and customers get nothing back,
--    even if they ask the database directly. (The short "Notes" box on the truck itself is separate and unchanged.)
-- ============================================================================

create table if not exists public.truck_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  truck_id uuid not null references public.trucks(id) on delete cascade,
  kind text not null default 'other' check (kind in ('insurance','registration','inspection','other')),
  title text not null check (length(trim(title)) > 0),
  file_url text not null,
  file_key text,
  content_type text,
  size_bytes bigint,
  expires_on date,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_truck_documents_truck on public.truck_documents (truck_id, created_at desc);

create table if not exists public.truck_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  truck_id uuid not null references public.trucks(id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_truck_notes_truck on public.truck_notes (truck_id, created_at desc);

create or replace function public.is_company_owner(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.member_role(cid) = 'owner', false)
$$;

alter table public.truck_documents enable row level security;
alter table public.truck_notes enable row level security;

do $$
declare t text;
begin
  foreach t in array array['truck_documents','truck_notes'] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_delete', t);
    execute format('create policy %I on public.%I for select using (public.is_company_owner(company_id))', t || '_owner_select', t);
    -- The truck must belong to the same company, so nobody can attach a file to another company's truck.
    execute format('create policy %I on public.%I for insert with check (public.is_company_owner(company_id)
      and exists (select 1 from public.trucks tr where tr.id = truck_id and tr.company_id = %I.company_id))', t || '_owner_insert', t, t);
    execute format('create policy %I on public.%I for update using (public.is_company_owner(company_id)) with check (public.is_company_owner(company_id))', t || '_owner_update', t);
    execute format('create policy %I on public.%I for delete using (public.is_company_owner(company_id))', t || '_owner_delete', t);
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;
