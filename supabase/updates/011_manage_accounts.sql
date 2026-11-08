-- ============================================================================
-- Update 11 — run once in Supabase → SQL Editor (safe to run again).
--  • "Accounts" screen for the owner (More → Accounts): everyone who has ever
--    signed up, with their role and status.
--  • Remove access: the person keeps their login but is locked out until the
--    owner restores them or approves a new join request.
--  • Delete account: erases their login and contact details for good (same as
--    them pressing "Delete Account" themselves). They'd have to sign up again
--    and be approved again. Their name stays on past records.
--  • Only an owner can do any of this, and never to themselves or another owner.
-- ============================================================================

-- The company the caller owns (null when they aren't an active owner).
create or replace function public._my_owned_company()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.company_members
  where person_id = public.my_person_id() and role = 'owner' and status = 'active'
  order by created_at limit 1
$$;

-- Everyone with a login, plus their place in the owner's company.
create or replace function public.list_accounts()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare
  cid uuid := public._my_owned_company();
begin
  if cid is null then raise exception 'not allowed'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'person_id', p.id,
      'first_name', p.first_name,
      'last_name', p.last_name,
      'email', coalesce(nullif(p.email, ''), u.email),
      'phone', p.phone,
      'avatar_url', p.avatar_url,
      'signed_up_at', u.created_at,
      'last_sign_in_at', u.last_sign_in_at,
      'role', cm.role,
      'member_status', cm.status,
      'removed_at', cm.deactivated_at,
      'request_status', jr.status,
      'requested_at', jr.created_at,
      'is_me', p.id = public.my_person_id()
    ) order by u.created_at desc)
    from public.people p
    join auth.users u on u.id = p.user_id
    left join public.company_members cm on cm.person_id = p.id and cm.company_id = cid
    left join lateral (
      select r.status, r.created_at from public.join_requests r
      where r.person_id = p.id and r.company_id = cid and r.status <> 'cancelled'
      order by r.created_at desc limit 1
    ) jr on true
  ), '[]'::jsonb);
end;
$$;

-- Shared guard for the actions below.
create or replace function public._check_account_target(p_person_id uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  cid uuid := public._my_owned_company();
begin
  if cid is null then raise exception 'Only the owner can manage accounts.'; end if;
  if p_person_id = public.my_person_id() then
    raise exception 'Use Settings → Delete Account for your own account.';
  end if;
  if exists (select 1 from public.company_members
             where person_id = p_person_id and role = 'owner' and status = 'active') then
    raise exception 'Another owner''s account can''t be changed here.';
  end if;
  return cid;
end;
$$;

-- Lock someone out. Their login stays; they need approval to get back in.
create or replace function public.remove_account_access(p_person_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public._check_account_target(p_person_id);
  me uuid := public.my_person_id();
begin
  update public.company_members
    set status = 'inactive', deactivated_at = now(), deactivated_by = me
    where person_id = p_person_id and company_id = cid and status <> 'inactive';
  update public.join_requests
    set status = 'cancelled', reviewed_by = me, reviewed_at = now()
    where person_id = p_person_id and company_id = cid and status = 'pending';
  delete from public.push_tokens where person_id = p_person_id;
  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id)
    values (cid, 'access_removed', me, p_person_id);
end;
$$;

-- Undo "Remove access": they're back with the role they had.
create or replace function public.restore_account_access(p_person_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public._check_account_target(p_person_id);
  me uuid := public.my_person_id();
begin
  update public.company_members
    set status = 'active', deactivated_at = null, deactivated_by = null,
        approved_by = me, approved_at = now()
    where person_id = p_person_id and company_id = cid and status = 'inactive';
  if not found then raise exception 'This person isn''t on the team yet. Approve their join request instead.'; end if;
  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id)
    values (cid, 'access_restored', me, p_person_id);
end;
$$;

-- Erase someone's login for good (mirrors delete_my_account).
create or replace function public.delete_account(p_person_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  cid uuid := public._check_account_target(p_person_id);
  me uuid := public.my_person_id();
  uid uuid;
begin
  select user_id into uid from public.people where id = p_person_id;
  if uid is null then raise exception 'This account was already deleted.'; end if;

  update public.company_members
    set status = 'inactive', deactivated_at = now(), deactivated_by = me
    where person_id = p_person_id;
  update public.join_requests set status = 'cancelled'
    where person_id = p_person_id and status = 'pending';
  update public.people set email = '', phone = null, avatar_url = null where id = p_person_id;
  delete from public.notification_preferences where person_id = p_person_id;
  delete from public.app_notifications where recipient_id = p_person_id;
  delete from public.push_tokens where person_id = p_person_id;
  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id)
    values (cid, 'account_deleted', me, p_person_id);

  delete from auth.users where id = uid;
end;
$$;

revoke execute on function public._my_owned_company(), public._check_account_target(uuid)
  from public, anon, authenticated;
revoke execute on function public.list_accounts(), public.remove_account_access(uuid),
  public.restore_account_access(uuid), public.delete_account(uuid) from public, anon;
grant execute on function public.list_accounts(), public.remove_account_access(uuid),
  public.restore_account_access(uuid), public.delete_account(uuid) to authenticated;

-- A removed customer can't see their projects any more…
create or replace function public.is_project_customer(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
    where p.id = pid
      and public.my_person_id() is not null
      and (p.customer_id = public.my_person_id() or p.customer_claimed_by = public.my_person_id())
      and public.is_member(p.company_id)
  )
$$;

-- …and re-entering a project code doesn't let them back in by itself.
create or replace function public._claim_project(pid uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pr record;
begin
  select p.id, p.company_id, p.customer_claimed_by, coalesce(s.customer_interaction_enabled, true) as enabled
  into pr
  from public.projects p
  left join public.project_settings s on s.project_id = p.id
  where p.customer_project_code = upper(trim(p_code));

  if pr.id is null then
    return jsonb_build_object('success', false, 'error', 'invalid_code');
  end if;
  if not pr.enabled then
    return jsonb_build_object('success', false, 'error', 'portal_disabled');
  end if;
  if pr.customer_claimed_by is not null and pr.customer_claimed_by <> pid then
    return jsonb_build_object('success', false, 'error', 'already_claimed');
  end if;
  if exists (select 1 from public.company_members
             where company_id = pr.company_id and person_id = pid and status = 'inactive'
               and deactivated_by is not null and deactivated_by <> pid) then
    return jsonb_build_object('success', false, 'error', 'access_removed');
  end if;

  update public.projects
  set customer_claimed_by = pid, customer_claimed_at = coalesce(customer_claimed_at, now()), customer_id = pid
  where id = pr.id;

  insert into public.company_members (company_id, person_id, role, status, join_method)
  values (pr.company_id, pid, 'customer', 'active', 'invitation_link')
  on conflict (company_id, person_id) do update
    set status = 'active'
    where public.company_members.status <> 'active' and public.company_members.role = 'customer';

  return jsonb_build_object('success', true, 'project_id', pr.id);
end;
$$;
