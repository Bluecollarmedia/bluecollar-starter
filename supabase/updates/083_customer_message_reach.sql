-- ============================================================================
-- Update 83 — run once in Supabase → SQL Editor (safe to run again). NOT run yet; read it before running.
--
-- Message Customers shows a small count on each group button ("Snow · 12"). The count has to be exactly who the message reaches, so
-- the "who is in this group" query now lives in ONE helper, used by both the send and the count.
--  • _customer_audience(company, audience): the people with an account in that group (same rules as update 55, and not customers whose access was turned off).
--  • customer_message_reach(): owner/admin only; returns how many people each group reaches right now. Changes nothing.
--  • send_customer_announcement(...) is unchanged for the owner; it just calls the helper.
-- ============================================================================

create or replace function public._customer_audience(p_company uuid, p_audience text)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct r.pid), '{}') from (
    select p.customer_id as pid from public.projects p
     where p.company_id = p_company and p.status in ('active','on_hold') and p_audience in ('customers_all','customers_landscaping')
    union
    select p.customer_claimed_by from public.projects p
     where p.company_id = p_company and p.status in ('active','on_hold') and p_audience in ('customers_all','customers_landscaping')
    union
    select m.customer_id from public.maintenance_properties m
     where m.company_id = p_company and m.is_active and p_audience in ('customers_all','customers_maintenance')
    union
    select c.person_id from public.snow_property_contacts c
      join public.snow_properties sp on sp.id = c.property_id
     where sp.company_id = p_company and c.removed_at is null and p_audience in ('customers_all','customers_snow')
    union
    select cm.person_id from public.company_members cm
     where cm.company_id = p_company and cm.role = 'customer' and cm.status = 'active' and p_audience = 'customers_all'
  ) r
  join public.people pe on pe.id = r.pid and pe.user_id is not null
  where r.pid is not null
    -- A customer whose access the owner turned off (update 84) is not messaged.
    and not exists (select 1 from public.company_members x where x.company_id = p_company and x.person_id = r.pid and x.role = 'customer' and x.status = 'inactive');
$$;
revoke all on function public._customer_audience(uuid, text) from public, anon, authenticated;

create or replace function public.customer_message_reach()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  cid uuid;
begin
  select company_id into cid from public.company_members
   where person_id = me and status = 'active' and role in ('owner','admin') limit 1;
  if cid is null then raise exception 'Only the owner or an admin can message customers.'; end if;
  return jsonb_build_object(
    'customers_all', cardinality(public._customer_audience(cid, 'customers_all')),
    'customers_landscaping', cardinality(public._customer_audience(cid, 'customers_landscaping')),
    'customers_maintenance', cardinality(public._customer_audience(cid, 'customers_maintenance')),
    'customers_snow', cardinality(public._customer_audience(cid, 'customers_snow'))
  );
end;
$$;
revoke all on function public.customer_message_reach() from public, anon;
grant execute on function public.customer_message_reach() to authenticated;

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

  recipients := public._customer_audience(cid, p_audience);

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
