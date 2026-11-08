-- ============================================================================
-- Update 84 — run once in Supabase → SQL Editor (safe to run again). NOT run yet; read it before running.
--
-- The owner decides, customer by customer, whether that customer can use the app (their "portal").
--  • set_customer_portal_access(person, enabled): owner (or an admin the owner allows to send invites).
--      OFF: the customer's access ends. A link they have not used yet stops working. Their projects, properties, photos and history are
--           kept exactly as they are; they just cannot sign in to see them.
--      ON:  a customer who already has a login is active again. A customer who never signed up goes back to "invite pending" and a
--           new link can be made for them.
--    Only customers of your company; never yourself or any other role. Every change is written to the audit log.
--  • "Message customers" (update 83) skips customers whose access is off.
-- ============================================================================

create or replace function public.set_customer_portal_access(p_person_id uuid, p_enabled boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public._invite_staff_company();
  me uuid := public.my_person_id();
  m record;
  has_login boolean;
  new_status text;
begin
  if cid is null then raise exception 'Only the owner (or an admin the owner allows) can change customer access.'; end if;
  if p_person_id = me then raise exception 'You can''t change your own access.'; end if;

  select cm.id, cm.status into m
    from public.company_members cm
   where cm.company_id = cid and cm.person_id = p_person_id and cm.role = 'customer';
  if m.id is null then raise exception 'That person is not one of your customers.'; end if;

  select (user_id is not null) into has_login from public.people where id = p_person_id;

  if coalesce(p_enabled, false) then
    if m.status <> 'inactive' then return m.status; end if;
    new_status := case when coalesce(has_login, false) then 'active' else 'invited' end;
    update public.company_members set status = new_status, deactivated_at = null, deactivated_by = null where id = m.id;
  else
    if m.status = 'inactive' then return 'inactive'; end if;
    update public.company_members set status = 'inactive', deactivated_at = now(), deactivated_by = me where id = m.id;
    update public.invites set status = 'revoked', revoked_at = now()
     where company_id = cid and person_id = p_person_id and status = 'pending';
    new_status := 'inactive';
  end if;

  insert into public.membership_audit_log (company_id, event_type, actor_id, target_id, metadata)
  values (cid, case when coalesce(p_enabled, false) then 'customer_access_on' else 'customer_access_off' end, me, p_person_id,
          jsonb_build_object('status', new_status));
  return new_status;
end;
$$;
revoke all on function public.set_customer_portal_access(uuid, boolean) from public, anon;
grant execute on function public.set_customer_portal_access(uuid, boolean) to authenticated;
