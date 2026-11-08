-- ============================================================================
-- Update 72 — run once in Supabase → SQL Editor, (safe to run again; does not need the unrun updates). NOT run yet; read it before running.
--
-- "Add customer" without duplicates. Before, the owner's phone looked for an existing person by email in the few people it is allowed to
-- see, so a customer who already had an account (for example at another company) was not found, and a second, unconnected person was
-- created. Now the database does it, in one step, for owner/admin only:
--
--   no email ............ a new customer record (no login). They connect later by entering a property/project code (update 70 merges).
--   same email, already in this company .. the existing person is returned; nothing new is created. A team member is refused (they are
--                         not a customer), and so is someone whose access the owner removed (reactivate them on purpose instead).
--   same email, a person with a login elsewhere .. THAT person is added to this company as an invited customer. No duplicate person.
--                         Nothing is shown to them until the owner assigns a project/property to them.
--   same email, no login anywhere .. one new customer record for this company (other companies' records are never reused or changed).
--
-- Names are never used to match. Caveat: an email address is only as trustworthy as the sign-up behind it, and email confirmation is
-- off in Supabase for now, so "the account with this email" is the person who registered that address, not a verified identity.
-- ============================================================================
-- The owner/admin's company (also defined by update 68, identically; repeated so this update does not depend on it).
create or replace function public._my_owned_or_staff_company()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.company_members where person_id = public.my_person_id() and role in ('owner', 'admin') and status = 'active' order by created_at limit 1
$$;
revoke all on function public._my_owned_or_staff_company() from public, anon, authenticated;

create or replace function public.add_customer(p_first text, p_last text, p_email text default '', p_phone text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public._my_owned_or_staff_company();
  me uuid := public.my_person_id();
  first text := trim(coalesce(p_first, ''));
  last text := trim(coalesce(p_last, ''));
  mail text := lower(trim(coalesce(p_email, '')));
  phone text := nullif(trim(coalesce(p_phone, '')), '');
  m record;
  acct record;
  pid uuid;
begin
  if cid is null then raise exception 'Only the owner or an admin can add customers.'; end if;
  if first = '' then raise exception 'Enter a first name.'; end if;
  if mail <> '' and mail !~ '^\S+@\S+\.\S+$' then raise exception 'That email address does not look right.'; end if;

  if mail <> '' then
    -- Already someone in THIS company with this email?
    select p.id as person_id, cm.role, cm.status, cm.deactivated_by into m
      from public.people p join public.company_members cm on cm.person_id = p.id and cm.company_id = cid
     where lower(p.email) = mail order by cm.created_at limit 1;
    if found then
      if m.role <> 'customer' then raise exception 'That email belongs to someone on your team, not a customer.'; end if;
      if m.status = 'inactive' and m.deactivated_by is not null then
        raise exception 'This customer''s access was removed earlier. Reactivate them on purpose instead of adding them again.';
      end if;
      return jsonb_build_object('person_id', m.person_id, 'outcome', 'already_customer');
    end if;

    -- A person who has a login (anywhere): reuse that person, never create a second one.
    select id into acct from public.people where lower(email) = mail and user_id is not null order by created_at limit 1;
    if found then
      insert into public.company_members (company_id, person_id, role, status, join_method, approved_by, approved_at)
      values (cid, acct.id, 'customer', 'invited', 'email_invitation', me, now())
      on conflict (company_id, person_id) do nothing;
      return jsonb_build_object('person_id', acct.id, 'outcome', 'existing_account');
    end if;
  end if;

  insert into public.people (email, first_name, last_name, phone) values (mail, first, last, phone) returning id into pid;
  insert into public.company_members (company_id, person_id, role, status, join_method, approved_by, approved_at)
  values (cid, pid, 'customer', 'invited', 'email_invitation', me, now());
  return jsonb_build_object('person_id', pid, 'outcome', 'created');
end;
$$;
revoke all on function public.add_customer(text, text, text, text) from public, anon;
grant execute on function public.add_customer(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
