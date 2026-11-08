-- Update 91: when the last Maintenance stop is finished, the crew leader can clock the whole crew out with one tap.
-- Safe to run more than once. Only a route's own leader (or the owner/an admin) can do it, only after every stop is done,
-- and it never forces anyone off a property timer or a running break: those people are reported back instead.

create or replace function public.maintenance_clock_out_crew(p_route uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  r public.maintenance_routes;
  w public.time_workdays;
  m record;
  closed jsonb := '[]'::jsonb;
  waiting jsonb := '[]'::jsonb;
  label text;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  select * into r from public.maintenance_routes where id = p_route;
  if not found then raise exception 'Route not found.'; end if;
  if not (public.is_staff(r.company_id) or r.lead_person_id = me) then
    raise exception 'Only the crew leader can clock the crew out.';
  end if;
  if exists (select 1 from public.maintenance_stops s where s.route_id = r.id and s.status in ('pending', 'arrived')) then
    raise exception 'Finish every stop first, then clock the crew out.';
  end if;

  for m in
    select p.id as person_id, coalesce(nullif(trim(p.first_name), ''), 'A crew member') as first_name
      from public.people p
     where p.id in (select c.person_id from public.maintenance_route_crew c where c.route_id = r.id
                    union select r.lead_person_id where r.lead_person_id is not null)
     order by p.first_name, p.id
  loop
    -- A day left open for too long is flagged for review (never closed with an invented time), exactly as at clock-in.
    perform public._time_flag_stale(m.person_id, r.company_id);
    select * into w from public.time_workdays
     where person_id = m.person_id and company_id = r.company_id and clock_out_at is null for update;
    if not found then continue; end if;

    if exists (select 1 from public.time_intervals i where i.person_id = m.person_id and i.ended_at is null and i.status = 'active') then
      waiting := waiting || jsonb_build_object('person_id', m.person_id, 'first_name', m.first_name, 'why', 'still working at a property');
      continue;
    end if;
    if exists (select 1 from public.time_breaks b where b.workday_id = w.id and b.ended_at is null) then
      waiting := waiting || jsonb_build_object('person_id', m.person_id, 'first_name', m.first_name, 'why', 'on a break');
      continue;
    end if;

    update public.time_workdays set clock_out_at = now(), status = 'closed' where id = w.id;
    perform public._time_audit(w.company_id, 'workday', w.id, w.person_id, w.id, null, 'crew_clock_out', 'clock_out_at', null, to_jsonb(now()),
                               'Clocked out by the crew leader after the last stop of the route.', false);
    closed := closed || jsonb_build_object('person_id', m.person_id, 'first_name', m.first_name);
  end loop;

  return jsonb_build_object('closed', closed, 'still_working', waiting);
end;
$$;
revoke all on function public.maintenance_clock_out_crew(uuid) from public, anon;
grant execute on function public.maintenance_clock_out_crew(uuid) to authenticated;
