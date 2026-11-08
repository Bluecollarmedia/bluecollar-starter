/**
 * The optional profile photo chosen while creating an account. It can only be saved once the new account is signed in, so this
 * runs right after sign-up: find my own person row, upload the picture to my avatar folder, and put its address on my profile.
 * A failure never undoes the account; the caller tells the person and points them to Edit Profile.
 */
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { uploadImage } from '@/lib/media';

export type SignupPhotoResult = { ok: true } | { ok: false; error: string };

export async function saveSignupPhoto(localUri: string): Promise<SignupPhotoResult> {
  if (!isSupabaseConfigured) return { ok: true };
  try {
    const { data: ctx } = await supabase.rpc('get_my_context');
    const personId = (ctx as { person?: { id: string } } | null)?.person?.id;
    if (!personId) return { ok: false, error: "Your profile wasn't ready yet." };
    const { url } = await uploadImage(localUri, `avatars/${personId}`);
    const { error } = await supabase.from('people').update({ avatar_url: url }).eq('id', personId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
