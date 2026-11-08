-- ════════════════════════════════════════════════════════════════════════════
-- Update 031 — Snow Mode notifications
--
-- Run after 020 (snow access), 020b (snow foundation), 022 (snow property
-- details) and 008 (push tokens + app_settings.functions_url).
--
--  • Customer preferences, one row per snow property: tell the customer when
--    the crew arrives, and when the work is done. They cover every snow
--    service at that property and never reset when a new storm starts.
--    Default: arrival off, completion on.
--  • Owner toggle snow_settings.owner_stop_alerts: an alert to the owner and
--    admins for every completed stop. Off means no per-stop alert is created;
--    the visit, its media and the activity log are unaffected, and so are
--    customer notifications.
--  • Records that keep "stored" apart from "sent":
--      snow_notifications            what we decided to tell whom, and why
--      snow_notification_deliveries  one row per channel (in_app, push, email)
--        status pending      handed to the sender, no answer yet
--               stored       in-app notification saved in the person's inbox
--               accepted     the provider (Expo push / Resend email) took it;
--                            this is not proof it reached the phone or inbox
--               delivered    reserved for a provider confirmation (receipts or
--                            webhooks); nothing sets it yet
--               failed       the provider refused it
--               unavailable  no way to send: no phone registered, no email on
--                            file, Resend not configured, or no sender set up
--  • A visit can only arrive once and complete once (020b), and each
--    notification has a unique key per visit, event and recipient, so a double
--    tap or a reopened storm never sends the same notice twice.
--
-- The send-snow-notification Edge Function does the actual sending. Deploy:
--   supabase functions deploy send-snow-notification --no-verify-jwt
-- It reuses the RESEND_API_KEY / NOTIFY_EMAIL_FROM secrets of send-notification.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Owner per-stop completion alerts ────────────────────────────────────────
alter table public.snow_settings add column if not exists owner_stop_alerts boolean not null default true;
-- Changes are logged as settings.changed by 020b's snow_settings trigger.

-- ── Customer preferences per property ───────────────────────────────────────
create table if not exists public.snow_property_notify_prefs (
  property_id uuid primary key references public.snow_properties(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  notify_on_arrival boolean not null default false,
  notify_on_completion boolean not null default true,
  updated_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every property has a row (existing ones now, new ones on create).
insert into public.snow_property_notify_prefs (property_id, company_id)
select id, company_id from public.snow_properties on conflict do nothing;

create or replace function public._snow_notify_prefs_for_new_property()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.snow_property_notify_prefs (property_id, company_id)
  values (new.id, new.company_id) on conflict do nothing;
  return null;
end;
$$;
drop trigger if exists snow_properties_notify_prefs on public.snow_properties;
create trigger snow_properties_notify_prefs after insert on public.snow_properties
  for each row execute function public._snow_notify_prefs_for_new_property();

drop trigger if exists snow_property_notify_prefs_updated_at on public.snow_property_notify_prefs;
create trigger snow_property_notify_prefs_updated_at before update on public.snow_property_notify_prefs
  for each row execute function public.set_updated_at();

alter table public.snow_property_notify_prefs enable row level security;
-- Owner/admin see all; a linked customer contact sees their property's. No
-- direct writes: changes go through snow_set_notify_prefs (logged).
drop policy if exists snow_notify_prefs_select on public.snow_property_notify_prefs;
create policy snow_notify_prefs_select on public.snow_property_notify_prefs for select
  using (public.is_staff(company_id) or public.snow_is_property_contact(property_id));

-- Set by a linked customer contact, or by the owner/admin on the customer's
-- behalf (many contacts won't have the app). Null leaves a value unchanged.
create or replace function public.snow_set_notify_prefs(
  p_property_id uuid,
  p_on_arrival boolean default null,
  p_on_completion boolean default null
) returns public.snow_property_notify_prefs
language plpgsql security definer set search_path = public as $$
declare
  p public.snow_property_notify_prefs;
  n public.snow_property_notify_prefs;
begin
  select * into p from public.snow_property_notify_prefs where property_id = p_property_id for update;
  if p.property_id is null
     or not (public.is_staff(p.company_id) or public.snow_is_property_contact(p_property_id)) then
    raise exception 'Property not found.';
  end if;

  update public.snow_property_notify_prefs
     set notify_on_arrival = coalesce(p_on_arrival, notify_on_arrival),
         notify_on_completion = coalesce(p_on_completion, notify_on_completion),
         updated_by = public.my_person_id()
   where property_id = p_property_id
  returning * into n;

  if (n.notify_on_arrival, n.notify_on_completion) is distinct from (p.notify_on_arrival, p.notify_on_completion) then
    perform public.snow_log_event(n.company_id, 'notification.prefs_changed', 'property', n.property_id,
      null, null, null, n.property_id, null, null,
      jsonb_build_object('notify_on_arrival', p.notify_on_arrival, 'notify_on_completion', p.notify_on_completion),
      jsonb_build_object('notify_on_arrival', n.notify_on_arrival, 'notify_on_completion', n.notify_on_completion),
      case when public.is_staff(n.company_id) then 'Changed by staff' else 'Changed by customer' end);
  end if;
  return n;
end;
$$;
revoke all on function public.snow_set_notify_prefs(uuid, boolean, boolean) from public, anon;
grant execute on function public.snow_set_notify_prefs(uuid, boolean, boolean) to authenticated;

-- ── Notification records ────────────────────────────────────────────────────
create table if not exists public.snow_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- owner_alert: to owner/admins. customer: to a property contact.
  -- employee: reserved for later (nothing creates these yet).
  category text not null check (category in ('owner_alert', 'customer', 'employee')),
  event text not null check (event in ('visit.arrived', 'visit.completed')),
  storm_id uuid references public.snow_storms(id) on delete set null,
  route_id uuid references public.snow_routes(id) on delete set null,
  visit_id uuid references public.snow_visits(id) on delete set null,
  property_id uuid references public.snow_properties(id) on delete set null,
  service text,
  recipient_person_id uuid references public.people(id) on delete set null,
  recipient_contact_id uuid references public.snow_property_contacts(id) on delete set null,
  recipient_name text,
  recipient_email text,
  title text not null,
  body text not null default '',
  -- One per visit + event + recipient: retries, double taps and reopened
  -- storms can't make a second one.
  dedupe_key text not null unique,
  -- Set when the sender picks it up (once).
  dispatched_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_snow_notifications_company on public.snow_notifications (company_id, created_at desc);
create index if not exists idx_snow_notifications_visit on public.snow_notifications (visit_id) where visit_id is not null;
create index if not exists idx_snow_notifications_storm on public.snow_notifications (storm_id, created_at desc) where storm_id is not null;

create table if not exists public.snow_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.snow_notifications(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  channel text not null check (channel in ('in_app', 'push', 'email')),
  status text not null default 'pending'
    check (status in ('pending', 'stored', 'accepted', 'delivered', 'failed', 'unavailable')),
  provider text check (provider in ('app', 'expo', 'resend')),
  -- app_notifications id, Expo ticket ids, or Resend message id.
  provider_ref text,
  detail text,
  attempted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_id, channel)
);
create index if not exists idx_snow_deliveries_notification on public.snow_notification_deliveries (notification_id);
drop trigger if exists snow_notification_deliveries_updated_at on public.snow_notification_deliveries;
create trigger snow_notification_deliveries_updated_at before update on public.snow_notification_deliveries
  for each row execute function public.set_updated_at();

-- Owner/admin read only. Nobody writes from the app: rows come from the visit
-- trigger below and results from the sender (service role).
alter table public.snow_notifications enable row level security;
alter table public.snow_notification_deliveries enable row level security;
drop policy if exists snow_notifications_staff on public.snow_notifications;
create policy snow_notifications_staff on public.snow_notifications for select using (public.is_staff(company_id));
drop policy if exists snow_deliveries_staff on public.snow_notification_deliveries;
create policy snow_deliveries_staff on public.snow_notification_deliveries for select using (public.is_staff(company_id));

-- ── Creating notifications when a visit arrives / completes ────────────────

create or replace function public._snow_service_label(s text)
returns text language sql immutable as $$
  select case s when 'plowing' then 'Plowing' when 'shoveling' then 'Sidewalk service'
                when 'salting' then 'Salting' else initcap(coalesce(s, 'Snow service')) end
$$;

-- One notification + its delivery rows. Returns the id, or null if this
-- exact notice already exists.
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
    -- In the app's notification list. pushed_at is set so the older
    -- send-notification function leaves it alone; the snow sender pushes it
    -- and records the result.
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

-- Ask the sender to deliver the pending push/email rows. Never blocks the
-- visit: if it can't be asked, those rows are marked unavailable instead.
create or replace function public._snow_dispatch_notification(nid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare url text;
begin
  if not exists (select 1 from public.snow_notification_deliveries where notification_id = nid and status = 'pending') then
    return;
  end if;
  select value into url from public.app_settings where key = 'functions_url';
  begin
    if url is null then
      raise exception 'functions_url is not set';
    end if;
    perform net.http_post(
      url := url || '/send-snow-notification',
      body := jsonb_build_object('id', nid),
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
  exception when others then
    update public.snow_notification_deliveries
       set status = 'unavailable', detail = 'Sender not set up: ' || left(sqlerrm, 200), attempted_at = now()
     where notification_id = nid and status = 'pending';
  end;
end;
$$;
revoke all on function public._snow_dispatch_notification(uuid) from public, anon, authenticated;

create or replace function public._snow_visit_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  prefs public.snow_property_notify_prefs;
  owner_alerts boolean;
  ev text;
  label text := public._snow_service_label(new.service);
  place text := coalesce(new.property_name, 'the property');
  route_name text;
  c record;
  nid uuid;
  ids uuid[] := '{}';
begin
  if new.status = old.status or new.status not in ('arrived', 'completed') then
    return null;
  end if;
  ev := 'visit.' || new.status;
  select * into prefs from public.snow_property_notify_prefs where property_id = new.property_id;

  -- Customers, per the property's preferences.
  if (ev = 'visit.arrived' and coalesce(prefs.notify_on_arrival, false))
     or (ev = 'visit.completed' and coalesce(prefs.notify_on_completion, true)) then
    for c in
      select id, person_id, name, email from public.snow_property_contacts
      where property_id = new.property_id and removed_at is null
    loop
      nid := public._snow_add_notification(new, 'customer', ev, c.person_id, c.id, c.name, c.email,
        case when ev = 'visit.arrived' then 'Our crew has arrived' else label || ' completed' end,
        case when ev = 'visit.arrived' then label || ' at ' || place else place end);
      if nid is not null then ids := ids || nid; end if;
    end loop;
  end if;

  -- Owner/admins, one alert per completed stop, if the toggle is on.
  if ev = 'visit.completed' then
    select s.owner_stop_alerts into owner_alerts from public.snow_settings s where s.company_id = new.company_id;
    if coalesce(owner_alerts, true) then
      select name into route_name from public.snow_routes where id = new.route_id;
      for c in
        select m.person_id from public.company_members m
        where m.company_id = new.company_id and m.role in ('owner', 'admin') and m.status = 'active'
      loop
        nid := public._snow_add_notification(new, 'owner_alert', ev, c.person_id, null, null, null,
          label || ' done: ' || place, coalesce(route_name, ''));
        if nid is not null then ids := ids || nid; end if;
      end loop;
    end if;
  end if;

  foreach nid in array ids loop
    perform public._snow_dispatch_notification(nid);
  end loop;
  return null;
end;
$$;
drop trigger if exists snow_visits_notify on public.snow_visits;
create trigger snow_visits_notify after update of status on public.snow_visits
  for each row execute function public._snow_visit_notify();

-- ── Results from the sender (service role only) ─────────────────────────────

-- The sender claims a notification once, within 15 minutes of it being made.
create or replace function public.snow_claim_notification(p_id uuid)
returns setof public.snow_notifications
language sql security definer set search_path = public as $$
  update public.snow_notifications set dispatched_at = now()
   where id = p_id and dispatched_at is null and created_at > now() - interval '15 minutes'
  returning *
$$;
revoke all on function public.snow_claim_notification(uuid) from public, anon, authenticated;
grant execute on function public.snow_claim_notification(uuid) to service_role;

-- Records one channel's outcome and logs it for customer notices.
create or replace function public.snow_record_delivery(
  p_notification_id uuid, p_channel text, p_status text, p_provider_ref text default null, p_detail text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  d public.snow_notification_deliveries;
  n public.snow_notifications;
begin
  if p_status not in ('accepted', 'failed', 'unavailable') then
    raise exception 'Unknown delivery status %', p_status;
  end if;
  update public.snow_notification_deliveries
     set status = p_status, provider_ref = left(p_provider_ref, 500), detail = left(p_detail, 500), attempted_at = now()
   where notification_id = p_notification_id and channel = p_channel and status = 'pending'
  returning * into d;
  if d.id is null then return; end if;

  select * into n from public.snow_notifications where id = p_notification_id;
  if n.category = 'customer' then
    perform public.snow_log_event(n.company_id, 'notification.' || p_status, 'notification', n.id,
      n.storm_id, n.route_id, n.visit_id, n.property_id, n.recipient_person_id, n.service, null,
      jsonb_build_object('channel', p_channel, 'status', p_status, 'detail', p_detail), null);
  end if;
end;
$$;
revoke all on function public.snow_record_delivery(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.snow_record_delivery(uuid, text, text, text, text) to service_role;
