/**
 * Storage hooks for upload management, storage info, and photo operations.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import {
  uploadFile,
  deleteMedia,
  getStorageInfo,
  updateStorageSettings,
  validateFileLocally,
  generateIdempotencyKey,
  UploadError,
} from '@/lib/storage';
import { logger } from '@/lib/logger';
import { effectiveMaxFileMb } from '@/lib/uploadLimit';
import { db, useDb, updateRow } from '@/data/store';
import { DEFAULT_STORAGE_LIMIT_GB, storageLimitBytes } from '@/types/storage';
import type {
  UploadPurpose,
  UploadProgress,
  StorageInfo,
} from '@/types/storage';

// ── useUpload — manages a single file upload ──────────────────────

export function useUpload() {
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const abortRef = useRef(false);

  const startUpload = useCallback(async (
    file: Blob,
    options: {
      fileName: string;
      contentType: string;
      purpose: UploadPurpose;
      entityId?: string;
      userId?: string;
    },
  ): Promise<{ fileKey: string; publicUrl: string } | null> => {
    abortRef.current = false;

    const id = `upload-${Date.now()}`;
    setUpload({
      id,
      fileName: options.fileName,
      status: 'pending',
      progress: 0,
    });

    try {
      const idempotencyKey = options.userId
        ? generateIdempotencyKey(options.userId, options.fileName, file.size)
        : undefined;

      const result = await uploadFile(file, {
        fileName: options.fileName,
        contentType: options.contentType,
        purpose: options.purpose,
        entityId: options.entityId,
        idempotencyKey,
      }, (percent) => {
        if (!abortRef.current) {
          setUpload(prev => prev ? { ...prev, status: 'uploading', progress: percent } : null);
        }
      });

      if (abortRef.current) return null;

      setUpload(prev => prev ? {
        ...prev,
        status: 'completed',
        progress: 100,
        fileKey: result.fileKey,
        publicUrl: result.publicUrl,
      } : null);

      return result;
    } catch (err) {
      const message = err instanceof UploadError
        ? err.message
        : 'Something went wrong. Please try again.';

      setUpload(prev => prev ? {
        ...prev,
        status: 'failed',
        error: message,
      } : null);

      logger.error('Upload failed', {
        fileName: options.fileName,
        error: message,
        code: err instanceof UploadError ? err.code : 'unknown',
      });

      return null;
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current = true;
    setUpload(null);
  }, []);

  return { upload, startUpload, reset, validateFileLocally };
}

// ── useStorageInfo — company storage usage and settings ────────────

export function useStorageInfo() {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getStorageInfo();
      setInfo(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load storage info');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const updateSettings = useCallback(async (
    settings: Parameters<typeof updateStorageSettings>[0],
  ) => {
    try {
      await updateStorageSettings(settings);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update settings');
    }
  }, [refresh]);

  return { info, loading, error, refresh, updateSettings };
}

// ── useStorageLimit — the company's storage limit the owner picked ──

/**
 * The storage limit saved on the company row (0 = Unlimited). Saving it
 * updates every screen right away, so usage percentages follow the pick.
 */
export function useStorageLimit() {
  useDb();
  const limitGb = db.company?.storageLimitGb ?? DEFAULT_STORAGE_LIMIT_GB;

  const setLimitGb = useCallback((next: number) => {
    if (!db.company) return;
    updateRow('companies', db.company.id, { storageLimitGb: next });
  }, []);

  return { limitGb, limitBytes: storageLimitBytes(limitGb), setLimitGb };
}

// ── useMaxFileSize — the biggest single file the owner allows ──────

/** The owner's max file size in MB (saved on the company row). Saving updates every screen and every upload check right away. */
export function useMaxFileSize() {
  useDb();
  const savedMb = db.company?.maxFileSizeMb;
  const maxMb = effectiveMaxFileMb(savedMb);

  const setMaxMb = useCallback((next: number) => {
    if (!db.company) return;
    updateRow('companies', db.company.id, { maxFileSizeMb: next });
  }, []);

  return { maxMb, setMaxMb };
}

// ── usePhotoDelete — handles media deletion with confirmation ─────

export function usePhotoDelete() {
  const [deleting, setDeleting] = useState(false);

  const deletePhoto = useCallback(async (
    fileKey: string,
    source: 'project_photos' | 'worker_photos' | 'avatar',
  ): Promise<boolean> => {
    setDeleting(true);
    try {
      await deleteMedia(fileKey, source);
      return true;
    } catch (err) {
      logger.error('Delete failed', {
        fileKey,
        error: err instanceof Error ? err.message : 'unknown',
      });
      return false;
    } finally {
      setDeleting(false);
    }
  }, []);

  return { deleting, deletePhoto };
}
