/**
 * Snow Mode company settings (the one snow_settings row per company, update 020b).
 * Only settings the database really acts on are here:
 *  - require_arrival_before_completion: the database refuses to finish a stop
 *    that was never "I'm Here"-ed when this is on (the visit status guard).
 * The owner's own stop alerts (owner_stop_alerts) live in snowNotifications.ts.
 */

import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
const NOT_CONNECTED = 'Snow settings need the live database, which is not connected in this version of the app.';

export interface SnowRules {
  /** Leads must tap "I'm Here" before a stop can be finished. On unless the owner turns it off. */
  requireArrival: boolean;
}

export async function loadSnowRules(companyId: string): Promise<Result<SnowRules>> {
  if (!isSupabaseConfigured) return { ok: false, error: NOT_CONNECTED };
  const { data, error } = await supabase
    .from('snow_settings')
    .select('require_arrival_before_completion')
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  // No settings row yet behaves as the database does: arrival is required.
  return { ok: true, data: { requireArrival: data?.require_arrival_before_completion ?? true } };
}

/** Saves the rule, then confirms the database really changed it (an update that matched no row is an error). */
export async function setRequireArrival(companyId: string, on: boolean): Promise<Result> {
  if (!isSupabaseConfigured) return { ok: false, error: NOT_CONNECTED };
  const { data, error } = await supabase
    .from('snow_settings')
    .update({ require_arrival_before_completion: on })
    .eq('company_id', companyId)
    .select('company_id');
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: 'Only the owner or an admin can change this.' };
  return { ok: true, data: undefined };
}

/** What the owner is told before turning the arrival rule off. */
export const ARRIVAL_OFF_WARNING =
  "Workers will be able to finish a stop without tapping I'm Here. Arrival times, and the customer's \"crew arrived\" message, depend on that tap, so they may be missing.";

/**
 * Does a completed stop's photos go to the customer by themselves (update 87)? On unless the owner turns it off. If the database does not
 * have the setting yet, it behaves as before (the owner reviews and sends), so we report off.
 */
export async function loadAutoShare(companyId: string): Promise<Result<boolean>> {
  if (!isSupabaseConfigured) return { ok: false, error: NOT_CONNECTED };
  const { data, error } = await supabase.from('snow_settings').select('auto_share_with_customers').eq('company_id', companyId).maybeSingle();
  if (error) return /auto_share_with_customers|column/i.test(error.message) ? { ok: true, data: false } : { ok: false, error: error.message };
  return { ok: true, data: data?.auto_share_with_customers ?? true };
}

export async function setAutoShare(companyId: string, on: boolean): Promise<Result> {
  if (!isSupabaseConfigured) return { ok: false, error: NOT_CONNECTED };
  const { data, error } = await supabase.from('snow_settings').update({ auto_share_with_customers: on }).eq('company_id', companyId).select('company_id');
  if (error) return { ok: false, error: /auto_share_with_customers|column/i.test(error.message) ? 'This needs the next app update to be installed first.' : error.message };
  if (!data?.length) return { ok: false, error: 'Only the owner or an admin can change this.' };
  return { ok: true, data: undefined };
}
