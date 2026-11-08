-- ============================================================================
-- Update 27 — run once in Supabase → SQL Editor, AFTER updates 20 and 20b.
-- Safe to run again.
--  Skipped-stop requests (Snow Mode).
--
--  • A route lead can't skip a stop on their own. They send a skip request
--    with a reason for the stop they're on (the next unfinished stop in the
--    owner's order). The visit stays pending while the owner reviews it, so
--    the route doesn't move on.
--  • The owner/admin approves it (the visit becomes 'skipped': never counted
--    as completed) or denies it (the visit stays open; the owner's note says
--    what to do instead). A decision is made once.
--  • The lead can withdraw their own request while it's pending. If the stop
--    gets completed while a request is open, the request is withdrawn
--    automatically.
--  • Every request, reason, decision, who made it and when stays in
--    snow_skip_requests and in the activity log (logged by update 20b).
--  • A double tap or a retry on a bad connection never creates two requests
--    or two decisions.
--  • Leads see the requests on their own routes (to show "Skip requested" and
--    the owner's answer). Nobody else but the owner/admin sees them;
--    customers never do.
-- ============================================================================

-- ── Who leads this visit's route ────────────────────────────────────────────

-- The caller is the current lead of the visit's route and still holds that
-- snow service. Owner/admin don't count here (they have their own policies).
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

-- ── Lead: request a skip ────────────────────────────────────────────────────

create or replace function public.request_snow_skip(
  p_visit_id uuid,
  p_reason text,
  p_client_request_id uuid default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v record;
  existing uuid;
  staff boolean;
  reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  -- A retry of a request that already went through returns the same request.
  if p_client_request_id is not null then
    select id into existing from public.snow_skip_requests where client_request_id = p_client_request_id;
    if existing is not null then return existing; end if;
  end if;

  select vi.id, vi.company_id, vi.route_id, vi.position, vi.status into v
    from public.snow_visits vi where vi.id = p_visit_id;
  if v.id is null then raise exception 'Stop not found.'; end if;

  staff := public.is_staff(v.company_id);
  if not staff and not public.snow_is_route_lead(v.route_id) then
    raise exception 'Only the lead on this route can ask to skip a stop.';
  end if;
  if reason is null then raise exception 'Say why this stop can''t be done.'; end if;

  if v.status not in ('pending', 'arrived') then
    raise exception 'This stop is already %.', v.status;
  end if;

  -- One open request per stop: a second tap returns the open one.
  select id into existing from public.snow_skip_requests where visit_id = v.id and status = 'pending';
  if existing is not null then return existing; end if;

  -- Leads work in the owner's order: only the next unfinished stop.
  if not staff and exists (
    select 1 from public.snow_visits o
    where o.route_id = v.route_id and o.position < v.position
      and o.status not in ('completed', 'skipped')
  ) then
    raise exception 'Finish the earlier stops on this route first.';
  end if;

  insert into public.snow_skip_requests (visit_id, reason, client_request_id)
  values (v.id, reason, p_client_request_id)
  returning id into existing;
  return existing;
end;
$$;

-- ── Owner/admin: approve or deny ────────────────────────────────────────────

create or replace function public.decide_snow_skip(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
)
returns text language plpgsql security definer set search_path = public as $$
declare
  r record;
  want text := case when p_approve then 'approved' else 'denied' end;
begin
  select id, company_id, status into r from public.snow_skip_requests where id = p_request_id for update;
  if r.id is null or not public.is_staff(r.company_id) then
    raise exception 'Skip request not found.';
  end if;
  if p_approve is null then raise exception 'Choose approve or deny.'; end if;

  if r.status <> 'pending' then
    -- Same answer twice (double tap / retry): nothing more to do.
    if r.status = want then return r.status; end if;
    raise exception 'This skip request was already %.', r.status;
  end if;

  update public.snow_skip_requests
     set status = want, decision_note = nullif(trim(coalesce(p_note, '')), '')
   where id = r.id;
  return want;
end;
$$;

-- ── Lead or owner: withdraw a pending request ───────────────────────────────

create or replace function public.withdraw_snow_skip(p_request_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select id, company_id, route_id, requested_by, status into r
    from public.snow_skip_requests where id = p_request_id for update;
  if r.id is null or not (
    public.is_staff(r.company_id)
    or (r.requested_by = public.my_person_id() and public.snow_is_route_lead(r.route_id))
  ) then
    raise exception 'Skip request not found.';
  end if;
  if r.status = 'withdrawn' then return r.status; end if;
  if r.status <> 'pending' then
    raise exception 'This skip request was already %.', r.status;
  end if;
  update public.snow_skip_requests set status = 'withdrawn' where id = r.id;
  return 'withdrawn';
end;
$$;

-- ── Stop completed while a request is open → withdraw it ────────────────────

create or replace function public.snow_skip_withdraw_on_complete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status <> 'completed' then
    update public.snow_skip_requests
       set status = 'withdrawn', decision_note = 'The stop was completed.'
     where visit_id = new.id and status = 'pending';
  end if;
  return null;
end;
$$;
drop trigger if exists snow_visits_skip_withdraw on public.snow_visits;
create trigger snow_visits_skip_withdraw after update of status on public.snow_visits
  for each row execute function public.snow_skip_withdraw_on_complete();

-- ── Access ──────────────────────────────────────────────────────────────────
--  Owner/admin already have full access (update 20b). Leads read the requests
--  on routes they currently lead. Nobody writes the table directly except
--  owner/admin; leads go through the functions above.

drop policy if exists snow_skip_requests_lead_select on public.snow_skip_requests;
create policy snow_skip_requests_lead_select on public.snow_skip_requests
  for select using (public.snow_is_route_lead(route_id));

revoke all on function public.snow_skip_withdraw_on_complete() from public, anon, authenticated;
revoke all on function public.request_snow_skip(uuid, text, uuid) from public, anon;
revoke all on function public.decide_snow_skip(uuid, boolean, text) from public, anon;
revoke all on function public.withdraw_snow_skip(uuid) from public, anon;
grant execute on function public.request_snow_skip(uuid, text, uuid) to authenticated;
grant execute on function public.decide_snow_skip(uuid, boolean, text) to authenticated;
grant execute on function public.withdraw_snow_skip(uuid) to authenticated;
grant execute on function public.snow_is_route_lead(uuid) to authenticated;
