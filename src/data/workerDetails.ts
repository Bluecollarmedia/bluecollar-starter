/**
 * A worker's hoodie size and ID photo (supabase/updates/058). The hoodie size sits on the person; the ID photo is kept in its own
 * table that only the worker and the company OWNER can read, and its file is never shown from a public link: the owner (or the
 * worker) gets a short-lived private link from the media function.
 */
import { tr } from '@/i18n';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { uploadImage, removeMedia, requireSession } from '@/lib/media';
import { idFolder, isHoodieSize, isIdKeyFor, type HoodieSize } from '@/lib/workerDetails';

export type Result = { ok: true } | { ok: false; error: string };

const NOT_ON = 'This feature is not switched on yet (update 58 is missing). Your other changes were saved.';
const missing = (m: string | undefined) => /(hoodie|person_ids)/i.test(m ?? '') && /(column|schema cache|does not exist|relation)/i.test(m ?? '');

export interface MyDetails { hoodieSize: HoodieSize | null; idKey: string | null }

export async function loadMyDetails(personId: string): Promise<MyDetails> {
  if (!isSupabaseConfigured) return { hoodieSize: null, idKey: null };
  const [p, i] = await Promise.all([
    supabase.from('people').select('hoodie_size').eq('id', personId).maybeSingle(),
    supabase.from('person_ids').select('id_key').eq('person_id', personId).maybeSingle(),
  ]);
  const size = (p.data as { hoodie_size?: string | null } | null)?.hoodie_size;
  const key = (i.data as { id_key?: string | null } | null)?.id_key;
  return { hoodieSize: isHoodieSize(size) ? size : null, idKey: isIdKeyFor(personId, key) ? key : null };
}

export async function saveMyHoodie(personId: string, size: HoodieSize | null): Promise<Result> {
  if (!isSupabaseConfigured) return { ok: true };
  const { error } = await supabase.from('people').update({ hoodie_size: size }).eq('id', personId);
  if (error) return { ok: false, error: missing(error.message) ? NOT_ON : error.message };
  return { ok: true };
}

/** Uploads a new ID photo to the private folder, then points the record at it and removes the old file. */
export async function saveMyId(personId: string, localUri: string, oldKey?: string | null): Promise<Result> {
  if (!isSupabaseConfigured) return { ok: true };
  try {
    await requireSession();
    const { key } = await uploadImage(localUri, idFolder(personId));
    const { error } = await supabase.from('person_ids').upsert({ person_id: personId, id_key: key, updated_at: new Date().toISOString() });
    if (error) {
      removeMedia(key).catch(() => {});
      return { ok: false, error: missing(error.message) ? NOT_ON : error.message };
    }
    if (oldKey && oldKey !== key) removeMedia(oldKey).catch(() => {});
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : tr("The ID photo couldn't be uploaded.") };
  }
}

export async function removeMyId(personId: string, oldKey: string): Promise<Result> {
  if (!isSupabaseConfigured) return { ok: true };
  const { error } = await supabase.from('person_ids').delete().eq('person_id', personId);
  if (error) return { ok: false, error: error.message };
  removeMedia(oldKey).catch(() => {});
  return { ok: true };
}

/** Right after sign-up (signed in as the new worker). Never throws; joining must not fail over these optional extras. */
export async function saveDetailsForCurrentUser(d: { hoodieSize: HoodieSize | null; idUri: string | null }): Promise<string | null> {
  if (!isSupabaseConfigured || (!d.hoodieSize && !d.idUri)) return null;
  try {
    const { data } = await supabase.auth.getUser();
    const uid = data?.user?.id;
    if (!uid) return null;
    const { data: person } = await supabase.from('people').select('id').eq('user_id', uid).maybeSingle();
    const pid = (person as { id?: string } | null)?.id;
    if (!pid) return null;
    const notes: string[] = [];
    if (d.hoodieSize) { const r = await saveMyHoodie(pid, d.hoodieSize); if (!r.ok) notes.push(r.error); }
    if (d.idUri) { const r = await saveMyId(pid, d.idUri); if (!r.ok) notes.push(r.error); }
    return notes.length ? notes.join(' ') : null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Your hoodie size or ID could not be saved.';
  }
}

/** Hoodie sizes for a set of people (owner/admin view). Empty when the update is not installed. */
export async function loadHoodieSizes(personIds: string[]): Promise<Record<string, HoodieSize>> {
  if (!isSupabaseConfigured || personIds.length === 0) return {};
  const { data, error } = await supabase.from('people').select('id, hoodie_size').in('id', personIds);
  if (error || !data) return {};
  const out: Record<string, HoodieSize> = {};
  for (const r of data as { id: string; hoodie_size?: string | null }[]) if (isHoodieSize(r.hoodie_size)) out[r.id] = r.hoodie_size;
  return out;
}

/** Whether each person has an ID on file, and its key. The database only returns rows the owner (or the person) may read. */
export async function loadIdKeys(personIds: string[]): Promise<Record<string, string>> {
  if (!isSupabaseConfigured || personIds.length === 0) return {};
  const { data, error } = await supabase.from('person_ids').select('person_id, id_key').in('person_id', personIds);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const r of data as { person_id: string; id_key: string }[]) if (isIdKeyFor(r.person_id, r.id_key)) out[r.person_id] = r.id_key;
  return out;
}

/** A short-lived private link to view an ID photo (the person, or the owner of their company). */
export async function getIdViewUrl(key: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('media', { body: { action: 'id-sign', key } });
    if (error || !data?.url) return { ok: false, error: data?.error ?? "The ID couldn't be opened. Try again in a moment." };
    return { ok: true, url: data.url as string };
  } catch {
    return { ok: false, error: "The ID couldn't be opened. Try again in a moment." };
  }
}
