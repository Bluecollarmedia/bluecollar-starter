/**
 * Snow Mode skipped-stop requests (supabase/updates/027_snow_skip_requests.sql).
 *
 * The lead asks with a reason; the visit stays pending until the owner/admin
 * approves (visit becomes 'skipped', never counted as completed) or denies
 * (visit stays open; the owner's note says what to do). Every rule is enforced
 * by the database functions, these are thin wrappers.
 *
 * Snow tables aren't in the global store: they're loaded per storm/route.
 */

import { supabase } from '@/lib/supabase';
import { uuid } from '@/lib/ids';
import { isDemo } from './store';
import type { SnowSkipRequest, SnowSkipRequestStatus } from '@/types/snow';

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
const fail = (error: string): Result<never> => ({ ok: false, error });
const DEMO = 'Skip requests need the live app.';

function toRequest(r: Record<string, any>): SnowSkipRequest {
  return {
    id: r.id,
    companyId: r.company_id,
    stormId: r.storm_id,
    routeId: r.route_id,
    visitId: r.visit_id,
    propertyId: r.property_id,
    requestedBy: r.requested_by ?? undefined,
    reason: r.reason,
    status: r.status as SnowSkipRequestStatus,
    decidedBy: r.decided_by ?? undefined,
    decidedAt: r.decided_at ?? undefined,
    decisionNote: r.decision_note ?? undefined,
    clientRequestId: r.client_request_id ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Requests in flight, keyed by visit, so a double tap reuses the same id. */
const pendingClientIds: Record<string, string> = {};

/** Lead (or owner): ask to skip the current stop. Returns the request id.
 * Safe to retry: the same tap/retry never makes a second request. */
export async function requestSkip(visitId: string, reason: string): Promise<Result<string>> {
  if (isDemo()) return fail(DEMO);
  if (!reason.trim()) return fail('Say why this stop can’t be done.');
  const clientId = (pendingClientIds[visitId] ??= uuid());
  const { data, error } = await supabase.rpc('request_snow_skip', {
    p_visit_id: visitId,
    p_reason: reason.trim(),
    p_client_request_id: clientId,
  });
  if (error) return fail(error.message);
  delete pendingClientIds[visitId];
  return ok(data as string);
}

/** Owner/admin: approve (stop is skipped) or deny (stop stays open). The
 * note is shown to the lead; on a denial it's what they should do instead. */
export async function decideSkip(requestId: string, approve: boolean, note?: string): Promise<Result<SnowSkipRequestStatus>> {
  if (isDemo()) return fail(DEMO);
  const { data, error } = await supabase.rpc('decide_snow_skip', {
    p_request_id: requestId,
    p_approve: approve,
    p_note: note?.trim() || null,
  });
  return error ? fail(error.message) : ok(data as SnowSkipRequestStatus);
}

/** Lead (own request) or owner: take back a pending request. */
export async function withdrawSkip(requestId: string): Promise<Result<SnowSkipRequestStatus>> {
  if (isDemo()) return fail(DEMO);
  const { data, error } = await supabase.rpc('withdraw_snow_skip', { p_request_id: requestId });
  return error ? fail(error.message) : ok(data as SnowSkipRequestStatus);
}

/** Every request for one visit, newest first (owner, or the route's lead). */
export async function skipHistory(visitId: string): Promise<Result<SnowSkipRequest[]>> {
  if (isDemo()) return ok([]);
  const { data, error } = await supabase
    .from('snow_skip_requests')
    .select('*')
    .eq('visit_id', visitId)
    .order('created_at', { ascending: false });
  return error ? fail(error.message) : ok((data ?? []).map(toRequest));
}

/** Every request on one route, newest first (owner, or the route's lead). */
export async function listRouteSkips(routeId: string): Promise<Result<SnowSkipRequest[]>> {
  if (isDemo()) return ok([]);
  const { data, error } = await supabase
    .from('snow_skip_requests')
    .select('*')
    .eq('route_id', routeId)
    .order('created_at', { ascending: false });
  return error ? fail(error.message) : ok((data ?? []).map(toRequest));
}
