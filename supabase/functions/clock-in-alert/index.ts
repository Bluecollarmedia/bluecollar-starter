/**
 * Edge Function: clock-in-alert
 *
 * When a worker clocks in away from the owner's yard (or the phone could not give a location), the app calls this once, right after the
 * clock-in. It emails the owner exactly where the worker clocked in from. The worker is never blocked: clocking in always works. Nothing
 * is emailed when the worker is at the yard, when no yard is set, or when the owner switched alerts off (Settings > Yard and clock-in alerts).
 *
 * Who may call it: the signed-in worker whose workday it is. The function trusts the database record (update 107), not the app: it reads
 * where the clock-in was recorded and whether that is outside the yard, so the app cannot talk it into sending or not sending.
 *
 * Deploy:  supabase functions deploy clock-in-alert
 *          (or Supabase dashboard → Edge Functions → Deploy a new function → Via Editor; keep "Enforce JWT verification" ON)
 * Secrets (the same ones send-document-email uses): RESEND_API_KEY, NOTIFY_EMAIL_FROM.
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

/** "850 ft" or "1.4 mi": how far from the yard, in words a person reads. */
export function distanceText(meters: number): string {
  const ft = meters * 3.28084;
  if (ft < 1000) return `${Math.max(10, Math.round(ft / 10) * 10)} ft`;
  const mi = meters / 1609.344;
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
}

export interface AlertInput {
  worker: string;
  clockInAtIso: string;
  company: string;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  distanceM: number | null;
  yardLabel: string;
  radiusM: number;
  /** The street address the phone's position falls on (looked up), or '' when it could not be. */
  address: string;
  timeZone?: string;
}

/** The email's words, in one place so they can be checked. Says exactly where the worker clocked in from, and how far that is from the yard. */
export function buildAlert(o: AlertInput): { subject: string; text: string; html: string } {
  const has = o.lat !== null && o.lng !== null;
  const when = new Date(o.clockInAtIso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: o.timeZone ?? 'America/New_York' });
  const map = has ? `https://www.google.com/maps?q=${o.lat!.toFixed(6)},${o.lng!.toFixed(6)}` : '';
  const subject = has ? `${o.worker} clocked in away from the yard` : `${o.worker} clocked in, but their location could not be read`;
  const lines: string[] = [];
  if (has) {
    lines.push(`${o.worker} clocked in at ${when}, and was not at the yard.`);
    lines.push('');
    lines.push('Where they clocked in from:');
    if (o.address) lines.push(o.address);
    lines.push(`Coordinates: ${o.lat!.toFixed(6)}, ${o.lng!.toFixed(6)}${o.accuracyM !== null ? ` (the phone's reading is accurate to about ${Math.round(o.accuracyM * 3.28084)} ft)` : ''}`);
    if (o.distanceM !== null) lines.push(`That is about ${distanceText(o.distanceM)} from ${o.yardLabel || 'the yard'} (the yard counts as anywhere within ${distanceText(o.radiusM)}).`);
    lines.push(`Open on the map: ${map}`);
  } else {
    lines.push(`${o.worker} clocked in at ${when}, but their phone could not give a location (location may be turned off for the app).`);
    lines.push('');
    lines.push('Clocking in was still allowed. You can ask them where they were.');
  }
  lines.push('');
  lines.push(`You get this email because "Email me when someone clocks in away from the yard" is on in Settings. ${o.company}`);
  const text = lines.join('\n');
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1F2328;max-width:560px">
<p style="margin:0 0 12px"><strong>${esc(o.worker)}</strong> clocked in at ${esc(when)}${has ? ', and was <strong>not at the yard</strong>' : ', but their phone could not give a location'}.</p>
${has ? `<div style="background:#F6F5F1;border-radius:12px;padding:14px 16px;margin:0 0 14px">
<div style="font-size:12px;font-weight:700;letter-spacing:.6px;color:#6A6E75;margin-bottom:6px">WHERE THEY CLOCKED IN FROM</div>
${o.address ? `<div style="font-size:16px;font-weight:600">${esc(o.address)}</div>` : ''}
<div style="color:#4B564F;margin-top:4px">${o.lat!.toFixed(6)}, ${o.lng!.toFixed(6)}${o.accuracyM !== null ? ` · accurate to about ${Math.round(o.accuracyM * 3.28084)} ft` : ''}</div>
${o.distanceM !== null ? `<div style="margin-top:6px">About <strong>${esc(distanceText(o.distanceM))}</strong> from ${esc(o.yardLabel || 'the yard')}.</div>` : ''}
</div>
<p style="margin:0 0 14px"><a href="${esc(map)}" style="background:#2D5A43;color:#fff;text-decoration:none;font-weight:700;border-radius:10px;padding:10px 16px;display:inline-block">Open on the map</a></p>` : '<p style="margin:0 0 12px">Clocking in was still allowed. You can ask them where they were.</p>'}
<p style="margin:0;font-size:12px;color:#6A6E75">You get this because "Email me when someone clocks in away from the yard" is on in Settings. ${esc(o.company)}</p>
</div>`;
  return { subject, text, html };
}

/** The street address for a point, from OpenStreetMap's free lookup. Best effort: '' when it is slow or fails (the email still has the coordinates). */
async function lookupAddress(lat: number, lng: number): Promise<string> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lng}`, {
      headers: { 'User-Agent': 'BrightonLawnLandscape/1.0 (clock-in alerts)', 'Accept-Language': 'en' },
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return '';
    const j = await res.json();
    return typeof j?.display_name === 'string' ? j.display_name : '';
  } catch {
    return '';
  }
}

// ───────────────────────────── Deno edge function below (not run by the Node checks) ─────────────────────────────
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) return reply({ error: 'email_not_configured' }, 503);

  try {
    const auth = req.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return reply({ error: 'sign_in_required' }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u.user) return reply({ error: 'sign_in_required' }, 401);
    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: me } = await db.from('people').select('id, first_name, last_name').eq('user_id', u.user.id).maybeSingle();
    if (!me) return reply({ error: 'sign_in_required' }, 401);

    const body = await req.json();
    const id = typeof body.workday_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.workday_id) ? body.workday_id : null;
    if (!id) return reply({ error: 'bad_request' }, 400);

    // The record the database made when the worker clocked in. It must be this caller's own workday.
    const { data: loc } = await db.from('time_clock_locations')
      .select('workday_id, company_id, person_id, lat, lng, accuracy_m, yard_distance_m, outside_yard, alert_sent_at')
      .eq('workday_id', id).maybeSingle();
    if (!loc || loc.person_id !== me.id) return reply({ error: 'not_found' }, 404);
    if (loc.alert_sent_at) return reply({ ok: true, sent: false, reason: 'already_sent' });

    // The yard is the one the owner set on the Yard Location screen; the alert settings are the ones in Settings > Yard and clock-in alerts.
    const { data: yard } = await db.from('company_yard_alerts').select('radius_m, alert_on, alert_email').eq('company_id', loc.company_id).maybeSingle();
    if (!yard || !yard.alert_on) return reply({ ok: true, sent: false, reason: 'no_alert' });
    const hasPoint = loc.lat !== null && loc.lng !== null;
    if (hasPoint && loc.outside_yard !== true) return reply({ ok: true, sent: false, reason: 'at_yard' });

    const [{ data: wd }, { data: company }] = await Promise.all([
      db.from('time_workdays').select('clock_in_at').eq('id', id).maybeSingle(),
      db.from('companies').select('name, yard_address, yard_city, yard_state, yard_latitude').eq('id', loc.company_id).maybeSingle(),
    ]);
    if (company?.yard_latitude == null) return reply({ ok: true, sent: false, reason: 'no_yard' });
    const yardPlace = [company.yard_address, company.yard_city, company.yard_state].filter((v: string | null) => v && v.trim()).join(', ');

    // Who gets it: the address the owner typed in Settings, else every active owner's own email.
    let to: string[] = [];
    if (yard.alert_email) to = [yard.alert_email];
    else {
      const { data: owners } = await db.from('company_members').select('people!inner(email)').eq('company_id', loc.company_id).eq('role', 'owner').eq('status', 'active');
      to = ((owners ?? []) as { people: { email: string | null } | { email: string | null }[] }[])
        .map((o) => (Array.isArray(o.people) ? o.people[0]?.email : o.people?.email))
        .filter((e): e is string => !!e);
    }
    if (!to.length) return reply({ error: 'no_owner_email' }, 422);

    const lat = hasPoint ? Number(loc.lat) : null;
    const lng = hasPoint ? Number(loc.lng) : null;
    const address = hasPoint ? await lookupAddress(lat!, lng!) : '';
    const msg = buildAlert({
      worker: `${me.first_name ?? ''} ${me.last_name ?? ''}`.trim() || 'A worker',
      clockInAtIso: wd?.clock_in_at ?? new Date().toISOString(),
      company: company?.name ?? '',
      lat, lng,
      accuracyM: loc.accuracy_m === null ? null : Number(loc.accuracy_m),
      distanceM: loc.yard_distance_m,
      yardLabel: yardPlace ? `the yard (${yardPlace})` : 'the yard',
      radiusM: yard.radius_m,
      address,
    });

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('NOTIFY_EMAIL_FROM') ?? 'Brighton Lawn + Landscape <noreply@brightonlawn.com>',
        to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    if (!res.ok) return reply({ error: 'send_failed', detail: (await res.text()).slice(0, 200) }, 502);
    await db.from('time_clock_locations').update({ alert_sent_at: new Date().toISOString() }).eq('workday_id', id);
    return reply({ ok: true, sent: true });
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : 'Something went wrong' }, 500);
  }
});
