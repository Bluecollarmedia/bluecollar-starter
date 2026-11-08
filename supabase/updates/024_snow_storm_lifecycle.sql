-- ============================================================================
-- Update 24 — run once in Supabase → SQL Editor, after 020b and 022
-- (safe to run again).
--  • Storm lifecycle: the owner/admin creates a storm for one service, plans
--    it, dispatches it explicitly, ends it with a confirmation, and can reopen
--    it later. Several storms can be active at the same time.
--  • Allowed moves: draft → dispatched → ended → (reopen) dispatched.
--    Nothing else: a storm never goes back to draft, is never dispatched
--    twice, and only an ended storm can be reopened. The database enforces
--    this for every write, not just the app's buttons.
--  • Status and the who/when stamps can only change through the functions
--    below. The app can still rename a storm or edit its notes directly.
--  • Reopening only changes the storm row. Earlier visits stay completed or
--    skipped, media keeps its review/share state, and no customer
--    notification is created or sent again. Extra work is a new visit.
--  • The storm.created / dispatched / ended / reopened events are written to
--    the activity log by update 020b's trigger; nothing here logs them twice.
-- ============================================================================

-- ── Double-tap safe create ──────────────────────────────────────────────────

alter table public.snow_storms add column if not exists client_request_id uuid;
create unique index if not exists uq_snow_storms_client_request on public.snow_storms (client_request_id)
  where client_request_id is not null;

-- ── Transition guard (every write, whoever makes it) ────────────────────────

create or replace function public.snow_storm_lifecycle_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_person_id();
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'A new storm starts as a draft. Dispatch it when the plan is ready.';
    end if;
    new.created_by := coalesce(me, new.created_by);
    new.dispatched_at := null; new.dispatched_by := null;
    new.ended_at := null; new.ended_by := null;
    new.reopened_count := 0; new.last_reopened_at := null; new.last_reopened_by := null;
    return new;
  end if;

  if new.company_id <> old.company_id then
    raise exception 'A storm can''t move to another company.';
  end if;
  if new.service <> old.service then
    raise exception 'A storm''s service can''t be changed. Create a new storm for another service.';
  end if;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.client_request_id := old.client_request_id;

  -- The stamps are filled in here, never taken from the caller.
  new.dispatched_at := old.dispatched_at; new.dispatched_by := old.dispatched_by;
  new.ended_at := old.ended_at; new.ended_by := old.ended_by;
  new.reopened_count := old.reopened_count;
  new.last_reopened_at := old.last_reopened_at; new.last_reopened_by := old.last_reopened_by;

  if new.status = old.status then
    return new;
  elsif old.status = 'draft' and new.status = 'dispatched' then
    new.dispatched_at := now(); new.dispatched_by := me;
  elsif old.status = 'dispatched' and new.status = 'ended' then
    new.ended_at := now(); new.ended_by := me;
  elsif old.status = 'ended' and new.status = 'dispatched' then
    -- Reopen. dispatched_at keeps the first dispatch; ended_at keeps the last
    -- end. Every end and reopen is also in the activity log.
    new.reopened_count := old.reopened_count + 1;
    new.last_reopened_at := now(); new.last_reopened_by := me;
  elsif new.status = 'draft' then
    raise exception 'A dispatched storm can''t go back to draft.';
  elsif old.status = 'draft' and new.status = 'ended' then
    raise exception 'This storm was never dispatched. Delete the draft instead of ending it.';
  else
    raise exception 'A storm can''t go from % to %.', old.status, new.status;
  end if;
  return new;
end;
$$;
revoke all on function public.snow_storm_lifecycle_guard() from public, anon, authenticated;

drop trigger if exists snow_storms_lifecycle_guard on public.snow_storms;
create trigger snow_storms_lifecycle_guard before insert or update on public.snow_storms
  for each row execute function public.snow_storm_lifecycle_guard();

-- ── Who can write what ──────────────────────────────────────────────────────
--  Owner/admin keep read, create (as a draft) and delete (drafts only, update
--  020b) through the existing policy. Direct updates are limited to the name
--  and notes; status changes go through the functions below.

revoke update on public.snow_storms from anon, authenticated;
grant update (name, notes) on public.snow_storms to authenticated;

-- ── Helpers ─────────────────────────────────────────────────────────────────

create or replace function public._snow_storm_for_staff(p_storm_id uuid)
returns public.snow_storms language plpgsql security definer set search_path = public as $$
declare s public.snow_storms;
begin
  -- Lock the row so two taps (or two owners) can't race each other.
  select * into s from public.snow_storms where id = p_storm_id for update;
  if s.id is null or not public.is_staff(s.company_id) then
    raise exception 'Storm not found.';
  end if;
  return s;
end;
$$;
revoke all on function public._snow_storm_for_staff(uuid) from public, anon, authenticated;

-- What the storm looks like right now, for the confirmation sheet and the
-- result of each action. Counts never include cancelled routes' visits as
-- remaining work.
create or replace function public._snow_storm_summary(p_storm_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'routes', (select count(*) from public.snow_routes r where r.storm_id = p_storm_id and r.cancelled_at is null),
    'visits', count(v.id),
    'completed', count(v.id) filter (where v.status = 'completed'),
    'skipped', count(v.id) filter (where v.status = 'skipped'),
    'arrived', count(v.id) filter (where v.status = 'arrived'),
    'pending', count(v.id) filter (where v.status = 'pending'),
    'pending_skip_requests', (select count(*) from public.snow_skip_requests k
                              where k.storm_id = p_storm_id and k.status = 'pending')
  )
  from public.snow_visits v
  join public.snow_routes r on r.id = v.route_id and r.cancelled_at is null
  where v.storm_id = p_storm_id
$$;
revoke all on function public._snow_storm_summary(uuid) from public, anon, authenticated;

create or replace function public._snow_storm_result(s public.snow_storms, p_changed boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('storm', to_jsonb(s), 'changed', p_changed, 'summary', public._snow_storm_summary(s.id))
$$;
revoke all on function public._snow_storm_result(public.snow_storms, boolean) from public, anon, authenticated;

-- ── Create ──────────────────────────────────────────────────────────────────
-- Makes a draft storm for one service. Nothing is dispatched or sent.
-- Repeating the call with the same client_request_id returns the same storm.

create or replace function public.snow_create_storm(
  p_name text,
  p_service text,
  p_notes text default null,
  p_client_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  cid uuid;
  s public.snow_storms;
begin
  select company_id into cid from public.company_members
  where person_id = me and status = 'active' and role in ('owner', 'admin')
  order by created_at limit 1;
  if cid is null then raise exception 'Only the owner or an admin can create a storm.'; end if;
  if p_service is null or p_service not in ('plowing', 'shoveling', 'salting') then
    raise exception 'Choose plowing, shoveling or salting.';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the storm a name.'; end if;

  if p_client_request_id is not null then
    select * into s from public.snow_storms where client_request_id = p_client_request_id;
    if s.id is not null then
      if s.company_id <> cid then raise exception 'Storm not found.'; end if;
      return public._snow_storm_result(s, false);
    end if;
  end if;

  insert into public.snow_storms (company_id, name, service, notes, client_request_id)
  values (cid, trim(p_name), p_service, nullif(trim(p_notes), ''), p_client_request_id)
  on conflict (client_request_id) where client_request_id is not null do nothing
  returning * into s;
  if s.id is null then
    -- Lost a race with the same request: hand back the one that won.
    select * into s from public.snow_storms where client_request_id = p_client_request_id;
    return public._snow_storm_result(s, false);
  end if;
  return public._snow_storm_result(s, true);
end;
$$;

-- Active properties that have this storm's service turned on (update 022),
-- for picking what goes on the storm's routes. Owner/admin only.
create or replace function public.snow_storm_eligible_properties(p_storm_id uuid)
returns table (property_id uuid, name text, address text, city text, state text, zip text,
               latitude double precision, longitude double precision, map_destination text)
language plpgsql stable security definer set search_path = public as $$
declare s public.snow_storms;
begin
  select * into s from public.snow_storms where id = p_storm_id;
  if s.id is null or not public.is_staff(s.company_id) then raise exception 'Storm not found.'; end if;
  return query
    select p.id, p.name, p.address, p.city, p.state, p.zip, p.latitude::double precision,
           p.longitude::double precision, p.map_destination
    from public.snow_properties p
    join public.snow_property_services ps on ps.property_id = p.id and ps.service = s.service and ps.is_active
    where p.company_id = s.company_id and p.status = 'active'
    order by p.name;
end;
$$;

-- ── Dispatch ────────────────────────────────────────────────────────────────
-- Only from draft, and only when the plan can actually be worked: at least
-- one route with stops, and every route with stops has a lead who still has
-- access to the service. Dispatching an already-dispatched storm again
-- (a double tap) changes nothing.

create or replace function public.snow_dispatch_storm(p_storm_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.snow_storms := public._snow_storm_for_staff(p_storm_id);
  problems text;
begin
  if s.status = 'dispatched' then return public._snow_storm_result(s, false); end if;
  if s.status = 'ended' then raise exception 'This storm has ended. Reopen it instead.'; end if;

  if not exists (
    select 1 from public.snow_routes r join public.snow_visits v on v.route_id = r.id
    where r.storm_id = s.id and r.cancelled_at is null
  ) then
    raise exception 'Add at least one route with stops before dispatching.';
  end if;

  select string_agg(r.name, ', ' order by r.position, r.name) into problems
  from public.snow_routes r
  where r.storm_id = s.id and r.cancelled_at is null
    and exists (select 1 from public.snow_visits v where v.route_id = r.id)
    and (r.lead_person_id is null or not public.snow_person_has_service(s.company_id, r.lead_person_id, s.service));
  if problems is not null then
    raise exception 'These routes need a lead with % access before dispatching: %', s.service, problems;
  end if;

  update public.snow_storms set status = 'dispatched' where id = s.id returning * into s;
  return public._snow_storm_result(s, true);
end;
$$;

-- ── End ─────────────────────────────────────────────────────────────────────
-- What ending would leave behind, for the confirmation sheet. Read-only.
create or replace function public.snow_storm_end_preview(p_storm_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.snow_storms;
begin
  select * into s from public.snow_storms where id = p_storm_id;
  if s.id is null or not public.is_staff(s.company_id) then raise exception 'Storm not found.'; end if;
  return public._snow_storm_result(s, false);
end;
$$;

-- Owner/admin only, by hand: never automatic, even when every stop is done.
-- Unfinished visits stay as they are (pending, not completed) and pending
-- skip requests stay pending; reopening lets them be finished or decided.
-- Ending an already-ended storm (a double tap) changes nothing.
create or replace function public.snow_end_storm(p_storm_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.snow_storms := public._snow_storm_for_staff(p_storm_id);
begin
  if s.status = 'ended' then return public._snow_storm_result(s, false); end if;
  if s.status = 'draft' then
    raise exception 'This storm was never dispatched. Delete the draft instead of ending it.';
  end if;
  update public.snow_storms set status = 'ended' where id = s.id returning * into s;
  return public._snow_storm_result(s, true);
end;
$$;

-- ── Reopen ──────────────────────────────────────────────────────────────────
-- Ended → dispatched. Touches only the storm row: earlier visits, media,
-- sharing and notifications are left exactly as they were, so nothing is
-- re-sent or re-shared. New work is added as new visits (update 025).
-- Reopening a storm that's already open (a double tap) changes nothing.
create or replace function public.snow_reopen_storm(p_storm_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.snow_storms := public._snow_storm_for_staff(p_storm_id);
begin
  if s.status = 'dispatched' then return public._snow_storm_result(s, false); end if;
  if s.status = 'draft' then raise exception 'This storm hasn''t been dispatched yet.'; end if;
  update public.snow_storms set status = 'dispatched' where id = s.id returning * into s;
  return public._snow_storm_result(s, true);
end;
$$;

revoke execute on function public.snow_create_storm(text, text, text, uuid) from public, anon;
revoke execute on function public.snow_storm_eligible_properties(uuid) from public, anon;
revoke execute on function public.snow_dispatch_storm(uuid) from public, anon;
revoke execute on function public.snow_storm_end_preview(uuid) from public, anon;
revoke execute on function public.snow_end_storm(uuid) from public, anon;
revoke execute on function public.snow_reopen_storm(uuid) from public, anon;
grant execute on function public.snow_create_storm(text, text, text, uuid) to authenticated;
grant execute on function public.snow_storm_eligible_properties(uuid) to authenticated;
grant execute on function public.snow_dispatch_storm(uuid) to authenticated;
grant execute on function public.snow_storm_end_preview(uuid) to authenticated;
grant execute on function public.snow_end_storm(uuid) to authenticated;
grant execute on function public.snow_reopen_storm(uuid) to authenticated;
