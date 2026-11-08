/**
 * Compresses a photo or video on the phone before it is uploaded (rules in mediaPlan.ts).
 *
 * Photos use expo-image-manipulator (already in the app): resized so the long side is at most 1600 px, saved as JPEG at 50% quality.
 * The picker's own EXIF rotation is applied by the manipulator, so the stored photo is upright and keeps its aspect ratio.
 *
 * Videos use react-native-compressor (720p cap, bitrate from planVideo()); if that cannot run, the original video is sent instead.
 */
import { Platform } from 'react-native';
import { File, Directory, Paths } from 'expo-file-system';
import { CompressionError, type MediaJob } from './mediaQueue';
import { planImage, planVideo, formatBytes, type ImagePlan } from './mediaPlan';

export const OUT_MARK = '/media-queue/out/';
/** A file this module already produced. */
export const isPrepared = (uri: string) => uri.includes(OUT_MARK);

function outFile(ext: string): File {
  const dir = new Directory(Paths.document, 'media-queue', 'out');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return new File(dir, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
}

const sizeOf = (uri: string): number | undefined => {
  try { return new File(uri).size ?? undefined; } catch { return undefined; }
};

export interface Prepared { uri: string; bytes?: number; width?: number; height?: number; mimeType: string }

export async function prepareImage(job: MediaJob): Promise<Prepared> {
  const bytesIn = job.bytesIn ?? sizeOf(job.sourceUri);
  const first = planImage({ width: job.width, height: job.height, bytes: bytesIn, mimeType: job.mimeType, alreadyPrepared: isPrepared(job.sourceUri) });
  if (first.action === 'skip') return { uri: job.sourceUri, bytes: bytesIn, width: job.width, height: job.height, mimeType: job.mimeType ?? 'image/jpeg' };
  try {
    const { ImageManipulator, SaveFormat } = require('expo-image-manipulator') as typeof import('expo-image-manipulator');
    let plan: ImagePlan = first;
    let ctx = ImageManipulator.manipulate(job.sourceUri);
    if (!job.width || !job.height) {
      // The picker did not tell us the size: read it, then decide.
      const probe = await ctx.renderAsync();
      plan = planImage({ width: probe.width, height: probe.height, bytes: bytesIn, mimeType: job.mimeType });
      ctx = ImageManipulator.manipulate(job.sourceUri);
      if (plan.action === 'skip') return { uri: job.sourceUri, bytes: bytesIn, width: probe.width, height: probe.height, mimeType: job.mimeType ?? 'image/jpeg' };
    }
    if (plan.action === 'compress' && plan.resize) {
      // Only the long side is given, so the other follows and the ratio is kept exactly.
      ctx = plan.width >= plan.height ? ctx.resize({ width: plan.width }) : ctx.resize({ height: plan.height });
    }
    const ref = await ctx.renderAsync();
    const saved = await ref.saveAsync({ compress: plan.action === 'compress' ? plan.quality : 0.5, format: SaveFormat.JPEG });
    let uri = saved.uri;
    if (Platform.OS !== 'web') {
      // The LEGACY file API, like the picker copy: on some phones the new File API cannot see files the image tools just wrote, so a copy made
      // with it can be missing (the upload then said "the file is gone"). Whatever happens, never hand on an address that is not a real file.
      const legacy = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
      const dest = outFile('jpg');
      try {
        await legacy.copyAsync({ from: saved.uri, to: dest.uri });
        const info = await legacy.getInfoAsync(dest.uri);
        if (info.exists && (info.size ?? 0) > 0) {
          uri = dest.uri;
          try { await legacy.deleteAsync(saved.uri, { idempotent: true }); } catch { /* cache file; harmless */ }
        }
      } catch { /* keep the prepared file where it is */ }
    }
    const bytes = Platform.OS === 'web' ? undefined : sizeOf(uri);
    // A "compressed" file that came out BIGGER than a small original is not an improvement: keep the original in that case.
    if (bytes !== undefined && bytesIn !== undefined && bytes >= bytesIn && !(plan.action === 'compress' && plan.resize)) {
      try { new File(uri).delete(); } catch { /* ignore */ }
      return { uri: job.sourceUri, bytes: bytesIn, width: job.width, height: job.height, mimeType: job.mimeType ?? 'image/jpeg' };
    }
    return { uri, bytes, width: saved.width, height: saved.height, mimeType: 'image/jpeg' };
  } catch (err) {
    throw new CompressionError(`The photo couldn't be prepared (${(err as Error)?.message ?? 'unknown error'}).`);
  }
}

/**
 * Videos are shrunk to 720p on the phone before they go up (react-native-compressor, bitrate from planVideo()), so they upload and load fast.
 * If the compressor is missing, the phone cannot do it, or the result is not smaller, the original goes up instead: a video is never lost or blocked.
 */
export async function prepareVideo(job: MediaJob): Promise<Prepared> {
  const original: Prepared = { uri: job.sourceUri, bytes: job.bytesIn ?? sizeOf(job.sourceUri), width: job.width, height: job.height, mimeType: job.mimeType ?? 'video/mp4' };
  if (Platform.OS === 'web' || isPrepared(job.sourceUri)) return original;
  let compressor: { Video: { compress: (uri: string, opts: Record<string, unknown>, onProgress?: (p: number) => void) => Promise<string> } } | undefined;
  try { compressor = require('react-native-compressor'); } catch { compressor = undefined; }
  if (!compressor?.Video) return original;
  // The compressor takes the LONG side as its limit, so a plan for a 1920x1080 source gives the right limit (1280) whatever the orientation.
  // (A square guess here once shrank every Our Work video to 404x720: measured on the server on 2026-10-28.)
  const plan = job.width && job.height ? planVideo({ width: job.width, height: job.height }) : planVideo({ width: VIDEO_FALLBACK_W, height: VIDEO_FALLBACK_H });
  // Already 720p or smaller (the picker hands videos over at 720p): sent as it is, never encoded a second time.
  if (!plan.resize) return original;
  try {
    // maxSize is the longest side: 1280 keeps landscape at 1280x720 and portrait at 720x1280, aspect ratio unchanged. Audio is kept.
    const made = await compressor.Video.compress(job.sourceUri, { compressionMethod: 'manual', maxSize: Math.max(plan.width, plan.height), bitrate: plan.bitrate, minimumFileSizeForCompress: 0 });
    // The LEGACY file API, like the photos: on some phones the new File API cannot see a file the compressor just wrote, so a copy made with it
    // can be missing (the upload then said "the file is gone"). The result is checked to be a real file before it is handed on; if it is not,
    // the original goes up.
    const legacy = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
    const exists = async (u: string) => { try { const i = await legacy.getInfoAsync(u); return i.exists && (i.size ?? 0) > 0 ? i.size ?? 0 : 0; } catch { return 0; } };
    let uri = made;
    const dest = outFile('mp4');
    try {
      await legacy.copyAsync({ from: made, to: dest.uri });
      if (await exists(dest.uri)) { uri = dest.uri; try { await legacy.deleteAsync(made, { idempotent: true }); } catch { /* cache file */ } }
    } catch { /* keep the compressor's own file */ }
    const bytes = (await exists(uri)) || undefined;
    if (!bytes) return original;
    if (bytes !== undefined && original.bytes !== undefined && bytes >= original.bytes) {
      // Already tighter than the target: keep the original instead of a bigger "compressed" copy.
      try { new File(uri).delete(); } catch { /* ignore */ }
      return original;
    }
    return { uri, bytes, width: plan.width, height: plan.height, mimeType: 'video/mp4' };
  } catch {
    return original;
  }
}

/**
 * Shrinks a video file for the screens that upload straight away (Our Work posts and stories); the original comes back if it cannot be shrunk.
 * Give the video's real size when the picker reported it: a video already 720p or smaller is then sent as it is.
 */
export async function shrinkVideoUri(uri: string, size?: { width?: number | null; height?: number | null }): Promise<string> {
  try {
    const job = { sourceUri: uri, kind: 'video', width: size?.width || undefined, height: size?.height || undefined } as unknown as MediaJob;
    return (await prepareVideo(job)).uri;
  } catch { return uri; }
}

// If the picker did not report the video's size, plan for a 1080p source (the result only sets maxSize, which never enlarges).
const VIDEO_FALLBACK_W = 1920;
const VIDEO_FALLBACK_H = 1080;

export const describeSaving = (inBytes?: number, outBytes?: number) =>
  inBytes && outBytes ? `${formatBytes(inBytes)} → ${formatBytes(outBytes)}` : '';
