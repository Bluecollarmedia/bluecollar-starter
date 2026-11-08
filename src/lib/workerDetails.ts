// A worker's hoodie size and ID photo (supabase/updates/058). Pure helpers: the sizes, the private folder, and the wording.
export const HOODIE_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'] as const;
export type HoodieSize = (typeof HOODIE_SIZES)[number];

export const isHoodieSize = (v: unknown): v is HoodieSize => typeof v === 'string' && (HOODIE_SIZES as readonly string[]).includes(v);

/** The private folder for one person's ID photo. Only that person may upload here (the media function checks it). */
export const idFolder = (personId: string) => `ids/${personId}`;

/** A saved ID key is only ever one of this person's own private files. */
export const isIdKeyFor = (personId: string, key: unknown): key is string =>
  typeof key === 'string' && key.startsWith(`ids/${personId}/`) && /^[A-Za-z0-9._\-/]+$/.test(key) && !key.includes('..');

export const ID_PRIVACY_TEXT = 'Only you and the company owner can see your ID. It is stored privately, never on a public link.';
