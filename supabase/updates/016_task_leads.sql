-- ============================================================================
-- Update 16 — run once in Supabase → SQL Editor (safe to run again).
--  • Task Lead: the owner/admin picks one worker per job as its Task Lead.
--    They stay the lead every day until the owner changes it.
--  • Only the Task Lead (or the owner/admin) can start, complete or reopen a
--    job's tasks. Everyone else on the crew can see the tasks and their
--    progress but can't change them. With no Task Lead picked, no worker can
--    change tasks until the owner picks one.
--  • Every completed task records who completed it and when. The database
--    stamps both, so they can't be faked from the app.
-- ============================================================================

-- The job's Task Lead. Only the owner/admin can change projects (projects_write).
alter table public.projects
  add column if not exists task_lead_id uuid references public.people(id) on delete set null;

-- Who completed each task (completed_at already exists).
alter table public.project_tasks
  add column if not exists completed_by uuid references public.people(id) on delete set null;

-- The Task Lead must be an active worker of the job's company.
create or replace function public.check_task_lead()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.task_lead_id is not null and new.task_lead_id is distinct from old.task_lead_id
     and not exists (
       select 1 from public.company_members
       where company_id = new.company_id and person_id = new.task_lead_id
         and status = 'active' and role = 'worker'
     ) then
    raise exception 'The Task Lead must be an active worker on your team.';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_task_lead_check on public.projects;
create trigger projects_task_lead_check before update of task_lead_id on public.projects
  for each row execute function public.check_task_lead();

-- Workers may change a task only if they are the job's Task Lead, and then
-- only its status. The owner/admin can change anything. Completion is stamped
-- here with the real person and time.
create or replace function public.enforce_task_lead()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  lead uuid;
begin
  -- Signed-in workers only; the owner/admin and the SQL editor are not limited.
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.is_staff(old.company_id) then
    if (new.title, new.description, new.sort_order, new.assigned_to, new.project_id, new.company_id)
       is distinct from
       (old.title, old.description, old.sort_order, old.assigned_to, old.project_id, old.company_id) then
      raise exception 'Only the owner can edit tasks.';
    end if;
    if new.status is distinct from old.status then
      select task_lead_id into lead from public.projects where id = old.project_id;
      if lead is null then
        raise exception 'This job has no Task Lead yet. Ask the owner to pick one.';
      elsif lead is distinct from me then
        raise exception 'Only the Task Lead can change tasks on this job.';
      end if;
    end if;
  end if;

  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status is distinct from 'completed' then
      new.completed_at := now();
      new.completed_by := coalesce(me, new.completed_by);
    else
      new.completed_at := old.completed_at;
      new.completed_by := old.completed_by;
    end if;
  else
    new.completed_at := null;
    new.completed_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists project_tasks_task_lead on public.project_tasks;
create trigger project_tasks_task_lead before insert or update on public.project_tasks
  for each row execute function public.enforce_task_lead();
