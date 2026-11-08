-- ============================================================================
-- Update 111 — run once in Supabase → SQL Editor, AFTER 110. Safe to run again.
--
-- Maintenance photos: ONE PHOTO PER TASK when photos are turned on, and the owner chooses how many photos a service needs.
--   * Until now a stop that needed photos only counted them in total, so a worker could take one picture and then tick every task. Now a photo
--     can belong to a task (maintenance_photos.task_id), and when the stop requires photos a task can only be ticked once it has its own photo.
--     Owner/admin corrections are not blocked. Photos taken before this update (no task) are untouched, and unticking a task never deletes a photo.
--   * A service rule can say how many photos its stops need (maintenance_service_rules.min_photos, 1 to 20). Stops are still made with the
--     number the owner chose for that stop; the rule's number is what new stops start from.
--   * ADDITIVE: two new columns, one new guard, and one function replaced (same name and arguments, so every grant stays).
-- ============================================================================

alter table public.maintenance_photos
  add column if not exists task_id uuid references public.maintenance_stop_tasks(id) on delete set null;
create index if not exists idx_maint_photos_task on public.maintenance_photos (task_id) where task_id is not null;

alter table public.maintenance_service_rules
  add column if not exists min_photos integer not null default 1;
do $$ begin
  alter table public.maintenance_service_rules add constraint maintenance_service_rules_min_photos_check check (min_photos between 1 and 20);
exception when duplicate_object then null; end $$;

-- A photo can only be tied to a task of the SAME stop.
create or replace function public._maint_photo_task_guard()
returns trigger language plpgsql as $$
begin
  if new.task_id is not null and not exists (select 1 from public.maintenance_stop_tasks t where t.id = new.task_id and t.stop_id = new.stop_id) then
    raise exception 'That task belongs to a different stop.';
  end if;
  return new;
end;
$$;
drop trigger if exists maintenance_photos_task_guard on public.maintenance_photos;
create trigger maintenance_photos_task_guard before insert or update of task_id, stop_id on public.maintenance_photos
  for each row execute function public._maint_photo_task_guard();

-- Ticking a task: when the stop requires photos, the task needs its own photo first (crew only; owner/admin are never blocked).
create or replace function public.maintenance_set_task_done(p_task_id uuid, p_done boolean)
returns public.maintenance_stop_tasks
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  t public.maintenance_stop_tasks;
  s public.maintenance_stops;
begin
  select * into t from public.maintenance_stop_tasks where id = p_task_id;
  if not found then raise exception 'Checklist item not found.'; end if;
  s := public._maint_stop_for_crew(t.stop_id);
  if s.status in ('completed', 'skipped') then raise exception 'This stop is already finished.'; end if;
  if (t.completed_at is not null) = p_done then return t; end if;
  if p_done and s.requires_photos and not public.is_staff(s.company_id)
     and not exists (select 1 from public.maintenance_photos ph where ph.task_id = t.id) then
    raise exception 'Take a photo for "%" first. Each task needs its own photo.', t.title;
  end if;
  update public.maintenance_stop_tasks
     set completed_at = case when p_done then now() end,
         completed_by = case when p_done then me end
   where id = t.id
  returning * into t;
  insert into public.maintenance_events (company_id, route_id, stop_id, person_id, event_type, metadata)
  values (s.company_id, s.route_id, s.id, me, case when p_done then 'task_checked' else 'task_unchecked' end,
          jsonb_build_object('task_id', t.id, 'title', t.title));
  return t;
end;
$$;
revoke all on function public.maintenance_set_task_done(uuid, boolean) from public, anon;
grant execute on function public.maintenance_set_task_done(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
