-- ============================================================================
-- Update 76 — the properties backfill (a report first; changes data only when told to).
-- Run once in Supabase → SQL Editor, AFTER update 75 (safe to run again). NOT run yet; read it before running.
--
-- This only DEFINES a function. Nothing changes when you run this file.
--
--   select public.backfill_properties();        -- a DRY RUN: a report of what it would do. Changes nothing.
--   select public.backfill_properties(true);    -- does it (owner only), after you have read the report and agreed.
--
-- The matching rules are written out in docs/customers-and-properties.md. In short:
--   * Looks at three kinds of existing record of YOUR company: landscaping projects, maintenance properties, snow properties
--     (a snow property's customer is its one linked customer contact, if there is exactly one).
--   * Two records are the SAME place only when they have the same customer AND the same normalized address (update 75's normalize_address:
--     case, punctuation, "Street/St", "North/N", "Apt/#/Unit" are ignored; unit numbers are kept; the ZIP's first five digits decide the town).
--   * It never groups across customers, never guesses from names, and never uses a record without a customer or without an address.
--   * Same address under two different customers, snow records with several contacts, records with no customer, no address, or a customer
--     who is not a customer of the company are NOT linked: they are listed in the report for the owner to decide.
--   * Applying it creates one property per place and fills property_id on the matching records. It NEVER changes an address, name, project,
--     quote, invoice or visit, and never deletes anything. Running it again skips what is already linked.
-- ============================================================================
create or replace function public.backfill_properties(p_apply boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  rec record;
  pid uuid;
  created_n integer := 0;
  linked_n integer := 0;
  report jsonb;
begin
  select m.company_id into cid from public.company_members m
   where m.person_id = public.my_person_id() and m.role = 'owner' and m.status = 'active' order by m.created_at limit 1;
  if cid is null then raise exception 'Only the company owner can run this.'; end if;

  create temp table _bf (
    src text, src_id uuid, customer_id uuid, name text, address text, city text, state text, zip text,
    lat double precision, lng double precision, akey text, updated_at timestamptz, existing_property uuid,
    contacts integer, is_customer boolean, status text
  ) on commit drop;

  insert into _bf
  select 'project', p.id, p.customer_id, p.name, p.address, p.city, p.state, p.zip, p.latitude, p.longitude,
         public.normalize_address(p.address, p.city, p.state, p.zip), p.updated_at, p.property_id, null::integer,
         (p.customer_id is not null and public._is_company_customer(p.company_id, p.customer_id)), p.status
    from public.projects p where p.company_id = cid;

  insert into _bf
  select 'maintenance', mp.id, mp.customer_id, mp.name, mp.address, mp.city, mp.state, mp.zip, mp.latitude, mp.longitude,
         public.normalize_address(mp.address, mp.city, mp.state, mp.zip), mp.updated_at, mp.property_id, null::integer,
         (mp.customer_id is not null and public._is_company_customer(mp.company_id, mp.customer_id)), null
    from public.maintenance_properties mp where mp.company_id = cid;

  insert into _bf
  select 'snow', sp.id, x.the_customer, sp.name, sp.address, sp.city, sp.state, sp.zip, sp.latitude, sp.longitude,
         public.normalize_address(sp.address, sp.city, sp.state, sp.zip), sp.updated_at, sp.property_id, x.n,
         (x.the_customer is not null), null
    from public.snow_properties sp
    cross join lateral (
      select count(distinct c.person_id)::integer as n,
             case when count(distinct c.person_id) = 1 then (array_agg(c.person_id))[1] end as the_customer
        from public.snow_property_contacts c
       where c.property_id = sp.id and c.removed_at is null and c.person_id is not null
         and public._is_company_customer(sp.company_id, c.person_id)
    ) x
   where sp.company_id = cid;

  -- A place (same address) that more than one customer claims: nobody is linked automatically.
  create temp table _bf_conflict on commit drop as
    select akey from _bf where akey <> '' and customer_id is not null group by akey having count(distinct customer_id) > 1;

  create temp table _bf_ok on commit drop as
    select b.* from _bf b
     where b.akey <> '' and b.customer_id is not null and b.is_customer and b.existing_property is null
       and not exists (select 1 from _bf_conflict c where c.akey = b.akey);

  if p_apply then
    for rec in select customer_id, akey from _bf_ok group by customer_id, akey loop
      select pr.id into pid from public.properties pr where pr.company_id = cid and pr.customer_id = rec.customer_id and pr.address_key = rec.akey;
      if pid is null then
        -- The best record describes the place: a maintenance property first (it is the most carefully entered), then snow, then the newest project.
        insert into public.properties (company_id, customer_id, name, address, city, state, zip, latitude, longitude)
        select cid, rec.customer_id, b.name, coalesce(b.address, ''), b.city, b.state, b.zip,
               (select o.lat from _bf_ok o where o.customer_id = rec.customer_id and o.akey = rec.akey and o.lat is not null order by o.updated_at desc limit 1),
               (select o.lng from _bf_ok o where o.customer_id = rec.customer_id and o.akey = rec.akey and o.lng is not null order by o.updated_at desc limit 1)
          from _bf_ok b where b.customer_id = rec.customer_id and b.akey = rec.akey
         order by case b.src when 'maintenance' then 1 when 'snow' then 2 else 3 end, b.updated_at desc nulls last limit 1
        returning id into pid;
        created_n := created_n + 1;
      end if;
      update public.projects p set property_id = pid
        where p.property_id is null and p.id in (select src_id from _bf_ok where src = 'project' and customer_id = rec.customer_id and akey = rec.akey);
      get diagnostics linked_n = row_count;
      update public.maintenance_properties mp set property_id = pid
        where mp.property_id is null and mp.id in (select src_id from _bf_ok where src = 'maintenance' and customer_id = rec.customer_id and akey = rec.akey);
      update public.snow_properties sp set property_id = pid
        where sp.property_id is null and sp.id in (select src_id from _bf_ok where src = 'snow' and customer_id = rec.customer_id and akey = rec.akey);
      pid := null;
    end loop;
  end if;

  report := jsonb_build_object(
    'applied', p_apply,
    'records', jsonb_build_object('projects', (select count(*) from _bf where src = 'project'), 'maintenance', (select count(*) from _bf where src = 'maintenance'),
                                  'snow', (select count(*) from _bf where src = 'snow')),
    'alreadyLinked', (select count(*) from _bf where existing_property is not null),
    'linkable', jsonb_build_object('projects', (select count(*) from _bf_ok where src = 'project'), 'maintenance', (select count(*) from _bf_ok where src = 'maintenance'),
                                   'snow', (select count(*) from _bf_ok where src = 'snow')),
    'propertiesThatWouldBeCreated', (select count(*) from (select distinct customer_id, akey from _bf_ok o
                                       where not exists (select 1 from public.properties pr where pr.company_id = cid and pr.customer_id = o.customer_id and pr.address_key = o.akey)) g),
    'createdNow', created_n,
    'needsDecision', jsonb_build_object(
      'sameAddressDifferentCustomers', coalesce((select jsonb_agg(x) from (
          select b.akey as address_key, jsonb_agg(distinct jsonb_build_object('src', b.src, 'id', b.src_id, 'name', b.name, 'address', b.address, 'customer', b.customer_id)) as records
            from _bf b join _bf_conflict c on c.akey = b.akey group by b.akey limit 50) x), '[]'::jsonb),
      'noCustomer', coalesce((select jsonb_agg(jsonb_build_object('src', src, 'id', src_id, 'name', name, 'address', address)) from (
          select * from _bf where customer_id is null and akey <> '' and existing_property is null order by src, name limit 50) y), '[]'::jsonb),
      'snowWithSeveralContacts', coalesce((select jsonb_agg(jsonb_build_object('id', src_id, 'name', name, 'address', address, 'contacts', contacts)) from (
          select * from _bf where src = 'snow' and contacts > 1 order by name limit 50) z), '[]'::jsonb),
      'customerNotACustomerOfThisCompany', coalesce((select jsonb_agg(jsonb_build_object('src', src, 'id', src_id, 'name', name, 'customer', customer_id)) from (
          select * from _bf where customer_id is not null and not is_customer and src <> 'snow' order by src, name limit 50) w), '[]'::jsonb),
      'noAddress', coalesce((select jsonb_agg(jsonb_build_object('src', src, 'id', src_id, 'name', name)) from (
          select * from _bf where akey = '' order by src, name limit 50) v), '[]'::jsonb)
    )
  );
  return report;
end;
$$;
revoke all on function public.backfill_properties(boolean) from public, anon;
grant execute on function public.backfill_properties(boolean) to authenticated;

notify pgrst, 'reload schema';
