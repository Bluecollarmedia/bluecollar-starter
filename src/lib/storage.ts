/**
 * Storage Client
 *
 * Handles file uploads through server-authorized presigned URLs.
 * R2 credentials are NEVER in this file — they live in Edge Functions only.
 *
 * Flow:
 * 1. Client requests presigned URL from Edge Function (with auth token)
 * 2. Edge Function validates: auth, file type, size, quota, rate limit
 * 3. Edge Function returns presigned PUT URL
 * 4. Client uploads directly to R2 using the presigned URL
 * 5. Client confirms upload and records the file reference
 */

import { supabase, isSupabaseConfigured } from './supabase';
import { logger } from './logger';
import type {
  UploadRequest,
  PresignedUploadResponse,
  StorageInfo,
  UploadPurpose,
} from '@/types/storage';
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_DEFAULT,
  MAX_AVATAR_SIZE,
  DEFAULT_STORAGE_LIMIT_GB,
  storageLimitBytes,
} from '@/types/storage';

export const R2_PUBLIC_URL = process.env.EXPO_PUBLIC_R2_PUBLIC_URL ?? '';

// ── Client-side validation (before hitting the server) ────────────

export function validateFileLocally(
  contentType: string,
  size: number,
  purpose: UploadPurpose,
): { valid: boolean; error?: string } {
  if (!ALLOWED_MIME_TYPES.has(contentType)) {
    return {
      valid: false,
      error: 'This file type is not supported. Please use JPEG, PNG, or WebP images.',
    };
  }

  const maxSize = purpose === 'avatar' ? MAX_AVATAR_SIZE : MAX_FILE_SIZE_DEFAULT;
  if (size > maxSize) {
    const maxMB = (maxSize / (1024 * 1024)).toFixed(0);
    return {
      valid: false,
      error: `This file is too large. Maximum size is ${maxMB} MB.`,
    };
  }

  if (size === 0) {
    return { valid: false, error: 'The selected file is empty.' };
  }

  return { valid: true };
}

// ── Request presigned URL from Edge Function ──────────────────────

export async function requestUploadUrl(
  request: UploadRequest,
): Promise<PresignedUploadResponse> {
  if (!isSupabaseConfigured) {
    return mockPresignedUrl(request);
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new UploadError('You must be signed in to upload files.', 'auth');
  }

  const response = await supabase.functions.invoke('upload-url', {
    body: request,
  });

  if (response.error) {
    const msg = response.error.message || 'Upload request failed';
    logger.error('upload-url failed', { error: msg, purpose: request.purpose });

    if (msg.includes('quota')) throw new UploadError(msg, 'quota');
    if (msg.includes('rate limit')) throw new UploadError(msg, 'rate_limit');
    if (msg.includes('type not allowed')) throw new UploadError(msg, 'invalid_type');
    if (msg.includes('too large')) throw new UploadError(msg, 'too_large');
    throw new UploadError(msg, 'server');
  }

  return response.data as PresignedUploadResponse;
}

// ── Upload file to presigned URL ──────────────────────────────────

export async function uploadToPresignedUrl(
  presignedUrl: string,
  file: Blob | ArrayBuffer,
  contentType: string,
): Promise<void> {
  const response = await fetch(presignedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });

  if (!response.ok) {
    throw new UploadError(
      'Upload failed. Please check your connection and try again.',
      'network',
    );
  }
}

// ── Full upload flow (validate → presign → upload) ────────────────

export async function uploadFile(
  file: Blob,
  request: Omit<UploadRequest, 'size'>,
  onProgress?: (percent: number) => void,
): Promise<{ fileKey: string; publicUrl: string }> {
  onProgress?.(0);

  // Client-side validation first
  const validation = validateFileLocally(
    request.contentType,
    file.size,
    request.purpose,
  );
  if (!validation.valid) {
    throw new UploadError(validation.error!, 'validation');
  }

  onProgress?.(10);

  // Get presigned URL from server
  const presigned = await requestUploadUrl({
    ...request,
    size: file.size,
  });

  if (presigned.duplicate) {
    onProgress?.(100);
    return { fileKey: presigned.fileKey, publicUrl: presigned.publicUrl };
  }

  onProgress?.(30);

  // Upload to R2
  await uploadToPresignedUrl(presigned.uploadUrl, file, request.contentType);

  onProgress?.(100);

  logger.info('File uploaded', {
    purpose: request.purpose,
    size: file.size,
    fileKey: presigned.fileKey,
  });

  return { fileKey: presigned.fileKey, publicUrl: presigned.publicUrl };
}

// ── Delete media ──────────────────────────────────────────────────

export async function deleteMedia(
  fileKey: string,
  source: 'project_photos' | 'worker_photos' | 'avatar',
): Promise<void> {
  if (!isSupabaseConfigured) {
    logger.info('Mock delete', { fileKey, source });
    return;
  }

  const response = await supabase.functions.invoke('delete-media', {
    body: { fileKey, source },
  });

  if (response.error) {
    throw new UploadError('Failed to delete file. Please try again.', 'server');
  }
}

// ── Storage usage ─────────────────────────────────────────────────

export async function getStorageInfo(): Promise<StorageInfo> {
  if (!isSupabaseConfigured) {
    return mockStorageInfo();
  }

  // Adds up the files in this company's folders of the Supabase Storage
  // "media" bucket (see src/lib/media.ts for the folder layout).
  const { db } = require('@/data/store') as typeof import('@/data/store');
  const bucket = supabase.storage.from('media');
  const folders = [
    ...db.projects.map((p) => `${db.companyId}/projects/${p.id}`),
    `${db.companyId}/trucks`,
    'avatars',
  ];
  let totalBytes = 0;
  let photoCount = 0;
  let avatarCount = 0;
  let workCount = 0;
  let workBytes = 0;
  const results = await Promise.all(folders.map((f) => bucket.list(f, { limit: 1000 })));
  results.forEach(({ data }, i) => {
    for (const obj of data ?? []) {
      if (!obj.id) continue; // sub-folder
      const size = Number((obj.metadata as { size?: number } | null)?.size ?? 0);
      if (folders[i] === 'avatars') {
        avatarCount++;
      } else {
        photoCount++;
      }
      totalBytes += size;
    }
  });
  // New files live in R2; add them to the old Supabase ones.
  if (process.env.EXPO_PUBLIC_R2_PUBLIC_URL) {
    const { data } = await supabase.functions.invoke('media', { body: { action: 'usage' } });
    if (data && typeof data.bytes === 'number') {
      totalBytes += data.bytes;
      photoCount += data.photos ?? 0;
      avatarCount += data.avatars ?? 0;
      workCount += data.work ?? 0;
      workBytes += data.workBytes ?? 0;
    }
  }
  const maxStorageBytes = companyStorageLimitBytes();
  return {
    usage: {
      totalBytes,
      fileCount: photoCount + avatarCount + workCount,
      photoCount,
      avatarCount,
      documentCount: 0,
      workCount,
      workBytes,
      percentUsed: percentOf(totalBytes, maxStorageBytes),
    },
    settings: {
      maxStorageBytes,
      maxFileSizeBytes: 10_485_760,
      rateLimitPerMinute: 10,
      rateLimitPerHour: 100,
    },
  };
}

export async function updateStorageSettings(
  settings: Partial<{
    max_storage_bytes: number;
    max_file_size_bytes: number;
    rate_limit_uploads_per_minute: number;
    rate_limit_uploads_per_hour: number;
  }>,
): Promise<void> {
  if (!isSupabaseConfigured) {
    logger.info('Mock settings update', settings);
    return;
  }

  const response = await supabase.functions.invoke('storage-usage', {
    body: settings,
  });

  if (response.error) {
    throw new UploadError('Failed to update storage settings.', 'server');
  }
}

// ── Public URL builder ────────────────────────────────────────────

export function getPublicUrl(fileKey: string): string {
  if (!R2_PUBLIC_URL) return fileKey;
  return `${R2_PUBLIC_URL}/${fileKey}`;
}

// ── Idempotency key generator ─────────────────────────────────────

export function generateIdempotencyKey(
  userId: string,
  fileName: string,
  size: number,
): string {
  return `${userId}-${fileName}-${size}-${Math.floor(Date.now() / 60000)}`;
}

// ── Error class ───────────────────────────────────────────────────

export type UploadErrorCode =
  | 'auth'
  | 'validation'
  | 'quota'
  | 'rate_limit'
  | 'invalid_type'
  | 'too_large'
  | 'network'
  | 'server';

export class UploadError extends Error {
  code: UploadErrorCode;
  constructor(message: string, code: UploadErrorCode) {
    super(message);
    this.name = 'UploadError';
    this.code = code;
  }
}

// ── Mock implementations for dev mode ─────────────────────────────

function mockPresignedUrl(request: UploadRequest): PresignedUploadResponse {
  const timestamp = Date.now();
  const fileKey = `${request.purpose}/${request.entityId ?? 'mock'}/${timestamp}-${request.fileName}`;
  return {
    uploadUrl: `https://mock-r2.local/upload/${fileKey}`,
    fileKey,
    publicUrl: `https://placehold.co/800x600/7CB342/FFFFFF?text=${encodeURIComponent(request.fileName)}`,
    expiresAt: timestamp + 300_000,
  };
}

/** The limit the owner picked in Settings → Storage (0 = no limit). */
function companyStorageLimitBytes(): number {
  const { db } = require('@/data/store') as typeof import('@/data/store');
  return storageLimitBytes(db.company?.storageLimitGb ?? DEFAULT_STORAGE_LIMIT_GB);
}

function percentOf(used: number, max: number): number {
  return max > 0 ? Math.round((used / max) * 100) : 0;
}

function mockStorageInfo(): StorageInfo {
  const totalBytes = 157_286_400;
  const maxStorageBytes = companyStorageLimitBytes();
  return {
    usage: {
      totalBytes,
      fileCount: 42,
      photoCount: 38,
      avatarCount: 3,
      documentCount: 1,
      percentUsed: percentOf(totalBytes, maxStorageBytes),
    },
    settings: {
      maxStorageBytes,
      maxFileSizeBytes: 10_485_760,
      rateLimitPerMinute: 10,
      rateLimitPerHour: 100,
    },
  };
}
