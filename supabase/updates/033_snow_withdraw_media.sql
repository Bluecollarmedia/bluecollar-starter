-- ============================================================================
-- 033 · Snow Mode: the owner can withdraw a photo that was sent to a customer
--
-- Run this in the Supabase SQL Editor AFTER update 030 (and 032). It is safe
-- to run again: it only adds columns and replaces functions and policies.
--
-- Until now a photo, once sent, was locked forever. Now the owner/admin can
-- WITHDRAW it:
--  • it disappears from the customer's Snow updates and the customer can no
--    longer open the file (new signed links are refused);
--  • nothing is deleted. The row, the file, who sent it and who withdrew it
--    and when all stay, and 'media.withdrawn' is written to the activity log;
--  • a withdrawn photo can't be sent again. (Add a new photo instead.)
--
-- A customer who already looked at or saved the photo still has it. This
-- can't be undone on their phone.
--
-- Nothing here touches Landscaping.
-- ============================================================================

alter table public.snow_completion_media add column if not exists withdrawn_at timestamptz;
alter table public.snow_completion_media add column if not exists withdrawn_by uuid references public.people(id) on delete set null;

-- Sent media stays sent, with one exception: it can be withdrawn, once.
create or replace function public.snow_media_share_guard()
returns trigger language plpgsql as $$
begin
  -- A withdrawn photo is final.
  if old.withdrawn_at is not null then
    if new.withdrawn_at is distinct from old.withdrawn_at
       or new.withdrawn_by is distinct from old.withdrawn_by
       or new.shared_at is distinct from old.shared_at
       or new.review_status <> old.review_status then
      raise exception 'This photo was withdrawn and can''t be changed.';
    end if;
    return new;
  end if;

  if old.shared_at is not null then
    if new.shared_at is distinct from old.shared_at then
      raise exception 'This photo was already sent to the customer and can''t be changed.';
    end if;
    if new.review_status <> 'approved' and new.withdrawn_at is null then
      raise exception 'This photo was already sent to the customer. Withdraw it instead of hiding it.';
    end if;
  end if;

  if new.withdrawn_at is not null and old.shared_at is null then
    raise exception 'Only a photo that was sent to the customer can be withdrawn. Hide it instead.';
  end if;
  if new.shared_at is not null and new.review_status <> 'approved' and new.withdrawn_at is null then
    raise exception 'Approve a photo before sending it to the customer.';
  end if;
  return new;
end;
$$;

-- ── Owner/admin: withdraw ───────────────────────────────────────────────────

create or replace function public.snow_withdraw_media(p_media_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare m public.snow_completion_media;
begin
  select * into m from public.snow_completion_media where id = p_media_id;
  if m.id is null or not public.is_staff(m.company_id) then raise exception 'Photo not found.'; end if;
  if m.withdrawn_at is not null then return; end if;  -- double tap
  if m.shared_at is null then
    raise exception 'This photo was never sent to the customer. Hide it instead.';
  end if;

  update public.snow_completion_media
     set review_status = 'hidden', withdrawn_at = now(), withdrawn_by = public.my_person_id(),
         reviewed_by = public.my_person_id(), reviewed_at = now()
   where id = m.id;

  perform public.snow_log_event(m.company_id, 'media.withdrawn', 'snow_completion_media', m.id, m.storm_id, m.route_id,
                                m.visit_id, m.property_id, p_service => m.service,
                                p_note => nullif(trim(coalesce(p_reason, '')), ''));
end;
$$;

revoke all on function public.snow_withdraw_media(uuid, text) from public;
grant execute on function public.snow_withdraw_media(uuid, text) to authenticated;

-- ── Customers no longer see withdrawn media ─────────────────────────────────

create or replace function public.snow_customer_updates()
returns table (
  visit_id uuid, property_name text, service text, completed_at timestamptz, media jsonb
)
language sql stable security definer set search_path = public as $$
  select v.id, v.property_name, v.service, v.completed_at,
         coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'file_key', m.file_key) order by m.created_at)
                     from public.snow_completion_media m
                    where m.visit_id = v.id and m.shared_at is not null and m.withdrawn_at is null), '[]'::jsonb)
    from public.snow_visits v
   where v.status = 'completed'
     and v.customer_notified_at is not null
     and exists (select 1 from public.snow_property_contacts c
                  where c.property_id = v.property_id and c.person_id = public.my_person_id() and c.removed_at is null)
   order by v.completed_at desc
   limit 100
$$;
revoke all on function public.snow_customer_updates() from public;
grant execute on function public.snow_customer_updates() to authenticated;

drop policy if exists snow_media_completion_customer_read on storage.objects;
create policy snow_media_completion_customer_read on storage.objects for select to authenticated
  using (
    bucket_id = 'snow-media'
    and (storage.foldername(name))[2] = 'completion'
    and exists (
      select 1 from public.snow_completion_media m
      join public.snow_property_contacts c on c.property_id = m.property_id
      where m.file_key = name and m.shared_at is not null and m.withdrawn_at is null
        and c.person_id = public.my_person_id() and c.removed_at is null
    )
  );
