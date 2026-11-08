// Turns the raw error text from a failed photo/video upload into a sentence that says what to do.
// The raw text is always kept in brackets so the real cause is never hidden.
import { tr } from '@/i18n';

const RULES: { test: RegExp; say: string }[] = [
  { test: /bucket not found/i, say: "Photo storage isn't set up on the server yet (the storage bucket is missing)." },
  { test: /\b(jwt|token)\b.*(expired|invalid|malformed)|invalid.*\b(jwt|token)\b|\b401\b/i, say: 'Your sign-in has expired. Sign out and sign in again, then retry.' },
  { test: /row-level security|violates.*polic|not authorized|unauthorized|permission denied|\b403\b/i, say: "The server refused this upload. You may be signed out, not on this company's team, or the stop/job is already closed." },
  { test: /exceeded the maximum allowed size|payload too large|entity too large|too large|\b413\b/i, say: 'This file is bigger than the server allows. Try a smaller photo or a shorter video.' },
  { test: /mime type|invalid_mime|not supported|unsupported/i, say: "The server doesn't accept this kind of file." },
  { test: /r2 is not set up|r2_not_configured/i, say: "Cloud photo storage (R2) isn't fully set up yet." },
  { test: /failed to send a request to the edge function|functionsfetcherror|edge function/i, say: "The photo service function isn't reachable. It may not be deployed yet." },
  { test: /network request failed|failed to fetch|network error|networkerror|timed? ?out|timeout|offline|internet/i, say: "Couldn't reach the server. Check the phone's connection and try again." },
  { test: /no such file|enoent|file not found|could not load|cannot read/i, say: 'The phone could not read that photo file. Pick it again.' },
];

/** A friendly explanation plus the raw text, or just the raw text when it isn't a known cause. */
export function explainUploadError(raw: unknown): string {
  const fromObject = typeof raw === 'object' && raw !== null && typeof (raw as { message?: unknown }).message === 'string'
    ? (raw as { message: string }).message
    : null;
  const text = (fromObject ?? String(raw ?? '')).trim() || 'Unknown error';
  const rule = RULES.find((r) => r.test.test(text));
  return rule ? `${tr(rule.say)} (${text})` : text;
}

/** Message used when there is no signed-in session, so the server would refuse the upload anyway. */
export const SIGNED_OUT_UPLOAD_MESSAGE = "You're signed out, so the file can't be saved. Sign out and sign in again, then retry.";
