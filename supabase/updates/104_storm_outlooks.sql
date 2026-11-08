-- ============================================================================
-- Update 104 — run once in Supabase → SQL Editor, AFTER 103. NOT run yet; read it first. Safe to run again.
--
-- Brighton's own storm outlooks (the owner writes them; every visitor reads them). ADDITIVE: two new tables and five new functions; nothing
-- existing is altered, dropped or re-granted.
--   * An outlook is one storm. Each time the owner publishes, that is a NEW VERSION (an "update") of it. A published version can never be
--     changed or deleted by anyone (a database rule enforces it), so the original always stays exactly as it was published.
--   * The owner can post an update, post a final update (which also ends the storm), or end the storm. Only one storm can be active at a time.
--   * Actual snowfall can only be saved together with a source (who or what measured it).
--   * Visitors (signed in or not) read through public_storm_current() and public_storm_history(). Both answer nothing while the owner's public
--     Weather switch (update 103) is off.
--   * Writing is for a signed-in, ACTIVE member whose role is exactly 'owner' (not admins, workers, customers, or signed-out callers).
-- ============================================================================

create table if not exists public.storm_outlooks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null default '' check (char_length(name) <= 80),
  status text not null default 'active' check (status in ('active', 'ended')),
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
-- One active storm per company.
create unique index if not exists storm_outlooks_one_active on public.storm_outlooks (company_id) where status = 'active';

create table if not exists public.storm_outlook_versions (
  id uuid primary key default gen_random_uuid(),
  outlook_id uuid not null references public.storm_outlooks(id) on delete cascade,
  version_no integer not null check (version_no >= 1),
  headline text not null check (char_length(headline) between 1 and 120),
  message text not null check (char_length(message) between 1 and 4000),
  message_es text check (message_es is null or char_length(message_es) <= 4000),
  snow_low numeric(5,1) check (snow_low is null or (snow_low >= 0 and snow_low <= 100)),
  snow_high numeric(5,1) check (snow_high is null or (snow_high >= 0 and snow_high <= 100)),
  starts_at timestamptz,
  ends_at timestamptz,
  disclaimer text not null check (char_length(disclaimer) between 1 and 600),
  actual_snow numeric(5,1) check (actual_snow is null or (actual_snow >= 0 and actual_snow <= 100)),
  actual_source text check (actual_source is null or char_length(actual_source) <= 160),
  is_final boolean not null default false,
  published_by uuid references public.people(id) on delete set null,
  published_at timestamptz not null default now(),
  unique (outlook_id, version_no),
  -- the estimate is a pair or nothing ("not sure yet" saves neither): never a half range
  check ((snow_low is null) = (snow_high is null)),
  check (snow_low is null or snow_high >= snow_low),
  check (starts_at is null or ends_at is null or ends_at > starts_at),
  -- actual snowfall needs a source
  check (actual_snow is null or (actual_source is not null and char_length(btrim(actual_source)) >= 3))
);

-- A published update is permanent: nobody (not even the database owner's own functions) can change or delete one.
create or replace function public.storm_versions_are_permanent() returns trigger language plpgsql as $$
begin
  -- Only the owner's delete functions (update 106) may delete, and only while they are running.
  if tg_op = 'DELETE' and coalesce(current_setting('app.storm_owner_delete', true), '') = '1' then
    return old;
  end if;
  raise exception 'A published storm update cannot be changed or deleted.';
end;
$$;
drop trigger if exists storm_versions_no_change on public.storm_outlook_versions;
create trigger storm_versions_no_change before update or delete on public.storm_outlook_versions
  for each row execute function public.storm_versions_are_permanent();

-- Nobody reads or writes these tables directly: no policies, and no table privileges for the app's roles.
alter table public.storm_outlooks enable row level security;
alter table public.storm_outlook_versions enable row level security;
revoke all on public.storm_outlooks from public, anon, authenticated;
revoke all on public.storm_outlook_versions from public, anon, authenticated;

-- One outlook as JSON: its facts and its latest version (and how many versions there are).
create or replace function public.storm_outlook_json(p_outlook_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', o.id, 'name', o.name, 'status', o.status, 'created_at', o.created_at, 'ended_at', o.ended_at,
    'version_count', (select count(*) from public.storm_outlook_versions v where v.outlook_id = o.id),
    'latest', (select to_jsonb(v) - 'published_by' - 'outlook_id' from public.storm_outlook_versions v where v.outlook_id = o.id order by v.version_no desc limit 1)
  )
  from public.storm_outlooks o where o.id = p_outlook_id
$$;
revoke all on function public.storm_outlook_json(uuid) from public, anon, authenticated;

-- Visitors: the storm that is active right now (or null). Nothing at all while public Weather is off.
create or replace function public.public_storm_current()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare oid uuid;
begin
  if coalesce((public.public_weather_config() ->> 'enabled')::boolean, false) is not true then return null; end if;
  select o.id into oid from public.storm_outlooks o
   where o.status = 'active' and exists (select 1 from public.storm_outlook_versions v where v.outlook_id = o.id)
   order by o.created_at desc limit 1;
  if oid is null then return null; end if;
  return public.storm_outlook_json(oid);
end;
$$;
revoke all on function public.public_storm_current() from public;
grant execute on function public.public_storm_current() to anon, authenticated;

-- Visitors: every storm Brighton has posted (newest first, up to 50), each with all of its versions (newest first).
create or replace function public.public_storm_history()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce((public.public_weather_config() ->> 'enabled')::boolean, false) is not true then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(
      public.storm_outlook_json(o.id) || jsonb_build_object('versions', (
        select coalesce(jsonb_agg(to_jsonb(v) - 'published_by' - 'outlook_id' order by v.version_no desc), '[]'::jsonb)
          from public.storm_outlook_versions v where v.outlook_id = o.id))
      order by o.created_at desc)
    from (select * from public.storm_outlooks x
           where exists (select 1 from public.storm_outlook_versions v where v.outlook_id = x.id)
           order by x.created_at desc limit 50) o
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.public_storm_history() from public;
grant execute on function public.public_storm_history() to anon, authenticated;

-- The owner's own view of the active storm (so "post an update" starts from the last version), whether or not public Weather is on.
create or replace function public.owner_storm_current()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.my_person_id(); cid uuid; oid uuid;
begin
  if me is null then raise exception 'Only the owner can do that.'; end if;
  select m.company_id into cid from public.company_members m where m.person_id = me and m.role = 'owner' and m.status = 'active' limit 1;
  if cid is null then raise exception 'Only the owner can do that.'; end if;
  select o.id into oid from public.storm_outlooks o where o.company_id = cid and o.status = 'active' order by o.created_at desc limit 1;
  if oid is null then return null; end if;
  return public.storm_outlook_json(oid);
end;
$$;
revoke all on function public.owner_storm_current() from public, anon;
grant execute on function public.owner_storm_current() to authenticated;

-- (If update 105 was already run, its 14-argument version of this function is removed first, so running 104 again never leaves two versions to clash.)
drop function if exists public.publish_storm_outlook(uuid, text, text, text, text, numeric, numeric, timestamptz, timestamptz, text, numeric, text, boolean, text);

-- The owner publishes: a new storm (p_outlook_id null) or a new update to the active one. p_final also ends the storm.
create or replace function public.publish_storm_outlook(
  p_outlook_id uuid, p_name text, p_headline text, p_message text, p_message_es text,
  p_snow_low numeric, p_snow_high numeric, p_starts_at timestamptz, p_ends_at timestamptz,
  p_disclaimer text, p_actual_snow numeric, p_actual_source text, p_final boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id(); cid uuid; oid uuid; vno integer;
  h text := btrim(coalesce(p_headline, '')); m text := btrim(coalesce(p_message, '')); d text := btrim(coalesce(p_disclaimer, ''));
begin
  if me is null then raise exception 'Only the owner can do that.'; end if;
  select mm.company_id into cid from public.company_members mm where mm.person_id = me and mm.role = 'owner' and mm.status = 'active' limit 1;
  if cid is null then raise exception 'Only the owner can do that.'; end if;
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
    (outlook_id, version_no, headline, message, message_es, snow_low, snow_high, starts_at, ends_at, disclaimer, actual_snow, actual_source, is_final, published_by)
  values
    (oid, vno, h, m, nullif(btrim(coalesce(p_message_es, '')), ''), p_snow_low, p_snow_high, p_starts_at, p_ends_at, d, p_actual_snow,
     nullif(btrim(coalesce(p_actual_source, '')), ''), coalesce(p_final, false), me);
  if coalesce(p_final, false) then
    update public.storm_outlooks set status = 'ended', ended_at = now() where id = oid;
  end if;
  return jsonb_build_object('outlook_id', oid, 'version_no', vno, 'ended', coalesce(p_final, false));
end;
$$;
revoke all on function public.publish_storm_outlook(uuid, text, text, text, text, numeric, numeric, timestamptz, timestamptz, text, numeric, text, boolean) from public, anon;
grant execute on function public.publish_storm_outlook(uuid, text, text, text, text, numeric, numeric, timestamptz, timestamptz, text, numeric, text, boolean) to authenticated;

-- The owner ends the active storm without posting another update.
create or replace function public.end_storm_outlook(p_outlook_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_person_id(); cid uuid; n integer;
begin
  if me is null then raise exception 'Only the owner can do that.'; end if;
  select mm.company_id into cid from public.company_members mm where mm.person_id = me and mm.role = 'owner' and mm.status = 'active' limit 1;
  if cid is null then raise exception 'Only the owner can do that.'; end if;
  update public.storm_outlooks set status = 'ended', ended_at = now() where id = p_outlook_id and company_id = cid and status = 'active';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'That storm outlook is not active.'; end if;
  return jsonb_build_object('ended', true);
end;
$$;
revoke all on function public.end_storm_outlook(uuid) from public, anon;
grant execute on function public.end_storm_outlook(uuid) to authenticated;

notify pgrst, 'reload schema';
