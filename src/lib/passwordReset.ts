// Pure helpers for "Forgot password". No network.
import { BUSINESS } from '@/legal/legalContent';

/** The web page the email link opens (hosted with the web app, so it works from any phone or computer). */
export const RESET_PAGE_PATH = '/reset-password';
export const MIN_PASSWORD_LENGTH = 8;

export function resetRedirectUrl(webUrl: string): string {
  return `${webUrl.replace(/\/+$/, '')}${RESET_PAGE_PATH}`;
}

export const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

/** '' when the new password is fine, otherwise what is wrong. */
export function newPasswordProblem(password: string, confirm: string): string {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== confirm) return 'The two passwords do not match.';
  return '';
}

const contact = `Please contact us at ${BUSINESS.email} or ${BUSINESS.phone} and we will help.`;

/** A plain sentence for a failed "send reset email" call. The raw text is kept in brackets when it is not a known cause. */
export function resetRequestError(raw: unknown): string {
  const text = (raw instanceof Error ? raw.message : typeof raw === 'object' && raw && 'message' in raw ? String((raw as { message: unknown }).message) : String(raw ?? '')).trim();
  if (/rate limit|too many|over_email_send_rate_limit|security purposes/i.test(text)) return 'Too many tries. Please wait a few minutes and try again.';
  if (/error sending|smtp|email provider|unable to send|failed to send|not authorized|not allowed|sending recovery/i.test(text)) {
    return `We couldn't send the email right now. ${contact}`;
  }
  if (/network request failed|failed to fetch|network error|timeout/i.test(text)) return "Couldn't reach the server. Check your connection and try again.";
  return `We couldn't send the email. ${contact}${text ? ` (${text})` : ''}`;
}

/** A plain sentence for a failed "set new password" call. */
export function newPasswordError(raw: unknown): string {
  const text = (raw instanceof Error ? raw.message : typeof raw === 'object' && raw && 'message' in raw ? String((raw as { message: unknown }).message) : String(raw ?? '')).trim();
  if (/session|jwt|token|expired|not authenticated|missing/i.test(text)) return 'This link has expired or was already used. Go back to Sign In and tap Forgot password to get a new one.';
  if (/different from the old|same as the old|should be different/i.test(text)) return 'Choose a password you have not used before.';
  if (/weak|at least|characters|pwned|easy to guess/i.test(text)) return 'That password is too easy to guess. Try a longer one with letters and numbers.';
  if (/network request failed|failed to fetch|network error|timeout/i.test(text)) return "Couldn't reach the server. Check your connection and try again.";
  return `Couldn't change the password. ${text}`.trim();
}
