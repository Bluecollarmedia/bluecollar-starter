export type UploadPurpose = 'project-photo' | 'worker-photo' | 'avatar' | 'before-after';

export type UploadStatus = 'pending' | 'uploading' | 'completed' | 'failed';

export interface UploadRequest {
  fileName: string;
  contentType: string;
  size: number;
  purpose: UploadPurpose;
  entityId?: string;
  idempotencyKey?: string;
}

export interface PresignedUploadResponse {
  uploadUrl: string;
  fileKey: string;
  publicUrl: string;
  expiresAt: number;
  duplicate?: boolean;
}

export interface UploadProgress {
  id: string;
  fileName: string;
  status: UploadStatus;
  progress: number;
  fileKey?: string;
  publicUrl?: string;
  error?: string;
}

export interface StorageUsage {
  totalBytes: number;
  fileCount: number;
  photoCount: number;
  avatarCount: number;
  documentCount: number;
  /** Our Work (reels, posts, stories, music): files and the space they take. */
  workCount?: number;
  workBytes?: number;
  percentUsed: number;
}

export interface StorageSettings {
  /** 0 means no limit. */
  maxStorageBytes: number;
  maxFileSizeBytes: number;
  rateLimitPerMinute: number;
  rateLimitPerHour: number;
}

export interface StorageInfo {
  usage: StorageUsage;
  settings: StorageSettings;
}

/** Storage limits the owner can pick. 0 GB means no limit. */
export const STORAGE_LIMIT_OPTIONS_GB = [1, 100, 1000, 0] as const;

/** Used until the owner picks a limit: the Supabase Free plan's 1 GB. */
export const DEFAULT_STORAGE_LIMIT_GB = 1;

/** Limits above this need a paid Supabase plan. */
export const SUPABASE_FREE_PLAN_GB = 1;

const GB = 1024 * 1024 * 1024;

export function storageLimitBytes(limitGb: number): number {
  return limitGb * GB;
}

export function storageLimitLabel(limitGb: number): string {
  return limitGb === 0 ? 'Unlimited' : `${limitGb.toLocaleString('en-US')} GB`;
}

export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export const MAX_FILE_SIZE_DEFAULT = 10 * 1024 * 1024;
export const MAX_AVATAR_SIZE = 2 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 2 : 0)} ${units[i]}`;
}
