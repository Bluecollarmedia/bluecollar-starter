/**
 * Photo and video uploads.
 *
 * Files go to Cloudflare R2 (through the `media` Edge Function, which hands out
 * a short upload link) once EXPO_PUBLIC_R2_PUBLIC_URL is set in the build.
 * Until then they fall back to the public Supabase "media" bucket so the app
 * keeps working during the move. Old Supabase files keep their links.
 *
 * In demo mode (no Supabase configured) the local file URI is returned as-is.
 */

import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from './supabase';
import { uuid } from './ids';
import { explainUploadError, SIGNED_OUT_UPLOAD_MESSAGE } from './uploadErrors';
import { tooLargeMessage } from './uploadLimit';
import { audioFormatOf, videoFormatOf } from './mediaFormats';

export const MEDIA_BUCKET = 'media';

/** True once the build knows the R2 public address. */
export const r2Enabled = !!process.env.EXPO_PUBLIC_R2_PUBLIC_URL;

function guessContentType(uri: string, mimeType?: string): { contentType: string; ext: string } {
  const lower = uri.split('?')[0].toLowerCase();
  const mime = (mimeType ?? '').toLowerCase();
  // Audio and video: the same shared rules as Our Work's pickers (src/lib/mediaFormats.ts).
  const audio = audioFormatOf(lower, mime);
  if (audio) return { contentType: audio.contentType, ext: audio.ext };
  const video = videoFormatOf(lower, mime);
  if (video) return { contentType: video.contentType, ext: video.ext };
  if (mime.startsWith('video/') || lower.endsWith('.m4v')) return { contentType: 'video/mp4', ext: 'mp4' };
  if (mime === 'image/png' || lower.endsWith('.png')) return { contentType: 'image/png', ext: 'png' };
  if (mime === 'image/webp' || lower.endsWith('.webp')) return { contentType: 'image/webp', ext: 'webp' };
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) return { contentType: 'image/heic', ext: 'heic' };
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) return { contentType: 'application/pdf', ext: 'pdf' };
  return { contentType: 'image/jpeg', ext: 'jpg' };
}

/**
 * Uploads a local image or video (file://, content://, blob: or data: URI) and returns
 * its public URL. `folder` groups files, e.g. `${companyId}/projects/${projectId}`.
 * Already-remote URLs (http/https) are returned unchanged.
 */
export async function uploadImage(localUri: string, folder: string, mimeType?: string, onProgress?: (p: number) => void, opts?: { raw?: boolean }): Promise<{ url: string; key: string }> {
  if (!isSupabaseConfigured || /^https?:\/\//i.test(localUri)) {
    return { url: localUri, key: localUri };
  }

  let { contentType, ext } = guessContentType(localUri, mimeType);
  await requireSession();
  // Every photo is compressed before it leaves the phone (about 50% quality, long side at most 1600 px), whichever screen it came from.
  // Files the shared media queue already prepared are not touched again, and PDFs/videos pass through (videos: see mediaQueue).
  // `raw` is for a caller that has already made the picture exactly as it wants it (Our Work: high-quality photos and its own small copies).
  if (contentType.startsWith('image/') && !opts?.raw) {
    const { prepareImage, isPrepared } = require('./mediaCompress') as typeof import('./mediaCompress');
    if (!isPrepared(localUri)) {
      const p = await prepareImage({ sourceUri: localUri, mimeType: contentType } as import('./mediaQueue').MediaJob);
      if (p.uri !== localUri) { localUri = p.uri; contentType = 'image/jpeg'; ext = 'jpg'; }
    }
  }
  try {
    if (r2Enabled) return await uploadToR2(localUri, folder, contentType, onProgress);

    const key = `${folder}/${uuid()}.${ext}`;

    let body: Blob | FormData;
    if (Platform.OS === 'web') {
      body = await (await fetch(localUri)).blob();
    } else {
      // React Native uploads local files most reliably as multipart form data.
      const form = new FormData();
      form.append('file', { uri: localUri, name: key.split('/').pop(), type: contentType } as unknown as Blob);
      body = form;
    }

    const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(key, body, {
      contentType,
      upsert: false,
    });
    if (error) throw error;

    const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(key);
    return { url: data.publicUrl, key };
  } catch (err) {
    throw new Error(`Upload failed: ${explainUploadError(err).replace(/^Upload failed:?\s*/i, '')}`);
  }
}

/** Uploads need a signed-in session; without one the server refuses with a confusing permission error. */
export async function requireSession(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (!data?.session) throw new Error(SIGNED_OUT_UPLOAD_MESSAGE);
}

async function uploadToR2(localUri: string, folder: string, contentType: string, onProgress?: (p: number) => void): Promise<{ url: string; key: string }> {
  const { putFile, localFileSize } = require('./uploadFile') as typeof import('./uploadFile');
  const size = await localFileSize(localUri);
  // The owner's max file size (More > Storage). The media function checks it again on the server.
  const { db } = require('@/data/store') as typeof import('@/data/store');
  const tooBig = size != null ? tooLargeMessage(size, db?.company?.maxFileSizeMb) : null;
  if (tooBig) throw new Error(tooBig);
  const { data, error } = await supabase.functions.invoke('media', {
    body: { action: 'put', folder, contentType, ...(size != null ? { size } : {}) },
  });
  if (error || !data?.uploadUrl) throw new Error(error?.message ?? data?.error ?? 'no upload link');

  // Sent by the phone's own file upload on a phone (JavaScript fetch + Blob is unreliable there); fetch on the web.
  const sent = await putFile(localUri, data.uploadUrl, contentType, contentType.startsWith('video/') ? 300_000 : 90_000, onProgress);
  if (sent.status < 200 || sent.status >= 300) {
    const code = sent.body.match(/<Code>([^<]+)<\/Code>/)?.[1];
    throw new Error(`The storage server answered ${sent.status}${code ? ` (${code})` : ''}`);
  }
  return { url: data.publicUrl as string, key: data.key as string };
}

/**
 * Removes an uploaded file by its key. Files can be in R2 (new) or the old
 * Supabase bucket, so both are asked; one of them simply has nothing to delete.
 */
export async function removeMedia(key: string): Promise<void> {
  if (!isSupabaseConfigured || /^https?:\/\//i.test(key)) return;
  if (r2Enabled) {
    const { error } = await supabase.functions.invoke('media', { body: { action: 'delete', key } });
    if (error) console.warn('[media] R2 delete failed', error.message);
  }
  const { error } = await supabase.storage.from(MEDIA_BUCKET).remove([key]);
  if (error) console.warn('[media] cleanup failed', error.message);
}
