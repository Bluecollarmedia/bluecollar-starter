-- ============================================================================
-- Update 36 — run once in Supabase → SQL Editor, AFTER updates 1 and 3
-- (safe to run again). NOT run yet; read it before running.
--
-- One company for the whole app, exactly:
--  • "Create a Company" is offered when NO company exists, is hidden while one
--    exists, and comes back only after the company has really been deleted.
--  • Deleting a company is a deliberate, owner-only action that is all or
--    nothing: if anything fails, nothing is deleted and the slot stays closed.
--  • The owner can't erase their own login while they still own the company
--    (that used to leave a company nobody could manage while the slot reopened
--    and a second company could be created).
--
-- Before (update 3): the slot was "open" when no active owner still had a
-- login. That is not the same as "no company exists", so the button could be
-- hidden after a company was gone, or shown while one still existed.
--
-- Deleting a company removes its data (it cascades) but NOT anyone's account,
-- and it gives nobody ownership of anything.
-- ============================================================================

-- 1) The slot: open only when there is no company at all.
create or replace function public.company_slot_open()
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.companies);
$$;
grant execute on function public.company_slot_open() to anon, authenticated;

-- (The enforce_one_company() trigger from update 3 already calls
-- company_slot_open() under a lock, so two sign-ups at the same moment still
-- can't both create a company. It needs no change.)

-- 2) Creating a company from a signed-in account: say so clearly up front.
create or replace function public.create_company(data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare pid uuid := public.my_person_id();
begin
  if pid is null then raise exception 'not signed in'; end if;
  if not public.company_slot_open() then
    raise exception 'A company already exists. Ask the owner for a team code to join it.';
  end if;
  return public._create_company(pid, data);
end;
$$;

-- 3) Deleting the company: owner only, name typed to confirm, all or nothing.
create or replace function public.delete_my_company(p_confirm_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  pid uuid := public.my_person_id();
  cid uuid;
  cname text;
  t text;
begin
  if pid is null then raise exception 'not signed in'; end if;

  select m.company_id into cid
    from public.company_members m
   where m.person_id = pid and m.role = 'owner' and m.status = 'active'
   limit 1;
  if cid is null then raise exception 'Only the company owner can delete the company.'; end if;

  select name into cname from public.companies where id = cid;
  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(coalesce(cname, ''))) then
    raise exception 'Type the company name exactly to confirm.';
  end if;

  -- Same lock the creation check takes, so a delete and a create can't interleave.
  perform pg_advisory_xact_lock(hashtext('public.one_company'));

  -- Deleting a company deletes its rows in many tables, and some tables' own
  -- triggers (Snow Mode's activity log, for one) try to write a log row that
  -- points at the company while it is being removed, which the database
  -- refuses. So the "user" triggers on the company's tables are switched off
  -- for this one transaction (the built-in cascade deletes stay on) and are
  -- switched back on before it ends. If anything fails, the whole transaction
  -- rolls back, including this switch.
  for t in
    select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r'
       and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
  loop
    execute format('alter table public.%I disable trigger user', t);
  end loop;

  -- The company delete lock allows this for this one transaction only.
  perform set_config('app.allow_company_delete', 'on', true);
  delete from public.companies where id = cid;
  perform set_config('app.allow_company_delete', 'off', true);

  for t in
    select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r'
       and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
  loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;

  -- Anything left over means the delete didn't really happen: undo everything.
  if exists (select 1 from public.companies where id = cid) then
    raise exception 'The company could not be deleted.';
  end if;
end;
$$;

revoke execute on function public.delete_my_company(text) from public, anon;
grant execute on function public.delete_my_company(text) to authenticated;

-- 4) An owner can't erase their own login while they still own the company.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  uid uuid := auth.uid();
  pid uuid;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select id into pid from public.people where user_id = uid;

  if pid is not null and exists (
    select 1 from public.company_members
     where person_id = pid and role = 'owner' and status = 'active'
  ) then
    raise exception 'You own the company. Delete the company first (More → Settings → Delete Company), then delete your account.';
  end if;

  if pid is not null then
    -- Leave every team and drop personal contact details.
    update public.company_members
      set status = 'inactive', deactivated_at = now(), deactivated_by = pid
      where person_id = pid;
    update public.people
      set email = '', phone = null, avatar_url = null
      where id = pid;
    delete from public.notification_preferences where person_id = pid;
    delete from public.app_notifications where recipient_id = pid;
  end if;

  -- Removing the login also unlinks the person record (user_id → null).
  delete from auth.users where id = uid;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
