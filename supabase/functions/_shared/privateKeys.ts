/**
 * Which stored files are PRIVATE. Private files live in their own R2 bucket that has no public address; they are opened only through
 * short-lived signed links that the `media` function hands out after checking who is asking. Everything else stays in the public bucket.
 *
 *   ids/{personId}/...                 ID photos — the ONLY private files
 *
 * Maintenance, Snow reference and Snow completion photos used to be private too, but they are just pictures of properties and work, so
 * they are public now (the owner still chooses whether a maintenance photo is shared with the customer). Only worker ID photos need a
 * locked bucket. The app has the same rule in src/lib/privateMedia.ts (a check keeps the two identical).
 */
const PRIVATE_FOLDERS = new Set<string>([]);

export function isPrivateKey(key: string): boolean {
  const parts = key.split('/');
  if (parts[0] === 'ids') return true;
  return parts.length >= 3 && PRIVATE_FOLDERS.has(parts[1]);
}
