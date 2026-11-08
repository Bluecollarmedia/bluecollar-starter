/**
 * Keeps the optional sign-up extras (profile photo, birthday, hoodie size, ID photo) safe on the phone while an account waits for
 * its email confirmation, then saves them the first time that person is signed in (confirmation link or normal sign-in).
 * Pictures are copied out of the temporary cache first, because the system can clear the cache before the person confirms.
 * A part that fails to save stays for the next try; nothing here ever throws or blocks signing in.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Directory, Paths } from 'expo-file-system';
import { isSupabaseConfigured } from '@/lib/supabase';
import { hasPending, pendingKey, remainingAfter, type PendingPart, type PendingSignup } from '@/lib/pendingSignup';
import { saveSignupPhoto } from '@/data/signupPhoto';
import { saveBirthdayForCurrentUser } from '@/data/birthday';
import { saveDetailsForCurrentUser } from '@/data/workerDetails';

/** Copies a picture somewhere that is not the cache. Returns the original address if the copy can't be made. */
function keepFile(uri: string | null | undefined, name: string): string | null {
  if (!uri) return null;
  try {
    const dir = new Directory(Paths.document, 'pending-signup');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const ext = (uri.split('?')[0].split('.').pop() || 'jpg').slice(0, 5);
    const dest = new File(dir, `${name}-${Date.now().toString(36)}.${ext}`);
    new File(uri).copy(dest);
    return dest.uri;
  } catch {
    return uri;
  }
}

function dropFiles(p: PendingSignup | null) {
  for (const u of [p?.photoUri, p?.idUri]) {
    if (!u || !u.includes('pending-signup')) continue;
    try { const f = new File(u); if (f.exists) f.delete(); } catch { /* already gone */ }
  }
}

/** Remember the extras for this email until they can be saved. Does nothing when there is nothing to keep. */
export async function stashPendingSignup(p: PendingSignup): Promise<void> {
  if (!hasPending(p)) return;
  try {
    const keep: PendingSignup = { ...p, photoUri: keepFile(p.photoUri, 'photo'), idUri: keepFile(p.idUri, 'id') };
    await AsyncStorage.setItem(pendingKey(p.email), JSON.stringify(keep));
  } catch {
    // Optional extras: the account itself is already made.
  }
}

const running = new Set<string>();

/** Save whatever this signed-in person set aside at sign-up. Safe to call any number of times. */
export async function applyPendingSignup(email: string | undefined | null): Promise<void> {
  if (!email || !isSupabaseConfigured) return;
  const key = pendingKey(email);
  if (running.has(key)) return;
  running.add(key);
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return;
    const p = JSON.parse(raw) as PendingSignup;
    if (!hasPending(p)) { await AsyncStorage.removeItem(key); return; }

    const saved: PendingPart[] = [];
    if (p.photoUri) { const r = await saveSignupPhoto(p.photoUri); if (r.ok) saved.push('photo'); }
    if (p.birthdayIso) { await saveBirthdayForCurrentUser(p.birthdayIso); saved.push('birthday'); }
    if (p.hoodieSize || p.idUri) { const note = await saveDetailsForCurrentUser({ hoodieSize: p.hoodieSize ?? null, idUri: p.idUri ?? null }); if (!note) saved.push('details'); }

    const left = remainingAfter(p, saved);
    if (left) await AsyncStorage.setItem(key, JSON.stringify(left));
    else { await AsyncStorage.removeItem(key); dropFiles(p); }
  } catch {
    // Try again the next time they are signed in.
  } finally {
    running.delete(key);
  }
}
