import { supabase, isSupabaseConfigured } from '@/lib/supabase';

// Birthday lives in its own column (SQL 044), read and written here instead of the shared
// people loader so a database without the update keeps working everywhere else.

export type BirthdayResult = { ok: true } | { ok: false; error: string; needsUpdate?: boolean };

function missingColumn(message: string | undefined): boolean {
  return /birthday/i.test(message ?? '') && /(column|schema cache|does not exist)/i.test(message ?? '');
}

/** My saved birthday as YYYY-MM-DD, or null when none / the update is not installed. */
export async function loadMyBirthday(personId: string): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.from('people').select('birthday').eq('id', personId).maybeSingle();
  if (error) return null;
  return ((data as { birthday?: string | null } | null)?.birthday ?? null) || null;
}

/** Save (or clear, with null) my own birthday. */
export async function saveMyBirthday(personId: string, iso: string | null): Promise<BirthdayResult> {
  if (!isSupabaseConfigured) return { ok: true };
  const { error } = await supabase.from('people').update({ birthday: iso }).eq('id', personId);
  if (error) {
    if (missingColumn(error.message)) {
      return { ok: false, needsUpdate: true, error: 'Birthdays are not switched on yet. Your other changes were saved.' };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Save my birthday right after sign-up, using the signed-in account. Never throws; sign-up must not fail over this. */
export async function saveBirthdayForCurrentUser(iso: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    const { data } = await supabase.auth.getUser();
    const uid = data?.user?.id;
    if (!uid) return;
    await supabase.from('people').update({ birthday: iso }).eq('user_id', uid);
  } catch {
    // Optional field: ignore.
  }
}

/** Birthdays for a set of people (owner view). Empty map when the update is not installed. */
export async function loadBirthdays(personIds: string[]): Promise<Record<string, string>> {
  if (!isSupabaseConfigured || personIds.length === 0) return {};
  const { data, error } = await supabase.from('people').select('id, birthday').in('id', personIds);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const r of data as { id: string; birthday?: string | null }[]) if (r.birthday) out[r.id] = r.birthday;
  return out;
}
