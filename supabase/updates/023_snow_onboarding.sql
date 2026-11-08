-- ============================================================================
-- Update 23 — Snow onboarding. Run once in Supabase → SQL Editor, after update 20
-- (Snow access). Safe to run again.
--  • The owner has a separate Snow signup code (SNOW-XXXXXX), apart from the
--    regular team code. Regenerating or turning it off stops new requests
--    with the old code; requests already waiting stay for review.
--  • Entering the code only files a pending request. A pending, declined or
--    revoked person gets no snow access and can read nothing but their own
--    request (no company details, properties, routes, workers or records).
--  • The owner approves (choosing which snow services: plowing, shoveling,
--    salting), declines, or removes a request, and can later change or
--    revoke someone's snow services.
--  • People already on the landscaping team use the same account; approving
--    snow never creates a second account and never touches their
--    landscaping membership. Snow-only people get no landscaping membership.
-- ============================================================================

-- ── Snow signup codes ───────────────────────────────────────────────────────
create table if not exists public.snow_signup_codes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null unique,
  is_active boolean not null default true,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  deactivated_at timestamptz,
  deactivated_by uuid references public.people(id) on delete set null
);
-- At most one working Snow code per company.
create unique index if not exists uq_snow_signup_codes_active
  on public.snow_signup_codes (company_id) where is_active;

alter table public.snow_signup_codes enable row level security;
drop policy if exists snow_signup_codes_staff on public.snow_signup_codes;
-- Owner/admin only. Applicants check a code through lookup_snow_code().
create policy snow_signup_codes_staff on public.snow_signup_codes for select
  using (public.is_staff(company_id));

-- ── Snow access requests ────────────────────────────────────────────────────
create table if not exists public.snow_access_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  signup_code_id uuid references public.snow_signup_codes(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending','approved','declined','withdrawn','removed')),
  granted_services text[],
  reviewed_by uuid references public.people(id) on delete set null,
  reviewed_at timestamptz,
  decline_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_snow_access_requests_one_pending
  on public.snow_access_requests (company_id, person_id) where status = 'pending';
create index if not exists idx_snow_access_requests_person on public.snow_access_requests (person_id);

drop trigger if exists snow_access_requests_updated_at on public.snow_access_requests;
create trigger snow_access_requests_updated_at before update on public.snow_access_requests
  for each row execute function public.set_updated_at();

alter table public.snow_access_requests enable row level security;
drop policy if exists snow_access_requests_select on public.snow_access_requests;
-- Your own request, or every request if you're the owner/admin. All writes go
-- through the functions below.
create policy snow_access_requests_select on public.snow_access_requests for select
  using (person_id = public.my_person_id() or public.is_staff(company_id));

-- ── Snow access grants ──────────────────────────────────────────────────────
-- Who has snow access, and for which services, lives in snow_staff and
-- snow_staff_services (the "Snow roles and service permissions" update, which
-- must be run first). Approving here calls its snow_grant_access(); revoking
-- calls snow_revoke_access(). Nothing here adds a landscaping membership.
do $$ begin
  if to_regclass('public.snow_staff') is null
     or to_regprocedure('public.snow_grant_access(uuid, text[])') is null
     or to_regprocedure('public.snow_revoke_access(uuid)') is null then
    raise exception 'Run the Snow roles and service permissions update first.';
  end if;
end $$;

create or replace function public._snow_valid_services(p text[])
returns boolean language sql immutable as $$
  select p is not null and cardinality(p) > 0
     and p <@ array['plowing','shoveling','salting']::text[]
$$;

create or replace function public._snow_is_active_member(cid uuid, pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.snow_staff
                 where company_id = cid and person_id = pid and status = 'active')
$$;

create or replace function public._snow_services_of(cid uuid, pid uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(service order by service), '{}')
  from public.snow_staff_services where company_id = cid and person_id = pid
$$;


-- ── Applicant side ──────────────────────────────────────────────────────────

-- Public: check a Snow code before signing up. Says only whether it works and
-- which company it's for.
create or replace function public.lookup_snow_code(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object('valid', true, 'company_name', c.name)
    from public.snow_signup_codes s
    join public.companies c on c.id = s.company_id
    where upper(s.code) = upper(trim(p_code)) and s.is_active
  ), jsonb_build_object('valid', false))
$$;

-- Files a pending request for pid. Repeating it while one is pending returns
-- the same request (safe on a double tap or a retried network call).
create or replace function public._request_snow_access(pid uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  sc record;
  rid uuid;
begin
  select * into sc from public.snow_signup_codes
  where upper(code) = upper(trim(p_code)) and is_active;
  if sc.id is null then
    return jsonb_build_object('success', false, 'error', 'invalid_code');
  end if;
  if public._snow_is_active_member(sc.company_id, pid) then
    return jsonb_build_object('success', false, 'error', 'already_member');
  end if;

  select id into rid from public.snow_access_requests
  where company_id = sc.company_id and person_id = pid and status = 'pending';
  if rid is null then
    begin
      insert into public.snow_access_requests (company_id, person_id, signup_code_id)
      values (sc.company_id, pid, sc.id) returning id into rid;
    exception when unique_violation then
      select id into rid from public.snow_access_requests
      where company_id = sc.company_id and person_id = pid and status = 'pending';
    end;
    insert into public.membership_audit_log (company_id, event_type, actor_id, target_id)
    values (sc.company_id, 'snow_request_submitted', pid, pid);
  end if;

  return jsonb_build_object('success', true, 'request_id', rid);
end;
$$;

create or replace function public.request_snow_access(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pid uuid := public.my_person_id();
begin
  if pid is null then raise exception 'not signed in'; end if;
  return public._request_snow_access(pid, p_code);
end;
$$;

-- Where the signed-in person stands with snow. Only their own request and
-- whether they have access; nothing about the company's snow operations.
create or replace function public.get_my_snow_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pid uuid := public.my_person_id();
begin
  if pid is null then return null; end if;
  return jsonb_build_object(
    'request', (
      select jsonb_build_object('id', r.id, 'status', r.status, 'company_name', c.name,
                                'decline_reason', r.decline_reason, 'created_at', r.created_at)
      from public.snow_access_requests r join public.companies c on c.id = r.company_id
      where r.person_id = pid and r.status <> 'withdrawn'
      order by r.created_at desc limit 1
    ),
    'member', (
      select jsonb_build_object('company_id', m.company_id, 'status', m.status,
                                'services', to_jsonb(public._snow_services_of(m.company_id, pid)))
      from public.snow_staff m
      where m.person_id = pid
      order by (m.status = 'active') desc limit 1
    )
  );
end;
$$;

-- The applicant takes back their own pending request.
create or replace function public.withdraw_my_snow_request()
returns void language plpgsql security definer set search_path = public as $$
declare
  pid uuid := public.my_person_id();
  r record;
begin
  if pid is null then raise exception 'not signed in'; end if;
  for r in update public.snow_access_requests set status = 'withdrawn'
           where person_id = pid and status = 'pending' returning company_id loop
    insert into public.membership_audit_log (company_id, event_type, actor_id, target_id)
    values (r.company_id, 'snow_request_withdrawn', pid, pid);
  end loop;
end;
$$;

-- Sign-up with a Snow code (app passes snow_code in the sign-up metadata).
-- A separate trigger so the regular sign-up function is left alone; trigger
-- names sort after on_auth_user_created, so the person row already exists.
create or replace function public.handle_new_user_snow()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
begin
  if coalesce(new.raw_user_meta_data->>'snow_code', '') = '' then return new; end if;
  begin
    select id into pid from public.people where user_id = new.id;
    if pid is not null then
      perform public._request_snow_access(pid, new.raw_user_meta_data->>'snow_code');
    end if;
  exception when others then raise warning 'snow access request failed: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_snow on auth.users;
create trigger on_auth_user_created_snow
  after insert on auth.users
  for each row execute function public.handle_new_user_snow();

-- ── Owner side ──────────────────────────────────────────────────────────────

-- The company the caller runs as owner/admin (null when they don't).
create or replace function public._my_staff_company()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.company_members
  where person_id = public.my_person_id() and role in ('owner','admin') and status = 'active'
  order by created_at limit 1
$$;

-- A fresh Snow code. The old one stops working right away.
create or replace function public.regenerate_snow_signup_code()
returns text language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public._my_staff_company();
  me uuid := public.my_person_id();
  new_code text;
begin
  if cid is null then raise exception 'not allowed'; end if;
  update public.snow_signup_codes set is_active = false, deactivated_at = now(), deactivated_by = me
  where company_id = cid and is_active;
  loop
    new_code := 'SNOW-' || public._random_code(6);
    exit when not exists (select 1 from public.snow_signup_codes where code = new_code)
          and not exists (select 1 from public.team_codes where upper(code) = new_code);
  end loop;
  insert into public.snow_signup_codes (company_id, code, created_by) values (cid, new_code, me);
  insert into public.membership_audit_log (company_id, event_type, actor_id)
  values (cid, 'snow_code_generated', me);
  return new_code;
end;
$$;

-- Turns the Snow code off without making a new one.
create or replace function public.disable_snow_signup_code()
returns void language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public._my_staff_company();
  me uuid := public.my_person_id();
begin
  if cid is null then raise exception 'not allowed'; end if;
  update public.snow_signup_codes set is_active = false, deactivated_at = now(), deactivated_by = me
  where company_id = cid and is_active;
  if found then
    insert into public.membership_audit_log (company_id, event_type, actor_id)
    values (cid, 'snow_code_disabled', me);
  end if;
end;
$$;

-- Every snow request (newest first) with the person's contact details, and
-- whether they're already on the landscaping team.
create or replace function public.list_snow_access_requests()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public._my_staff_company();
begin
  if cid is null then raise exception 'not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'person_id', p.id, 'status', r.status,
      'first_name', p.first_name, 'last_name', p.last_name, 'email', p.email,
      'phone', p.phone, 'avatar_url', p.avatar_url,
      'created_at', r.created_at, 'reviewed_at', r.reviewed_at,
      'decline_reason', r.decline_reason, 'granted_services', to_jsonb(r.granted_services),
      'code_still_active', coalesce(sc.is_active, false),
      'landscaping_role', (select cm.role from public.company_members cm
                           where cm.company_id = cid and cm.person_id = p.id and cm.status = 'active')
    ) order by r.created_at desc)
    from public.snow_access_requests r
    join public.people p on p.id = r.person_id
    left join public.snow_signup_codes sc on sc.id = r.signup_code_id
    where r.company_id = cid and r.status <> 'withdrawn'
  ), '[]'::jsonb);
end;
$$;

-- Everyone who has (or had) snow access.
create or replace function public.list_snow_members()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cid uuid := public._my_staff_company();
begin
  if cid is null then raise exception 'not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'person_id', p.id, 'first_name', p.first_name, 'last_name', p.last_name,
      'email', p.email, 'phone', p.phone, 'avatar_url', p.avatar_url,
      'services', to_jsonb(public._snow_services_of(cid, p.id)), 'status', m.status,
      'approved_at', m.granted_at, 'revoked_at', m.revoked_at,
      'landscaping_role', (select cm.role from public.company_members cm
                           where cm.company_id = cid and cm.person_id = p.id and cm.status = 'active')
    ) order by m.status, p.first_name, p.last_name)
    from public.snow_staff m join public.people p on p.id = m.person_id
    where m.company_id = cid
  ), '[]'::jsonb);
end;
$$;

-- Approve with the snow services this person may work. Approving twice is a
-- no-op; approving a request that was already declined or removed is refused.
create or replace function public.approve_snow_access_request(p_request_id uuid, p_services text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
  me uuid := public.my_person_id();
begin
  select * into r from public.snow_access_requests where id = p_request_id for update;
  if r.id is null or not public.is_staff(r.company_id) then raise exception 'not allowed'; end if;
  if r.status = 'approved' then return; end if;
  if r.status <> 'pending' then raise exception 'request is no longer pending'; end if;
  if not public._snow_valid_services(p_services) then raise exception 'pick at least one snow service'; end if;

  perform public.snow_grant_access(r.person_id, p_services);
  update public.snow_access_requests
  set status = 'approved', granted_services = p_services, reviewed_by = me, reviewed_at = now()
  where id = r.id;
  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
  values (r.company_id, 'snow_request_approved', me, r.person_id, jsonb_build_object('services', to_jsonb(p_services)));
end;
$$;

create or replace function public.decline_snow_access_request(p_request_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
  me uuid := public.my_person_id();
begin
  select * into r from public.snow_access_requests where id = p_request_id for update;
  if r.id is null or not public.is_staff(r.company_id) then raise exception 'not allowed'; end if;
  if r.status = 'declined' then return; end if;
  if r.status <> 'pending' then raise exception 'request is no longer pending'; end if;

  update public.snow_access_requests
  set status = 'declined', decline_reason = nullif(trim(p_reason), ''), reviewed_by = me, reviewed_at = now()
  where id = r.id;
  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id)
  values (r.company_id, 'snow_request_declined', me, r.person_id);
end;
$$;

-- Owner clears a pending request off the list without a decision being shown
-- to the applicant as "declined" (they're returned to the start).
create or replace function public.remove_snow_access_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
  me uuid := public.my_person_id();
begin
  select * into r from public.snow_access_requests where id = p_request_id for update;
  if r.id is null or not public.is_staff(r.company_id) then raise exception 'not allowed'; end if;
  if r.status <> 'pending' then return; end if;

  update public.snow_access_requests set status = 'removed', reviewed_by = me, reviewed_at = now()
  where id = r.id;
  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id)
  values (r.company_id, 'snow_request_removed', me, r.person_id);
end;
$$;

-- Change which snow services someone has (also restores revoked access).
create or replace function public.set_snow_member_services(p_person_id uuid, p_services text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public._my_staff_company();
  me uuid := public.my_person_id();
  before text[];
begin
  if cid is null then raise exception 'not allowed'; end if;
  if not public._snow_valid_services(p_services) then raise exception 'pick at least one snow service'; end if;
  if not exists (select 1 from public.snow_staff where company_id = cid and person_id = p_person_id) then
    raise exception 'not on the snow team';
  end if;
  before := public._snow_services_of(cid, p_person_id);

  perform public.snow_grant_access(p_person_id, p_services);
  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
  values (cid, 'snow_access_changed', me, p_person_id,
          jsonb_build_object('before', to_jsonb(before), 'after', to_jsonb(p_services)));
end;
$$;

-- Takes away all snow access. Landscaping access is not touched.
create or replace function public.revoke_snow_access(p_person_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public._my_staff_company();
  me uuid := public.my_person_id();
begin
  if cid is null then raise exception 'not allowed'; end if;
  if public._snow_is_active_member(cid, p_person_id) then
    perform public.snow_revoke_access(p_person_id);
    insert into public.membership_audit_log (company_id, event_type, actor_id, target_id)
    values (cid, 'snow_access_revoked', me, p_person_id);
  end if;
end;
$$;

-- Applicants and members call these through the API; nobody writes the
-- tables directly.
revoke insert, update, delete on public.snow_signup_codes, public.snow_access_requests
  from anon, authenticated;
revoke execute on function public._request_snow_access(uuid, text), public._snow_is_active_member(uuid, uuid),
  public._snow_services_of(uuid, uuid), public.handle_new_user_snow()
  from public, anon, authenticated;
