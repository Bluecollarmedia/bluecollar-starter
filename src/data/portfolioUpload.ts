/**
 * Sends the owner's pictures and videos for Our Work to the public bucket (phone only). Photos: saved at a long side of up to 1600 px plus a
 * small square copy for the grid. Videos: shrunk to 720p first (the original goes up if that cannot be done), plus a still frame for the grid.
 */
import { uploadImage } from '@/lib/media';
import {
  FULL_LONG_SIDE, FULL_QUALITY, THUMB_QUALITY, THUMB_SIZE, fitLongSide, portfolioFolder, squareCrop, thumbFolder, type PortfolioFolder,
} from '@/lib/portfolioMedia';

export interface UploadedPhoto { url: string; key: string; thumbUrl: string; thumbKey: string; width: number; height: number }
export interface UploadedVideo { url: string; key: string; thumbUrl: string | null; thumbKey: string | null }

/** A photo: one full copy (long side up to 1600 px) and one small square copy. `onProgress` goes 0 to 1 across both. */
export async function uploadPortfolioPhoto(localUri: string, companyId: string, kind: PortfolioFolder = 'posts', onProgress?: (p: number) => void): Promise<UploadedPhoto> {
  onProgress?.(0);
  const { ImageManipulator, SaveFormat } = require('expo-image-manipulator') as typeof import('expo-image-manipulator');
  const probe = await ImageManipulator.manipulate(localUri).renderAsync();
  const fit = fitLongSide(probe.width, probe.height, FULL_LONG_SIDE);
  let ctx = ImageManipulator.manipulate(localUri);
  if (fit.width < probe.width) ctx = ctx.resize({ width: fit.width });
  const full = await (await ctx.renderAsync()).saveAsync({ compress: FULL_QUALITY, format: SaveFormat.JPEG });

  // The small copy is cut from the saved (upright) picture, so the crop always matches what people see.
  const sq = squareCrop(full.width, full.height);
  const small = await (await ImageManipulator.manipulate(full.uri)
    .crop({ originX: sq.originX, originY: sq.originY, width: sq.size, height: sq.size })
    .resize({ width: THUMB_SIZE })
    .renderAsync()).saveAsync({ compress: THUMB_QUALITY, format: SaveFormat.JPEG });

  const big = await uploadImage(full.uri, portfolioFolder(companyId, kind), 'image/jpeg', (p) => onProgress?.(p * 0.9), { raw: true });
  onProgress?.(0.9);
  const thumb = await uploadImage(small.uri, thumbFolder(companyId, kind), 'image/jpeg', undefined, { raw: true });
  onProgress?.(1);
  return { url: big.url, key: big.key, thumbUrl: thumb.url, thumbKey: thumb.key, width: full.width, height: full.height };
}

/** A video, shrunk to 720p. The still frame for the grid is best effort: a video with no frame still posts (its tile just has no picture). */
export async function uploadPortfolioVideo(localUri: string, companyId: string, kind: PortfolioFolder = 'posts', frameAtS = 0.5, onProgress?: (p: number) => void, size?: { width?: number | null; height?: number | null }): Promise<UploadedVideo> {
  const { shrinkVideoUri } = require('@/lib/mediaCompress') as typeof import('@/lib/mediaCompress');
  onProgress?.(0);
  const source = await shrinkVideoUri(localUri, size);
  // The video's own bytes are most of the wait: they move the bar from 5% to 90%; the still frame for the grid is the last bit.
  onProgress?.(0.05);
  const up = await uploadImage(source, portfolioFolder(companyId, kind), 'video/mp4', (p) => onProgress?.(0.05 + p * 0.85), { raw: true });
  onProgress?.(0.9);
  const frame = await videoFrameToFile(localUri, frameAtS);
  if (!frame) { onProgress?.(1); return { url: up.url, key: up.key, thumbUrl: null, thumbKey: null }; }
  try {
    const thumb = await uploadImage(frame, thumbFolder(companyId, kind), 'image/jpeg', undefined, { raw: true });
    onProgress?.(1);
    return { url: up.url, key: up.key, thumbUrl: thumb.url, thumbKey: thumb.key };
  } catch {
    onProgress?.(1);
    return { url: up.url, key: up.key, thumbUrl: null, thumbKey: null };
  }
}

/** One frame of a video, saved as a picture file (null when the phone cannot make it). */
export async function videoFrameToFile(videoUri: string, atS: number): Promise<string | null> {
  return (await videoFrameAt(videoUri, atS))?.uri ?? null;
}

/**
 * Waits until a player has loaded its video (status readyToPlay), so a frame can be taken from it. Taking a frame before that fails on iOS:
 * the player has no asset yet. Gives up after `timeoutMs` (resolves false) and never throws.
 */
export function waitUntilReady(player: import('expo-video').VideoPlayer, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    let sub: { remove: () => void } | null = null;
    const finish = (ok: boolean) => { if (done) return; done = true; clearTimeout(timer); try { sub?.remove(); } catch { /* gone */ } resolve(ok); };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      if (player.status === 'readyToPlay') { finish(true); return; }
      if (player.status === 'error') { finish(false); return; }
      sub = player.addListener('statusChange', ({ status }) => { if (status === 'readyToPlay') finish(true); else if (status === 'error') finish(false); });
      // It may have become ready between the first look and the listener; look once more.
      const now: string = player.status;
      if (now === 'readyToPlay') finish(true);
    } catch { finish(false); }
  });
}

/** The same, with the picture's size (the crop step needs it). The moment asked for first; the very start if that fails. */
export async function videoFrameAt(videoUri: string, atS: number): Promise<{ uri: string; width: number; height: number } | null> {
  try {
    const { createVideoPlayer } = require('expo-video') as typeof import('expo-video');
    const { ImageManipulator, SaveFormat } = require('expo-image-manipulator') as typeof import('expo-image-manipulator');
    const player = createVideoPlayer(videoUri);
    try {
      await waitUntilReady(player);
      let frame: import('expo-video').VideoThumbnail | undefined;
      try { [frame] = await player.generateThumbnailsAsync(atS, { maxWidth: 1080 }); } catch { frame = undefined; }
      if (!frame && atS > 0) { try { [frame] = await player.generateThumbnailsAsync(0, { maxWidth: 1080 }); } catch { frame = undefined; } }
      if (!frame) return null;
      const saved = await (await ImageManipulator.manipulate(frame).renderAsync()).saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
      return { uri: saved.uri, width: saved.width, height: saved.height };
    } finally {
      player.release();
    }
  } catch {
    return null;
  }
}
