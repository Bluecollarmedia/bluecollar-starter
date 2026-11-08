/**
 * Which stored files (in the public R2 bucket) belong to an Our Work item, so deleting the item can delete its files too: a post's photos AND
 * their small grid copies, its videos and their still frames, its own cover, its music; a story's picture or video; a highlight's own circle
 * picture. Pure: no phone, no network. A file is only ever named if its address is under THIS company's own portfolio folder
 * (`<company>/portfolio/...`): a project photo borrowed from another place, or anyone else's file, is never touched.
 */
type Addressed = { url?: string | null; thumb_url?: string | null; storage_key?: string | null };

/** The storage key of a public file address ("<public base>/<key>"), or null when it is not one of this company's portfolio files. */
export function portfolioKeyFromUrl(url: string | null | undefined, publicBase: string, companyId: string): string | null {
  if (!url || !publicBase || !companyId) return null;
  const base = publicBase.replace(/\/+$/, '') + '/';
  if (!url.startsWith(base)) return null;
  const key = decodeURI(url.slice(base.length).split('?')[0]);
  return key.startsWith(`${companyId}/portfolio/`) && !key.includes('..') ? key : null;
}

const own = (companyId: string, key: string | null | undefined): string | null => (key && key.startsWith(`${companyId}/portfolio/`) && !key.includes('..') ? key : null);

/** Every file of one picture or video: the file itself and its small copy / still frame. */
export function mediaFileKeys(m: Addressed, publicBase: string, companyId: string): string[] {
  return [...new Set([own(companyId, m.storage_key), portfolioKeyFromUrl(m.url, publicBase, companyId), portfolioKeyFromUrl(m.thumb_url, publicBase, companyId)].filter((k): k is string => !!k))];
}

export function postFileKeys(
  post: { media: Addressed[]; cover_url?: string | null; cover_thumb_url?: string | null; music_url?: string | null },
  publicBase: string,
  companyId: string,
): string[] {
  const keys = new Set<string>();
  for (const m of post.media) for (const k of mediaFileKeys(m, publicBase, companyId)) keys.add(k);
  for (const u of [post.cover_url, post.cover_thumb_url, post.music_url]) { const k = portfolioKeyFromUrl(u, publicBase, companyId); if (k) keys.add(k); }
  return [...keys];
}

export function storyFileKeys(story: { media_url?: string | null; media_thumb_url?: string | null }, publicBase: string, companyId: string): string[] {
  return [...new Set([portfolioKeyFromUrl(story.media_url, publicBase, companyId), portfolioKeyFromUrl(story.media_thumb_url, publicBase, companyId)].filter((k): k is string => !!k))];
}

/** A highlight's circle picture is a file only when the owner uploaded one (it sits in the covers folder); otherwise it points at a post photo that must stay. */
export function highlightFileKeys(h: { cover_url?: string | null }, publicBase: string, companyId: string): string[] {
  const k = portfolioKeyFromUrl(h.cover_url, publicBase, companyId);
  return k && k.includes('/portfolio/covers/') ? [k] : [];
}

/** The files that were in an old version of a post and are not in the new one (a replaced cover, a replaced or removed song, a removed picture). */
export function replacedFileKeys(before: string[], after: string[]): string[] {
  const keep = new Set(after);
  return before.filter((k) => !keep.has(k));
}
