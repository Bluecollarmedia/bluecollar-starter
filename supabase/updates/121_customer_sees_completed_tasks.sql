-- ============================================================================
-- Update 121 — run once in Supabase → SQL Editor, AFTER 120. NOT run yet; read it first. Safe to run again.
--
-- A customer can see the COMPLETED tasks of their own project (name and when it was done) so the app can list "Work completed" with the
-- photos the owner shared for each task. Tasks that are not finished stay hidden from the customer. Customers still cannot change tasks.
-- (Photos keep their own rule: only photos the owner shared are visible to the customer.)
--
-- Also here: a project's progress is now ESTIMATED from its tasks by default (project_settings.auto_progress, on unless the owner turns it off).
-- Each completed task counts 1, each in-progress task counts half, divided by all tasks (never 100 until the project itself is completed).
-- The database does it, so it works whoever checks a task off (worker or owner). With auto off, the owner sets the number by hand and tasks leave it alone.
-- ============================================================================

-- Before this, the general read rule (project_tasks_select) let a customer read EVERY task of their project through the database, even though the app
-- never showed them. It now covers the crew only; the customer's own rule below covers finished tasks.
drop policy if exists project_tasks_select on public.project_tasks;
create policy project_tasks_select on public.project_tasks for select using (public.is_crew(company_id));

drop policy if exists project_tasks_customer_completed_read on public.project_tasks;
create policy project_tasks_customer_completed_read on public.project_tasks
  for select using (status = 'completed' and public.is_project_customer(project_id));

alter table public.project_settings add column if not exists auto_progress boolean not null default true;

create or replace function public._recompute_project_progress(p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  total integer; done integer; working integer; est integer; auto boolean; st text;
begin
  select status into st from public.projects where id = p_project;
  if not found or st in ('completed', 'cancelled') then return; end if;
  select coalesce((select s.auto_progress from public.project_settings s where s.project_id = p_project), true) into auto;
  if not auto then return; end if;
  select count(*), count(*) filter (where status = 'completed'), count(*) filter (where status = 'in_progress')
    into total, done, working from public.project_tasks where project_id = p_project;
  if total = 0 then return; end if;
  est := least(99, round(100.0 * (done + 0.5 * working) / total)::integer);
  update public.projects set progress = est where id = p_project and progress is distinct from est;
end;
$$;
revoke all on function public._recompute_project_progress(uuid) from public, anon, authenticated;

create or replace function public._project_tasks_progress()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then perform public._recompute_project_progress(old.project_id);
  else perform public._recompute_project_progress(new.project_id); end if;
  return null;
end;
$$;
revoke all on function public._project_tasks_progress() from public, anon, authenticated;

drop trigger if exists zz_project_tasks_progress on public.project_tasks;
create trigger zz_project_tasks_progress after insert or delete or update of status on public.project_tasks
  for each row execute function public._project_tasks_progress();

-- Existing projects get their estimate once now.
do $$ declare r record; begin
  for r in select id from public.projects loop perform public._recompute_project_progress(r.id); end loop;
end $$;

notify pgrst, 'reload schema';
