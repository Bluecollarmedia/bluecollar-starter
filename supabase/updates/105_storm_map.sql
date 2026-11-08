-- ============================================================================
-- Update 105 — run once in Supabase → SQL Editor, AFTER 104. Safe to run again.
--
-- A storm map: each storm update can carry one picture (a map the owner uploads), stored with that update and locked like the rest of it.
--   * Adds one optional column (map_url, an https link) to storm_outlook_versions. Nothing existing is dropped or changed.
--   * Replaces publish_storm_outlook with the same function plus an optional map link (the old 13-argument one is removed so the two never clash).
--   * Visitors already read each update through to_jsonb(v), so the map link reaches them without changing the reading functions.
-- ============================================================================

alter table public.storm_outlook_versions add column if not exists map_url text
  check (map_url is null or (char_length(map_url) <= 600 and map_url ~* '^https://'));

drop function if exists public.publish_storm_outlook(uuid, text, text, text, text, numeric, numeric, timestamptz, timestamptz, text, numeric, text, boolean);

-- The owner publishes: a new storm (p_outlook_id null) or a new update to the active one. p_final also ends the storm.
create or replace function public.publish_storm_outlook(
  p_outlook_id uuid, p_name text, p_headline text, p_message text, p_message_es text,
  p_snow_low numeric, p_snow_high numeric, p_starts_at timestamptz, p_ends_at timestamptz,
  p_disclaimer text, p_actual_snow numeric, p_actual_source text, p_final boolean, p_map_url text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id(); cid uuid; oid uuid; vno integer;
  h text := btrim(coalesce(p_headline, '')); m text := btrim(coalesce(p_message, '')); d text := btrim(coalesce(p_disclaimer, '')); v_map text := nullif(btrim(coalesce(p_map_url, '')), '');
begin
  if me is null then raise exception 'Only the owner can do that.'; end if;
  select mm.company_id into cid from public.company_members mm where mm.person_id = me and mm.role = 'owner' and mm.status = 'active' limit 1;
  if cid is null then raise exception 'Only the owner can do that.'; end if;
  if v_map is not null and (char_length(v_map) > 600 or v_map !~* '^https://') then raise exception 'The storm map link is not valid.'; end if;
  if h = '' then raise exception 'Write a headline.'; end if;
  if m = '' then raise exception 'Write your message.'; end if;
  if d = '' then raise exception 'The disclaimer cannot be empty.'; end if;
  if (p_snow_low is null) <> (p_snow_high is null) then raise exception 'Give both a low and a high snowfall, or neither.'; end if;
  if p_snow_low is not null and p_snow_high < p_snow_low then raise exception 'The high snowfall cannot be below the low.'; end if;
  if p_actual_snow is not null and char_length(btrim(coalesce(p_actual_source, ''))) < 3 then raise exception 'Say who or what measured the actual snowfall.'; end if;
  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then raise exception 'The end must be after the start.'; end if;

  if p_outlook_id is null then
    if exists (select 1 from public.storm_outlooks o where o.company_id = cid and o.status = 'active') then
      raise exception 'A storm outlook is already active. Post an update to it, or end it first.';
    end if;
    insert into public.storm_outlooks (company_id, name, created_by) values (cid, left(btrim(coalesce(p_name, '')), 80), me) returning id into oid;
  else
    select o.id into oid from public.storm_outlooks o where o.id = p_outlook_id and o.company_id = cid and o.status = 'active';
    if oid is null then raise exception 'That storm outlook is not active.'; end if;
  end if;

  select coalesce(max(v.version_no), 0) + 1 into vno from public.storm_outlook_versions v where v.outlook_id = oid;
  insert into public.storm_outlook_versions
    (outlook_id, version_no, headline, message, message_es, snow_low, snow_high, starts_at, ends_at, disclaimer, actual_snow, actual_source, is_final, published_by, map_url)
  values
    (oid, vno, h, m, nullif(btrim(coalesce(p_message_es, '')), ''), p_snow_low, p_snow_high, p_starts_at, p_ends_at, d, p_actual_snow,
     nullif(btrim(coalesce(p_actual_source, '')), ''), coalesce(p_final, false), me, v_map);
  if coalesce(p_final, false) then
    update public.storm_outlooks set status = 'ended', ended_at = now() where id = oid;
  end if;
  return jsonb_build_object('outlook_id', oid, 'version_no', vno, 'ended', coalesce(p_final, false));
end;
$$;
revoke all on function public.publish_storm_outlook(uuid, text, text, text, text, numeric, numeric, timestamptz, timestamptz, text, numeric, text, boolean, text) from public, anon;
grant execute on function public.publish_storm_outlook(uuid, text, text, text, text, numeric, numeric, timestamptz, timestamptz, text, numeric, text, boolean, text) to authenticated;


notify pgrst, 'reload schema';
