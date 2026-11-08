/**
 * Edge Function: send-document-email
 *
 * The owner taps "Email to customer" on a sent quote, change order or issued invoice (update 81). This emails the customer
 * a short message with a "View quote" / "View invoice" button that opens the private page (…/approve/<token>). Nothing is
 * emailed for a draft.
 *
 * Who may call it: a signed-in owner or admin of the document's company. The recipient is the project's customer, or an
 * address the owner typed (`email`) when the customer has none on file.
 *
 * Deploy:  supabase functions deploy send-document-email
 *          (or Supabase dashboard → Edge Functions → Deploy a new function → Via Editor; keep "Enforce JWT verification" ON)
 * Secrets (Supabase → Edge Functions → Secrets):
 *   RESEND_API_KEY     — the Resend key (the same one the SMTP settings use is fine)
 *   NOTIFY_EMAIL_FROM  — e.g. "Brighton Lawn + Landscape <noreply@brightonlawn.com>" (a domain verified in Resend)
 *   APP_WEB_URL        — the web app's address, e.g. https://app.brightonlawn.com
 * Replies go to the company's own email address (Company settings), else info@brightonlawn.com.
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

/** The email's words. Kept in one place so the app and the function say the same thing. */
export function buildMessage(o: { customerName: string; kind: 'quote' | 'change_order' | 'invoice'; totalText: string; dateText: string; contactEmail: string; company: string; dueText?: string }) {
  const what = o.kind === 'quote' ? 'quote' : o.kind === 'invoice' ? 'invoice' : 'change order';
  const hello = o.customerName ? `Hi ${o.customerName},` : 'Hello,';
  const body = o.kind === 'quote'
    ? `Thank you for asking us to quote your project. The quote total is ${o.totalText} as of ${o.dateText}.`
    : o.kind === 'invoice'
      ? `Here is your invoice. The invoice total is ${o.totalText} as of ${o.dateText}.${o.dueText ? ` Payment is due by ${o.dueText}.` : ''}`
      : `Here is the change order for your project. The change order total is ${o.totalText} as of ${o.dateText}.`;
  const closing = `If you have any questions or concerns regarding this ${what}, please don't hesitate to get in touch with ${o.contactEmail}.`;
  return { what, hello, body, closing, sign: `Sincerely,\n${o.company}` };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) return reply({ error: 'email_not_configured' }, 503);

  try {
    // Who is asking.
    const auth = req.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return reply({ error: 'sign_in_required' }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u.user) return reply({ error: 'sign_in_required' }, 401);
    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: me } = await db.from('people').select('id').eq('user_id', u.user.id).maybeSingle();
    if (!me) return reply({ error: 'sign_in_required' }, 401);

    const body = await req.json();
    const kind = ['change_order', 'quote', 'invoice'].includes(body.kind) ? (body.kind as 'change_order' | 'quote' | 'invoice') : null;
    const id = typeof body.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
    if (!kind || !id) return reply({ error: 'bad_request' }, 400);

    const table = kind === 'quote' ? 'quotes' : kind === 'invoice' ? 'invoices' : 'change_orders';
    const { data: doc } = await db
      .from(table)
      .select(`id, number, total, share_token, project_id, company_id, status, customer_id${kind === 'invoice' ? ', issued_at, due_date' : ', sent_at'}`)
      .eq('id', id).maybeSingle();
    if (!doc) return reply({ error: 'not_found' }, 404);

    // Only the owner or an admin of that company.
    const { data: member } = await db.from('company_members').select('role')
      .eq('company_id', doc.company_id).eq('person_id', me.id).eq('status', 'active').maybeSingle();
    if (!member || !['owner', 'admin'].includes(member.role)) return reply({ error: 'not_allowed' }, 403);
    if (doc.status === 'draft' || !doc.share_token) return reply({ error: 'not_sent_yet' }, 409);
    if (kind === 'invoice' && doc.status === 'void') return reply({ error: 'not_sent_yet' }, 409);

    const [{ data: project }, { data: company }] = await Promise.all([
      db.from('projects').select('name, customer_id').eq('id', doc.project_id).maybeSingle(),
      db.from('companies').select('name, email').eq('id', doc.company_id).maybeSingle(),
    ]);
    // The customer the DOCUMENT was made for (what the customer sees in it; an invoice can bill someone other than the project's customer), not whoever the project points at now.
    const customerId = doc.customer_id ?? project?.customer_id;
    const { data: customer } = customerId
      ? await db.from('people').select('email, first_name, last_name').eq('id', customerId).maybeSingle()
      : { data: null };

    const typed = typeof body.email === 'string' ? body.email.trim() : '';
    if (typed && !looksLikeEmail(typed)) return reply({ error: 'bad_email' }, 400);
    const to = typed || customer?.email || '';
    if (!to) return reply({ error: 'no_email' }, 422);

    const webUrl = (Deno.env.get('APP_WEB_URL') ?? 'https://app.brightonlawn.com').replace(/\/+$/, '');
    const link = `${webUrl}/approve/${doc.share_token}`;
    const companyName = company?.name ?? 'Brighton Lawn + Landscape';
    const contact = company?.email || 'info@brightonlawn.com';
    const total = Number(doc.total).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    const date = new Date(doc.sent_at ?? doc.issued_at ?? Date.now()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
    const dueText = kind === 'invoice' && doc.due_date
      ? new Date(`${doc.due_date}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
      : undefined;
    const customerName = typed && !customer?.email ? '' : [customer?.first_name, customer?.last_name].filter(Boolean).join(' ').trim();
    const m = buildMessage({ customerName, kind, totalText: total, dateText: date, contactEmail: contact, company: companyName, dueText });

    const html = `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1B3A2D;max-width:520px;line-height:1.55">
  <p style="margin:0 0 14px">${esc(m.hello)}</p>
  <p style="margin:0 0 14px">${esc(m.body)}</p>
  <p style="margin:0 0 20px">${esc(m.closing)}</p>
  <p style="margin:0 0 24px"><a href="${esc(link)}" style="background:#2D5A43;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">View ${esc(m.what)}</a></p>
  <p style="margin:0;white-space:pre-line">${esc(m.sign)}</p>
</div>`;
    const text = `${m.hello}\n\n${m.body}\n\n${m.closing}\n\nView ${m.what}: ${link}\n\n${m.sign}`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('NOTIFY_EMAIL_FROM') ?? 'Brighton Lawn + Landscape <noreply@brightonlawn.com>',
        to: [to],
        reply_to: contact,
        subject: `Your ${m.what} ${doc.number} from ${companyName}`,
        html,
        text,
      }),
    });
    if (!res.ok) return reply({ error: 'send_failed', detail: (await res.text()).slice(0, 200) }, 502);
    return reply({ ok: true, to });
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : 'Something went wrong' }, 500);
  }
});
