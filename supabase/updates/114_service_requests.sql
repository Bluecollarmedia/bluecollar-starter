-- ============================================================================
-- Update 114 — run once in Supabase → SQL Editor, AFTER 113. NOT run yet; read it first. Safe to run again.
--
-- "Request a service": anyone who opens the app and is not signed in (the public Weather area) can send Brighton a request for work:
-- property type, what they want, a description, where, and how to reach them. ADDITIVE: one new table and one new function.
--   * service_requests: the requests. Only the company's active owner or admin can read them or mark one handled. Nobody else, signed in or
--     not, can read, change or delete a request through the table (no insert policy: the function below is the only way in).
--   * submit_service_request(...): callable by anyone (signed in or not). Checks every field, refuses obvious spam (3 an hour from the same
--     phone or email, 40 an hour in all), saves the request, and files an in-app notification for each active owner and admin. The
--     existing notification trigger (update 8) turns that into a push to their phones.
-- ============================================================================

create table if not exists public.service_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  property_type text not null check (property_type in ('residential','commercial')),
  services text[] not null check (cardinality(services) between 1 and 8),
  details text not null default '' check (char_length(details) <= 2000),
  town text not null check (char_length(town) between 2 and 80),
  name text not null check (char_length(name) between 2 and 80),
  phone text not null,
  phone_digits text not null,
  email text not null default '' check (char_length(email) <= 120),
  status text not null default 'new' check (status in ('new','contacted','done')),
  handled_by uuid references public.people(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_service_requests_company on public.service_requests(company_id, created_at desc);
create index if not exists idx_service_requests_phone on public.service_requests(phone_digits, created_at desc);

alter table public.service_requests enable row level security;
revoke all on public.service_requests from public, anon, authenticated;
grant select on public.service_requests to authenticated;
grant update (status, handled_by, handled_at) on public.service_requests to authenticated;

drop policy if exists service_requests_select on public.service_requests;
create policy service_requests_select on public.service_requests for select to authenticated using (
  exists (select 1 from public.company_members m
           where m.company_id = service_requests.company_id and m.person_id = public.my_person_id()
             and m.status = 'active' and m.role in ('owner','admin'))
);
drop policy if exists service_requests_update on public.service_requests;
create policy service_requests_update on public.service_requests for update to authenticated using (
  exists (select 1 from public.company_members m
           where m.company_id = service_requests.company_id and m.person_id = public.my_person_id()
             and m.status = 'active' and m.role in ('owner','admin'))
) with check (
  exists (select 1 from public.company_members m
           where m.company_id = service_requests.company_id and m.person_id = public.my_person_id()
             and m.status = 'active' and m.role in ('owner','admin'))
);

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

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.submit_service_request(text, text[], text, text, text, text, text) from public;
grant execute on function public.submit_service_request(text, text[], text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
