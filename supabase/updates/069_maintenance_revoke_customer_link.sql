-- ============================================================================
-- Update 69 — run once in Supabase → SQL Editor, AFTER update 37 (safe to run again). NOT run yet; read it before running.
--
-- "Remove Customer's Access" on a maintenance property did nothing when the owner had linked the customer BY HAND (the customer picker
-- on the property edit screen). Update 37 only unlinked the customer when they had claimed the property's code, and a hand link never
-- sets that, so the customer stayed linked to the property and kept seeing its visits and shared photos.
--
-- Now revoking always clears maintenance_properties.customer_id (the one customer link Maintenance uses), whoever linked it. Generating
-- a new code WITHOUT revoking still keeps the link, as before. No table or column is added.
-- ============================================================================
create or replace function public.regenerate_maintenance_code(p_property_id uuid, p_revoke boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare
  cid uuid;
  new_code text;
begin
  select company_id into cid from public.maintenance_properties where id = p_property_id;
  if cid is null or not public.is_staff(cid) then raise exception 'not allowed'; end if;

  new_code := public._new_customer_code();

  insert into public.maintenance_customer_codes (property_id, company_id, code)
  values (p_property_id, cid, new_code)
  on conflict (property_id) do update set code = excluded.code, claimed_by = null, claimed_at = null;

  if p_revoke then
    update public.maintenance_properties set customer_id = null where id = p_property_id;
  end if;
  return new_code;
end;
$$;
revoke execute on function public.regenerate_maintenance_code(uuid, boolean) from public, anon;
grant execute on function public.regenerate_maintenance_code(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
