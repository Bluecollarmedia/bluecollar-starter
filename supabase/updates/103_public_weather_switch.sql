-- ============================================================================
-- Update 103 — run once in Supabase → SQL Editor, AFTER 102. NOT run yet; read it first. Safe to run again.
--
-- The master switch for the future public Weather experience. Default OFF. ADDITIVE: one new table and two new functions; nothing existing
-- is altered, dropped or re-granted. The app does not yet have any screen that uses it (and in this phase ignores the answer).
--   * public_weather_config(): anyone (signed in or not) may ask "is public weather on?". Answers ONLY {"enabled": true|false}.
--   * set_public_weather_enabled(on/off): ONLY a signed-in, ACTIVE member whose role is exactly 'owner'. Admins, workers, customers and
--     signed-out callers are refused. Nothing in the app calls it yet.
-- ============================================================================

create table if not exists public.public_weather_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  enabled boolean not null default false,
  updated_by uuid references public.people(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Nobody reads or writes this table directly: no policies, and no table privileges for the app's roles.
alter table public.public_weather_settings enable row level security;
revoke all on public.public_weather_settings from public, anon, authenticated;

create or replace function public.public_weather_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('enabled', coalesce((
    select bool_and(s.enabled)
      from public.public_weather_settings s
     where exists (select 1 from public.company_members m
                    where m.company_id = s.company_id and m.role = 'owner' and m.status = 'active')
  ), false))
$$;
revoke all on function public.public_weather_config() from public;
grant execute on function public.public_weather_config() to anon, authenticated;

create or replace function public.set_public_weather_enabled(p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  cid uuid;
begin
  if p_enabled is null then raise exception 'Choose on or off.'; end if;
  if me is null then raise exception 'Only the owner can do that.'; end if;
  select m.company_id into cid
    from public.company_members m
   where m.person_id = me and m.role = 'owner' and m.status = 'active'
   limit 1;
  if cid is null then raise exception 'Only the owner can do that.'; end if;
  insert into public.public_weather_settings (company_id, enabled, updated_by, updated_at)
  values (cid, p_enabled, me, now())
  on conflict (company_id) do update
    set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return jsonb_build_object('enabled', p_enabled);
end;
$$;
revoke all on function public.set_public_weather_enabled(boolean) from public, anon;
grant execute on function public.set_public_weather_enabled(boolean) to authenticated;

notify pgrst, 'reload schema';
