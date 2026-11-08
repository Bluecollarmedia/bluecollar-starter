/**
 * Edge Function: send-snow-notification
 *
 * Called by the database (update 031, trigger snow_visits_notify) when a snow
 * visit's arrival or completion creates a notification, and (update 082) when a storm is dispatched or a lead/crew
 * member is assigned to a route. It sends that
 * notification's pending channels and records what actually happened:
 *   push  → Expo push service, to the recipient's registered phones
 *   email → Resend, to the property contact's email
 * The in-app copy is already saved by the database before this runs.
 *
 * Results go to snow_notification_deliveries via snow_record_delivery:
 *   accepted     the provider took it (Expo ticket "ok" / Resend 200). Neither
 *                confirms it reached the phone or inbox; that would need Expo
 *                receipts or Resend webhooks, which aren't set up.
 *   failed       the provider refused it
 *   unavailable  nothing to send with (no phone registered, no RESEND_API_KEY)
 *
 * The request carries only the notification's id. The function claims it once
 * (snow_claim_notification, within 15 minutes of creation), so it can't be
 * used to send anything else or to send twice.
 *
 * Deploy:  supabase functions deploy send-snow-notification --no-verify-jwt
 *          (or paste this file into the dashboard editor as
 *          send-snow-notification and turn off "Enforce JWT verification")
 * Secrets: the same RESEND_API_KEY and NOTIFY_EMAIL_FROM as send-notification.
 * Optional: SNOW_NOTIFY_SECRET. When set, calls must send it as the x-snow-secret header (the database does this
 *           once SQL 047 is run and the same value is stored in app_settings as 'snow_notify_secret').
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';

// Self-contained (no ../_shared import) so it can be pasted into the dashboard.
const getServiceClient = () =>
  createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Db = ReturnType<typeof getServiceClient>;
interface SnowNotification {
  id: string;
  company_id: string;
  category: 'owner_alert' | 'customer' | 'employee';
  event: string;
  property_id: string | null;
  route_id?: string | null;
  visit_id: string | null;
  recipient_person_id: string | null;
  recipient_name: string | null;
  recipient_email: string | null;
  title: string;
  body: string;
}
type Outcome = { status: 'accepted' | 'failed' | 'unavailable'; ref?: string; detail?: string };

serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Optional shared secret (SQL 047). When SNOW_NOTIFY_SECRET is set here, only calls that carry it are accepted.
  const expected = Deno.env.get('SNOW_NOTIFY_SECRET');
  if (expected && req.headers.get('x-snow-secret') !== expected) return json({ error: 'unauthorized' }, 401);

  let id: string | undefined;
  try {
    id = (await req.json())?.id;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'bad_request' }, 400);

  const db = getServiceClient();
  const { data: claimed, error } = await db.rpc('snow_claim_notification', { p_id: id });
  if (error) return json({ error: error.message }, 500);
  const n = (claimed as SnowNotification[] | null)?.[0];
  if (!n) return json({ skipped: true });

  const { data: pending } = await db
    .from('snow_notification_deliveries')
    .select('channel')
    .eq('notification_id', n.id)
    .eq('status', 'pending');
  const channels = new Set((pending ?? []).map((d: { channel: string }) => d.channel));

  const results: Record<string, Outcome> = {};
  const run = async (channel: string, send: () => Promise<Outcome>) => {
    let out: Outcome;
    try {
      out = await send();
    } catch (e) {
      out = { status: 'failed', detail: e instanceof Error ? e.message : String(e) };
    }
    results[channel] = out;
    await db.rpc('snow_record_delivery', {
      p_notification_id: n.id,
      p_channel: channel,
      p_status: out.status,
      p_provider_ref: out.ref ?? null,
      p_detail: out.detail ?? null,
    });
  };

  await Promise.all([
    channels.has('push') ? run('push', () => sendPush(db, n)) : null,
    channels.has('email') ? run('email', () => sendEmail(db, n)) : null,
  ]);
  return json(results);
});

async function sendPush(db: Db, n: SnowNotification): Promise<Outcome> {
  if (!n.recipient_person_id) return { status: 'unavailable', detail: 'No app account' };
  const { data: tokens } = await db.from('push_tokens').select('token').eq('person_id', n.recipient_person_id);
  if (!tokens?.length) return { status: 'unavailable', detail: 'No phone registered for notifications' };

  const { data: who } = await db.from('people').select('language').eq('id', n.recipient_person_id).maybeSingle();
  const text = who?.language === 'es' ? spanishPush(n.title, n.body) : { title: n.title, body: n.body };
  const messages = tokens.map(({ token }: { token: string }) => ({
    to: token,
    title: text.title,
    body: text.body || undefined,
    sound: 'default',
    data: {
      eventType: `snow_${n.event.replace('.', '_')}`,
      // customer notices open their property; crew notices (update 82) open the route; owner alerts open the stop
      linkedEntityType: n.category === 'customer' ? 'snow_property' : n.category === 'employee' ? 'snow_route' : 'snow_visit',
      linkedEntityId: n.category === 'customer' ? n.property_id : n.category === 'employee' ? n.route_id : n.visit_id,
    },
  }));
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok) return { status: 'failed', detail: `Expo error ${res.status}` };

  const tickets: { status: string; id?: string; message?: string; details?: { error?: string } }[] = out?.data ?? [];
  // Forget phones that uninstalled the app or turned notifications off for good.
  const dead = tickets
    .map((t, i) => (t.status === 'error' && t.details?.error === 'DeviceNotRegistered' ? messages[i].to : null))
    .filter((t): t is string => !!t);
  if (dead.length) await db.from('push_tokens').delete().in('token', dead);

  const ok = tickets.filter((t) => t.status === 'ok');
  if (!ok.length) {
    return { status: 'failed', detail: tickets.map((t) => t.details?.error ?? t.message).filter(Boolean).join('; ') || 'No ticket' };
  }
  return {
    status: 'accepted',
    ref: ok.map((t) => t.id).filter(Boolean).join(','),
    detail: `Accepted for ${ok.length} of ${messages.length} phones`,
  };
}

async function sendEmail(db: Db, n: SnowNotification): Promise<Outcome> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) return { status: 'unavailable', detail: 'Email not set up (no RESEND_API_KEY)' };
  if (!n.recipient_email) return { status: 'unavailable', detail: 'No email address' };

  const { data: company } = await db.from('companies').select('name, phone').eq('id', n.company_id).maybeSingle();
  const companyName = company?.name || 'Brighton Lawn + Landscape';
  const html = `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#14263A;max-width:520px">
  <p style="font-size:18px;font-weight:600;margin:0 0 6px">${esc(n.title)}</p>
  <p style="font-size:15px;margin:0 0 18px;color:#3C4E60">${esc(n.body)}</p>
  <p style="font-size:12px;color:#7A8896;margin:0">${esc(companyName)}${company?.phone ? ` · ${esc(company.phone)}` : ''}</p>
</div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('NOTIFY_EMAIL_FROM') ?? `${companyName} <onboarding@resend.dev>`,
      to: [n.recipient_email],
      subject: `${n.title} · ${n.body}`,
      html,
    }),
  });
  if (!res.ok) return { status: 'failed', detail: `Resend error ${res.status}: ${(await res.text()).slice(0, 200)}` };
  const out = await res.json().catch(() => null);
  return { status: 'accepted', ref: out?.id };
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// ── Spanish push texts (same as _shared/pushSpanish.ts; this function is pasted by hand, so it carries its own copy) ──
const RULES: [RegExp, string][] = [
  [/^Please confirm your schedule$/, 'Confirma tu horario'],
  [/^(.+) (today|tomorrow|[A-Z][a-z]{2} \d{1,2}), full day\. Open the app to confirm\.$/, '$1 $2, todo el día. Abre la app para confirmar.'],
  [/^(.+) (today|tomorrow|[A-Z][a-z]{2} \d{1,2}), starts (.+)\. Open the app to confirm\.$/, '$1 $2, empieza a las $3. Abre la app para confirmar.'],
  [/^Check your progress$/, 'Revisa tu avance'],
  [/^Take a moment to check how the work at (.+) is going\.?$/, 'Tómate un momento para ver cómo va el trabajo en $1.'],
  [/^Storm dispatched: (.+)$/, 'Tormenta enviada: $1'],
  [/^You lead (.+) · (\d+) stops?\. Open My Route\.$/, 'Diriges $1 · $2 paradas. Abre Mi ruta.'],
  [/^You are on the crew of (.+) · (\d+) stops?\.$/, 'Estás en el equipo de $1 · $2 paradas.'],
  [/^You now lead (.+)$/, 'Ahora diriges $1'],
  [/^You were added to (.+)$/, 'Te agregaron a $1'],
  [/^(.+)\. Open My Route\.$/, '$1. Abre Mi ruta.'],
  [/^Our crew has arrived$/, 'Nuestro equipo ya llegó'],
  [/^(.+) completed$/, '$1 completado'],
  [/^(.+) at (.+)$/, '$1 en $2'],
];

function spanishPush(title: string, body: string): { title: string; body: string } {
  const tr = (s: string) => {
    for (const [re, to] of RULES) if (re.test(s)) return s.replace(re, to);
    return s;
  };
  return { title: tr(title), body: body ? tr(body) : body };
}
