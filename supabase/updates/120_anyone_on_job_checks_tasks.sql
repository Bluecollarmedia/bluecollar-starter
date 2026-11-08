-- ============================================================================
-- Update 120 — run once in Supabase → SQL Editor, AFTER 119. NOT run yet; read it first. Safe to run again.
--
-- Who can check off a job's tasks. Until now only the job's Task Lead could (and with no lead picked, nobody could).
-- Now, by default, ANYONE ON THE JOB can start, complete and reopen its tasks (a worker with an active assignment on that job).
-- The owner can turn the old rule back on: More → Settings → Tasks → "Only the Task Lead checks off tasks" (companies.task_lead_only).
--   * Default is OFF (anyone on the job can). The owner/admin can always change tasks.
--   * With it ON, nothing changes from before: only the Task Lead (or the owner/admin) can.
--   * Everything else stays: workers still cannot edit a task's title/notes/order/assignee; the database still stamps who completed it and when.
-- ============================================================================

alter table public.companies add column if not exists task_lead_only boolean not null default false;

create or replace function public.enforce_task_lead()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  lead uuid;
  lead_only boolean;
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
      select coalesce(task_lead_only, false) into lead_only from public.companies where id = old.company_id;
      if lead is not null and lead = me then
        null; -- the Task Lead always can
      elsif lead_only then
        if lead is null then
          raise exception 'This job has no Task Lead yet. Ask the owner to pick one.';
        end if;
        raise exception 'Only the Task Lead can change tasks on this job.';
      elsif not exists (
        select 1 from public.assignments a
         where a.project_id = old.project_id and a.person_id = me and a.status not in ('cancelled', 'reassigned')
      ) then
        raise exception 'Only people on this job can change its tasks.';
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

notify pgrst, 'reload schema';
