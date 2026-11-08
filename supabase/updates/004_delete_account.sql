-- ============================================================================
-- Update 4 — run once in Supabase → SQL Editor (safe to run again).
--  • "Delete Account" in the app: removes the signed-in person's login and
--    personal details. Their name stays on past records (hours, history).
-- ============================================================================

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  uid uuid := auth.uid();
  pid uuid;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select id into pid from public.people where user_id = uid;

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
