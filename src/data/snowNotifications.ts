/**
 * Snow Mode notifications (supabase/updates/031): customer arrival/completion
 * preferences per property, the owner's per-stop completion alert toggle, and
 * the record of every notification with what each channel actually did.
 *
 * Notifications are created by the database when a visit arrives or
 * completes, never by the app, and the send-snow-notification Edge Function
 * reports each channel's result. Nothing here marks anything as sent.
 */

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type {
  SnowDeliveryStatus, SnowNotification, SnowNotificationDelivery, SnowNotifyPrefs,
} from '@/types/snowNotifications';

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
const fail = (error: string): Result<never> => ({ ok: false, error });

const NOT_CONNECTED = 'Snow notifications need the live database, which isn\'t connected in this version of the app.';

type Row = Record<string, unknown>;
function fromDb<T>(row: Row): T {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (v !== null) out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return out as T;
}

// ── Customer preferences ────────────────────────────────────────────────────

/** Every property's preferences this person may see, keyed by property id. */
export async function loadAllNotifyPrefs(): Promise<Result<Record<string, SnowNotifyPrefs>>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data, error } = await supabase.from('snow_property_notify_prefs').select('*');
  if (error) return fail(error.message);
  const out: Record<string, SnowNotifyPrefs> = {};
  for (const row of data ?? []) {
    const p = fromDb<SnowNotifyPrefs>(row);
    out[p.propertyId] = p;
  }
  return ok(out);
}

/** Change one or both preferences. Leave a field out to keep it. Logged. */
export async function setNotifyPrefs(
  propertyId: string,
  change: { notifyOnArrival?: boolean; notifyOnCompletion?: boolean },
): Promise<Result<SnowNotifyPrefs>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data, error } = await supabase.rpc('snow_set_notify_prefs', {
    p_property_id: propertyId,
    p_on_arrival: change.notifyOnArrival ?? null,
    p_on_completion: change.notifyOnCompletion ?? null,
  });
  if (error) return fail(error.message);
  return ok(fromDb<SnowNotifyPrefs>(data as Row));
}

// ── Owner per-stop completion alerts ────────────────────────────────────────

export async function loadOwnerStopAlerts(companyId: string): Promise<Result<boolean>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data, error } = await supabase
    .from('snow_settings').select('owner_stop_alerts').eq('company_id', companyId).maybeSingle();
  if (error) return fail(error.message);
  return ok(data?.owner_stop_alerts ?? true);
}

/** Only changes owner alerts; customer notices and completion are unaffected. */
export async function setOwnerStopAlerts(companyId: string, enabled: boolean): Promise<Result> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data, error } = await supabase
    .from('snow_settings').update({ owner_stop_alerts: enabled }).eq('company_id', companyId).select('company_id');
  if (error) return fail(error.message);
  if (!data?.length) return fail('Only the owner or an admin can change this.');
  return ok(undefined);
}

// ── A customer's own properties ─────────────────────────────────────────────

/** The properties this signed-in customer is a linked contact for. */
export async function loadMySnowProperties(): Promise<Result<{ id: string; name: string; address: string }[]>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data, error } = await supabase.rpc('snow_my_properties');
  if (error) return fail(error.message);
  return ok(((data ?? []) as Row[]).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    address: [p.address, p.city].filter(Boolean).join(', '),
  })));
}
