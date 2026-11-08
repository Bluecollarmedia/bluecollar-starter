-- ============================================================================
-- Update 26 — run once in Supabase → SQL Editor, after 025
-- (safe to run again).
--  • Route leads work their routes from the Snow app: they see the storms,
--    routes and stops they lead (once the storm is dispatched), tap I'm Here,
--    add completion photos/videos, and finish the stop.
--  • Stops are worked in order: a lead can only start the next stop after
--    the earlier ones are completed or skipped, and only one stop at a time.
--    The owner reorders a route if the crew needs a different order.
--  • Update 020b's guard still has the last word on every status change
--    (dispatched storm only, arrival first, photo minimum, no going back).
--  • Completion media goes to the private snow-media bucket at
--    {company_id}/completion/{visit_id}/{file}. Only the lead of that stop
--    can upload; the lead and owner/admin can view.
-- ============================================================================

-- ── What a lead can see ─────────────────────────────────────────────────────

-- Same definition as update 027 (which runs later and may replace it):
-- the caller is the current lead of a live route and still holds its service.
create or replace function public.snow_is_route_lead(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.snow_routes r
    where r.id = rid
      and r.cancelled_at is null
      and r.lead_person_id = public.my_person_id()
      and public.snow_has_service(r.company_id, r.service)
  )
$$;

create or replace function public.snow_leads_in_storm(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.snow_routes r
    join public.snow_storms s on s.id = r.storm_id
    where r.storm_id = sid and s.status <> 'draft' and public.snow_is_route_lead(r.id)
  )
$$;

create or replace function public.snow_leads_dispatched_route(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.snow_is_route_lead(rid) and exists (
    select 1 from public.snow_routes r join public.snow_storms s on s.id = r.storm_id
    where r.id = rid and s.status <> 'draft'
  )
$$;

drop policy if exists snow_storms_lead_select on public.snow_storms;
create policy snow_storms_lead_select on public.snow_storms for select
  using (public.snow_leads_in_storm(id));

drop policy if exists snow_routes_lead_select on public.snow_routes;
create policy snow_routes_lead_select on public.snow_routes for select
  using (public.snow_leads_dispatched_route(id));

drop policy if exists snow_visits_lead_select on public.snow_visits;
create policy snow_visits_lead_select on public.snow_visits for select
  using (public.snow_leads_dispatched_route(route_id));

drop policy if exists snow_completion_media_lead_select on public.snow_completion_media;
create policy snow_completion_media_lead_select on public.snow_completion_media for select
  using (public.snow_leads_dispatched_route(route_id));

-- ── Helpers ─────────────────────────────────────────────────────────────────

create or replace function public._snow_visit_for_lead(p_visit_id uuid)
returns public.snow_visits language plpgsql stable security definer set search_path = public as $$
declare v public.snow_visits;
begin
  select * into v from public.snow_visits where id = p_visit_id;
  if v.id is null or not (public.snow_leads_dispatched_route(v.route_id) or public.is_staff(v.company_id)) then
    raise exception 'Stop not found.';
  end if;
  return v;
end;
$$;

-- ── I'm Here ────────────────────────────────────────────────────────────────

create or replace function public.snow_arrive_visit(p_visit_id uuid)
returns public.snow_visits language plpgsql security definer set search_path = public as $$
declare v public.snow_visits;
begin
  v := public._snow_visit_for_lead(p_visit_id);
  if v.status = 'arrived' then return v; end if;  -- double tap
  if v.status <> 'pending' then
    raise exception 'This stop is already %.', v.status;
  end if;
  if exists (select 1 from public.snow_visits where route_id = v.route_id and status = 'arrived' and id <> v.id) then
    raise exception 'Finish the stop you''re at before starting another.';
  end if;
  if exists (select 1 from public.snow_visits where route_id = v.route_id and position < v.position and status = 'pending') then
    raise exception 'Work the stops in order. Ask the owner to reorder the route if you need to.';
  end if;
  update public.snow_visits set status = 'arrived' where id = v.id returning * into v;
  return v;
end;
$$;

-- ── Completion photos/videos ────────────────────────────────────────────────

create or replace function public.snow_add_completion_media(
  p_visit_id uuid, p_kind text, p_file_key text,
  p_size_bytes bigint default null, p_duration_s numeric default null, p_captured_at timestamptz default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v public.snow_visits;
  mid uuid;
begin
  v := public._snow_visit_for_lead(p_visit_id);
  if v.status not in ('pending', 'arrived') then
    raise exception 'This stop is already %.', v.status;
  end if;
  if p_file_key is null or p_file_key not like v.company_id::text || '/completion/' || v.id::text || '/%' then
    raise exception 'That file doesn''t belong to this stop.';
  end if;
  select id into mid from public.snow_completion_media where visit_id = v.id and file_key = p_file_key;
  if mid is not null then return mid; end if;  -- retry
  insert into public.snow_completion_media (visit_id, kind, file_key, size_bytes, duration_s, uploaded_by, captured_at)
  values (v.id, p_kind, p_file_key, p_size_bytes, p_duration_s, public.my_person_id(), coalesce(p_captured_at, now()))
  returning id into mid;
  return mid;
end;
$$;

-- ── Finish Stop ─────────────────────────────────────────────────────────────

create or replace function public.snow_complete_visit(p_visit_id uuid, p_note text default null)
returns public.snow_visits language plpgsql security definer set search_path = public as $$
declare v public.snow_visits;
begin
  v := public._snow_visit_for_lead(p_visit_id);
  if v.status = 'completed' then return v; end if;  -- double tap
  update public.snow_visits
     set status = 'completed', completion_note = nullif(trim(coalesce(p_note, '')), '')
   where id = v.id
  returning * into v;
  return v;
end;
$$;

revoke all on function public.snow_arrive_visit(uuid) from public;
revoke all on function public.snow_add_completion_media(uuid, text, text, bigint, numeric, timestamptz) from public;
revoke all on function public.snow_complete_visit(uuid, text) from public;
grant execute on function public.snow_arrive_visit(uuid) to authenticated;
grant execute on function public.snow_add_completion_media(uuid, text, text, bigint, numeric, timestamptz) to authenticated;
grant execute on function public.snow_complete_visit(uuid, text) to authenticated;

-- ── Storage: completion media ───────────────────────────────────────────────

drop policy if exists snow_media_completion_upload on storage.objects;
create policy snow_media_completion_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'snow-media'
    and (storage.foldername(name))[2] = 'completion'
    and exists (
      select 1 from public.snow_visits v
      where v.id = public._try_uuid((storage.foldername(name))[3])
        and v.company_id = public._try_uuid((storage.foldername(name))[1])
        and v.status in ('pending', 'arrived')
        and public.snow_leads_dispatched_route(v.route_id)
    )
  );

drop policy if exists snow_media_completion_read on storage.objects;
create policy snow_media_completion_read on storage.objects for select to authenticated
  using (
    bucket_id = 'snow-media'
    and (storage.foldername(name))[2] = 'completion'
    and (
      public.is_staff(public._try_uuid((storage.foldername(name))[1]))
      or exists (
        select 1 from public.snow_visits v
        where v.id = public._try_uuid((storage.foldername(name))[3])
          and public.snow_leads_dispatched_route(v.route_id)
      )
    )
  );
