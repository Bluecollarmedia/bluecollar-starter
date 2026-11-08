-- ============================================================================
-- Update 54 — run once in Supabase → SQL Editor, AFTER 008 (safe to run again). NOT run yet; read it before running.
--
-- A drawn signature on the approval link.
--  • quotes and change_orders get approved_signature: the customer's signature as SVG path text (not a picture file), saved
--    with the approval and printed on the approved PDF.
--  • respond_by_link gets a 5th argument, p_signature. It must be plain path text (only the letters M and L, numbers, dots,
--    minus signs, commas and spaces) and at most 20,000 characters, so nothing else can ever be stored or shown.
--  • The signature is optional at the database level so a website that has not been republished yet keeps working; the new
--    approval page requires it before it lets the customer approve.
--  • Declining ("Request changes") is unchanged: the note the customer writes is saved with it.
-- ============================================================================

alter table public.quotes add column if not exists approved_signature text;
alter table public.change_orders add column if not exists approved_signature text;

-- The lock that keeps a sent document's contents fixed must let the signature be saved with the approval (and once saved,
-- never changed). Same function as update 8 with approved_signature added to the columns that may change.
create or replace function public.lock_financial_document()
returns trigger language plpgsql as $$
declare
  status_cols text[] := array['status','sent_at','approved_at','approved_by','declined_at','declined_by',
                              'decline_reason','issued_at','voided_at','void_reason','updated_at',
                              'approved_name','share_token','approved_signature'];
  allowed text[];
begin
  if old.status = 'draft' then
    if TG_TABLE_NAME = 'invoices' then allowed := array['draft','issued'];
    else allowed := array['draft','sent'];
    end if;
  elsif TG_TABLE_NAME = 'invoices' then
    allowed := case old.status when 'issued' then array['issued','void'] else array[old.status] end;
  else
    allowed := case old.status
      when 'sent' then array['sent','approved','declined','expired']
      else array[old.status] end;
  end if;

  if not (new.status = any(allowed)) then
    raise exception 'This % is % and can''t be changed to %.', replace(rtrim(TG_TABLE_NAME, 's'), '_', ' '), old.status, new.status;
  end if;

  if old.status <> 'draft'
     and (to_jsonb(new) - status_cols) is distinct from (to_jsonb(old) - status_cols) then
    raise exception 'This document was already sent, so its contents can''t be changed. Make a new one instead.';
  end if;

  -- A saved signature is part of the record of the approval and is never changed.
  if old.status <> 'draft' and (to_jsonb(old) ->> 'approved_signature') is not null
     and (to_jsonb(new) ->> 'approved_signature') is distinct from (to_jsonb(old) ->> 'approved_signature') then
    raise exception 'The approval signature can''t be changed.';
  end if;
  return new;
end;
$$;

-- The old 4-argument version is replaced by the 5-argument one (p_signature has a default, so older callers still work).
drop function if exists public.respond_by_link(text, boolean, text, text);

create or replace function public.respond_by_link(
  p_token text, p_approve boolean, p_name text, p_note text default null, p_signature text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_kind text;
  v_id uuid;
  v_name text := nullif(left(trim(coalesce(p_name, '')), 120), '');
  v_sig text := nullif(trim(coalesce(p_signature, '')), '');
  hdr jsonb;
  res jsonb;
begin
  if p_token is null or length(p_token) < 32 then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  select id into v_id from public.quotes where share_token = p_token;
  if v_id is not null then
    v_kind := 'quote';
  else
    select id into v_id from public.change_orders where share_token = p_token;
    v_kind := 'change_order';
  end if;
  if v_id is null then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  if p_approve and (v_name is null or length(v_name) < 2) then
    return jsonb_build_object('success', false, 'error', 'name_required');
  end if;
  -- Only path text: it is later drawn inside an SVG, so nothing else may be stored.
  if v_sig is not null and (length(v_sig) > 20000 or v_sig !~ '^[ML0-9.,[:space:]-]+$') then
    return jsonb_build_object('success', false, 'error', 'bad_signature');
  end if;

  begin
    hdr := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    hdr := null;
  end;

  res := public.apply_document_response(v_kind, v_id, p_approve, p_note, null, v_name,
    jsonb_strip_nulls(jsonb_build_object(
      'via', 'link',
      'name', v_name,
      'signed', v_sig is not null,
      'ip', nullif(trim(split_part(coalesce(hdr->>'x-forwarded-for', ''), ',', 1)), ''),
      'user_agent', left(hdr->>'user-agent', 300))));

  if p_approve and v_sig is not null and coalesce((res->>'success')::boolean, false) then
    if v_kind = 'quote' then
      update public.quotes set approved_signature = v_sig where id = v_id;
    else
      update public.change_orders set approved_signature = v_sig where id = v_id;
    end if;
  end if;
  return res;
end;
$$;
revoke execute on function public.respond_by_link(text, boolean, text, text, text) from public;
grant execute on function public.respond_by_link(text, boolean, text, text, text) to anon, authenticated;
