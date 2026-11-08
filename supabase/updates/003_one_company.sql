-- ============================================================================
-- Update 3 — run once in Supabase → SQL Editor (safe to run again).
--  • Only one company at a time: once a company has an owner with a working
--    account, nobody can create another one. If every owner's account is
--    deleted, "Create a Company" becomes available again.
-- ============================================================================

-- True when no company has an active owner who still has a login.
create or replace function public.company_slot_open()
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1
    from public.company_members m
    join public.people p on p.id = m.person_id
    join auth.users u on u.id = p.user_id
    where m.role = 'owner' and m.status = 'active'
  );
$$;
grant execute on function public.company_slot_open() to anon, authenticated;

-- Every way of creating a company goes through this check.
-- (A deliberate admin script can bypass it with: set local app.allow_company_create = 'on';)
create or replace function public.enforce_one_company()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.allow_company_create', true), '') = 'on' then
    return new;
  end if;
  -- Two sign-ups at the same moment can't both slip through.
  perform pg_advisory_xact_lock(hashtext('public.one_company'));
  if not public.company_slot_open() then
    raise exception 'A company already exists. Ask the owner for a team code to join it.';
  end if;
  return new;
end;
$$;

drop trigger if exists companies_one_only on public.companies;
create trigger companies_one_only
  before insert on public.companies
  for each row execute function public.enforce_one_company();
