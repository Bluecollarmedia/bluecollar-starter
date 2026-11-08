-- ============================================================================
-- Update 87 — run once in Supabase → SQL Editor (safe to run again). NOT run yet; read it before running.
--
-- Photos go to the customer by themselves. Until now every crew photo waited for the owner to approve it and tap "Send to customer", which
-- nobody can do in the middle of a storm. Now, the moment a crew lead completes a stop:
--   * its photos and videos are approved and shared with the property's customer, and the stop appears on the customer's Snow timeline;
--   * a photo or video the owner adds to that stop later is shared the same way.
-- The owner keeps control:
--   * a switch (snow_settings.auto_share_with_customers, ON by default, in Snow Mode's More) turns this off; with it off the old way applies
--     (approve in Photo review, then send);
--   * any photo can still be withdrawn from the customer afterward (update 33).
-- Stops that were already completed are not touched.
-- ============================================================================

alter table public.snow_settings add column if not exists auto_share_with_customers boolean not null default true;

create or replace function public._snow_auto_share_on(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select s.auto_share_with_customers from public.snow_settings s where s.company_id = cid), true)
$$;
revoke all on function public._snow_auto_share_on(uuid) from public, anon, authenticated;

-- A stop is completed: share its photos and release it to the customer.
create or replace function public._snow_auto_share_visit()
returns trigger language plpgsql security definer set search_path = public as $$
declare shared int;
begin
  if new.status <> 'completed' or old.status = 'completed' then return null; end if;
  if not public._snow_auto_share_on(new.company_id) then return null; end if;

  update public.snow_completion_media
     set review_status = 'approved', reviewed_at = now(), shared_at = now()
   where visit_id = new.id and review_status = 'pending';
  update public.snow_completion_media
     set shared_at = now()
   where visit_id = new.id and review_status = 'approved' and shared_at is null;
  get diagnostics shared = row_count;

  update public.snow_visits set customer_notified_at = coalesce(customer_notified_at, now()) where id = new.id;

  perform public.snow_log_event(new.company_id, 'visit.customer_update_sent', 'snow_visit', new.id, new.storm_id, new.route_id,
                                new.id, new.property_id, p_service => new.service,
                                p_after => jsonb_build_object('automatic', true));
  return null;
end;
$$;
drop trigger if exists snow_visits_auto_share on public.snow_visits;
create trigger snow_visits_auto_share after update of status on public.snow_visits
  for each row execute function public._snow_auto_share_visit();

-- A photo added to a stop that has already been released to the customer is released too.
create or replace function public._snow_auto_share_new_media()
returns trigger language plpgsql security definer set search_path = public as $$
declare v public.snow_visits;
begin
  select * into v from public.snow_visits where id = new.visit_id;
  if v.id is not null and v.status = 'completed' and v.customer_notified_at is not null and public._snow_auto_share_on(v.company_id) then
    new.review_status := 'approved';
    new.reviewed_at := coalesce(new.reviewed_at, now());
    new.shared_at := coalesce(new.shared_at, now());
  end if;
  return new;
end;
$$;
drop trigger if exists snow_completion_media_auto_share on public.snow_completion_media;
create trigger snow_completion_media_auto_share before insert on public.snow_completion_media
  for each row execute function public._snow_auto_share_new_media();

notify pgrst, 'reload schema';
