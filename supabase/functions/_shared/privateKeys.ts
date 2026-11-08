/**
 * Which stored files are PRIVATE. Private files live in their own R2 bucket that has no public address; they are opened only through
 * short-lived signed links that the `media` function hands out after checking who is asking. Everything else stays in the public bucket.
 *
 *   ids/{personId}/...                 ID photos — the ONLY private files
 *
 * Work photos are just pictures of properties and work, so they are public (the owner still chooses whether a photo is shared with the
 * customer). Only worker ID photos need a locked bucket. The media function has the same rule (a check keeps the two identical).
 */
const PRIVATE_FOLDERS = new Set<string>([]);

export function isPrivateKey(key: string): boolean {
  const parts = key.split('/');
  if (parts[0] === 'ids') return true;
  return parts.length >= 3 && PRIVATE_FOLDERS.has(parts[1]);
}
