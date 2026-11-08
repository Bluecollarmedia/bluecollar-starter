/**
 * Service requests (update 114). A visitor sends one with submit_service_request (works signed out); the owner and admins read them and mark
 * them contacted or done. Every call returns a plain result and never throws.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { newRequestCount, sortRequests, type RequestStatus, type ServiceRequestInput, type ServiceRequestRow } from '@/lib/serviceRequest';

const UNREACHABLE = "Couldn't send your request. Check your connection and try again, or call us.";

/** Sends a request. The server's own wording comes back when it refuses (too many requests, a missing field). */
export async function submitServiceRequest(r: ServiceRequestInput): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: UNREACHABLE };
  try {
    const { data, error } = await supabase.rpc('submit_service_request', {
      p_property_type: r.propertyType,
      p_services: r.services,
      p_details: r.details.trim(),
      p_town: r.town.trim(),
      p_name: r.name.trim(),
      p_phone: r.phone.trim(),
      p_email: r.email.trim(),
    });
    // The server's own wording (code P0001: it refused the request) is shown as is; anything else (no connection, the update not run yet) gets the plain sentence.
    if (error) return { ok: false, error: error.code === 'P0001' && error.message ? error.message : UNREACHABLE };
    // Update 118 returns the new request's id: the owner is emailed about it (notify-request). Before 118 there is no id and no email; the
    // request is saved and shown in the app either way, so a failure here is never shown to the visitor.
    const id = (data as { id?: unknown } | null)?.id;
    if (typeof id === 'string') void supabase.functions.invoke('notify-request', { body: { id } }).catch(() => {});
    return { ok: true };
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export async function loadServiceRequests(): Promise<{ ok: true; data: ServiceRequestRow[] } | { ok: false; error: string }> {
  try {
    const { data, error } = await supabase
      .from('service_requests')
      .select('id, property_type, services, details, town, name, phone, email, status, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: sortRequests((data ?? []) as ServiceRequestRow[]) };
  } catch {
    return { ok: false, error: "Couldn't load the requests." };
  }
}

export async function setServiceRequestStatus(id: string, status: RequestStatus): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { data: u } = await supabase.auth.getUser();
    const { data: me } = u.user ? await supabase.from('people').select('id').eq('user_id', u.user.id).maybeSingle() : { data: null };
    const { data, error } = await supabase
      .from('service_requests')
      .update({ status, handled_by: status === 'new' ? null : me?.id ?? null, handled_at: status === 'new' ? null : new Date().toISOString() })
      .eq('id', id)
      .select('id');
    if (error) return { ok: false, error: error.message };
    if (!data?.length) return { ok: false, error: 'Only the owner or an admin can change a request.' };
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't update the request." };
  }
}

/** The owner's list, loaded on open and on demand. */
export function useServiceRequests(): { rows: ServiceRequestRow[]; loading: boolean; error: string | null; refresh: () => Promise<void>; newCount: number } {
  const [rows, setRows] = useState<ServiceRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const r = await loadServiceRequests();
    setLoading(false);
    if (r.ok) { setRows(r.data); setError(null); } else setError(r.error);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { rows, loading, error, refresh, newCount: newRequestCount(rows) };
}
