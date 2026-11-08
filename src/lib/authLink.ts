// Pure helpers for the links in Supabase's emails (confirm your email, reset your password) when they open the app itself.
// The email link goes through Supabase, which then redirects to brighton-lawn://auth-callback with the short-lived sign-in
// token in the address (after the "#"). No network here.

/** Where Supabase sends the person after they tap the email link. Must also be in Supabase > Auth > URL Configuration > Redirect URLs. */
export const AUTH_CALLBACK_URL = 'brighton-lawn://auth-callback';

export type AuthLink =
  | { kind: 'session'; purpose: 'recovery' | 'confirm'; accessToken: string; refreshToken: string }
  | { kind: 'error'; message: string }
  | { kind: 'none' };

function paramsOf(url: string): URLSearchParams {
  const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : '';
  const queryStart = url.indexOf('?');
  const query = queryStart >= 0 ? url.slice(queryStart + 1, url.includes('#') ? url.indexOf('#') : undefined) : '';
  // Supabase uses the part after "#"; some setups put the same values after "?". Read both, the "#" part wins.
  const merged = new URLSearchParams(query);
  new URLSearchParams(hash).forEach((v, k) => merged.set(k, v));
  return merged;
}

/** What an incoming address means. Never throws; anything unrecognised is { kind: 'none' }. */
export function parseAuthLink(url: string | null | undefined): AuthLink {
  if (!url) return { kind: 'none' };
  const p = paramsOf(url);
  const error = p.get('error_description') || p.get('error');
  if (error) {
    const code = p.get('error_code') ?? '';
    if (/expired|invalid/i.test(code + ' ' + error)) {
      return { kind: 'error', message: 'This link has expired or was already used. Go back to Sign In and ask for a new one.' };
    }
    return { kind: 'error', message: error.replace(/\+/g, ' ') };
  }
  const accessToken = p.get('access_token');
  const refreshToken = p.get('refresh_token');
  if (!accessToken || !refreshToken) return { kind: 'none' };
  return { kind: 'session', purpose: p.get('type') === 'recovery' ? 'recovery' : 'confirm', accessToken, refreshToken };
}
