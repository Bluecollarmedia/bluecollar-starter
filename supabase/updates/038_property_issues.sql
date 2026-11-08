-- ============================================================================
-- Update 38 — run once in Supabase → SQL Editor, AFTER updates 8 and 18
-- (safe to run again). NOT run yet; read it before running.
--
-- "Report a problem": a worker at a property (maintenance stop or regular job)
-- reports an issue — tree down, damage, safety hazard… — with photos and notes.
--  • Workers can report and see their own reports. Owner/admin see all of them,
--    mark them Resolved (with a note) and can delete them. Customers see none.
--  • Each new report notifies the owner/admins in the app and by phone push
--    (the existing push trigger on app_notifications sends it).
--  • Photos are kept as a list of {url, key} on the report.
-- ============================================================================

create table if not exists public.property_issues (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  reported_by uuid references public.people(id) on delete set null,
  issue_type text not null check (issue_type in ('tree_down', 'damage', 'safety', 'equipment', 'customer_request', 'other')),
  notes text,
  photos jsonb not null default '[]'::jsonb,
  -- Where it was reported: exactly one of these.
  maintenance_property_id uuid references public.maintenance_properties(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  -- The place's name when it was reported, so the list still reads well later.
  place_name text not null default '',
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by uuid references public.people(id) on delete set null,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((maintenance_property_id is not null)::int + (project_id is not null)::int = 1)
);
create index if not exists idx_property_issues_company on public.property_issues (company_id, status, created_at desc);
create index if not exists idx_property_issues_property on public.property_issues (maintenance_property_id);
create index if not exists idx_property_issues_project on public.property_issues (project_id);

alter table public.property_issues enable row level security;

drop policy if exists property_issues_select on public.property_issues;
create policy property_issues_select on public.property_issues for select
  using (public.is_staff(company_id) or (public.is_crew(company_id) and reported_by = public.my_person_id()));

drop policy if exists property_issues_insert on public.property_issues;
create policy property_issues_insert on public.property_issues for insert
  with check (public.is_crew(company_id) and reported_by = public.my_person_id() and status = 'open');

drop policy if exists property_issues_staff_update on public.property_issues;
create policy property_issues_staff_update on public.property_issues for update
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));

drop policy if exists property_issues_staff_delete on public.property_issues;
create policy property_issues_staff_delete on public.property_issues for delete
  using (public.is_staff(company_id));

-- Keep updated_at fresh.
create or replace function public._property_issues_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists property_issues_touch on public.property_issues;
create trigger property_issues_touch before update on public.property_issues
  for each row execute function public._property_issues_touch();

-- Tell the owner/admins about each new report (in the app + push).
create or replace function public._property_issues_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  staff record;
  who text;
  label text;
begin
  select nullif(trim(concat_ws(' ', first_name, last_name)), '') into who from public.people where id = new.reported_by;
  label := case new.issue_type
    when 'tree_down' then 'Tree down'
    when 'damage' then 'Damage'
    when 'safety' then 'Safety hazard'
    when 'equipment' then 'Equipment problem'
    when 'customer_request' then 'Customer request'
    else 'Problem reported'
  end;
  for staff in
    select person_id from public.company_members
     where company_id = new.company_id and role in ('owner', 'admin') and status = 'active'
       and person_id is distinct from new.reported_by
  loop
    insert into public.app_notifications (company_id, recipient_id, event_type, title, body, linked_entity_type, linked_entity_id)
    values (new.company_id, staff.person_id, 'issue_reported',
            label || case when new.place_name <> '' then ' · ' || new.place_name else '' end,
            concat_ws(' · ', case when who is not null then 'By ' || who end, left(nullif(trim(coalesce(new.notes, '')), ''), 140)),
            'issue', new.id::text);
  end loop;
  return null;
end;
$$;
revoke all on function public._property_issues_notify() from public, anon, authenticated;
drop trigger if exists property_issues_notify on public.property_issues;
create trigger property_issues_notify after insert on public.property_issues
  for each row execute function public._property_issues_notify();

-- Live updates for the owner's Issues list.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'property_issues'
  ) then
    alter publication supabase_realtime add table public.property_issues;
  end if;
end $$;
