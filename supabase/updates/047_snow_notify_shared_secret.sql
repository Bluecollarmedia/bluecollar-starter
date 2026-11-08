-- 047: optional shared secret between the database and the send-snow-notification function.
-- Needs: 031 (snow notifications) and 008 (app_settings). Safe to run twice. OPTIONAL hardening.
-- What it does: when a row with key 'snow_notify_secret' exists in app_settings, the database adds it as the
--   header x-snow-secret on each call to send-snow-notification. The function (updated in the same change) refuses
--   calls without the right header IF its SNOW_NOTIFY_SECRET setting is set. If neither side is set, nothing
--   changes (today's behaviour). If only one side is set, notifications are marked "unavailable" rather than lost
--   silently, so set both together.
-- app_settings has row-level security with no policies, so the secret is not readable from the app.
--
-- To switch it on (later, by you): pick a long random text, then
--   1) in Supabase -> Edge Functions -> Secrets add SNOW_NOTIFY_SECRET = that text and redeploy the function;
--   2) run:  insert into public.app_settings (key, value) values ('snow_notify_secret', 'that text')
--            on conflict (key) do update set value = excluded.value;
-- This file does not set any secret.

create or replace function public._snow_dispatch_notification(nid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  url text;
  secret text;
  hdr jsonb := jsonb_build_object('Content-Type', 'application/json');
begin
  if not exists (select 1 from public.snow_notification_deliveries where notification_id = nid and status = 'pending') then
    return;
  end if;
  select value into url from public.app_settings where key = 'functions_url';
  select value into secret from public.app_settings where key = 'snow_notify_secret';
  if secret is not null and secret <> '' then
    hdr := hdr || jsonb_build_object('x-snow-secret', secret);
  end if;
  begin
    if url is null then
      raise exception 'functions_url is not set';
    end if;
    perform net.http_post(
      url := url || '/send-snow-notification',
      body := jsonb_build_object('id', nid),
      headers := hdr
    );
  exception when others then
    update public.snow_notification_deliveries
       set status = 'unavailable', detail = 'Sender not set up: ' || left(sqlerrm, 200), attempted_at = now()
     where notification_id = nid and status = 'pending';
  end;
end;
$$;
revoke all on function public._snow_dispatch_notification(uuid) from public, anon, authenticated;
