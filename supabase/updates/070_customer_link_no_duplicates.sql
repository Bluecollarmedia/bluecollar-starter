-- ============================================================================
-- Update 70 — run once in Supabase → SQL Editor, AFTER update 37 (safe to run again). NOT run yet; read it before running.
--
-- Linking a customer record the owner created to the customer's real login, without duplicates and without guessing.
--
-- Before: the owner adds a customer (a people row with no login). A property or project is linked to it. When the real customer signs
-- up and enters the property's code, _claim_maintenance pointed the property at the customer's OWN person row but left the owner's
-- record behind: two people for one customer, the old one still on the owner's Customers list (and still holding quotes/invoices/projects).
--
-- Now, when a code is claimed, and the property is currently linked to an owner-created record that has NO login (a placeholder: no
-- user_id, an invited customer of this company), everything of that company that pointed at the placeholder is moved to the person who
-- proved they hold the code, and the placeholder is removed. Identity comes from possessing the single-use code the owner gave out.
-- Names and email addresses are never matched. A record that HAS a login is never merged, and nothing outside the company is touched.
-- ============================================================================

-- Moves one company's customer_id references from a placeholder person to the real person, then removes the placeholder.
create or replace function public._merge_placeholder_customer(p_company uuid, p_placeholder uuid, p_real uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if p_placeholder is null or p_real is null or p_placeholder = p_real then return false; end if;
  -- Only an owner-created record: no login, and an invited customer of THIS company (and of no other company).
  if not exists (select 1 from public.people p where p.id = p_placeholder and p.user_id is null) then return false; end if;
  if not exists (select 1 from public.company_members m where m.company_id = p_company and m.person_id = p_placeholder and m.role = 'customer' and m.status = 'invited') then return false; end if;
  if exists (select 1 from public.company_members m where m.person_id = p_placeholder and m.company_id <> p_company) then return false; end if;

  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r'
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'customer_id' and not a.attisdropped)
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
  loop
    execute format('update public.%I set customer_id = $1 where customer_id = $2 and company_id = $3', t.relname) using p_real, p_placeholder, p_company;
  end loop;
  -- Their own timeline/records stay with the company; the invited membership and the empty person go.
  delete from public.company_members where company_id = p_company and person_id = p_placeholder and role = 'customer' and status = 'invited';
  begin
    delete from public.people where id = p_placeholder and user_id is null;
  exception when foreign_key_violation then
    null;   -- something outside the customer_id columns still points at it: keep the person rather than lose data
  end;
  return true;
end;
$$;
revoke all on function public._merge_placeholder_customer(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public._claim_maintenance(pid uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c record;
  prop record;
begin
  select * into c from public.maintenance_customer_codes where code = upper(trim(p_code));
  if c.property_id is null then
    return jsonb_build_object('success', false, 'error', 'invalid_code');
  end if;

  select id, company_id, customer_id into prop from public.maintenance_properties where id = c.property_id;

  -- A code belongs to the first customer who uses it (same as project codes).
  if c.claimed_by is not null and c.claimed_by <> pid then
    return jsonb_build_object('success', false, 'error', 'already_claimed');
  end if;
  if exists (select 1 from public.company_members
             where company_id = c.company_id and person_id = pid and status = 'inactive'
               and deactivated_by is not null and deactivated_by <> pid) then
    return jsonb_build_object('success', false, 'error', 'access_removed');
  end if;

  update public.maintenance_properties set customer_id = pid where id = prop.id;
  update public.maintenance_customer_codes
     set claimed_by = pid, claimed_at = coalesce(claimed_at, now())
   where property_id = c.property_id;

  insert into public.company_members (company_id, person_id, role, status, join_method)
  values (c.company_id, pid, 'customer', 'active', 'invitation_link')
  on conflict (company_id, person_id) do update
    set status = 'active'
    where public.company_members.status <> 'active' and public.company_members.role = 'customer';

  -- If the owner had linked an owner-created record (no login) to this property, it becomes this person: no duplicate.
  perform public._merge_placeholder_customer(c.company_id, prop.customer_id, pid);

  return jsonb_build_object('success', true, 'project_id', prop.id, 'kind', 'maintenance');
end;
$$;
revoke all on function public._claim_maintenance(uuid, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
