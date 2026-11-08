-- Update 94: the owner's "Remind" button on a worker who has not confirmed their job sends that worker a push notification, and
-- stays where it is. It creates one in-app notification for the worker (the existing push trigger, update 8, sends it to their phones),
-- at most once an hour per job so a worker is never spammed. Safe to run more than once.

create or replace function public.remind_worker_assignment(p_assignment uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  a record;
  proj text;
  last_at timestamptz;
  devices integer;
  has_login boolean;
  when_text text;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  select * into a from public.assignments where id = p_assignment;
  if a.id is null then raise exception 'Job not found.'; end if;
  if not exists (
    select 1 from public.company_members m
     where m.company_id = a.company_id and m.person_id = me and m.role in ('owner', 'admin') and m.status = 'active'
  ) then raise exception 'not allowed'; end if;
  if a.status in ('completed', 'cancelled', 'reassigned') then
    return jsonb_build_object('sent', false, 'reason', 'done');
  end if;
  if a.confirmation_state = 'confirmed' then
    return jsonb_build_object('sent', false, 'reason', 'confirmed');
  end if;

  select exists (select 1 from public.people where id = a.person_id and user_id is not null) into has_login;
  if not has_login then
    return jsonb_build_object('sent', false, 'reason', 'no_login');
  end if;

  select max(created_at) into last_at from public.app_notifications
   where recipient_id = a.person_id and event_type = 'schedule_reminder' and linked_entity_id = a.id::text;
  if last_at is not null and last_at > now() - interval '1 hour' then
    return jsonb_build_object('sent', false, 'reason', 'recent', 'minutes_left', greatest(1, ceil(extract(epoch from (last_at + interval '1 hour' - now())) / 60)::int));
  end if;

  select coalesce(p.name, 'your job') into proj from public.projects p where p.id = a.project_id;
  when_text := case when a.scheduled_date = current_date then 'today' when a.scheduled_date = current_date + 1 then 'tomorrow' else to_char(a.scheduled_date, 'Mon DD') end;
  insert into public.app_notifications (company_id, recipient_id, event_type, title, body, linked_entity_type, linked_entity_id)
  values (a.company_id, a.person_id, 'schedule_reminder', 'Please confirm your schedule',
          proj || ' ' || when_text || case when a.is_full_day then ', full day' else ', starts ' || to_char(a.start_time::time, 'HH12:MI AM') end || '. Open the app to confirm.',
          'assignment', a.id::text);

  select count(*) into devices from public.push_tokens where person_id = a.person_id;
  return jsonb_build_object('sent', true, 'devices', devices);
end;
$$;
revoke all on function public.remind_worker_assignment(uuid) from public, anon;
grant execute on function public.remind_worker_assignment(uuid) to authenticated;
