-- ============================================================================
-- Update 2 — run once in Supabase → SQL Editor (safe to run again).
--  • Messages between a customer and the owner, one conversation per project
-- ============================================================================

create table if not exists public.project_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  sender_id uuid references public.people(id) on delete set null,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index if not exists idx_project_messages_project on public.project_messages(project_id, created_at);

-- company_id comes from the project, like the other project tables
drop trigger if exists project_messages_company on public.project_messages;
create trigger project_messages_company before insert or update of project_id on public.project_messages
  for each row execute function public.set_company_from_project();

-- Only the owner/admins and that project's customer can see or send messages (not workers).
alter table public.project_messages enable row level security;
drop policy if exists project_messages_select on public.project_messages;
create policy project_messages_select on public.project_messages for select using (
  public.is_staff(company_id) or public.is_project_customer(project_id)
);
drop policy if exists project_messages_insert on public.project_messages;
create policy project_messages_insert on public.project_messages for insert with check (
  sender_id = public.my_person_id()
  and (
    public.is_staff((select company_id from public.projects where id = project_id))
    or public.is_project_customer(project_id)
  )
);
drop policy if exists project_messages_delete on public.project_messages;
create policy project_messages_delete on public.project_messages for delete using (
  public.is_staff(company_id) or sender_id = public.my_person_id()
);

-- Live updates
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_messages'
  ) then
    alter publication supabase_realtime add table public.project_messages;
  end if;
end $$;

-- Alert setting for new customer messages, on for every existing company
insert into public.notification_preferences (company_id, event_type, enabled)
select c.id, 'customer_message', true from public.companies c
where not exists (
  select 1 from public.notification_preferences p
  where p.company_id = c.id and p.person_id is null and p.event_type = 'customer_message'
);
