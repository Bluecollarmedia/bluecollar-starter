/**
 * Snow property details: contacts, services, versioned instructions and
 * reference photos/videos (supabase/updates/022).
 *
 * These read and write Supabase directly. Every rule that matters is in the
 * database: who can see a service's instructions/media, that saved
 * instructions never change (saving adds a version), and that reference
 * media is retired, never deleted. Nothing here pretends to save without the
 * live database.
 */

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { snowReferenceFolder } from '@/lib/snowMedia';
import { SNOW_REFERENCE_TARGET } from '@/data/snowMediaTargets';
import type {
  SnowPropertyContact, SnowPropertyService, SnowReferenceMedia, SnowService, SnowServiceInstructions,
  SnowServiceReference,
} from '@/types/snowProperty';

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
const fail = (error: string): Result<never> => ({ ok: false, error });

const NOT_CONNECTED = 'Snow properties need the live database, which isn\'t connected in this version of the app.';

type Row = Record<string, unknown>;

function camel(key: string) {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
function snake(key: string) {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
function fromDb<T>(row: Row): T {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) if (v !== null) out[camel(k)] = v;
  return out as T;
}
function toDb(obj: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(obj)) out[snake(k)] = v === undefined ? null : v;
  return out;
}

/** Turns database errors into something the owner can act on. */
function message(err: { message: string; code?: string } | null | undefined, fallback: string): string {
  if (!err) return fallback;
  if (err.code === '23505' && /primary/.test(err.message)) return 'This property already has a main contact.';
  if (err.code === '23505' && /person/.test(err.message)) return 'That customer is already a contact for this property.';
  if (err.code === '23505' && /service/.test(err.message)) return 'This property already has that service.';
  if (err.code === '42501' || /row-level security/.test(err.message)) return 'Only the owner or an admin can change snow properties.';
  return err.message || fallback;
}

// ── Reading ─────────────────────────────────────────────────────────────────

export interface SnowPropertyDetails {
  contacts: SnowPropertyContact[];
  services: SnowPropertyService[];
  /** Every saved version, newest first. */
  instructions: SnowServiceInstructions[];
  /** Every reference item, removed ones included (they stay on past visits). */
  media: SnowReferenceMedia[];
}

/** Owner/admin view of one property's details. Returns only what the database lets the caller see. */
/** Customer contact names for every property in the company, primary contact first. Used to search and filter by customer. */
export async function loadPropertyContactNames(): Promise<Result<Record<string, string[]>>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { data, error } = await supabase.from('snow_property_contacts').select('property_id, name, is_primary, sort_order').is('removed_at', null)
    .order('is_primary', { ascending: false }).order('sort_order');
  if (error) return fail(message(error, 'Couldn\'t load customers.'));
  const out: Record<string, string[]> = {};
  for (const r of (data ?? []) as { property_id: string; name: string }[]) (out[r.property_id] ??= []).push(r.name);
  return ok(out);
}

export async function loadSnowPropertyDetails(propertyId: string): Promise<Result<SnowPropertyDetails>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const [contacts, services] = await Promise.all([
    supabase.from('snow_property_contacts').select('*').eq('property_id', propertyId).is('removed_at', null)
      .order('is_primary', { ascending: false }).order('sort_order').order('created_at'),
    supabase.from('snow_property_services').select('*').eq('property_id', propertyId).order('created_at'),
  ]);
  if (contacts.error) return fail(message(contacts.error, 'Couldn\'t load contacts.'));
  if (services.error) return fail(message(services.error, 'Couldn\'t load services.'));
  const serviceIds = (services.data ?? []).map((s) => s.id as string);

  let instructions: SnowServiceInstructions[] = [];
  let media: SnowReferenceMedia[] = [];
  if (serviceIds.length > 0) {
    const [ins, med] = await Promise.all([
      supabase.from('snow_service_instructions').select('*').in('property_service_id', serviceIds).order('version', { ascending: false }),
      supabase.from('snow_reference_media').select('*').in('property_service_id', serviceIds).order('created_at'),
    ]);
    if (ins.error) return fail(message(ins.error, 'Couldn\'t load instructions.'));
    if (med.error) return fail(message(med.error, 'Couldn\'t load reference media.'));
    instructions = (ins.data ?? []).map((r) => fromDb<SnowServiceInstructions>(r));
    media = (med.data ?? []).map((r) => fromDb<SnowReferenceMedia>(r));
  }

  return ok({
    contacts: (contacts.data ?? []).map((r) => fromDb<SnowPropertyContact>(r)),
    services: (services.data ?? []).map((r) => fromDb<SnowPropertyService>(r)),
    instructions,
    media,
  });
}

/**
 * What was in effect for one service at `at` (default: now). Mirrors
 * snow_instructions_as_of / snow_reference_media_as_of in the database, for
 * details already loaded.
 */
export function referenceAsOf(details: SnowPropertyDetails, service: SnowPropertyService, at?: string): SnowServiceReference {
  const when = at ?? new Date().toISOString();
  const t = Date.parse(when);
  const instructions = details.instructions
    .filter((i) => i.propertyServiceId === service.id && Date.parse(i.createdAt) <= t)
    .sort((a, b) => b.version - a.version)[0];
  const media = details.media.filter((m) =>
    m.propertyServiceId === service.id
    && Date.parse(m.createdAt) <= t
    && (!m.retiredAt || Date.parse(m.retiredAt) > t));
  return { service, instructions, media };
}

/**
 * The instructions and reference media for one property + service, as the
 * database lets the caller see them: a route lead gets only the services on
 * routes they lead. `at` shows a past visit as it was (pass the visit's
 * completion time); leave it out for what's current.
 */
export async function loadServiceReference(propertyId: string, service: SnowService, at?: string): Promise<Result<SnowServiceReference | null>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const ps = await supabase.from('snow_property_services').select('*')
    .eq('property_id', propertyId).eq('service', service).maybeSingle();
  if (ps.error) return fail(message(ps.error, 'Couldn\'t load this service.'));
  if (!ps.data) return ok(null);
  const args = { ps_id: ps.data.id, at: at ?? new Date().toISOString() };
  const [ins, med] = await Promise.all([
    supabase.rpc('snow_instructions_as_of', args),
    supabase.rpc('snow_reference_media_as_of', args),
  ]);
  if (ins.error) return fail(message(ins.error, 'Couldn\'t load the instructions.'));
  if (med.error) return fail(message(med.error, 'Couldn\'t load the reference media.'));
  const insRow = Array.isArray(ins.data) ? ins.data[0] : ins.data;
  return ok({
    service: fromDb<SnowPropertyService>(ps.data),
    instructions: insRow ? fromDb<SnowServiceInstructions>(insRow) : undefined,
    media: ((med.data ?? []) as Row[]).map((r) => fromDb<SnowReferenceMedia>(r)),
  });
}

// ── Contacts ────────────────────────────────────────────────────────────────

export type ContactInput = {
  name: string;
  title?: string;
  phone?: string;
  email?: string;
  personId?: string;
  isPrimary?: boolean;
};

function cleanContact(input: Partial<ContactInput>): Row {
  const out: Row = {};
  if (input.name !== undefined) out.name = input.name.trim();
  for (const k of ['title', 'phone', 'email'] as const) {
    if (input[k] !== undefined) out[k] = input[k]?.trim() || undefined;
  }
  if (input.personId !== undefined) out.personId = input.personId || undefined;
  if (input.isPrimary !== undefined) out.isPrimary = input.isPrimary;
  return out;
}

/** Clears the current main contact so another can take its place. */
async function clearPrimary(propertyId: string, exceptId?: string) {
  let q = supabase.from('snow_property_contacts').update({ is_primary: false })
    .eq('property_id', propertyId).eq('is_primary', true);
  if (exceptId) q = q.neq('id', exceptId);
  return q;
}

export async function addContact(companyId: string, propertyId: string, input: ContactInput): Promise<Result<SnowPropertyContact>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  if (!input.name.trim()) return fail('Add the contact\'s name.');
  if (input.isPrimary) {
    const cleared = await clearPrimary(propertyId);
    if (cleared.error) return fail(message(cleared.error, 'Couldn\'t change the main contact.'));
  }
  const { data, error } = await supabase.from('snow_property_contacts')
    .insert(toDb({ companyId, propertyId, ...cleanContact(input) })).select().single();
  if (error) return fail(message(error, 'Couldn\'t add the contact.'));
  return ok(fromDb<SnowPropertyContact>(data));
}

export async function updateContact(contact: SnowPropertyContact, patch: Partial<ContactInput>): Promise<Result> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  if (patch.name !== undefined && !patch.name.trim()) return fail('Add the contact\'s name.');
  if (patch.isPrimary && !contact.isPrimary) {
    const cleared = await clearPrimary(contact.propertyId, contact.id);
    if (cleared.error) return fail(message(cleared.error, 'Couldn\'t change the main contact.'));
  }
  const { error } = await supabase.from('snow_property_contacts').update(toDb(cleanContact(patch))).eq('id', contact.id);
  return error ? fail(message(error, 'Couldn\'t save the contact.')) : ok(undefined);
}

// ── Services ────────────────────────────────────────────────────────────────

/** Adds a service to the property, or turns a previously stopped one back on. */
export async function addService(companyId: string, propertyId: string, service: SnowService, existing?: SnowPropertyService): Promise<Result> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  if (existing) return setServiceActive(existing.id, true);
  const { error } = await supabase.from('snow_property_services')
    .insert(toDb({ companyId, propertyId, service }));
  return error ? fail(message(error, 'Couldn\'t add the service.')) : ok(undefined);
}

/**
 * Stops (or resumes) a service at this property. Its instructions and media
 * are kept, and storms that already used it keep showing them.
 */
export async function setServiceActive(propertyServiceId: string, active: boolean): Promise<Result> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { error } = await supabase.from('snow_property_services')
    .update({ is_active: active }).eq('id', propertyServiceId);
  return error ? fail(message(error, 'Couldn\'t change the service.')) : ok(undefined);
}

/** The photo rule for one service at a property (update 112): required (with how many), not required, or null to follow the route. */
export async function setServicePhotoRule(propertyServiceId: string, rule: { photosRequired: boolean | null; photoCount: number | null }): Promise<Result> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { error } = await supabase.from('snow_property_services')
    .update({ photos_required: rule.photosRequired, photo_count: rule.photosRequired ? rule.photoCount : null }).eq('id', propertyServiceId);
  if (error) return fail(/photos_required|photo_count/i.test(error.message) ? 'Photo rules for a service need database update 112, which has not been installed yet.' : message(error, 'Couldn\'t save the photo rule.'));
  return ok(undefined);
}

// ── Instructions ────────────────────────────────────────────────────────────

/**
 * Saves the instructions as a new version. Earlier versions stay as they
 * were, so past visits keep the text they were done with. Saving unchanged
 * text adds nothing.
 */
export async function saveInstructions(companyId: string, propertyServiceId: string, body: string, current?: SnowServiceInstructions): Promise<Result<SnowServiceInstructions | undefined>> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const text = body.trim();
  if (text === (current?.body ?? '').trim()) return ok(current);
  const { data, error } = await supabase.from('snow_service_instructions')
    .insert(toDb({ companyId, propertyServiceId, body: text, version: 0 })).select().single();
  if (error) return fail(message(error, 'Couldn\'t save the instructions.'));
  return ok(fromDb<SnowServiceInstructions>(data));
}

// ── Reference media ─────────────────────────────────────────────────────────

export interface SnowMediaDraft {
  uri: string;
  mediaType: 'image' | 'video';
  mimeType?: string;
  sizeBytes?: number;
  caption?: string;
}

/**
 * Adds reference photos/videos for a service. They join the shared background queue (compress -> upload -> save the record), so this
 * returns at once and the screen can say they are uploading; a file only counts once both the upload and the database row succeed,
 * and a failure stays in the queue as Failed with Retry. Returns how many were queued.
 */
export async function addReferenceMedia(companyId: string, propertyServiceId: string, drafts: SnowMediaDraft[]): Promise<{ queued: number; errors: string[] }> {
  if (!isSupabaseConfigured) return { queued: 0, errors: [NOT_CONNECTED] };
  const { queueMedia } = require('@/lib/mediaQueueRuntime') as typeof import('@/lib/mediaQueueRuntime');
  for (const d of drafts) {
    queueMedia({
      kind: d.mediaType === 'video' ? 'video' : 'image', sourceUri: d.uri, mimeType: d.mimeType, bytesIn: d.sizeBytes,
      folder: snowReferenceFolder(companyId, propertyServiceId),
      target: { type: SNOW_REFERENCE_TARGET, payload: { companyId, propertyServiceId, mediaType: d.mediaType, caption: d.caption?.trim() || undefined } },
    });
  }
  return { queued: drafts.length, errors: [] };
}

/** Last step of a queued reference photo: the file is stored, so save its row. Safe to repeat (a file that already has a row is left alone). */
export async function saveReferenceRecord(job: { bytesOut?: number; bytesIn?: number; target: { payload: Record<string, unknown> } }, key: string): Promise<void> {
  const p = job.target.payload;
  const existing = await supabase.from('snow_reference_media').select('id').eq('file_key', key).maybeSingle();
  if (existing.data) return;
  const { error } = await supabase.from('snow_reference_media').insert(toDb({
    companyId: p.companyId, propertyServiceId: p.propertyServiceId, mediaType: p.mediaType, fileKey: key,
    sizeBytes: job.bytesOut ?? job.bytesIn, caption: p.caption,
  }));
  if (error) throw new Error(message(error, "Couldn't save the file."));
}

/**
 * Takes a photo/video out of the reference set for future storms. The file
 * and row are kept, so visits done while it was in use still show it.
 */
export async function retireReferenceMedia(mediaId: string): Promise<Result> {
  if (!isSupabaseConfigured) return fail(NOT_CONNECTED);
  const { error } = await supabase.from('snow_reference_media')
    .update({ retired_at: new Date().toISOString() }).eq('id', mediaId);
  return error ? fail(message(error, 'Couldn\'t remove it.')) : ok(undefined);
}
