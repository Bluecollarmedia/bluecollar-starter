-- ============================================================================
-- Update 200 - security fixes. Run once in Supabase -> SQL Editor (safe to run again). NOT run yet.
--
-- What each part fixes (the numbers are from the Step 0 problem list):
--
--  1. R3  The old Supabase "media" photo bucket. Photos now go to Cloudflare R2 only (src/lib/media.ts no longer
--         writes to this bucket). Before: anyone could LIST every file, and any signed-in person (even a customer)
--         could upload into any folder. Now: signed-in people cannot upload, change or delete anything in it
--         (the open rules are dropped; server functions with the service key are not affected). The bucket stays
--         public so an old public link keeps opening (public links do not go through these rules), but listing is
--         limited to the company folders ({companyId}/...) of the companies you are an active member of
--         (src/lib/storage.ts counts old files that way).
--
--  2. R4  Any signed-in person could add rows to the people table (check (true)). Nothing in the app adds people
--         directly (only demo mode, which never talks to the database). Real people rows are made by database
--         functions that run with full rights (handle_new_user, get_my_context, add_customer, add_worker), so the
--         direct insert rule is simply removed.
--
--  3. R5  The sign-up function. Only an invite link may connect a new login to an owner-made record; never a
--         matching email address (email confirmation may be off, so anyone could sign up with someone else's
--         email). handle_new_user is re-created here exactly as update 078 made it (no later update changed it),
--         so the old email-matching version from schema.sql can never come back by running files out of order.
--         The old helper _accept_invitations (still called by get_my_context) also joined people to a company by
--         matching their email against the unused company_invitations table; it now does nothing and nobody can
--         call it directly.
--
--  4. R21 Who may create an in-app notice (each one is also sent as a phone push by the trigger from update 008).
--         Before: any active member, customers included, could send any notice to anyone. Now:
--           * the recipient must be an ACTIVE member of the same company;
--           * owner/admin may send any event type to any active member;
--           * a worker may send only the worker notices below, and only to the owner/admins;
--           * a customer may send only customer_message and customer_request_submitted, and only to the owner/admins;
--           * anyone else (signed out, other companies, inactive members) may send nothing.
--         Notices made by database functions (quote approve/decline, issues, reminders, time tracking, service
--         requests) and by server functions run with full rights and are not affected.
--         Every place the app itself inserts notices, checked against the new rule:
--           - src/data/actions.ts notifyStaff: recipients are the ACTIVE owner/admins (already filtered).
--             Called by: src/providers/WorkerProvider.tsx (worker_checked_in, worker_checked_in_late,
--             worker_checked_out, worker_completed_task, photo_waiting_review - a worker, or an owner/admin working
--             a job), src/hooks/useProject.ts (customer_request_submitted - a customer),
--             src/hooks/useProjectMessages.ts (customer_message - a customer writing to the owner).
--           - src/data/actions.ts notifyPeople: now sends only to people who are active members (the app filters
--             first, so an invited customer with no login yet is skipped instead of failing the save).
--             Called by: src/hooks/useAnnouncements.ts (announcement_posted to active workers - owner/admin),
--             src/hooks/useProjectMessages.ts (customer_message to the project's customer - owner/admin),
--             src/data/financials.ts (quote_sent / invoice_issued to the customer - owner/admin).
-- ============================================================================


-- ── 1. R3: the old "media" bucket ───────────────────────────────────────────
drop policy if exists media_public_read on storage.objects;
drop policy if exists media_authenticated_upload on storage.objects;
drop policy if exists media_owner_delete on storage.objects;
drop policy if exists media_company_read on storage.objects;

-- Listing: only your own company's folders. The CASE makes sure a folder name that is not an id is never cast.
create policy media_company_read on storage.objects for select to authenticated using (
  bucket_id = 'media'
  and case
        when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then public.is_member(((storage.foldername(name))[1])::uuid)
        else false
      end
);
-- No insert, update or delete rule for signed-in people: the app stores files in R2 only.


-- ── 2. R4: no direct inserts into people ────────────────────────────────────
drop policy if exists people_insert on public.people;


-- ── 3. R5: sign-up links a login ONLY through an invite link (the update 078 version, unchanged) ─────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  pid uuid;
  inv public.invites;
begin
  if coalesce(meta->>'invite_token', '') <> '' then
    begin
      -- Using the link and making the login are one step: the link is marked used first, so it cannot be used twice.
      update public.invites set status = 'used', used_at = now()
       where token_hash = public._invite_hash(meta->>'invite_token') and status = 'pending' and expires_at > now()
      returning * into inv;
      if found then
        update public.people set
          user_id = new.id,
          email = coalesce(new.email, ''),
          -- A worker can correct their own name here. A customer keeps the name the owner typed (the form only fills in a part the owner left empty).
          first_name = case when inv.kind = 'customer' then coalesce(nullif(btrim(first_name), ''), nullif(btrim(meta->>'first_name'), ''), first_name)
                            else coalesce(nullif(btrim(meta->>'first_name'), ''), first_name) end,
          last_name = case when inv.kind = 'customer' then coalesce(nullif(btrim(last_name), ''), nullif(btrim(meta->>'last_name'), ''), last_name)
                           else coalesce(nullif(btrim(meta->>'last_name'), ''), last_name) end,
          phone = coalesce(nullif(btrim(meta->>'phone'), ''), phone)
        where id = inv.person_id and user_id is null
        returning id into pid;
        if pid is not null then
          update public.company_members set status = 'active' where person_id = pid and company_id = inv.company_id and status = 'invited';
          insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
          values (inv.company_id, 'invite_used', pid, pid, jsonb_build_object('kind', inv.kind, 'invite_id', inv.id));
        end if;
      end if;
    exception when others then raise warning 'invite link failed: %', sqlerrm;
    end;
  end if;

  if pid is null then
    insert into public.people (user_id, email, first_name, last_name, phone)
    values (new.id, coalesce(new.email, ''), coalesce(meta->>'first_name', ''), coalesce(meta->>'last_name', ''), nullif(meta->>'phone', ''))
    returning id into pid;
  end if;

  -- Someone starting their own company (unchanged).
  begin
    if coalesce(meta->>'company_name', '') <> '' then
      perform public._create_company(pid, meta);
    end if;
  exception when others then raise warning 'create company failed: %', sqlerrm;
  end;

  return new;
end;
$$;

-- The old "accept every invitation sent to my email" helper. get_my_context still calls it, so it stays, but it does nothing.
create or replace function public._accept_invitations(pid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Joining a company happens only through an invite link (update 078). Never by matching an email address.
  return;
end;
$$;
revoke all on function public._accept_invitations(uuid) from public, anon, authenticated;


-- ── 4. R21: who may create an in-app notice ─────────────────────────────────
create or replace function public._notification_insert_allowed(cid uuid, recipient uuid, ev text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  my_role text := public.member_role(cid);   -- null unless I am an ACTIVE member of this company
  to_role text;
begin
  if my_role is null or recipient is null or ev is null then return false; end if;
  select role into to_role from public.company_members
   where company_id = cid and person_id = recipient and status = 'active'
   limit 1;
  if to_role is null then return false; end if;                        -- the recipient must be an active member of this company
  if my_role in ('owner', 'admin') then return true; end if;           -- owner/admin: any notice
  if to_role not in ('owner', 'admin') then return false; end if;      -- workers and customers only ever notify the owner/admins
  if my_role = 'worker' then
    return ev in ('worker_checked_in', 'worker_checked_in_late', 'worker_checked_out', 'worker_completed_task', 'photo_waiting_review');
  end if;
  if my_role = 'customer' then
    return ev in ('customer_message', 'customer_request_submitted');
  end if;
  return false;
end;
$$;
revoke all on function public._notification_insert_allowed(uuid, uuid, text) from public, anon;
grant execute on function public._notification_insert_allowed(uuid, uuid, text) to authenticated;

drop policy if exists notifications_insert on public.app_notifications;
create policy notifications_insert on public.app_notifications for insert to authenticated
  with check (public._notification_insert_allowed(company_id, recipient_id, event_type));

notify pgrst, 'reload schema';
