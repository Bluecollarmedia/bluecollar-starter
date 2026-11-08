/**
 * File validation constants and helpers.
 * Shared between Edge Functions for consistent enforcement.
 */

export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export const ALLOWED_PURPOSES = new Set([
  'project-photo',
  'worker-photo',
  'avatar',
  'before-after',
]);

export const MAX_FILE_SIZE_DEFAULT = 10 * 1024 * 1024; // 10 MB
export const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2 MB

export function validateContentType(contentType: string): boolean {
  return ALLOWED_MIME_TYPES.has(contentType);
}

export function validateFileSize(
  size: number,
  maxSize: number = MAX_FILE_SIZE_DEFAULT,
): boolean {
  return size > 0 && size <= maxSize;
}

export function validatePurpose(purpose: string): boolean {
  return ALLOWED_PURPOSES.has(purpose);
}

export function getMaxSizeForPurpose(
  purpose: string,
  settingsMaxSize?: number,
): number {
  if (purpose === 'avatar') return MAX_AVATAR_SIZE;
  return settingsMaxSize ?? MAX_FILE_SIZE_DEFAULT;
}
