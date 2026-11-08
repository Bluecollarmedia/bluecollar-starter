/**
 * Task photos and videos: what the owner attaches to a task to show the crew
 * what to do (supabase/updates/017).
 *
 * Files go in the project's folder of the "media" bucket, so they count toward
 * the storage limit the owner picked in Settings → Storage. Picks that would go
 * over the limit, or one file over the per-file cap, are turned away up front.
 */

import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { VIDEO_PICK_OPTIONS } from '@/lib/videoPick';
import { db, insertRow, deleteRow } from './store';
import { removeMedia } from '@/lib/media';
import { getStorageInfo } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { keepPickedFileAsync } from '@/lib/keepPickedFile';
import { formatBytes } from '@/types/storage';
import type { TaskAttachment } from '@/types/project';

/** Longest video the camera will record or the library will accept. */
export const MAX_TASK_VIDEO_SECONDS = 60;
/** Supabase's default per-file upload limit (Free plan). */
export const MAX_TASK_FILE_BYTES = 50 * 1024 * 1024;
/** Most files one task can carry. */
export const MAX_TASK_ATTACHMENTS = 6;

/** A picked file that hasn't been saved to a task yet. */
export interface TaskMediaDraft {
  key: string;
  uri: string;
  mediaType: 'image' | 'video';
  mimeType?: string;
  sizeBytes?: number;
}

function notify(title: string, message: string) {
  if (Platform.OS === 'web') (globalThis as { alert?: (m: string) => void }).alert?.(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

/** Asks camera vs. library on phones; the web goes straight to file choice. */
function chooseSource(): Promise<'camera' | 'library' | null> {
  if (Platform.OS === 'web') return Promise.resolve('library');
  return new Promise((resolve) => {
    Alert.alert('Add photo or video', undefined, [
      { text: 'Take Photo or Video', onPress: () => resolve('camera') },
      { text: 'Choose from Library', onPress: () => resolve('library') },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ], { cancelable: true, onDismiss: () => resolve(null) });
  });
}

/**
 * Lets the owner pick photos/videos for a task. `alreadyPicked` is how many
 * the task has (saved + drafts), to keep under MAX_TASK_ATTACHMENTS. Returns
 * only the picks that pass the size and storage checks.
 */
export async function pickTaskMedia(alreadyPicked: number): Promise<TaskMediaDraft[]> {
  const room = MAX_TASK_ATTACHMENTS - alreadyPicked;
  if (room <= 0) {
    notify('That\'s the limit', `A task can have up to ${MAX_TASK_ATTACHMENTS} photos and videos.`);
    return [];
  }

  const source = await chooseSource();
  if (!source) return [];

  const perm = source === 'camera'
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    notify(
      source === 'camera' ? 'Camera access is off' : 'Photo access is off',
      'Turn it on for Brighton Lawn in the Settings app to add task photos and videos.',
    );
    return [];
  }

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images', 'videos'],
    quality: 1,
    videoMaxDuration: MAX_TASK_VIDEO_SECONDS,
    ...VIDEO_PICK_OPTIONS,
    allowsMultipleSelection: source === 'library' && room > 1,
    selectionLimit: room,
  };
  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.length) return [];

  const drafts: TaskMediaDraft[] = [];
  const skipped: string[] = [];
  for (const asset of result.assets.slice(0, room)) {
    const mediaType = asset.type === 'video' ? 'video' : 'image';
    const sizeBytes = asset.fileSize ?? (asset as { file?: File }).file?.size;
    if (mediaType === 'video' && asset.duration && asset.duration / 1000 > MAX_TASK_VIDEO_SECONDS + 1) {
      skipped.push(`A video is longer than ${MAX_TASK_VIDEO_SECONDS} seconds. Trim it and try again.`);
      continue;
    }
    if (sizeBytes && sizeBytes > MAX_TASK_FILE_BYTES) {
      skipped.push(`A ${mediaType} is ${formatBytes(sizeBytes)}; the most one file can be is ${formatBytes(MAX_TASK_FILE_BYTES)}.`);
      continue;
    }
    const kept = await keepPickedFileAsync(asset.uri, mediaType);
    if (!kept.uri) {
      skipped.push(`A ${mediaType} couldn't be read from your phone (${kept.why}). Pick it again.`);
      continue;
    }
    drafts.push({
      key: `${Date.now()}-${drafts.length}-${asset.uri.slice(-12)}`,
      uri: kept.uri,
      mediaType,
      mimeType: asset.mimeType ?? undefined,
      sizeBytes,
    });
  }

  if (drafts.length > 0) {
    const problem = await storageProblem(drafts.reduce((sum, d) => sum + (d.sizeBytes ?? 0), 0));
    if (problem) {
      notify('Storage is full', problem);
      return [];
    }
  }
  if (skipped.length > 0) notify('Some files weren\'t added', skipped.join('\n'));
  return drafts;
}

/** Why `bytes` more wouldn't fit under the company's storage limit, if so. */
async function storageProblem(bytes: number): Promise<string | null> {
  try {
    const { usage, settings } = await getStorageInfo();
    const max = settings.maxStorageBytes;
    if (max > 0 && usage.totalBytes + bytes > max) {
      return `This would go over the company's ${formatBytes(max)} storage limit (${formatBytes(usage.totalBytes)} used). Remove some photos or raise the limit in More → Settings → Storage.`;
    }
  } catch (err) {
    // Couldn't read usage; let the upload go ahead rather than block the owner.
    console.warn('[task media] storage check failed', err);
  }
  return null;
}

/**
 * Saves picked files to a task. Each shows right away from the local file and
 * is saved for everyone once its upload finishes; a failed upload is removed.
 */
export function saveTaskMedia(projectId: string, taskId: string, drafts: TaskMediaDraft[]) {
  for (const d of drafts) {
    const needsUpload = !db.demo && !/^https?:\/\//i.test(d.uri);
    const row = insertRow('task_attachments', {
      projectId,
      taskId,
      mediaType: d.mediaType,
      fileUrl: d.uri,
      fileKey: '',
      sizeBytes: d.sizeBytes,
      createdBy: db.personId || undefined,
    }, { deferSave: needsUpload });
    if (!needsUpload) continue;
    // Photos and videos go through the shared queue (compress -> upload -> save the record). A failure stays on the task as Failed with Retry.
    const { fileUrl: _f, fileKey: _k, id: _i, createdAt: _c, ...payload } = row as unknown as Record<string, unknown>;
    void _f; void _k; void _i; void _c;
    const { queueMedia } = require('@/lib/mediaQueueRuntime') as typeof import('@/lib/mediaQueueRuntime');
    queueMedia({
      id: row.id, kind: d.mediaType === 'video' ? 'video' : 'image', sourceUri: d.uri, mimeType: d.mimeType, bytesIn: d.sizeBytes,
      folder: `${db.companyId}/projects/${projectId}`, target: { type: 'task_attachment', payload },
    });
  }
}

/** Removes a file from a task, and from storage so it stops counting. */
export function removeTaskMedia(att: TaskAttachment) {
  deleteRow('task_attachments', att.id);
  if (!db.demo && att.fileKey) {
    removeMedia(att.fileKey).catch((err) => console.warn('[task media] storage delete failed', err));
  }
}
