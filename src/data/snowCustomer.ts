/**
 * What a customer sees about their Snow service (supabase/updates/086_customer_snow_view.sql): the timeline of completed, sent stops,
 * what is happening right now, the services each property gets, and their own notification choices. If the database has not got update
 * 86 yet, the timeline falls back to the older function and the rest is simply empty, so the screens never break.
 */
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { signedSnowMediaUrls, snowPublicUrl } from '@/lib/snowMedia';
import { loadCustomerSnowUpdates } from '@/data/snowMediaReview';
import type { SnowStatus, SnowSvc, TimelineEntry } from '@/lib/customerSnow';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
const fail = (error: string): Result<never> => ({ ok: false, error });
const missing = (m?: string) => /could not find the function|schema cache|does not exist/i.test(m ?? '');

// The last full timeline that loaded (with photo links), kept for the session so the Snow screen can open with it already on screen.
let rememberedTimeline: TimelineEntry[] | null = null;
export const peekTimeline = (): TimelineEntry[] | null => rememberedTimeline;

export async function loadTimeline(opts: { withUrls?: boolean } = {}): Promise<Result<TimelineEntry[]>> {
  const withUrls = opts.withUrls !== false;
  if (!isSupabaseConfigured) return fail('Snow updates need the live app, not demo mode.');
  // Update 116's history (adds the arrival time); the older timeline function answers when 116 has not been run.
  let { data, error } = await supabase.rpc('snow_customer_history');
  if (error && missing(error.message)) ({ data, error } = await supabase.rpc('snow_customer_timeline'));
  if (error) {
    if (!missing(error.message)) return fail("Couldn't load your snow updates.");
    // Older database: the previous function has no property id or storm name, so group by property name.
    const old = await loadCustomerSnowUpdates();
    if (!old.ok) return fail(old.error);
    return ok(old.data.map((u) => ({
      visitId: u.visitId, propertyId: u.propertyName, propertyName: u.propertyName, service: u.service as SnowSvc,
      completedAt: u.completedAt, media: u.media,
    })));
  }
  type Row = { visit_id: string; property_id: string; property_name: string; service: SnowSvc; storm_name: string | null; arrived_at?: string | null; completed_at: string; media: { id: string; kind: 'photo' | 'video'; file_key: string }[] };
  const rows = (data ?? []) as Row[];
  let urls: Record<string, string> = {};
  if (withUrls) { try { urls = await signedSnowMediaUrls(rows.flatMap((r) => r.media.map((m) => m.file_key))); } catch { /* shown without photos */ } }
  const list = rows.map((r) => ({
    visitId: r.visit_id, propertyId: r.property_id, propertyName: r.property_name, service: r.service,
    stormName: r.storm_name ?? undefined, arrivedAt: r.arrived_at ?? undefined, completedAt: r.completed_at,
    media: r.media.map((m) => ({ id: m.id, kind: m.kind, url: urls[m.file_key] ?? (withUrls ? snowPublicUrl(m.file_key) : undefined) })),
  }));
  if (withUrls) rememberedTimeline = list;
  return ok(list);
}

/** What is happening now at each of their properties. Empty when nothing is, and when the database does not have update 86 yet. */
export async function loadStatuses(): Promise<SnowStatus[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase.rpc('snow_customer_status');
  if (error) return [];
  return ((data ?? []) as { property_id: string; state: 'scheduled' | 'on_site'; since: string | null; storm_name: string | null }[])
    .map((r) => ({ propertyId: r.property_id, state: r.state, since: r.since ?? undefined, stormName: r.storm_name ?? undefined }));
}

/** property id -> the services it gets. */
export async function loadServices(): Promise<Record<string, SnowSvc[]>> {
  if (!isSupabaseConfigured) return {};
  const { data, error } = await supabase.rpc('snow_my_property_services');
  if (error) return {};
  const out: Record<string, SnowSvc[]> = {};
  for (const r of (data ?? []) as { property_id: string; service: SnowSvc }[]) (out[r.property_id] ??= []).push(r.service);
  return out;
}

export interface NotifyChoices { crewArrives: boolean; serviceFinished: boolean }

export async function loadNotifyChoices(): Promise<Result<NotifyChoices>> {
  if (!isSupabaseConfigured) return fail('Not connected.');
  const { data, error } = await supabase.rpc('snow_my_notify_choices');
  if (error) return fail(missing(error.message) ? 'Snow notification choices need the next app update.' : "Couldn't load your choices.");
  const r = (Array.isArray(data) ? data[0] : data) as { crew_arrives?: boolean; service_finished?: boolean } | null;
  return ok({ crewArrives: r?.crew_arrives !== false, serviceFinished: r?.service_finished !== false });
}

export async function saveNotifyChoices(patch: Partial<NotifyChoices>): Promise<Result<undefined>> {
  if (!isSupabaseConfigured) return fail('Not connected.');
  const { error } = await supabase.rpc('snow_set_my_notify_choices', {
    p_crew_arrives: patch.crewArrives ?? null,
    p_service_finished: patch.serviceFinished ?? null,
  });
  return error ? fail("Couldn't save that. Please try again.") : ok(undefined);
}
