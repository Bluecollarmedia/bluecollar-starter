-- ============================================================================
-- Update 55 — run once in Supabase → SQL Editor (safe to run again). NOT run yet; read it before running.
--
-- Messages from the owner to their customers (like an announcement to workers, but for customers).
--  • send_customer_announcement(title, message, audience): owner/admin only. Saves the message in the company's announcements
--    list (so the owner has a history) and gives every customer in the chosen group one unread notification. Each notification
--    is also pushed to that customer's phone (the same push system as every other notification) and shows as a banner on
--    their home screen until they dismiss it.
--  • Audience: 'customers_all', 'customers_landscaping' (people on a landscaping project), 'customers_maintenance'
--    (maintenance property customers), or 'customers_snow' (Snow property contacts with an account).
--  • Only people who actually have an account in the app are messaged (a customer who was only typed in, never signed up, is
--    skipped). Returns how many people it went to, so the owner sees the real number.
--  • Customers cannot read the announcements table, only their own notification.
-- ============================================================================

do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.announcements'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%audience%';
  if c is not null then execute format('alter table public.announcements drop constraint %I', c); end if;
  alter table public.announcements add constraint announcements_audience_check
    check (audience in ('all_workers','all_members','selected','customers_all','customers_landscaping','customers_maintenance','customers_snow'));
end $$;

create or replace function public.send_customer_announcement(p_title text, p_body text, p_audience text default 'customers_all')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  cid uuid;
  v_title text := nullif(left(trim(coalesce(p_title, '')), 120), '');
  v_body text := nullif(left(trim(coalesce(p_body, '')), 2000), '');
  ann uuid;
  recipients uuid[];
  n int;
begin
  if p_audience not in ('customers_all','customers_landscaping','customers_maintenance','customers_snow') then
    raise exception 'Choose who this message is for.';
  end if;
  if v_title is null then raise exception 'Add a title.'; end if;
  if v_body is null then raise exception 'Write the message.'; end if;

  select company_id into cid from public.company_members
   where person_id = me and status = 'active' and role in ('owner','admin') limit 1;
  if cid is null then raise exception 'Only the owner or an admin can message customers.'; end if;

  select coalesce(array_agg(distinct pid), '{}') into recipients from (
    select p.customer_id as pid from public.projects p
     where p.company_id = cid and p.status in ('active','on_hold') and p_audience in ('customers_all','customers_landscaping')
    union
    select p.customer_claimed_by from public.projects p
     where p.company_id = cid and p.status in ('active','on_hold') and p_audience in ('customers_all','customers_landscaping')
    union
    select m.customer_id from public.maintenance_properties m
     where m.company_id = cid and m.is_active and p_audience in ('customers_all','customers_maintenance')
    union
    select c.person_id from public.snow_property_contacts c
      join public.snow_properties sp on sp.id = c.property_id
     where sp.company_id = cid and c.removed_at is null and p_audience in ('customers_all','customers_snow')
    union
    select cm.person_id from public.company_members cm
     where cm.company_id = cid and cm.role = 'customer' and cm.status = 'active' and p_audience = 'customers_all'
  ) r
  join public.people pe on pe.id = r.pid and pe.user_id is not null
  where r.pid is not null;

  insert into public.announcements (company_id, created_by, title, body, audience, priority, recipient_ids)
  values (cid, me, v_title, v_body, p_audience, 'normal', (select coalesce(array_agg(x::text), '{}') from unnest(recipients) x))
  returning id into ann;

  insert into public.app_notifications (company_id, recipient_id, event_type, title, body, linked_entity_type, linked_entity_id, metadata)
  select cid, x, 'announcement_posted', v_title, v_body, 'announcement', ann::text,
         jsonb_build_object('to', 'customers', 'audience', p_audience)
    from unnest(recipients) x;
  get diagnostics n = row_count;

  return jsonb_build_object('announcement_id', ann, 'recipients', n);
end;
$$;
revoke all on function public.send_customer_announcement(text, text, text) from public, anon;
grant execute on function public.send_customer_announcement(text, text, text) to authenticated;
