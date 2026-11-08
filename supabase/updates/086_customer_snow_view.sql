-- ============================================================================
-- Update 86 — run once in Supabase → SQL Editor (safe to run again). NOT run yet; read it before running.
--
-- What a customer sees about Snow, and their own notification choices. New functions only; the older ones (snow_customer_updates,
-- snow_my_properties) keep working for builds that still use them.
--  • snow_customer_timeline(): the customer's completed, SENT stops, newest first, with the storm's name and the photos the owner sent.
--  • snow_customer_status(): for each of the customer's Snow properties, what is happening right now: "scheduled" (a dispatched storm has a
--    crew assigned and no one is there yet) or "on_site" (the crew has arrived, and when). Nothing else about the work is exposed.
--  • snow_my_property_services(): the services each of their properties gets.
--  • snow_my_notify_choices() / snow_set_my_notify_choices(): the customer's own on/off for "Crew arrives" and "Service finished".
--    This is personal: it only stops messages to THEM. Your company setting still decides what is sent at all. Off means no push,
--    no in-app notice and no email for that customer.
-- All of it respects a customer whose portal access you turned off (update 84): they get nothing.
-- ============================================================================

-- ── 1. The customer's own notification choices ──────────────────────────────
create table if not exists public.snow_customer_opt_outs (
  person_id uuid primary key references public.people(id) on delete cascade,
  no_arrival boolean not null default false,
  no_finished boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.snow_customer_opt_outs enable row level security;   -- no policies: only the functions below read or write it
revoke all on public.snow_customer_opt_outs from anon, authenticated;

create or replace function public._snow_customer_opted_out(p_person uuid, p_event text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select case p_event when 'visit.arrived' then o.no_arrival when 'visit.completed' then o.no_finished else false end
                     from public.snow_customer_opt_outs o where o.person_id = p_person), false)
$$;
revoke all on function public._snow_customer_opted_out(uuid, text) from public, anon, authenticated;

create or replace function public.snow_my_notify_choices()
returns table (crew_arrives boolean, service_finished boolean)
language sql stable security definer set search_path = public as $$
  select not coalesce(o.no_arrival, false), not coalesce(o.no_finished, false)
    from (select 1) one
    left join public.snow_customer_opt_outs o on o.person_id = public.my_person_id()
$$;
revoke all on function public.snow_my_notify_choices() from public, anon;
grant execute on function public.snow_my_notify_choices() to authenticated;

create or replace function public.snow_set_my_notify_choices(p_crew_arrives boolean default null, p_service_finished boolean default null)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_person_id();
begin
  if me is null then raise exception 'Not signed in.'; end if;
  insert into public.snow_customer_opt_outs (person_id, no_arrival, no_finished)
  values (me, coalesce(not p_crew_arrives, false), coalesce(not p_service_finished, false))
  on conflict (person_id) do update
    set no_arrival = coalesce(not p_crew_arrives, public.snow_customer_opt_outs.no_arrival),
        no_finished = coalesce(not p_service_finished, public.snow_customer_opt_outs.no_finished),
        updated_at = now();
end;
$$;
revoke all on function public.snow_set_my_notify_choices(boolean, boolean) from public, anon;
grant execute on function public.snow_set_my_notify_choices(boolean, boolean) to authenticated;

-- A customer who opted out of a kind of message is not sent it (push, in-app or email). Same function as update 31, plus this check.
create or replace function public._snow_add_notification(
  v public.snow_visits, p_category text, p_event text,
  p_person uuid, p_contact uuid, p_name text, p_email text,
  p_title text, p_body text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  nid uuid;
  app_id uuid;
  key text := v.id || ':' || p_event || ':' || p_category || ':' || coalesce(p_contact::text, p_person::text);
  em text := nullif(lower(trim(p_email)), '');
begin
  if p_category = 'customer' and p_person is not null and public._snow_customer_opted_out(p_person, p_event) then
    return null;
  end if;

  insert into public.snow_notifications
    (company_id, category, event, storm_id, route_id, visit_id, property_id, service,
     recipient_person_id, recipient_contact_id, recipient_name, recipient_email, title, body, dedupe_key)
  values
    (v.company_id, p_category, p_event, v.storm_id, v.route_id, v.id, v.property_id, v.service,
     p_person, p_contact, p_name, em, p_title, p_body, key)
  on conflict (dedupe_key) do nothing
  returning id into nid;
  if nid is null then return null; end if;

  if p_person is not null then
    insert into public.app_notifications
      (company_id, recipient_id, event_type, title, body, linked_entity_type, linked_entity_id, metadata, pushed_at)
    values
      (v.company_id, p_person, 'snow_' || replace(p_event, '.', '_'), p_title, p_body,
       case when p_category = 'customer' then 'snow_property' else 'snow_visit' end,
       case when p_category = 'customer' then v.property_id::text else v.id::text end,
       jsonb_build_object('snow_notification_id', nid), now())
    returning id into app_id;
    insert into public.snow_notification_deliveries (notification_id, company_id, channel, status, provider, provider_ref, attempted_at)
    values (nid, v.company_id, 'in_app', 'stored', 'app', app_id::text, now()),
           (nid, v.company_id, 'push', 'pending', 'expo', null, null);
  end if;

  if p_category = 'customer' then
    if em is not null then
      insert into public.snow_notification_deliveries (notification_id, company_id, channel, status, provider)
      values (nid, v.company_id, 'email', 'pending', 'resend');
    elsif p_person is null then
      insert into public.snow_notification_deliveries (notification_id, company_id, channel, status, detail, attempted_at)
      values (nid, v.company_id, 'email', 'unavailable', 'No email address or app account for this contact', now());
    end if;
    perform public.snow_log_event(v.company_id, 'notification.created', 'notification', nid,
      v.storm_id, v.route_id, v.id, v.property_id, p_person, v.service, null,
      jsonb_build_object('event', p_event, 'contact_id', p_contact, 'recipient', p_name), p_title);
  end if;
  return nid;
end;
$$;
revoke all on function public._snow_add_notification(public.snow_visits, text, text, uuid, uuid, text, text, text, text) from public, anon, authenticated;

-- ── 2. The timeline ─────────────────────────────────────────────────────────
create or replace function public.snow_customer_timeline()
returns table (
  visit_id uuid, property_id uuid, property_name text, service text, storm_name text, completed_at timestamptz, media jsonb
)
language sql stable security definer set search_path = public as $$
  select v.id, v.property_id, v.property_name, v.service, st.name, v.completed_at,
         coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'file_key', m.file_key) order by m.created_at)
                     from public.snow_completion_media m
                    where m.visit_id = v.id and m.shared_at is not null and m.withdrawn_at is null), '[]'::jsonb)
    from public.snow_visits v
    join public.snow_storms st on st.id = v.storm_id
   where v.status = 'completed'
     and v.customer_notified_at is not null
     and public.snow_is_property_contact(v.property_id)
   order by v.completed_at desc
   limit 300
$$;
revoke all on function public.snow_customer_timeline() from public, anon;
grant execute on function public.snow_customer_timeline() to authenticated;

-- ── 3. What is happening right now ──────────────────────────────────────────
create or replace function public.snow_customer_status()
returns table (property_id uuid, state text, since timestamptz, storm_name text)
language sql stable security definer set search_path = public as $$
  select distinct on (v.property_id)
         v.property_id,
         case when v.status = 'arrived' then 'on_site' else 'scheduled' end,
         case when v.status = 'arrived' then v.arrived_at else st.dispatched_at end,
         st.name
    from public.snow_visits v
    join public.snow_storms st on st.id = v.storm_id and st.status = 'dispatched'
    join public.snow_routes r on r.id = v.route_id and r.cancelled_at is null
   where v.status in ('pending', 'arrived')
     and public.snow_is_property_contact(v.property_id)
   order by v.property_id, (v.status = 'arrived') desc, v.arrived_at desc nulls last, st.dispatched_at desc nulls last
$$;
revoke all on function public.snow_customer_status() from public, anon;
grant execute on function public.snow_customer_status() to authenticated;

-- ── 4. The services each property gets ──────────────────────────────────────
create or replace function public.snow_my_property_services()
returns table (property_id uuid, service text)
language sql stable security definer set search_path = public as $$
  select s.property_id, s.service
    from public.snow_property_services s
   where s.is_active and public.snow_is_property_contact(s.property_id)
   order by s.property_id, s.service
$$;
revoke all on function public.snow_my_property_services() from public, anon;
grant execute on function public.snow_my_property_services() to authenticated;

notify pgrst, 'reload schema';
