/**
 * Making a login from a private invite link. The link already proves the person was invited, so the login is created already
 * confirmed by the invite-signup function (no second "confirm your email" message). Anything unexpected falls back to the normal
 * sign-up, so a function that is not deployed yet never blocks an invite.
 */
import { supabase } from '@/lib/supabase';

const REASONS: Record<string, string> = {
  used: 'This link has already been used. If you already made your login, sign in instead.',
  expired: 'This link has expired. Ask for a new one.',
  invalid: 'This link can’t be used. Ask for a new one.',
  email_exists: 'An account with this email already exists. Sign in first, then open this link again.',
  weak_password: 'Password must be at least 6 characters.',
  link_failed: 'This link was just used. If that was you, sign in instead; otherwise ask for a new link.',
};

/** 'ok' = the login exists (sign in now); 'unavailable' = use the normal sign-up instead; anything else is a message to show. */
export async function createInvitedLogin(
  email: string,
  password: string,
  profile: { firstName: string; lastName: string; phone?: string },
  token: string,
): Promise<'ok' | 'unavailable' | string> {
  const { data, error } = await supabase.functions.invoke('invite-signup', {
    body: { token, email, password, firstName: profile.firstName, lastName: profile.lastName, phone: profile.phone ?? '' },
  });
  if (!error) return (data as { ok?: boolean } | null)?.ok ? 'ok' : 'unavailable';

  const res = (error as { context?: Response }).context;
  if (res && typeof res.json === 'function') {
    // 404 = the function is not deployed; 401 = it was deployed with the login check ON (it must be OFF, see supabase/config.toml).
    // Either way the function is not usable here, so fall back to the normal sign-up instead of a dead end.
    if (res.status === 404 || res.status === 401) return 'unavailable';
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return REASONS[body?.error ?? ''] ?? 'Something went wrong. Please try again.';
  }
  return 'unavailable';
}
