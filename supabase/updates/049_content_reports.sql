-- ============================================================================
-- Update 49 — run once in Supabase → SQL Editor, AFTER 002 (messages) and 001 (project photos)
-- (safe to run again). NOT run yet; read it before running.
--
-- "Report content" (App Store guideline 1.2): a customer or the company can report a message or a shared
-- project photo as inappropriate. The company's owner/admin sees every report, can mark it handled,
-- and can delete the message / stop sharing the photo (those already exist).
--  • Reporter: only the project's customer or the company's owner/admin, and only as themself.
--  • Visibility: the company's owner/admin see all reports; a reporter sees only their own.
--  • Only owner/admin can mark a report handled. Nobody can delete or edit a report's contents.
--  • One report per person per item (a second tap changes nothing).
-- ============================================================================

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  reported_by uuid not null references public.people(id) on delete cascade,
  content_type text not null check (content_type in ('message', 'photo')),
  content_id uuid not null,
  reason text not null check (reason in ('inappropriate', 'harassment', 'spam', 'other')),
  details text,
  status text not null default 'open' check (status in ('open', 'handled')),
  handled_by uuid references public.people(id) on delete set null,
  handled_at timestamptz,
  handled_note text,
  created_at timestamptz not null default now(),
  unique (reported_by, content_type, content_id)
);
create index if not exists idx_content_reports_company on public.content_reports (company_id, status, created_at desc);

-- company_id comes from the project, like the other project tables
drop trigger if exists content_reports_company on public.content_reports;
create trigger content_reports_company before insert or update of project_id on public.content_reports
  for each row execute function public.set_company_from_project();

alter table public.content_reports enable row level security;

drop policy if exists content_reports_select on public.content_reports;
create policy content_reports_select on public.content_reports for select using (
  public.is_staff(company_id) or reported_by = public.my_person_id()
);

drop policy if exists content_reports_insert on public.content_reports;
create policy content_reports_insert on public.content_reports for insert with check (
  reported_by = public.my_person_id()
  and status = 'open'
  and (
    public.is_staff((select company_id from public.projects where id = project_id))
    or public.is_project_customer(project_id)
  )
);

-- Only owner/admin may update, and only the handling fields (enforced by the trigger below).
drop policy if exists content_reports_update on public.content_reports;
create policy content_reports_update on public.content_reports for update
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));

create or replace function public.content_reports_guard()
returns trigger language plpgsql as $$
begin
  if new.project_id is distinct from old.project_id or new.reported_by is distinct from old.reported_by
     or new.content_type is distinct from old.content_type or new.content_id is distinct from old.content_id
     or new.reason is distinct from old.reason or new.details is distinct from old.details
     or new.created_at is distinct from old.created_at then
    raise exception 'A report''s contents can''t be changed.';
  end if;
  if new.status = 'handled' and old.status <> 'handled' then
    new.handled_by := public.my_person_id();
    new.handled_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists content_reports_guard on public.content_reports;
create trigger content_reports_guard before update on public.content_reports
  for each row execute function public.content_reports_guard();

grant select, insert, update on public.content_reports to authenticated;
revoke all on public.content_reports from anon;

-- Live updates for the owner's list
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'content_reports') then
    alter publication supabase_realtime add table public.content_reports;
  end if;
end $$;
