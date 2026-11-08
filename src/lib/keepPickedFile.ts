/**
 * Copies a file the person just picked (photo library or camera) into the app's own folder straight away.
 *
 * Two reasons. The picker hands over a temporary copy the phone may clear while the app is still busy, and — seen on a real iPhone —
 * the NEW expo-file-system File API cannot read picker files at all on some phones (File.copy throws and .exists says false on a file
 * the picker just returned), which broke every upload whose file was not re-encoded first. So the copy is made with the LEGACY
 * FileSystem API first (battle-tested against picker files for years), then the new File API, then — photos only — by re-saving the
 * picture through the image library (which reads picker files natively). If all fail, the reason for each is returned for the alert.
 *
 * The upload queue deletes the copy after a successful upload; anything that never reaches the queue is swept away after a few days
 * (sweepKeptFiles, called when the queue starts).
 */
import { Platform } from 'react-native';

const PREFIX = 'pick-';
const KEEP_MS = 3 * 24 * 60 * 60 * 1000;

const extOf = (uri: string, kind: 'image' | 'video') =>
  (uri.split('?')[0].match(/\.([A-Za-z0-9]{2,5})$/)?.[1] ?? (kind === 'video' ? 'mp4' : 'jpg')).toLowerCase();
const whyOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 120);

function newName(ext: string): string {
  return `${PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}

/** The app's own folder for kept files, as a directory address ending in a slash (made once). */
function keptDir(): string {
  const { Directory, Paths } = require('expo-file-system') as typeof import('expo-file-system');
  const dir = new Directory(Paths.document, 'media-queue');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir.uri.endsWith('/') ? dir.uri : `${dir.uri}/`;
}

export interface KeptFile { uri?: string; why?: string }

/** The kept copy's address, or the reason it could not be made. Never throws. */
export async function keepPickedFileAsync(uri: string, kind: 'image' | 'video' = 'image'): Promise<KeptFile> {
  if (Platform.OS === 'web' || !uri || /^(https?|data|blob):/i.test(uri) || uri.includes('/media-queue/')) return { uri };
  const reasons: string[] = [];
  let dirUri = '';
  try {
    dirUri = keptDir();
  } catch (e) {
    return { why: `app folder: ${whyOf(e)}` };
  }

  // 1. The legacy file API: the one picker files have always worked with.
  try {
    const legacy = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
    const to = `${dirUri}${newName(extOf(uri, kind))}`;
    await legacy.copyAsync({ from: uri, to });
    const info = await legacy.getInfoAsync(to);
    if (info.exists && (info.size ?? 0) > 0) return { uri: to };
    reasons.push('legacy copy came out empty');
  } catch (e) {
    reasons.push(`legacy: ${whyOf(e)}`);
  }

  // 2. The new file API.
  try {
    const { File } = require('expo-file-system') as typeof import('expo-file-system');
    const dest = new File(`${dirUri}${newName(extOf(uri, kind))}`);
    new File(uri).copy(dest);
    if (dest.exists) return { uri: dest.uri };
    reasons.push('copy did not appear');
  } catch (e) {
    reasons.push(`copy: ${whyOf(e)}`);
  }

  // 3. Photos only: re-save the picture through the image library, which reads picker files natively.
  if (kind === 'image') {
    try {
      const { ImageManipulator, SaveFormat } = require('expo-image-manipulator') as typeof import('expo-image-manipulator');
      const ref = await ImageManipulator.manipulate(uri).renderAsync();
      const saved = await ref.saveAsync({ compress: 1, format: SaveFormat.JPEG });
      try {
        const legacy = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
        const to = `${dirUri}${newName('jpg')}`;
        await legacy.copyAsync({ from: saved.uri, to });
        const info = await legacy.getInfoAsync(to);
        if (info.exists && (info.size ?? 0) > 0) { legacy.deleteAsync(saved.uri, { idempotent: true }).catch(() => undefined); return { uri: to }; }
      } catch { /* use it where it is: the cache file lives long enough to upload */ }
      return { uri: saved.uri };
    } catch (e) {
      reasons.push(`re-save: ${whyOf(e)}`);
    }
  }
  return { why: `${reasons.join('; ') || 'unknown'} · ...${uri.slice(-40)}` };
}

/** Like keepPickedFileAsync, but falls back to the original address so a screen that never failed before keeps working as it did. */
export async function keepPicked(uri: string, kind: 'image' | 'video' = 'image'): Promise<string> {
  return (await keepPickedFileAsync(uri, kind)).uri ?? uri;
}

/** Whether this address still points at a real, non-empty file (checked with the legacy API, which reads every address the app uses). */
export async function fileIsThere(uri: string): Promise<boolean> {
  try {
    const legacy = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
    const info = await legacy.getInfoAsync(uri);
    return info.exists && (info.size ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Deletes kept copies older than a few days, except any a pending upload still needs. */
export function sweepKeptFiles(stillNeeded: Array<string | undefined>): void {
  if (Platform.OS === 'web') return;
  try {
    const { File, Directory, Paths } = require('expo-file-system') as typeof import('expo-file-system');
    const dir = new Directory(Paths.document, 'media-queue');
    if (!dir.exists) return;
    const needed = new Set(stillNeeded.filter((u): u is string => !!u));
    const now = Date.now();
    for (const item of dir.list()) {
      if (!(item instanceof File) || !item.name.startsWith(PREFIX)) continue;
      const stamp = parseInt(item.name.slice(PREFIX.length).split('-')[0], 36);
      if (!Number.isFinite(stamp) || now - stamp < KEEP_MS || needed.has(item.uri)) continue;
      try { item.delete(); } catch { /* already gone */ }
    }
  } catch { /* housekeeping only */ }
}
