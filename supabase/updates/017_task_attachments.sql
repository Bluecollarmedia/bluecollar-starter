-- ============================================================================
-- Update 17 — run once in Supabase → SQL Editor (safe to run again).
--  • Task photos and videos: when the owner creates or edits a task they can
--    attach photos or short videos that show what to do. Workers see them on
--    the task.
--  • The files go in the same "media" bucket and project folder as project
--    photos, so they count toward the company's storage limit.
--  • Same access rules as tasks: the crew can see, only the owner/admin can
--    add or remove.
-- ============================================================================

create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  media_type text not null default 'image' check (media_type in ('image', 'video')),
  file_url text not null,
  file_key text not null default '',
  size_bytes bigint,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_task_attachments_task on public.task_attachments (task_id);
create index if not exists idx_task_attachments_project on public.task_attachments (project_id);

alter table public.task_attachments enable row level security;
drop policy if exists task_attachments_select on public.task_attachments;
create policy task_attachments_select on public.task_attachments for select using (public.is_crew(company_id));
drop policy if exists task_attachments_staff on public.task_attachments;
create policy task_attachments_staff on public.task_attachments for all
  using (public.is_staff(company_id)) with check (public.is_staff(company_id));

-- Live updates
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_attachments'
  ) then
    alter publication supabase_realtime add table public.task_attachments;
  end if;
end $$;
