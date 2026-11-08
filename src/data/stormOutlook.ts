/**
 * Brighton's storm outlooks, as the app reads and writes them (database functions in supabase/updates/104_storm_outlooks.sql).
 * Visitors read the current storm and the history; only the owner writes. Reading never fails loudly: if the update has not been run yet,
 * or the phone is offline, there is simply no storm to show (the last answer is kept on the phone for offline use).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { normalizeStorm, normalizeStorms, type StormOutlook } from '@/lib/stormView';
import { shareInFlight } from '@/lib/sharedRequest';

const CURRENT_KEY = 'weather.storm.current.v1';
const HISTORY_KEY = 'weather.storm.history.v1';
const LIMIT_MS = 10_000;

async function rpc(name: string, args?: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; message: string }> {
  if (!isSupabaseConfigured) return { ok: false, message: 'Not connected.' };
  try {
    const call = supabase.rpc(name, args ?? {});
    const stop = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timed out.')), LIMIT_MS));
    const { data, error } = await Promise.race([Promise.resolve(call), stop]);
    if (error) return { ok: false, message: error.message || 'Something went wrong.' };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Something went wrong.' };
  }
}

const save = async (key: string, v: unknown) => { try { await AsyncStorage.setItem(key, JSON.stringify(v)); } catch { /* best effort */ } };
const read = async (key: string): Promise<unknown> => { try { const r = await AsyncStorage.getItem(key); return r ? JSON.parse(r) : null; } catch { return null; } };

/** The storm that is active right now, or null. Falls back to the last one saved on the phone when it cannot be asked. */
export function fetchCurrentStorm(): Promise<{ storm: StormOutlook | null; fresh: boolean }> {
  return shareInFlight('storm.current', fetchCurrentStormNow);
}
async function fetchCurrentStormNow(): Promise<{ storm: StormOutlook | null; fresh: boolean }> {
  const r = await rpc('public_storm_current');
  if (r.ok) {
    const storm = normalizeStorm(r.data);
    await save(CURRENT_KEY, storm);
    return { storm, fresh: true };
  }
  return { storm: normalizeStorm(await read(CURRENT_KEY)), fresh: false };
}
export async function readSavedStorm(): Promise<StormOutlook | null> { return normalizeStorm(await read(CURRENT_KEY)); }

export function fetchStormHistory(): Promise<{ storms: StormOutlook[]; fresh: boolean }> {
  return shareInFlight('storm.history', fetchStormHistoryNow);
}
async function fetchStormHistoryNow(): Promise<{ storms: StormOutlook[]; fresh: boolean }> {
  const r = await rpc('public_storm_history');
  if (r.ok) {
    const storms = normalizeStorms(r.data);
    await save(HISTORY_KEY, storms);
    return { storms, fresh: true };
  }
  return { storms: normalizeStorms(await read(HISTORY_KEY)), fresh: false };
}
export async function readSavedHistory(): Promise<StormOutlook[]> { return normalizeStorms(await read(HISTORY_KEY)); }

// ── the owner ──

/** The owner's view of the active storm (so "post an update" starts from the last version). */
export async function fetchOwnerStorm(): Promise<{ ok: true; storm: StormOutlook | null } | { ok: false; message: string }> {
  const r = await rpc('owner_storm_current');
  if (!r.ok) return r;
  return { ok: true, storm: normalizeStorm(r.data) };
}

/** Every storm of the owner's company, newest first, whether or not public Weather is on (so the owner can see what can be deleted). */
export async function fetchOwnerStormHistory(): Promise<{ ok: true; storms: StormOutlook[] } | { ok: false; message: string }> {
  const r = await rpc('owner_storm_history');
  if (!r.ok) return r;
  return { ok: true, storms: normalizeStorms(r.data) };
}

/** Deletes one published update for everyone (the storm goes too if it was the only update). Owner only. */
export async function deleteStormUpdate(versionId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const r = await rpc('delete_storm_update', { p_version_id: versionId });
  if (!r.ok) return r;
  await save(CURRENT_KEY, null);
  await save(HISTORY_KEY, null);
  return { ok: true };
}

/** Deletes a whole storm and all of its updates for everyone, Storm History included. Owner only. */
export async function deleteStorm(outlookId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const r = await rpc('delete_storm_outlook', { p_outlook_id: outlookId });
  if (!r.ok) return r;
  await save(CURRENT_KEY, null);
  await save(HISTORY_KEY, null);
  return { ok: true };
}

export interface StormDraft {
  outlookId: string | null;
  name: string;
  headline: string;
  message: string;
  messageEs: string;
  snowLow: number | null;
  snowHigh: number | null;
  startsAt: string | null;
  endsAt: string | null;
  disclaimer: string;
  actualSnow: number | null;
  actualSource: string;
  final: boolean;
  /** The picture link of the storm map, already uploaded (null for no map). Sent only when there is one, so publishing works before update 105 is run. */
  mapUrl: string | null;
}

export async function publishStorm(d: StormDraft): Promise<{ ok: true } | { ok: false; message: string }> {
  const r = await rpc('publish_storm_outlook', {
    p_outlook_id: d.outlookId, p_name: d.name, p_headline: d.headline, p_message: d.message, p_message_es: d.messageEs.trim() ? d.messageEs : null,
    p_snow_low: d.snowLow, p_snow_high: d.snowHigh, p_starts_at: d.startsAt, p_ends_at: d.endsAt, p_disclaimer: d.disclaimer,
    p_actual_snow: d.actualSnow, p_actual_source: d.actualSnow === null ? null : d.actualSource, p_final: d.final,
    ...(d.mapUrl ? { p_map_url: d.mapUrl } : {}),
  });
  if (!r.ok) return r;
  await save(CURRENT_KEY, null);
  return { ok: true };
}
export async function endStorm(outlookId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const r = await rpc('end_storm_outlook', { p_outlook_id: outlookId });
  if (!r.ok) return r;
  await save(CURRENT_KEY, null);
  return { ok: true };
}
