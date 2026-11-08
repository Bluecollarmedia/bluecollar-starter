/**
 * Storm lifecycle (supabase/updates/024): create a draft storm for one
 * service, dispatch it, end it, reopen it.
 *
 * Every status change goes through a database function that checks the
 * caller is the owner/admin and that the move is allowed
 * (draft → dispatched → ended → reopened as dispatched). Repeating a call
 * (double tap, retry after a dropped connection) changes nothing and returns
 * `changed: false`. The app can still rename a storm or edit its notes
 * directly. Nothing here pretends to save without the live database.
 *
 * Reopening only changes the storm: earlier visits stay completed or
 * skipped, and no customer notification or media share is repeated.
 */
import { defaultStormNameFor } from '@/lib/snowServices';
import { NEEDS_UPDATE_50, isMissingFunction, type StormCounts } from '@/lib/snowStormDelete';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { sweepStorageSoon } from '@/lib/storageSweep';
import { uuid } from '@/lib/ids';
import type { SnowService, SnowStorm } from '@/types/snow';

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
const fail = (error: string): Result<never> => ({ ok: false, error });

/** The database doesn't have update 40 yet (the function or its new option isn't there). */
const OLD_DATABASE = /could not find the function|schema cache/i;
const NEEDS_UPDATE_40 = 'Several services in one storm need database update 40, which has not been installed yet. Pick one service for now.';

const NOT_CONNECTED = 'Storms need the live database, which isn\'t connected in this version of the app.';

type Row = Record<string, unknown>;

function camel(key: string) {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
function fromDb<T>(row: Row): T {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) if (v !== null) out[camel(k)] = v;
  return out as T;
}

function message(err: { message: string; code?: string } | null | undefined, fallback: string): string {
  if (!err) return fallback;
  if (err.code === '42501' || /permission denied|row-level security/.test(err.message)) {
    return 'Only the owner or an admin can change storms.';
  }
  return err.message || fallback;
}

/** Where the storm's work stands. Cancelled routes aren't counted. */
export interface StormSummary {
  routes: number;
  visits: number;
  completed: number;
  skipped: number;
  /** Lead tapped I'm Here but hasn't finished. */
  arrived: number;
  /** Not started. */
  pending: number;
  pendingSkipRequests: number;
}

export interface StormActionResult {
  storm: SnowStorm;
  /** False when the storm was already in that state (a repeated tap). */
  changed: boolean;
  summary: StormSummary;
}

function toResult(data: unknown): StormActionResult {
  const d = data as { storm: Row; changed: boolean; summary: Row };
  const s = d.summary ?? {};
  return {
    storm: fromDb<SnowStorm>(d.storm),
    changed: !!d.changed,
    summary: {
      routes: Number(s.routes ?? 0),
      visits: Number(s.visits ?? 0),
      completed: Number(s.completed ?? 0),
      skipped: Number(s.skipped ?? 0),
      arrived: Number(s.arrived ?? 0),
      pending: Number(s.pending ?? 0),
      pendingSkipRequests: Number(s.pending_skip_requests ?? 0),
    },
  };
}

async function call(fn: string, args: Row, fallback: string): Promise<Result<StormActionResult>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data, error } = await supabase.rpc(fn, args);
  if (error || !data) return fail(message(error, fallback));
  return ok(toResult(data));
}

// ── Reading ─────────────────────────────────────────────────────────────────

/** Every storm the caller can see (owner/admin: all), newest first. */
export async function loadStorms(): Promise<Result<SnowStorm[]>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data, error } = await supabase.from('snow_storms').select('*').order('created_at', { ascending: false });
  if (error) return fail(message(error, 'Couldn\'t load storms.'));
  return ok((data ?? []).map((r) => fromDb<SnowStorm>(r as Row)));
}

/** Give a storm a new name (the owner's own title, e.g. "Big Halloween Storm"). Only the name changes. */
export async function renameStorm(stormId: string, name: string): Promise<Result> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const clean = name.trim();
  if (!clean) return fail('Type a name for the storm.');
  const { data, error } = await supabase.from('snow_storms').update({ name: clean }).eq('id', stormId).select('id');
  if (error) return fail(message(error, 'Couldn\'t rename the storm.'));
  if (!data?.length) return fail('Only the owner or an admin can rename a storm.');
  return ok(undefined);
}

export interface EligibleProperty {
  propertyId: string;
  name: string;
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;
  mapDestination?: string;
  /** Which of the storm's services this property offers (update 40). */
  services?: SnowService[];
}

/** Active properties that offer one of this storm's services (or just `service`), for building its routes. */
export async function loadEligibleProperties(stormId: string, service?: SnowService): Promise<Result<EligibleProperty[]>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  let { data, error } = await supabase.rpc('snow_storm_eligible_properties', service ? { p_storm_id: stormId, p_service: service } : { p_storm_id: stormId });
  // Before update 40 the function has no service choice, and a storm has one service anyway.
  if (error && service && OLD_DATABASE.test(error.message)) {
    ({ data, error } = await supabase.rpc('snow_storm_eligible_properties', { p_storm_id: stormId }));
  }
  if (error) return fail(message(error, 'Couldn\'t load properties.'));
  return ok(((data ?? []) as Row[]).map((r) => fromDb<EligibleProperty>(r)));
}

/** What ending the storm would leave behind, for the confirmation. Changes nothing. */
export function previewEndStorm(stormId: string) {
  return call('snow_storm_end_preview', { p_storm_id: stormId }, 'Couldn\'t check the storm.');
}

/** A storm's routes as the owner sees them on the storm screen. */
export interface StormRouteRow {
  id: string;
  name: string;
  position: number;
  leadPersonId?: string;
  leadName?: string;
  /** The one service this route performs. */
  service: SnowService;
  /** Crew members besides the lead (update 41; 0 before it). */
  crew: number;
  cancelled: boolean;
  stops: number;
  completed: number;
  skipped: number;
}

/** Routes with their lead and stop counts. Route editing lives with the routes screens (update 025). */
export async function loadStormRoutes(stormId: string): Promise<Result<StormRouteRow[]>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const [routes, visits, crew] = await Promise.all([
    supabase.from('snow_routes').select('id, name, position, service, lead_person_id, cancelled_at').eq('storm_id', stormId)
      .order('position').order('created_at'),
    supabase.from('snow_visits').select('route_id, status').eq('storm_id', stormId),
    // Update 41. If it isn't installed this just fails and every route shows no crew.
    supabase.from('snow_route_crew').select('route_id').eq('storm_id', stormId),
  ]);
  if (routes.error) return fail(message(routes.error, 'Couldn\'t load routes.'));
  if (visits.error) return fail(message(visits.error, 'Couldn\'t load stops.'));
  const leadIds = [...new Set((routes.data ?? []).map((r) => r.lead_person_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (leadIds.length) {
    const { data } = await supabase.from('people').select('id, first_name, last_name').in('id', leadIds);
    for (const p of data ?? []) names.set(p.id, `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Unnamed');
  }
  return ok((routes.data ?? []).map((r) => {
    const mine = (visits.data ?? []).filter((v) => v.route_id === r.id);
    return {
      id: r.id,
      name: r.name,
      position: r.position,
      leadPersonId: r.lead_person_id ?? undefined,
      leadName: r.lead_person_id ? names.get(r.lead_person_id) : undefined,
      service: r.service as SnowService,
      crew: crew.error ? 0 : (crew.data ?? []).filter((c) => c.route_id === r.id).length,
      cancelled: !!r.cancelled_at,
      stops: mine.length,
      completed: mine.filter((v) => v.status === 'completed').length,
      skipped: mine.filter((v) => v.status === 'skipped').length,
    };
  }));
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * Creates a draft storm. Pass the same `requestId` when retrying the same
 * tap so only one storm is made (keep it for the life of the form).
 */
export async function createStorm(input: { name: string; services: SnowService[]; notes?: string; requestId?: string }): Promise<Result<StormActionResult>> {
  if (input.services.length === 0) return fail('Choose at least one service.');
  const common = { p_name: input.name.trim(), p_notes: input.notes?.trim() || null, p_client_request_id: input.requestId ?? uuid() };
  const res = await call('snow_create_storm', { ...common, p_services: input.services }, 'Couldn\'t create the storm.');
  if (res.ok || !OLD_DATABASE.test(res.error)) return res;
  // Database update 40 isn't installed: it only knows one service per storm.
  if (input.services.length === 1) return call('snow_create_storm', { ...common, p_service: input.services[0] }, 'Couldn\'t create the storm.');
  return fail(NEEDS_UPDATE_40);
}

/** Draft → dispatched. Needs a route with stops, and a lead on every route with stops. */
export function dispatchStorm(stormId: string) {
  return call('snow_dispatch_storm', { p_storm_id: stormId }, 'Couldn\'t dispatch the storm.');
}

/** Dispatched → ended. Always ask first (see `endStormConfirmation`). */
export function endStorm(stormId: string) {
  return call('snow_end_storm', { p_storm_id: stormId }, 'Couldn\'t end the storm.');
}

/** Ended → dispatched again. Earlier work, media and notifications are left as they were. */
export function reopenStorm(stormId: string) {
  return call('snow_reopen_storm', { p_storm_id: stormId }, 'Couldn\'t reopen the storm.');
}

/** How much work hangs off a storm, for the "delete for good" confirmation. */
export async function loadStormCounts(stormId: string): Promise<Result<StormCounts>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const head = { count: 'exact' as const, head: true };
  const [routes, stops, done, media] = await Promise.all([
    supabase.from('snow_routes').select('id', head).eq('storm_id', stormId),
    supabase.from('snow_visits').select('id', head).eq('storm_id', stormId),
    supabase.from('snow_visits').select('id', head).eq('storm_id', stormId).eq('status', 'completed'),
    supabase.from('snow_completion_media').select('id', head).eq('storm_id', stormId),
  ]);
  const err = routes.error ?? stops.error ?? done.error;
  if (err) return fail(message(err, 'Couldn\'t check the storm.'));
  return ok({ routes: routes.count ?? 0, stops: stops.count ?? 0, completedStops: done.count ?? 0, media: media.error ? 0 : media.count ?? 0 });
}

/**
 * Deletes a storm of ANY status, with its routes, stops, skip requests and photo records (update 50, owner/admin
 * only). On a database without update 50 only a draft can still be deleted, the old way.
 */
export async function deleteStormForGood(stormId: string, status?: string): Promise<Result<{ routes: number; stops: number }>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data, error } = await supabase.rpc('snow_delete_storm', { p_storm_id: stormId });
  if (!error) {
    sweepStorageSoon();
    const d = (data ?? {}) as { routes?: number; stops?: number };
    return ok({ routes: d.routes ?? 0, stops: d.stops ?? 0 });
  }
  if (isMissingFunction(error.message)) {
    if (status !== 'draft') return fail(NEEDS_UPDATE_50);
    const old = await deleteDraftStorm(stormId);
    return old.ok ? ok({ routes: 0, stops: 0 }) : old;
  }
  return fail(message(error, 'Couldn\'t delete the storm.'));
}

/** Only drafts can be deleted; a dispatched storm is ended instead. */
export async function deleteDraftStorm(stormId: string): Promise<Result> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { error } = await supabase.from('snow_storms').delete().eq('id', stormId);
  if (!error) sweepStorageSoon();
  if (error) return fail(message(error, 'Couldn\'t delete the draft.'));
  return ok(undefined);
}

// ── Wording for the End Storm confirmation ──────────────────────────────────

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

import { SERVICE_LABEL } from '@/types/snow';
export { SERVICE_LABEL };

export const STORM_STATUS_LABEL: Record<SnowStorm['status'], string> = {
  draft: 'Draft',
  dispatched: 'Active',
  ended: 'Ended',
};

/** A starting name for a new storm, e.g. "Jan 12 Storm" (never named after one service). */
export function defaultStormName(services: SnowService | SnowService[], now = new Date()): string {
  return defaultStormNameFor(Array.isArray(services) ? services : [services], (s) => SERVICE_LABEL[s], now);
}

/** Plain-language implications of ending, from `previewEndStorm`. Layout is up to the screen. */
export function endStormConfirmation(storm: Pick<SnowStorm, 'name'>, s: StormSummary): { title: string; message: string } {
  const lines: string[] = [];
  const open = s.pending + s.arrived;
  if (open > 0) lines.push(`${plural(open, 'stop')} not finished. They'll stay unfinished, not completed.`);
  if (s.pendingSkipRequests > 0) lines.push(`${plural(s.pendingSkipRequests, 'skip request')} waiting for your decision. You can decide after reopening.`);
  lines.push('Leads can\'t record more work until you reopen the storm. Everything done so far is kept.');
  return { title: `End ${storm.name}?`, message: lines.join('\n\n') };
}
