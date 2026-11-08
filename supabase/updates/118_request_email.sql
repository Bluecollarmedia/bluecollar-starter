-- ============================================================================
-- Update 118 — a new service request also EMAILS the owner (and admins). Run once in Supabase → SQL Editor, AFTER 114. Safe to run again.
-- NOT run yet. Also deploy the `notify-request` edge function (supabase/functions/notify-request/index.ts) with "Verify JWT" OFF, and make
-- sure the secrets RESEND_API_KEY and NOTIFY_EMAIL_FROM are set (they are the ones send-document-email already uses).
--
-- 1. service_requests.emailed_at: when the email went (so a request is never emailed twice).
-- 2. submit_service_request now also returns the new request's id; the app hands it to notify-request right after sending.
--    The function is otherwise exactly as in 114.
-- ============================================================================
alter table public.service_requests add column if not exists emailed_at timestamptz;

create or replace function public.submit_service_request(
  p_property_type text, p_services text[], p_details text, p_town text, p_name text, p_phone text, p_email text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  allowed constant text[] := array[
    'Backyard Design & Build', 'Pavers, Patios & Walkways', 'Turf & Sod Installation', 'Lighting & Planting',
    'Commercial Maintenance', 'Seasonal Cleanup', 'Snow & Storm Response', 'Other / Multiple'];
  v_name text := btrim(coalesce(p_name, ''));
  v_town text := btrim(coalesce(p_town, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_details text := btrim(coalesce(p_details, ''));
  v_services text[];
  cid uuid;
  rid uuid;
  mem record;
  one_hour constant interval := interval '1 hour';
begin
  if p_property_type is null or p_property_type not in ('residential','commercial') then raise exception 'Choose residential or commercial.'; end if;
  select coalesce(array_agg(distinct s), '{}') into v_services from unnest(coalesce(p_services, '{}')) s where s = any(allowed);
  if cardinality(v_services) < 1 then raise exception 'Choose at least one service.'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then raise exception 'Enter your name.'; end if;
  if char_length(v_town) < 2 or char_length(v_town) > 80 then raise exception 'Enter the town or ZIP code of the property.'; end if;
  if char_length(v_digits) < 10 or char_length(v_digits) > 15 then raise exception 'Enter a phone number we can reach you at.'; end if;
  if v_email <> '' and (char_length(v_email) > 120 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then raise exception 'That email address does not look right.'; end if;
  if char_length(v_details) > 2000 then raise exception 'Please keep the description under 2000 characters.'; end if;

  select m.company_id into cid from public.company_members m where m.role = 'owner' and m.status = 'active' limit 1;
  if cid is null then raise exception 'Requests are not available right now. Please call us.'; end if;

  if (select count(*) from public.service_requests r
       where r.created_at > now() - one_hour and (r.phone_digits = v_digits or (v_email <> '' and r.email = v_email))) >= 3 then
    raise exception 'We already have your requests. We will be in touch, or you can call us.';
  end if;
  if (select count(*) from public.service_requests r where r.created_at > now() - one_hour) >= 40 then
    raise exception 'Too many requests right now. Please call us instead.';
  end if;

  insert into public.service_requests (company_id, property_type, services, details, town, name, phone, phone_digits, email)
  values (cid, p_property_type, v_services, v_details, v_town, v_name, v_phone, v_digits, v_email)
  returning id into rid;

  for mem in select m.person_id from public.company_members m
              where m.company_id = cid and m.status = 'active' and m.role in ('owner','admin') loop
    insert into public.app_notifications (company_id, recipient_id, event_type, title, body, linked_entity_type, linked_entity_id)
    values (cid, mem.person_id, 'service_request', 'New service request',
            v_name || ' (' || v_town || '): ' || array_to_string(v_services, ', '), 'service_request', rid::text);
  end loop;

  return jsonb_build_object('ok', true, 'id', rid);
end;
$$;
revoke all on function public.submit_service_request(text, text[], text, text, text, text, text) from public;
grant execute on function public.submit_service_request(text, text[], text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
