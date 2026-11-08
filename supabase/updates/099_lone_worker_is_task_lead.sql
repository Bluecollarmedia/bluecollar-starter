-- ============================================================================
-- Update 99 — run once in Supabase → SQL Editor, AFTER 098. NOT run yet; read it first. Safe to run again.
--
-- A job with no Task Lead picked, and exactly ONE worker on it, makes that worker the Task Lead (the owner sees them under Task Lead on the
-- project and can still change it). Before, that worker could not tick off a single task until the owner picked a lead.
--   * It happens when a worker is put on a job (and any time a lone worker's job still has no lead).
--   * A job with two or more workers still waits for the owner to pick the lead. A lead the owner picked is never replaced.
--   * Only an active worker can be made lead (an owner/admin on a job never is).
--   * Existing jobs that already fit are fixed once, below.
-- ============================================================================

create or replace function public._auto_task_lead(p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  pr public.projects;
  only_person uuid;
  n integer;
begin
  select * into pr from public.projects where id = p_project;
  if not found or pr.task_lead_id is not null then return; end if;
  select count(distinct a.person_id), min(a.person_id::text)::uuid into n, only_person
    from public.assignments a
   where a.project_id = p_project and a.status not in ('cancelled', 'reassigned');
  if n <> 1 or only_person is null then return; end if;
  if not exists (select 1 from public.company_members m where m.company_id = pr.company_id and m.person_id = only_person and m.status = 'active' and m.role = 'worker') then return; end if;
  update public.projects set task_lead_id = only_person where id = p_project and task_lead_id is null;
end;
$$;
revoke all on function public._auto_task_lead(uuid) from public, anon, authenticated;

create or replace function public._auto_task_lead_after_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._auto_task_lead(new.project_id);
  return new;
end;
$$;
revoke all on function public._auto_task_lead_after_assignment() from public, anon, authenticated;
drop trigger if exists trg_auto_task_lead on public.assignments;
create trigger trg_auto_task_lead after insert on public.assignments
  for each row execute function public._auto_task_lead_after_assignment();

-- Jobs that already fit: no lead, one worker.
do $$
declare r record;
begin
  for r in select p.id from public.projects p where p.task_lead_id is null loop
    perform public._auto_task_lead(r.id);
  end loop;
end $$;

notify pgrst, 'reload schema';
