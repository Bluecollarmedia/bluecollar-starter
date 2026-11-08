/**
 * Snow completion media review and customer updates (supabase/updates/030).
 * The owner approves or hides each photo/video, then sends a completed
 * stop's approved media to the property's linked customers. Customers read
 * only shared media for their own properties.
 */
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { sweepStorageSoon } from '@/lib/storageSweep';
import { signedSnowMediaUrls } from '@/lib/snowMedia';
import { SNOW_OWNER_MEDIA_TARGET } from '@/data/snowMediaTargets';
import type { SnowMediaDraft } from '@/data/snowProperties';
import type { SnowService } from '@/types/snow';

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
const fail = (error: string): Result<never> => ({ ok: false, error });
const NOT_CONNECTED = 'Snow updates need the live database, which isn\'t connected in this version of the app.';

function message(error: { message?: string } | null | undefined, fallback: string) {
  const m = error?.message?.trim();
  return m && !/^(permission denied|new row violates|JWT)/i.test(m) ? m : fallback;
}

export interface ReviewMedia { id: string; kind: 'photo' | 'video'; url?: string; status: 'pending' | 'approved' | 'hidden'; shared: boolean; withdrawn: boolean }
export interface ReviewStop {
  visitId: string;
  propertyName: string;
  service: SnowService;
  completedAt: string;
  completionNote?: string;
  notified: boolean;
  media: ReviewMedia[];
}

/** Completed stops from the last 14 days, newest first, with their media and signed links. */
export async function loadReviewQueue(): Promise<Result<ReviewStop[]>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('snow_visits')
    .select('id, property_name, service, completed_at, completion_note, customer_notified_at, snow_completion_media(id, kind, file_key, review_status, shared_at, withdrawn_at, created_at)')
    .eq('status', 'completed')
    .gte('completed_at', since)
    .order('completed_at', { ascending: false });
  if (error) return fail(message(error, 'Couldn\'t load completed stops.'));
  type M = { id: string; kind: 'photo' | 'video'; file_key: string; review_status: ReviewMedia['status']; shared_at: string | null; withdrawn_at: string | null; created_at: string };
  const keys = (data ?? []).flatMap((v) => ((v.snow_completion_media ?? []) as M[]).map((m) => m.file_key));
  let urls: Record<string, string> = {};
  try { urls = await signedSnowMediaUrls(keys); } catch { /* thumbnails are optional */ }
  return ok((data ?? []).map((v) => ({
    visitId: v.id,
    propertyName: v.property_name ?? 'Property',
    service: v.service,
    completedAt: v.completed_at,
    completionNote: v.completion_note ?? undefined,
    notified: !!v.customer_notified_at,
    media: ((v.snow_completion_media ?? []) as M[])
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((m) => ({ id: m.id, kind: m.kind, url: urls[m.file_key], status: m.review_status, shared: !!m.shared_at, withdrawn: !!m.withdrawn_at })),
  })));
}

export async function reviewMedia(mediaId: string, status: 'approved' | 'hidden'): Promise<Result> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { error } = await supabase.rpc('snow_review_media', { p_media_id: mediaId, p_status: status });
  return error ? fail(message(error, 'Couldn\'t save the review.')) : ok(undefined);
}

/** Shares the stop's approved media with linked customers (update 031 sends the "done" message). Returns how many were shared. */
export async function sendCustomerUpdate(visitId: string): Promise<Result<number>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data, error } = await supabase.rpc('snow_send_customer_update', { p_visit_id: visitId });
  return error ? fail(message(error, 'Couldn\'t send the update.')) : ok(Number(data ?? 0));
}

export interface CustomerSnowUpdate { visitId: string; propertyName: string; service: SnowService; completedAt: string; media: { id: string; kind: 'photo' | 'video'; url?: string }[] }

export async function loadCustomerSnowUpdates(): Promise<Result<CustomerSnowUpdate[]>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data, error } = await supabase.rpc('snow_customer_updates');
  if (error) return fail(message(error, 'Couldn\'t load snow updates.'));
  type Row = { visit_id: string; property_name: string; service: SnowService; completed_at: string; media: { id: string; kind: 'photo' | 'video'; file_key: string }[] };
  const rows = (data ?? []) as Row[];
  let urls: Record<string, string> = {};
  try { urls = await signedSnowMediaUrls(rows.flatMap((r) => r.media.map((m) => m.file_key))); } catch { /* shown without photos */ }
  return ok(rows.map((r) => ({
    visitId: r.visit_id,
    propertyName: r.property_name,
    service: r.service,
    completedAt: r.completed_at,
    media: r.media.map((m) => ({ id: m.id, kind: m.kind, url: urls[m.file_key] })),
  })));
}

/**
 * Owner/admin: add photos or videos to a completed stop (update 032). They join the shared background queue, so this returns at once;
 * each file counts once it is both uploaded and saved. The owner added it, so it starts approved, and it is still not shared with the
 * customer until sent. Returns how many were queued.
 */
export async function addOwnerMedia(companyId: string, visitId: string, drafts: SnowMediaDraft[]): Promise<Result<number>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { queueMedia } = require('@/lib/mediaQueueRuntime') as typeof import('@/lib/mediaQueueRuntime');
  for (const d of drafts) {
    queueMedia({
      kind: d.mediaType === 'video' ? 'video' : 'image', sourceUri: d.uri, mimeType: d.mimeType, bytesIn: d.sizeBytes,
      folder: `${companyId}/completion/${visitId}`, target: { type: SNOW_OWNER_MEDIA_TARGET, payload: { visitId } },
    });
  }
  return ok(drafts.length);
}

/** Last step of a queued owner photo: the file is stored, so save it on the stop. Safe to repeat (the database ignores a file it already has). */
export async function saveOwnerMediaRecord(job: { kind: string; bytesOut?: number; bytesIn?: number; target: { payload: Record<string, unknown> } }, key: string): Promise<void> {
  const { error } = await supabase.rpc('snow_owner_add_media', {
    p_visit_id: String(job.target.payload.visitId),
    p_kind: job.kind === 'video' ? 'video' : 'photo',
    p_file_key: key,
    p_size_bytes: job.bytesOut ?? job.bytesIn ?? null,
  });
  if (error) throw new Error(message(error, "Couldn't save the photo."));
}

/**
 * Owner/admin: take a photo or video back from the customer (update 033). It
 * leaves their Snow updates and they can no longer open the file; the record,
 * who sent it and who withdrew it stay. A customer who already saw or saved it
 * still has it. A withdrawn item can't be sent again.
 */
export async function withdrawMedia(mediaId: string): Promise<Result> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { error } = await supabase.rpc('snow_withdraw_media', { p_media_id: mediaId });
  return error ? fail(message(error, "Couldn't withdraw the photo.")) : ok(undefined);
}

/** Owner/admin: deletes a stop's photo or video for good (update 96). A customer who was sent it can no longer see it. */
export async function deleteMedia(mediaId: string): Promise<Result> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { error } = await supabase.rpc('snow_delete_media', { p_media_id: mediaId });
  if (!error) sweepStorageSoon();
  return error ? fail(message(error, "Couldn't delete the photo.")) : ok(undefined);
}
