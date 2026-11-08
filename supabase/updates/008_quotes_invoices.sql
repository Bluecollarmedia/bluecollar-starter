-- ============================================================================
-- Update 8 — run once in Supabase → SQL Editor (safe to run again).
--  • Quotes, change orders and invoices for each project.
--  • Line items are saved inside each document (line_items), so a document
--    always re-prints exactly as it was saved.
--  • Once a document leaves Draft, its contents and price are locked by the
--    database. Only its status can move forward (sent → approved, issued →
--    void, …). To change a sent quote, make a new one.
--  • financial_events keeps the history: created, sent, approved, declined,
--    issued, voided — who and when.
--  • Access: only the owner/admin can see or change these. A project's
--    customer can see that project's documents once they're sent/issued
--    (never drafts), and can approve or decline a sent quote or change order
--    through respond_to_financial_document(). Workers can't see them.
--  • Approval links: each quote / change order has a private link the owner
--    can text or email. The customer opens it in any browser (no login),
--    types their name and approves (respond_by_link). Name, time, IP and
--    browser are recorded.
--  • Push notifications: phones register in push_tokens, and every new
--    in-app notification is pushed to the person's phone through the
--    send-notification Edge Function. Approved/declined quotes are also
--    emailed to the owner. Needs pg_net (Database → Extensions) and the
--    Edge Function deployed: see supabase/functions/send-notification.
-- ============================================================================

-- ── Quotes ──────────────────────────────────────────────────────────────────
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  customer_id uuid references public.people(id) on delete set null,
  number text not null,
  title text,
  status text not null default 'draft' check (status in ('draft','sent','approved','declined','expired')),
  line_items jsonb not null default '[]'::jsonb,
  tax_rate numeric(6,3) not null default 0 check (tax_rate >= 0 and tax_rate < 100),
  subtotal numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  notes text,
  exclusions text,
  terms text,
  issue_date date not null default current_date,
  valid_until date,
  -- Company, customer and property details frozen when the quote is sent.
  snapshot jsonb,
  sent_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.people(id) on delete set null,
  declined_at timestamptz,
  declined_by uuid references public.people(id) on delete set null,
  decline_reason text,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, number)
);
create index if not exists idx_quotes_project on public.quotes(project_id, created_at);

-- ── Change orders ───────────────────────────────────────────────────────────
create table if not exists public.change_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  quote_id uuid references public.quotes(id) on delete restrict,
  customer_id uuid references public.people(id) on delete set null,
  number text not null,
  title text,
  description text,
  status text not null default 'draft' check (status in ('draft','sent','approved','declined')),
  line_items jsonb not null default '[]'::jsonb,
  tax_rate numeric(6,3) not null default 0 check (tax_rate >= 0 and tax_rate < 100),
  subtotal numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  notes text,
  terms text,
  issue_date date not null default current_date,
  snapshot jsonb,
  sent_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.people(id) on delete set null,
  declined_at timestamptz,
  declined_by uuid references public.people(id) on delete set null,
  decline_reason text,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, number)
);
create index if not exists idx_change_orders_project on public.change_orders(project_id, created_at);

-- ── Invoices ────────────────────────────────────────────────────────────────
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  quote_id uuid references public.quotes(id) on delete restrict,
  change_order_ids uuid[] not null default '{}',
  customer_id uuid references public.people(id) on delete set null,
  number text not null,
  title text,
  status text not null default 'draft' check (status in ('draft','issued','void')),
  line_items jsonb not null default '[]'::jsonb,
  tax_rate numeric(6,3) not null default 0 check (tax_rate >= 0 and tax_rate < 100),
  subtotal numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  notes text,
  payment_instructions text,
  invoice_date date not null default current_date,
  due_date date,
  snapshot jsonb,
  issued_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, number)
);
create index if not exists idx_invoices_project on public.invoices(project_id, created_at);

-- ── History ─────────────────────────────────────────────────────────────────
create table if not exists public.financial_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  document_type text not null check (document_type in ('quote','change_order','invoice')),
  document_id uuid not null,
  event_type text not null check (event_type in ('created','sent','approved','declined','expired','issued','voided')),
  actor_id uuid references public.people(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_financial_events_doc on public.financial_events(document_id, created_at);

-- ── Approval links ──────────────────────────────────────────────────────────
-- Every quote and change order gets a long random link token, so the owner
-- can text or email a link (…/approve/<token>) the customer opens without
-- the app or a login. Whoever has the link can view and answer that one
-- document, nothing else.
create or replace function public.new_share_token()
returns text language sql volatile as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

alter table public.quotes add column if not exists share_token text default public.new_share_token();
alter table public.quotes add column if not exists approved_name text;
alter table public.change_orders add column if not exists share_token text default public.new_share_token();
alter table public.change_orders add column if not exists approved_name text;
create unique index if not exists quotes_share_token_key on public.quotes(share_token);
create unique index if not exists change_orders_share_token_key on public.change_orders(share_token);
-- Who answered through a link (typed name, IP address, browser).
alter table public.financial_events add column if not exists metadata jsonb;

-- company_id comes from the project, like the other project tables
do $$
declare t text;
begin
  foreach t in array array['quotes','change_orders','invoices','financial_events'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_company', t);
    execute format('create trigger %I before insert or update of project_id on public.%I for each row execute function public.set_company_from_project()', t || '_company', t);
  end loop;
  foreach t in array array['quotes','change_orders','invoices'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

-- ── Lock documents once they leave Draft ───────────────────────────────────
-- After a document is sent/issued only these columns may change, and the
-- status may only move forward.
create or replace function public.lock_financial_document()
returns trigger language plpgsql as $$
declare
  status_cols text[] := array['status','sent_at','approved_at','approved_by','declined_at','declined_by',
                              'decline_reason','issued_at','voided_at','void_reason','updated_at',
                              'approved_name','share_token'];
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
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['quotes','change_orders','invoices'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_lock', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.lock_financial_document()', t || '_lock', t);
  end loop;
end $$;

-- ── Access rules ────────────────────────────────────────────────────────────
alter table public.quotes enable row level security;
alter table public.change_orders enable row level security;
alter table public.invoices enable row level security;
alter table public.financial_events enable row level security;

do $$
declare t text;
begin
  foreach t in array array['quotes','change_orders'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select using (
      public.is_staff(company_id) or (status <> ''draft'' and public.is_project_customer(project_id)))', t || '_select', t);
  end loop;
  foreach t in array array['quotes','change_orders','invoices'] loop
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert with check (
      public.is_staff((select company_id from public.projects where id = project_id)))', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update using (public.is_staff(company_id)) with check (public.is_staff(company_id))', t || '_update', t);
    -- Only drafts can be deleted; sent documents stay on record.
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete using (public.is_staff(company_id) and status = ''draft'')', t || '_delete', t);
  end loop;
end $$;

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices for select using (
  public.is_staff(company_id) or (status = 'issued' and public.is_project_customer(project_id))
);

drop policy if exists financial_events_select on public.financial_events;
create policy financial_events_select on public.financial_events for select using (
  public.is_staff(company_id)
  or (public.is_project_customer(project_id) and event_type <> 'created')
);
drop policy if exists financial_events_insert on public.financial_events;
create policy financial_events_insert on public.financial_events for insert with check (
  public.is_staff((select company_id from public.projects where id = project_id))
);

-- ── Customer approves or declines a sent quote / change order ──────────────
-- One place that records an answer, used by both the customer app and the
-- approval link. Not callable directly.
create or replace function public.apply_document_response(
  p_type text, p_id uuid, p_approve boolean, p_note text, p_actor uuid, p_name text, p_meta jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  doc record;
  label text;
  v_note text := nullif(left(trim(coalesce(p_note, '')), 1000), '');
  v_name text := nullif(left(trim(coalesce(p_name, '')), 120), '');
  project_name text;
  staff record;
begin
  if p_type = 'quote' then
    select id, company_id, project_id, status, number, valid_until into doc from public.quotes where id = p_id for update;
    label := 'Quote';
  elsif p_type = 'change_order' then
    select id, company_id, project_id, status, number, null::date as valid_until into doc from public.change_orders where id = p_id for update;
    label := 'Change order';
  else
    return jsonb_build_object('success', false, 'error', 'invalid_type');
  end if;

  if not found then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  if doc.status <> 'sent' then
    return jsonb_build_object('success', false, 'error', 'not_open', 'status', doc.status);
  end if;
  if p_approve and doc.valid_until is not null and doc.valid_until < current_date then
    return jsonb_build_object('success', false, 'error', 'expired');
  end if;

  if p_type = 'quote' then
    if p_approve then
      update public.quotes set status = 'approved', approved_at = now(), approved_by = p_actor, approved_name = v_name where id = p_id;
    else
      update public.quotes set status = 'declined', declined_at = now(), declined_by = p_actor, decline_reason = v_note where id = p_id;
    end if;
  else
    if p_approve then
      update public.change_orders set status = 'approved', approved_at = now(), approved_by = p_actor, approved_name = v_name where id = p_id;
    else
      update public.change_orders set status = 'declined', declined_at = now(), declined_by = p_actor, decline_reason = v_note where id = p_id;
    end if;
  end if;

  insert into public.financial_events (company_id, project_id, document_type, document_id, event_type, actor_id, note, metadata)
  values (doc.company_id, doc.project_id, p_type, p_id,
          case when p_approve then 'approved' else 'declined' end, p_actor, v_note, p_meta);

  -- Alert the owner/admins (in the app, by push, and by email for these two events)
  select name into project_name from public.projects where id = doc.project_id;
  for staff in
    select person_id from public.company_members
    where company_id = doc.company_id and role in ('owner','admin') and status = 'active'
  loop
    insert into public.app_notifications (company_id, recipient_id, event_type, title, body, linked_entity_type, linked_entity_id, metadata)
    values (doc.company_id, staff.person_id,
            case when p_approve then 'quote_approved' else 'quote_declined' end,
            label || ' ' || doc.number || case when p_approve then ' approved' else ' declined' end,
            concat_ws(' · ', case when v_name is not null then 'By ' || v_name end, nullif(project_name, '')),
            p_type, p_id::text,
            jsonb_strip_nulls(jsonb_build_object('name', v_name, 'note', v_note)));
  end loop;

  return jsonb_build_object('success', true);
end;
$$;
revoke execute on function public.apply_document_response(text, uuid, boolean, text, uuid, text, jsonb) from public, anon, authenticated;

-- The signed-in customer answers in the app.
create or replace function public.respond_to_financial_document(
  p_type text, p_id uuid, p_approve boolean, p_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.my_person_id();
  proj uuid;
  me_name text;
begin
  if p_type = 'quote' then
    select project_id into proj from public.quotes where id = p_id;
  elsif p_type = 'change_order' then
    select project_id into proj from public.change_orders where id = p_id;
  else
    return jsonb_build_object('success', false, 'error', 'invalid_type');
  end if;
  if me is null or proj is null or not public.is_project_customer(proj) then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  select nullif(trim(first_name || ' ' || last_name), '') into me_name from public.people where id = me;
  return public.apply_document_response(p_type, p_id, p_approve, p_note, me, me_name, jsonb_build_object('via', 'app'));
end;
$$;
revoke execute on function public.respond_to_financial_document(text, uuid, boolean, text) from public, anon;
grant execute on function public.respond_to_financial_document(text, uuid, boolean, text) to authenticated;

-- Approval link: find the document a link points to. Drafts are never shown.
create or replace function public.get_shared_document(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_kind text;
  v_doc jsonb;
  v_quote_number text;
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;
  select to_jsonb(q) into v_doc from public.quotes q where q.share_token = p_token and q.status <> 'draft';
  if v_doc is not null then
    v_kind := 'quote';
  else
    select to_jsonb(c) into v_doc from public.change_orders c where c.share_token = p_token and c.status <> 'draft';
    if v_doc is null then
      return null;
    end if;
    v_kind := 'change_order';
    select number into v_quote_number from public.quotes where id = (v_doc->>'quote_id')::uuid;
  end if;

  return jsonb_build_object(
    'kind', v_kind,
    'document', v_doc - 'created_by' - 'approved_by' - 'declined_by',
    'quote_number', v_quote_number,
    'project_name', (select name from public.projects where id = (v_doc->>'project_id')::uuid),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event_type', e.event_type,
               'created_at', e.created_at,
               'name', coalesce(e.metadata->>'name', nullif(trim(p.first_name || ' ' || p.last_name), '')))
             order by e.created_at)
      from public.financial_events e
      left join public.people p on p.id = e.actor_id
      where e.document_id = (v_doc->>'id')::uuid and e.event_type in ('sent','approved','declined','expired')
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.get_shared_document(text) from public;
grant execute on function public.get_shared_document(text) to anon, authenticated;

-- Approval link: the customer answers. A typed name is required to approve;
-- it's recorded with the time, IP address and browser.
create or replace function public.respond_by_link(
  p_token text, p_approve boolean, p_name text, p_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_kind text;
  v_id uuid;
  v_name text := nullif(left(trim(coalesce(p_name, '')), 120), '');
  hdr jsonb;
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

  begin
    hdr := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    hdr := null;
  end;

  return public.apply_document_response(v_kind, v_id, p_approve, p_note, null, v_name,
    jsonb_strip_nulls(jsonb_build_object(
      'via', 'link',
      'name', v_name,
      'ip', nullif(trim(split_part(coalesce(hdr->>'x-forwarded-for', ''), ',', 1)), ''),
      'user_agent', left(hdr->>'user-agent', 300))));
end;
$$;
revoke execute on function public.respond_by_link(text, boolean, text, text) from public;
grant execute on function public.respond_by_link(text, boolean, text, text) to anon, authenticated;

-- ── Push notifications ──────────────────────────────────────────────────────
-- Every in-app notification (app_notifications) is also sent as a phone push
-- to the people it's for. Phones register their Expo push token below; a
-- trigger asks the send-notification Edge Function to deliver each new
-- notification. Approved/declined quotes are also emailed to the owner.
create table if not exists public.push_tokens (
  token text primary key,
  person_id uuid not null references public.people(id) on delete cascade,
  platform text,
  updated_at timestamptz not null default now()
);
create index if not exists idx_push_tokens_person on public.push_tokens(person_id);
alter table public.push_tokens enable row level security;
drop policy if exists push_tokens_own on public.push_tokens;
create policy push_tokens_own on public.push_tokens for select using (person_id = public.my_person_id());

-- A phone belongs to whoever signed in on it last.
create or replace function public.register_push_token(p_token text, p_platform text default null)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := public.my_person_id();
begin
  if me is null or p_token is null or length(p_token) > 300 then
    return;
  end if;
  insert into public.push_tokens (token, person_id, platform, updated_at)
  values (p_token, me, left(p_platform, 20), now())
  on conflict (token) do update set person_id = excluded.person_id, platform = excluded.platform, updated_at = now();
end;
$$;
revoke execute on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;

create or replace function public.unregister_push_token(p_token text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_tokens where token = p_token and person_id = public.my_person_id();
$$;
revoke execute on function public.unregister_push_token(text) from public, anon;
grant execute on function public.unregister_push_token(text) to authenticated;

alter table public.app_notifications add column if not exists pushed_at timestamptz;

-- Where the Edge Functions live. Change this if the Supabase project changes.
create table if not exists public.app_settings (key text primary key, value text not null);
alter table public.app_settings enable row level security; -- no policies: server-only
insert into public.app_settings (key, value)
values ('functions_url', 'https://YOUR-PROJECT-REF.supabase.co/functions/v1')
on conflict (key) do nothing;

-- pg_net lets the database call the Edge Function.
do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net is not available: push notifications will not be sent (%).', sqlerrm;
end $$;

create or replace function public.push_app_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare url text;
begin
  -- Only worth a call if the person has a phone registered or it's an emailed event.
  if not exists (select 1 from public.push_tokens where person_id = new.recipient_id)
     and new.event_type not in ('quote_approved','quote_declined') then
    return new;
  end if;
  select value into url from public.app_settings where key = 'functions_url';
  if url is null then
    return new;
  end if;
  begin
    -- Only the id is sent; the function reads the notification itself and
    -- sends each one once, so the call can't be used to send anything else.
    perform net.http_post(
      url := url || '/send-notification',
      body := jsonb_build_object('id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
  exception when others then
    -- Never block the in-app notification because a push couldn't be queued.
    raise notice 'push not queued: %', sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists app_notifications_push on public.app_notifications;
create trigger app_notifications_push after insert on public.app_notifications
  for each row execute function public.push_app_notification();

-- ── Live updates ────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['quotes','change_orders','invoices','financial_events'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
