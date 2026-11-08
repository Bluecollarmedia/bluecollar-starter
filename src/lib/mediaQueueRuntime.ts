/**
 * The phone wiring for the shared media queue (engine and rules: mediaQueue.ts, compression: mediaCompress.ts).
 *
 * One queue for the whole app. Picked files are copied into the app's own folder (so the system clearing its picker cache cannot lose
 * them), compressed, uploaded through the same `uploadImage` every flow already used (same storage, same permission checks in the
 * `media` function), and only then is the database record saved. The pending list is kept in AsyncStorage so it survives leaving a
 * screen and restarting the app.
 *
 * Honest limits: if iOS or Android suspends or kills the app, uploads pause until the app is opened again, when the queue resumes by
 * itself. An interrupted upload starts over from the beginning (no partial resume). Background upload while the app is closed is not
 * promised.
 */
import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Directory, Paths } from 'expo-file-system';
import { MediaQueue, PermanentError, type MediaJob, type NewJob } from './mediaQueue';
import { prepareImage, prepareVideo } from './mediaCompress';
import { isSnowKey, isSnowTarget } from '@/data/snowMediaTargets';

const KEY = 'mediaQueue.v1';
const QDIR = '/media-queue/';

const extOf = (uri: string, kind: 'image' | 'video') => {
  const m = uri.split('?')[0].match(/\.([A-Za-z0-9]{2,5})$/);
  return (m?.[1] ?? (kind === 'video' ? 'mp4' : 'jpg')).toLowerCase();
};

function inboxFile(id: string, ext: string): File {
  const dir = new Directory(Paths.document, 'media-queue');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return new File(dir, `${id}.${ext}`);
}

export const mediaQueue = new MediaQueue({
  load: async () => {
    try { return JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]') as MediaJob[]; } catch { return []; }
  },
  save: async (jobs) => { try { await AsyncStorage.setItem(KEY, JSON.stringify(jobs)); } catch { /* storage full or unavailable: the queue still runs for this session */ } },

  adopt: async (job) => {
    if (Platform.OS === 'web' || /^(https?|data|blob):/i.test(job.sourceUri)) return job.sourceUri;
    // The same keeper every picker uses (legacy copy first; the new File API cannot read picker files on some phones).
    const { keepPickedFileAsync } = require('./keepPickedFile') as typeof import('./keepPickedFile');
    const kept = await keepPickedFileAsync(job.sourceUri, job.kind === 'video' ? 'video' : 'image');
    return kept.uri ?? job.sourceUri;
  },

  prepare: async (job) => {
    const out = job.kind === 'video' ? await prepareVideo(job) : await prepareImage(job);
    return { uri: out.uri, bytes: out.bytes, width: out.width, height: out.height, mimeType: out.mimeType };
  },

  upload: async (job, uri, onProgress) => {
    // A pending item belongs to the company it was picked in: never send it under a different sign-in.
    const { db } = require('@/data/store') as typeof import('@/data/store');
    if (db.companyId && !job.folder.startsWith(`${db.companyId}/`)) throw new PermanentError('This photo belongs to a different account, so it was not uploaded.');
    if (isSnowTarget(job.target.type)) {
      // Snow photos live in the private snow-media bucket, not the public one.
      const { uploadSnowMedia } = require('./snowMedia') as typeof import('./snowMedia');
      const snowMime = job.kind === 'video' ? (job.useOriginal ? job.mimeType : 'video/mp4') : (uri === job.sourceUri ? job.mimeType : 'image/jpeg');
      return { url: '', key: await uploadSnowMedia(uri, job.folder, snowMime, onProgress) };
    }
    const { uploadImage } = require('./media') as typeof import('./media');
    const mime = job.kind === 'video' ? (job.useOriginal ? job.mimeType : 'video/mp4') : (uri === job.sourceUri ? job.mimeType : 'image/jpeg');
    return uploadImage(uri, job.folder, mime, onProgress);
  },

  complete: async (job, uploaded) => {
    if (isSnowTarget(job.target.type)) {
      const { completeSnowTarget } = require('@/data/snowMediaTargets') as typeof import('@/data/snowMediaTargets');
      await completeSnowTarget(job, uploaded.key);
      return;
    }
    const { completeMediaTarget } = require('@/data/mediaTargets') as typeof import('@/data/mediaTargets');
    await completeMediaTarget(job, uploaded);
  },

  removeStored: async (key) => {
    if (isSnowKey(key)) {
      const { discardSnowUpload } = require('./snowMedia') as typeof import('./snowMedia');
      await discardSnowUpload(key);
      return;
    }
    const { removeMedia } = require('./media') as typeof import('./media');
    await removeMedia(key);
  },

  cleanup: async (uris) => {
    if (Platform.OS === 'web') return;
    for (const u of uris) { try { const f = new File(u); if (f.exists) f.delete(); } catch { /* already gone */ } }
  },
});

let started = false;
/** Called once the person is signed in (uploads need a session). Resumes anything left from last time, and re-shows its local previews. */
export async function startMediaQueue(): Promise<void> {
  if (started) return;
  started = true;
  await mediaQueue.start();
  try {
    const { sweepKeptFiles } = require('./keepPickedFile') as typeof import('./keepPickedFile');
    sweepKeptFiles(mediaQueue.pending().flatMap((j) => [j.sourceUri, j.preparedUri]));
  } catch { /* housekeeping only */ }
  try {
    const { restoreMediaTarget } = require('@/data/mediaTargets') as typeof import('@/data/mediaTargets');
    for (const j of mediaQueue.pending()) restoreMediaTarget(j);
  } catch { /* previews only */ }
  AppState.addEventListener('change', (s) => { if (s === 'active') mediaQueue.resumeNow(); });
}

/** Adds picked media to the queue. The local file is shown at once by the caller; this returns immediately. */
export function queueMedia(input: NewJob): MediaJob {
  void startMediaQueue();
  return mediaQueue.enqueue(input);
}

let snapshot: MediaJob[] = mediaQueue.list();
mediaQueue.subscribe(() => { snapshot = mediaQueue.list(); });

/** Waits until every given job has been saved ('done'), one of them failed ('failed'), or the time runs out ('timeout'). */
export function waitForMediaJobs(ids: string[], timeoutMs: number): Promise<'done' | 'failed' | 'timeout'> {
  return new Promise((resolve) => {
    let off: () => void = () => {};
    const timer = setTimeout(() => { off(); resolve('timeout'); }, timeoutMs);
    const check = () => {
      const jobs = ids.map((id) => mediaQueue.get(id));
      if (jobs.some((j) => j?.status === 'failed')) { clearTimeout(timer); off(); resolve('failed'); return; }
      if (jobs.every((j) => !j || j.status === 'uploaded')) { clearTimeout(timer); off(); resolve('done'); }
    };
    off = mediaQueue.subscribe(check);
    check();
  });
}

/** Live list of every job (pending, failed and just-uploaded). */
export function useMediaJobs(): MediaJob[] {
  return useSyncExternalStore((cb) => mediaQueue.subscribe(cb), () => snapshot, () => snapshot);
}

/** The job for one record (job id = the record's id), if it is still being handled. */
export function useMediaJob(rowId: string | undefined): MediaJob | undefined {
  const jobs = useMediaJobs();
  return rowId ? jobs.find((j) => j.id === rowId) : undefined;
}

export const isQueueFile = (uri: string) => uri.includes(QDIR);
