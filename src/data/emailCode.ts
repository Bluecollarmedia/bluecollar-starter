/**
 * Confirming a new owner's email with the code in the "Confirm your signup" email, typed into the app.
 * Replaces tapping the email link, which had to bounce through a browser back into the app and often failed.
 * A correct code signs the person in (the app then routes them like any sign-in).
 */
import { supabase } from '@/lib/supabase';

export type CodeResult = { ok: true } | { ok: false; error: string };

/** Just the digits, so spaces or dashes pasted from the email do not matter. */
export const cleanCode = (raw: string): string => raw.replace(/\D/g, '');

export async function verifyEmailCode(email: string, code: string): Promise<CodeResult> {
  const token = cleanCode(code);
  if (token.length < 6) return { ok: false, error: 'Enter the code from the email.' };
  const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'signup' });
  if (!error) return { ok: true };
  if (/expired|invalid/i.test(`${error.code ?? ''} ${error.message}`)) {
    return { ok: false, error: 'That code is wrong or has expired. Check the newest email, or send a new code.' };
  }
  return { ok: false, error: error.message };
}

export async function resendEmailCode(email: string): Promise<CodeResult> {
  const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() });
  if (!error) return { ok: true };
  if (/rate|too many|seconds/i.test(`${error.code ?? ''} ${error.message}`)) {
    return { ok: false, error: 'Too many emails were sent just now. Wait a minute, then try again.' };
  }
  return { ok: false, error: error.message };
}

/** Supabase's answer when someone signs in before confirming their email. */
export const isEmailNotConfirmed = (err: { code?: string; message?: string } | null | undefined): boolean =>
  !!err && (err.code === 'email_not_confirmed' || /email not confirmed/i.test(err.message ?? ''));
