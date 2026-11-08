/**
 * notify-request — emails the owner (and admins) about a NEW service request (update 118).
 *
 * The app calls it right after submit_service_request, with the new request's id. Anyone can call it (visitors are not signed in), so it
 * only ever emails a request that is less than 15 minutes old and has not been emailed yet, and it emails only the company's own owner and
 * admins. It never returns the request's details. Deploy with "Verify JWT" OFF. One file on purpose (no _shared imports): it is deployed by
 * pasting it into the Supabase website.
 *
 * Secrets (already set for send-document-email): RESEND_API_KEY, NOTIFY_EMAIL_FROM.
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
const FRESH_MS = 15 * 60 * 1000;

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((v ?? '').trim());

/** The email's words, kept in one place. */
export function buildRequestEmail(r: { name: string; town: string; property_type: string; services: string[]; details: string; phone: string; email: string; created_at: string }) {
  const when = new Date(r.created_at).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  const kind = r.property_type === 'commercial' ? 'Commercial' : 'Residential';
  const lines = [
    `Name: ${r.name}`,
    `Phone: ${r.phone}`,
    `Email: ${r.email || '(none given)'}`,
    `Town / ZIP: ${r.town}`,
    `Property: ${kind}`,
    `Services: ${r.services.join(', ')}`,
    `Details: ${r.details || '(none)'}`,
    `Sent: ${when}`,
  ];
  return {
    subject: `New service request: ${r.name} (${r.town})`,
    text: `A new service request came in through the app.\n\n${lines.join('\n')}\n\nOpen the app → Requests to mark it contacted or done.`,
    lines,
  };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) return reply({ error: 'email_not_configured' }, 503);

  try {
    const body = await req.json().catch(() => ({}));
    const id = typeof body.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
    if (!id) return reply({ error: 'bad_request' }, 400);

    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: r } = await db.from('service_requests')
      .select('id, company_id, name, town, property_type, services, details, phone, email, created_at, emailed_at')
      .eq('id', id).maybeSingle();
    // Unknown, old, or already emailed: say "ok" and do nothing (never a hint about what exists).
    if (!r || r.emailed_at || Date.now() - new Date(r.created_at).getTime() > FRESH_MS) return reply({ ok: true, sent: 0 });

    // Claim it first, so two calls at once never send two emails.
    const { data: claimed } = await db.from('service_requests').update({ emailed_at: new Date().toISOString() }).eq('id', id).is('emailed_at', null).select('id');
    if (!claimed || claimed.length === 0) return reply({ ok: true, sent: 0 });

    const { data: members } = await db.from('company_members').select('person_id, role')
      .eq('company_id', r.company_id).eq('status', 'active').in('role', ['owner', 'admin']);
    const ids = (members ?? []).map((m) => m.person_id);
    const { data: people } = ids.length ? await db.from('people').select('id, email').in('id', ids) : { data: [] };
    const to = Array.from(new Set((people ?? []).map((p) => (p.email ?? '').trim().toLowerCase()).filter(looksLikeEmail)));
    if (to.length === 0) return reply({ ok: true, sent: 0, reason: 'no_owner_email' });

    const m = buildRequestEmail(r);
    const html = `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1B3A2D;max-width:520px;line-height:1.55">
  <p style="margin:0 0 14px;font-size:17px;font-weight:700">New service request</p>
  <p style="margin:0 0 14px">A new request came in through the app.</p>
  <table style="border-collapse:collapse;margin:0 0 18px">${m.lines.map((l) => { const i = l.indexOf(':'); return `<tr><td style="padding:3px 12px 3px 0;color:#5B6B62;white-space:nowrap;vertical-align:top">${esc(l.slice(0, i))}</td><td style="padding:3px 0;white-space:pre-line">${esc(l.slice(i + 2))}</td></tr>`; }).join('')}</table>
  <p style="margin:0 0 6px"><a href="tel:${esc(r.phone.replace(/[^+\d]/g, ''))}" style="color:#2D5A43;font-weight:600">Call ${esc(r.name)}</a></p>
  <p style="margin:0;color:#5B6B62">Open the app → Requests to mark it contacted or done.</p>
</div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('NOTIFY_EMAIL_FROM') ?? 'Brighton Lawn + Landscape <noreply@brightonlawn.com>',
        to,
        reply_to: looksLikeEmail(r.email) ? r.email : undefined,
        subject: m.subject,
        html,
        text: m.text,
      }),
    });
    if (!res.ok) {
      // Let a later call try again.
      await db.from('service_requests').update({ emailed_at: null }).eq('id', id);
      return reply({ error: 'send_failed', detail: (await res.text()).slice(0, 200) }, 502);
    }
    return reply({ ok: true, sent: to.length });
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : 'Something went wrong' }, 500);
  }
});
