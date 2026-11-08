-- Update 92: the owner can DELETE a worker or customer who has no login and no history (for example one added by mistake, or a
-- placeholder nobody ever linked). Anyone with a login or with hours, jobs, quotes, properties or any other record is never deleted:
-- they are deactivated instead, which keeps their history (and payroll) intact. Safe to run more than once.

create or replace function public.delete_unused_member(p_person_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  m record;
  p record;
  r record;
  has boolean;
  blocked text[] := '{}';
  -- Setup rows that only describe who is on a team, route or job. They are removed together with the person; nothing else may exist.
  safe text[] := array[
    'company_members', 'invites', 'crew_members', 'push_tokens', 'resource_access', 'worker_settings', 'worker_pay_settings',
    'worker_reminders', 'worker_hourly_rates', 'time_person_settings', 'snow_staff', 'snow_access_requests', 'snow_customer_opt_outs',
    'project_team', 'maintenance_route_crew', 'snow_route_crew'
  ];
  tbl text;
  others integer;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  select * into m from public.company_members
   where person_id = p_person_id and role in ('worker', 'customer')
     and company_id in (select company_id from public.company_members where person_id = me and role in ('owner', 'admin') and status = 'active')
   limit 1;
  if m.id is null then raise exception 'not allowed'; end if;
  if not public.admin_can(m.company_id, 'team') then raise exception 'Only the owner (or an admin the owner allows) can do that.'; end if;
  select * into p from public.people where id = p_person_id;
  if p.id is null then raise exception 'Person not found.'; end if;
  if p.user_id is not null then
    raise exception 'HAS_HISTORY: This person has a login. Deactivate them instead so their history is kept.';
  end if;

  for r in
    select distinct c.conrelid::regclass::text as tbl, a.attname::text as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.confrelid = 'public.people'::regclass and c.contype = 'f'
  loop
    if regexp_replace(r.tbl, '^public\.', '') = any (safe) then continue; end if;
    execute format('select exists (select 1 from %s where %I = $1)', r.tbl, r.col) using p_person_id into has;
    if has then blocked := array_append(blocked, regexp_replace(r.tbl, '^public\.', '')); end if;
  end loop;
  if cardinality(blocked) > 0 then
    raise exception 'HAS_HISTORY: % has records (%), so they cannot be deleted. Deactivate them instead and their history stays.',
      coalesce(nullif(trim(p.first_name), ''), 'This person'), array_to_string(blocked, ', ');
  end if;

  select count(*) into others from public.company_members where person_id = p_person_id and company_id <> m.company_id;

  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
  values (m.company_id, 'member_deleted', me, null,
          jsonb_build_object('role', m.role, 'first_name', p.first_name, 'last_name', p.last_name, 'email', p.email));

  if others > 0 then
    -- Also a member of another company: only this company's membership goes; the person stays for the other one.
    delete from public.company_members where id = m.id;
    return jsonb_build_object('deleted', true, 'kept_person', true);
  end if;

  foreach tbl in array safe loop
    for r in
      select a.attname::text as col
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
       where c.confrelid = 'public.people'::regclass and c.contype = 'f' and c.conrelid::regclass::text in (tbl, 'public.' || tbl)
    loop
      execute format('delete from public.%I where %I = $1', tbl, r.col) using p_person_id;
    end loop;
  end loop;
  delete from public.people where id = p_person_id;
  return jsonb_build_object('deleted', true, 'kept_person', false);
end;
$$;
revoke all on function public.delete_unused_member(uuid) from public, anon;
grant execute on function public.delete_unused_member(uuid) to authenticated;
