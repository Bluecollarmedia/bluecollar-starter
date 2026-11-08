/**
 * How Our Work pictures are made (pure: no phone, no network). The owner chose (2026-10-28): photos shrunk to 1600 px, videos shrunk to 720p, and a
 * small square copy of every picture just for the grid, so a screen of tiles is light to load.
 */

/** The long side of a full photo (a phone photo is usually 3000 to 4000 px, so this keeps it sharp but much lighter). */
export const FULL_LONG_SIDE = 1600;
export const FULL_QUALITY = 0.85;
/** The grid copy: a centred square, this many pixels on a side. */
export const THUMB_SIZE = 400;
export const THUMB_QUALITY = 0.6;

/** The size a photo is saved at: the long side is at most `max`, the shape is kept, and a smaller photo is never enlarged. */
export function fitLongSide(width: number, height: number, max: number = FULL_LONG_SIDE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const long = Math.max(width, height);
  if (long <= max) return { width: Math.round(width), height: Math.round(height) };
  const k = max / long;
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

/** The centred square cut out of a picture for the grid copy. */
export function squareCrop(width: number, height: number): { originX: number; originY: number; size: number } {
  const size = Math.max(0, Math.floor(Math.min(width, height)));
  return { originX: Math.floor((width - size) / 2), originY: Math.floor((height - size) / 2), size };
}

export type PortfolioFolder = 'posts' | 'stories' | 'covers' | 'music';

/** Where the owner's files go in the public bucket (the media function lets a member upload anywhere under their company's id). */
export const portfolioFolder = (companyId: string, kind: PortfolioFolder): string => `${companyId}/portfolio/${kind}`;
export const thumbFolder = (companyId: string, kind: PortfolioFolder): string => `${portfolioFolder(companyId, kind)}/thumbs`;

/** The longest a video may be, in seconds, and how it is stored: as it came off the phone. */
export const MAX_VIDEO_SECONDS = 180;
export const VIDEO_IS_COMPRESSED = true;
