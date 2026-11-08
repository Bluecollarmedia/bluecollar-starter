/**
 * What to do to a photo or video before it is uploaded. Pure functions (no phone APIs), so the rules are tested on their own.
 *
 * Photos: about 50% JPEG quality, the long edge capped so a 12-megapixel camera photo is not stored at full size, never enlarged.
 * A photo that is already small and already a web-friendly format is not recompressed (recompressing small files only loses quality).
 * Videos: at most 720p (1280 x 720 landscape, 720 x 1280 portrait), aspect ratio kept exactly, never enlarged, with a bitrate to match.
 * (480p was tried on 2026-10-28 and looked blurry on a phone screen; 720p at about 2.8 Mbps is sharp and still a third of a phone recording.)
 */

export const IMAGE_QUALITY = 0.5;
/** Longest side of a stored photo, in pixels. Plenty for job documentation on a phone, and far smaller than a 4000 px camera original. */
export const IMAGE_MAX_EDGE = 1600;
/** A JPEG/WebP at or under this size, within the edge cap, is already optimised and is uploaded as it is. */
export const IMAGE_SKIP_BYTES = 250 * 1024;

export const VIDEO_MAX_LONG_EDGE = 1280;
export const VIDEO_MAX_SHORT_EDGE = 720;

export interface Size { width: number; height: number }

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Scales (w,h) down so the long side is at most `maxLong` and the short side at most `maxShort`, keeping the ratio. Never enlarges. */
export function fitWithin(w: number, h: number, maxLong: number, maxShort: number): Size {
  if (!(w > 0) || !(h > 0)) return { width: w, height: h };
  const long = Math.max(w, h), short = Math.min(w, h);
  const scale = Math.min(1, maxLong / long, maxShort / short);
  if (scale >= 1) return { width: w, height: h };
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

export type ImagePlan =
  | { action: 'skip'; reason: string }
  | { action: 'compress'; width: number; height: number; quality: number; resize: boolean };

export function planImage(input: { width?: number; height?: number; bytes?: number; mimeType?: string; alreadyPrepared?: boolean }): ImagePlan {
  if (input.alreadyPrepared) return { action: 'skip', reason: 'already prepared by the app' };
  const w = input.width ?? 0, h = input.height ?? 0;
  const mime = (input.mimeType ?? '').toLowerCase();
  const long = Math.max(w, h);
  const webFriendly = mime === 'image/jpeg' || mime === 'image/jpg' || mime === 'image/webp';
  if (webFriendly && input.bytes !== undefined && input.bytes <= IMAGE_SKIP_BYTES && long > 0 && long <= IMAGE_MAX_EDGE) {
    return { action: 'skip', reason: 'already small and optimised' };
  }
  const fit = long > 0 ? fitWithin(w, h, IMAGE_MAX_EDGE, IMAGE_MAX_EDGE) : { width: w, height: h };
  return { action: 'compress', width: fit.width, height: fit.height, quality: IMAGE_QUALITY, resize: long > IMAGE_MAX_EDGE };
}

export interface VideoPlan { width: number; height: number; bitrate: number; resize: boolean }

/** Output size for a video: within 1280x720 (or 720x1280 portrait), ratio kept, even numbers (H.264 needs them), never enlarged. */
export function planVideo(input: { width: number; height: number }): VideoPlan {
  const { width: w, height: h } = input;
  const fit = fitWithin(w, h, VIDEO_MAX_LONG_EDGE, VIDEO_MAX_SHORT_EDGE);
  const resize = fit.width !== w || fit.height !== h;
  const width = even(fit.width), height = even(fit.height);
  // About 3 bits per pixel per second at 30 fps: roughly 2.8 Mbps at 1280x720. Clamped so tiny clips are not starved and big ones stay small.
  const bitrate = Math.min(4_000_000, Math.max(1_000_000, Math.round(width * height * 3)));
  return { width, height, bitrate, resize };
}

/** "3.2 MB" style text for messages. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
