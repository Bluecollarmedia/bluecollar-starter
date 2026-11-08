/**
 * Forgot password. Sends a reset link to the person's email; in the app the link opens the app (auth-callback, then
 * the Choose a new password screen), on the web it opens the web page (/reset-password). Needs Supabase's email sending to be set up (a custom sender such as Resend);
 * until then the request fails with a polite message that points to support.
 */
import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { AUTH_CALLBACK_URL } from '@/lib/authLink';
import { config } from '@/lib/config';
import { looksLikeEmail, newPasswordError, newPasswordProblem, resetRedirectUrl, resetRequestError } from '@/lib/passwordReset';

export type Result = { ok: true } | { ok: false; error: string };

/** Emails the reset link. Says "sent" for any address that looks right, so nobody can probe which emails have accounts. */
export async function requestPasswordReset(email: string): Promise<Result> {
  if (!looksLikeEmail(email)) return { ok: false, error: 'Enter the email address you signed up with.' };
  if (!isSupabaseConfigured) return { ok: false, error: 'Password reset needs the live database, which is not connected in this version of the app.' };
  try {
    // In the app the email link comes back into the app (auth-callback); on the web it opens the web page.
    const options = Platform.OS !== 'web' ? { redirectTo: AUTH_CALLBACK_URL } : config.webUrl ? { redirectTo: resetRedirectUrl(config.webUrl) } : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), options);
    if (error) return { ok: false, error: resetRequestError(error) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: resetRequestError(err) };
  }
}

/** Saves the new password for the person who opened the reset link (they are signed in by the link). */
export async function setNewPassword(password: string, confirm: string): Promise<Result> {
  const problem = newPasswordProblem(password, confirm);
  if (problem) return { ok: false, error: problem };
  if (!isSupabaseConfigured) return { ok: false, error: 'Password reset needs the live database.' };
  try {
    const { data } = await supabase.auth.getSession();
    if (!data?.session) return { ok: false, error: newPasswordError('session missing') };
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { ok: false, error: newPasswordError(error) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: newPasswordError(err) };
  }
}
