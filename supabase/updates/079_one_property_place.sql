-- Update 79: one place for every property.
--
-- A property is entered ONCE (for one customer) in the properties table (update 75). Landscaping projects, Maintenance properties
-- and Snow properties are just that same property with their own settings, linked through property_id.
--
--  * ensure_property(): the one way the app adds a property. The same customer + the same address (even typed differently) gives the
--    SAME property back, never a second copy.
--  * snow_enable_for_property(): turns Snow on for a property: makes (or finds) its Snow record and links the customer as its contact,
--    so nothing about the customer or the address is typed again.
--  * Changing a property's address changes it everywhere it is used (projects, maintenance, snow).
--
-- Safe to run more than once. Does not touch existing data.

create or replace function public._property_staff_company()
returns uuid language sql stable security definer set search_path = public as $$
  select m.company_id from public.company_members m
   where m.person_id = public.my_person_id() and m.role in ('owner', 'admin') and m.status = 'active'
   order by m.created_at limit 1
$$;
revoke all on function public._property_staff_company() from public, anon, authenticated;

create or replace function public.ensure_property(
  p_customer uuid, p_name text, p_address text, p_city text default null, p_state text default null, p_zip text default null,
  p_lat double precision default null, p_lng double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public._property_staff_company();
  key text;
  pid uuid;
begin
  if cid is null then raise exception 'not allowed'; end if;
  if p_customer is null then raise exception 'Choose the customer first.'; end if;
  if not exists (select 1 from public.company_members m where m.company_id = cid and m.person_id = p_customer and m.role = 'customer') then
    raise exception 'That customer is not in your company.';
  end if;
  if length(trim(coalesce(p_address, ''))) = 0 then raise exception 'Enter the street address.'; end if;

  key := public.normalize_address(p_address, p_city, p_state, p_zip);
  if key <> '' then
    select id into pid from public.properties where company_id = cid and customer_id = p_customer and address_key = key limit 1;
    if pid is not null then return jsonb_build_object('property_id', pid, 'created', false); end if;
  end if;

  insert into public.properties (company_id, customer_id, name, address, city, state, zip, latitude, longitude, created_by)
  values (cid, p_customer, nullif(trim(coalesce(p_name, '')), ''), trim(p_address), nullif(trim(coalesce(p_city, '')), ''),
          nullif(trim(coalesce(p_state, '')), ''), nullif(trim(coalesce(p_zip, '')), ''), p_lat, p_lng, public.my_person_id())
  returning id into pid;
  return jsonb_build_object('property_id', pid, 'created', true);
end;
$$;
revoke all on function public.ensure_property(uuid, text, text, text, text, text, double precision, double precision) from public, anon;
grant execute on function public.ensure_property(uuid, text, text, text, text, text, double precision, double precision) to authenticated;

-- Snow on for a property. The Snow record copies the address and links the customer as its contact (their app account sees it).
create or replace function public.snow_enable_for_property(p_property uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pr public.properties;
  cust record;
  sid uuid;
  made boolean := false;
  nm text;
begin
  select * into pr from public.properties where id = p_property;
  if pr.id is null or pr.company_id is distinct from public._property_staff_company() then raise exception 'not allowed'; end if;

  select s.id into sid from public.snow_properties s where s.property_id = pr.id order by s.created_at limit 1;
  if sid is null then
    select first_name, last_name, phone, email into cust from public.people where id = pr.customer_id;
    nm := coalesce(nullif(trim(coalesce(pr.name, '')), ''), nullif(trim(coalesce(cust.last_name, '') || ' residence'), 'residence'), pr.address, 'Property');
    insert into public.snow_properties (company_id, name, address, city, state, zip, latitude, longitude, notes, property_id, created_by)
    values (pr.company_id, nm, pr.address, pr.city, pr.state, pr.zip, pr.latitude, pr.longitude, pr.notes, pr.id, public.my_person_id())
    returning id into sid;
    made := true;
  end if;

  if pr.customer_id is not null and not exists (
       select 1 from public.snow_property_contacts c where c.property_id = sid and c.person_id = pr.customer_id and c.removed_at is null) then
    select first_name, last_name, phone, email into cust from public.people where id = pr.customer_id;
    insert into public.snow_property_contacts (company_id, property_id, name, phone, email, person_id, is_primary, created_by)
    values (pr.company_id, sid, coalesce(nullif(trim(coalesce(cust.first_name, '') || ' ' || coalesce(cust.last_name, '')), ''), 'Customer'),
            cust.phone, nullif(cust.email, ''), pr.customer_id,
            not exists (select 1 from public.snow_property_contacts c where c.property_id = sid and c.removed_at is null and c.is_primary),
            public.my_person_id());
  end if;
  return jsonb_build_object('snow_property_id', sid, 'created', made);
end;
$$;
revoke all on function public.snow_enable_for_property(uuid) from public, anon;
grant execute on function public.snow_enable_for_property(uuid) to authenticated;

-- Change the address of a property once and every place that uses it follows.
create or replace function public._property_address_follows()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.address, new.city, new.state, new.zip, new.latitude, new.longitude)
     is distinct from (old.address, old.city, old.state, old.zip, old.latitude, old.longitude) then
    update public.projects set address = new.address, city = new.city, state = new.state, zip = new.zip,
           latitude = new.latitude, longitude = new.longitude where property_id = new.id;
    update public.maintenance_properties set address = new.address, city = new.city, state = new.state, zip = new.zip,
           latitude = new.latitude, longitude = new.longitude where property_id = new.id;
    update public.snow_properties set address = new.address, city = new.city, state = new.state, zip = new.zip,
           latitude = new.latitude, longitude = new.longitude where property_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public._property_address_follows() from public, anon, authenticated;
drop trigger if exists properties_address_follows on public.properties;
create trigger properties_address_follows after update on public.properties for each row execute function public._property_address_follows();

notify pgrst, 'reload schema';
