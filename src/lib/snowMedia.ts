/**
 * Snow reference photos/videos live in the private "snow-media" bucket
 * (supabase/updates/022), not the public "media" bucket: a plow lead must not
 * be able to open shoveling media just by having its link. Files are shown
 * through short-lived signed links that the database only issues to people
 * allowed to see that property service.
 *
 * Paths: {companyId}/reference/{propertyServiceId}/{random}.{ext}
 */

import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from './supabase';
import { uuid } from './ids';
import { r2Enabled, requireSession } from './media';
import { withTimeout } from './mediaQueue';
import { putFile } from './uploadFile';
import { explainUploadError } from './uploadErrors';

export const SNOW_MEDIA_BUCKET = 'snow-media';

/** How long a signed link stays valid. Long enough to watch a video. */
const SIGNED_URL_SECONDS = 60 * 60;

function contentTypeOf(uri: string, mimeType?: string): { contentType: string; ext: string } {
  const lower = uri.split('?')[0].toLowerCase();
  const mime = (mimeType ?? '').toLowerCase();
  if (mime === 'video/quicktime' || lower.endsWith('.mov')) return { contentType: 'video/quicktime', ext: 'mov' };
  if (mime.startsWith('video/') || lower.endsWith('.mp4') || lower.endsWith('.m4v')) return { contentType: 'video/mp4', ext: 'mp4' };
  if (mime === 'image/png' || lower.endsWith('.png')) return { contentType: 'image/png', ext: 'png' };
  if (mime === 'image/webp' || lower.endsWith('.webp')) return { contentType: 'image/webp', ext: 'webp' };
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) return { contentType: 'image/heic', ext: 'heic' };
  return { contentType: 'image/jpeg', ext: 'jpg' };
}

export function snowReferenceFolder(companyId: string, propertyServiceId: string): string {
  return `${companyId}/reference/${propertyServiceId}`;
}

/** Runs `work`, giving up with a plain message if it takes longer than `ms`: a stalled connection must never leave a photo "uploading" forever. */
const within = <T,>(work: Promise<T>, ms: number, what: string): Promise<T> =>
  withTimeout(work, ms, () => new Error(`${what} timed out after ${Math.round(ms / 1000)} seconds`));

/** What a failed function call actually said. The library's own message only ever says "non-2xx status code". */
async function functionFailure(error: unknown, data: unknown): Promise<string> {
  const res = (error as { context?: Response } | null)?.context;
  if (res && typeof res.json === 'function') {
    const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    return `${res.status}: ${body?.error ?? body?.message ?? 'no reason given'}`;
  }
  return (data as { error?: string } | null)?.error ?? (error as { message?: string } | null)?.message ?? 'no answer';
}

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
/** How long the file itself may take to send: photos are small, videos can be big. */
const sendMs = (contentType: string) => (contentType.startsWith('video/') ? 300_000 : 90_000);

/**
 * The cloud route: a 1-byte stand-in goes to the private bucket (so the database's permission rules decide who may write and read the
 * file), then the real file goes to cloud storage through a short-lived link. Every step says what it was doing if it fails.
 */
async function putViaCloud(localUri: string, key: string, contentType: string, onProgress?: (p: number) => void): Promise<void> {
  const reserved = await within(
    supabase.storage.from(SNOW_MEDIA_BUCKET).upload(key, new Uint8Array([0]).buffer, { contentType, upsert: false }),
    30_000, 'Reserving the file',
  );
  if (reserved.error) throw new Error(`Couldn't reserve the file: ${explainUploadError(reserved.error.message)}`);
  try {
    const link = await within(supabase.functions.invoke('media', { body: { action: 'snow-put', key, contentType } }), 30_000, 'Asking for the upload link');
    if (link.error || !link.data?.uploadUrl) throw new Error(`The upload link was refused (${await functionFailure(link.error, link.data)})`);
    // The file is sent by the phone's own file upload (not JavaScript fetch + Blob, which is unreliable on a phone): see uploadFile.ts.
    const sent = await putFile(localUri, link.data.uploadUrl, contentType, sendMs(contentType), onProgress);
    if (sent.status < 200 || sent.status >= 300) {
      const code = sent.body.match(/<Code>([^<]+)<\/Code>/)?.[1];
      throw new Error(`Cloud storage answered ${sent.status}${code ? ` (${code})` : ''}`);
    }
  } catch (err) {
    await supabase.storage.from(SNOW_MEDIA_BUCKET).remove([key]);
    throw err;
  }
}

/** The backup route: the whole file goes straight into the private bucket (no stand-in, no cloud link). */
async function putViaBackup(localUri: string, key: string, contentType: string): Promise<void> {
  let body: Blob | FormData;
  if (Platform.OS === 'web') {
    body = await (await fetch(localUri)).blob();
  } else {
    const form = new FormData();
    form.append('file', { uri: localUri, name: key.split('/').pop(), type: contentType } as unknown as Blob);
    body = form;
  }
  const { error } = await within(
    supabase.storage.from(SNOW_MEDIA_BUCKET).upload(key, body, { contentType, upsert: false }),
    sendMs(contentType), 'Sending the file',
  );
  if (error) throw new Error(explainUploadError(error.message));
}

/**
 * Uploads a local photo/video to the private bucket and returns its key. Tries cloud storage first; if that fails for any reason the
 * file goes to the private bucket directly, so a cloud-storage problem never stops a photo. If both fail, the message says what each
 * one said, so the real cause is on the screen and not hidden behind "check your connection".
 */
export async function uploadSnowMedia(localUri: string, folder: string, mimeType?: string, onProgress?: (p: number) => void): Promise<string> {
  if (!isSupabaseConfigured) throw new Error('Snow media needs the live database.');
  let { contentType, ext } = contentTypeOf(localUri, mimeType);
  await requireSession();
  // Photos are compressed like everywhere else (about 50% quality, long side at most 1600 px). Videos are not compressed here yet
  // (see mediaCompress.ts: needs the video library added to the app).
  if (contentType.startsWith('image/')) {
    const { prepareImage, isPrepared } = require('./mediaCompress') as typeof import('./mediaCompress');
    if (!isPrepared(localUri)) {
      const p = await prepareImage({ sourceUri: localUri, mimeType: contentType } as import('./mediaQueue').MediaJob);
      if (p.uri !== localUri) { localUri = p.uri; contentType = 'image/jpeg'; ext = 'jpg'; }
    }
  }

  let cloudWhy = '';
  if (r2Enabled) {
    const key = `${folder}/${uuid()}.${ext}`;
    try {
      await putViaCloud(localUri, key, contentType, onProgress);
      return key;
    } catch (err) {
      cloudWhy = reasonOf(err);
      console.warn('[snow media] cloud storage failed, using the backup route:', cloudWhy);
    }
  }
  const key = `${folder}/${uuid()}.${ext}`;
  try {
    await putViaBackup(localUri, key, contentType);
    return key;
  } catch (err) {
    throw new Error(cloudWhy ? `Upload failed. Cloud storage: ${cloudWhy}. Backup: ${reasonOf(err)}` : `Upload failed: ${reasonOf(err)}`);
  }
}

/** Removes an upload that was never saved as media (the database refuses saved ones). */
export async function discardSnowUpload(key: string): Promise<void> {
  const { error } = await supabase.storage.from(SNOW_MEDIA_BUCKET).remove([key]);
  if (error) console.warn('[snow media] cleanup failed', error.message);
  if (r2Enabled) {
    const { error: r2Error } = await supabase.functions.invoke('media', { body: { action: 'snow-delete', key } });
    if (r2Error) console.warn('[snow media] R2 cleanup failed', r2Error.message);
  }
}

/**
 * Signed links for the given keys. Keys the caller isn't allowed to see come
 * back without a link, so they are simply left out.
 */
/**
 * The public address of a Snow file in R2 (Snow photos are public files since 2026-10-23; the key is an unguessable id that a person only ever
 * receives for their own properties). Used when asking for a signed link did not give one, so a photo still opens.
 */
export function snowPublicUrl(key: string): string | undefined {
  const base = (process.env.EXPO_PUBLIC_R2_PUBLIC_URL ?? '').replace(/\/+$/, '');
  return base && key ? `${base}/${key.split('/').map(encodeURIComponent).join('/')}` : undefined;
}

export async function signedSnowMediaUrls(keys: string[]): Promise<Record<string, string>> {
  if (!isSupabaseConfigured || keys.length === 0) return {};
  if (r2Enabled) {
    const { data, error } = await supabase.functions.invoke('media', { body: { action: 'snow-sign', keys } });
    if (error) throw new Error(error.message);
    return (data?.urls ?? {}) as Record<string, string>;
  }
  const { data, error } = await supabase.storage.from(SNOW_MEDIA_BUCKET).createSignedUrls(keys, SIGNED_URL_SECONDS);
  if (error) throw new Error(error.message);
  const out: Record<string, string> = {};
  for (const item of data ?? []) {
    if (item.path && item.signedUrl && !item.error) out[item.path] = item.signedUrl;
  }
  return out;
}
