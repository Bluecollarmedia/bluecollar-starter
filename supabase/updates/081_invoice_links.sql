-- Update 81: invoices get the same private link and email as quotes and change orders.
--
-- "Email to Customer" on an issued invoice used to answer "Invoices are not emailed from here yet", and the owner had to
-- copy a PDF into a text. Now an invoice has its own share token, the public page (…/approve/<token>) can SHOW it
-- (read-only: respond_by_link still answers only quotes and change orders, so an invoice can never be "approved"), and the
-- send-document-email function emails the link. Deploy send-document-email again together with this update.
--
-- Safe to run more than once.

alter table public.invoices add column if not exists share_token text default public.new_share_token();
update public.invoices set share_token = public.new_share_token() where share_token is null;
create unique index if not exists invoices_share_token_key on public.invoices(share_token);

-- The public page's one read: now also finds an issued invoice by its token. Drafts are never shown.
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
    if v_doc is not null then
      v_kind := 'change_order';
    else
      select to_jsonb(i) into v_doc from public.invoices i where i.share_token = p_token and i.status <> 'draft';
      if v_doc is null then
        return null;
      end if;
      v_kind := 'invoice';
    end if;
  end if;
  if v_kind <> 'quote' and v_doc ? 'quote_id' then
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
      where e.document_id = (v_doc->>'id')::uuid and e.event_type in ('sent','approved','declined','expired','issued','voided')
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_shared_document(text) from public;
grant execute on function public.get_shared_document(text) to anon, authenticated;

notify pgrst, 'reload schema';
