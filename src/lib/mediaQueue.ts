/**
 * The shared queue for photos and videos: prepare (compress) -> upload -> save the database record.
 *
 * Pure engine with injected dependencies (storage, compressor, uploader, record saver, clock), so every rule below is tested without a
 * phone. The phone wiring is in mediaQueueRuntime.ts.
 *
 * Statuses a screen shows:
 *   preparing  compressing / getting the file ready
 *   uploading  the compressed file is being sent (also covers the short database step that follows)
 *   uploaded   the storage has the file AND the database record has been saved and confirmed (and nothing earlier)
 *   failed     something failed; `error` says what, and the person can Retry (or, for a failed compression, upload the original)
 *
 * Rules:
 *  - Bounded: at most MAX_ACTIVE jobs run at once and only MAX_VIDEOS videos at once (memory, battery, data).
 *  - A job keeps going through screen changes (the queue lives outside screens) and is saved to storage after every step, so an app
 *    restart resumes it. An upload that was interrupted restarts from the beginning (no partial-upload resume).
 *  - Retryable trouble (no network, timeouts, server 5xx) is retried automatically with a growing delay, up to MAX_AUTO_TRIES; after that
 *    it shows Failed with a Retry button. Permanent trouble (not allowed, too large, unreadable file) fails at once.
 *  - If the file reaches storage but saving the record fails, only the record step is retried (no second upload). Cancelling at that point
 *    deletes the stored file so nothing is left behind.
 *  - Adding the same thing twice (double tap) returns the job that already exists.
 */

export type JobStatus = 'preparing' | 'uploading' | 'uploaded' | 'failed';
export type JobStage = 'prepare' | 'upload' | 'record';
export type MediaKind = 'image' | 'video';

export interface MediaJob {
  id: string;
  kind: MediaKind;
  /** Where the person picked it from (or the app's own copy once adopted). Shown as the instant preview. */
  sourceUri: string;
  mimeType?: string;
  width?: number;
  height?: number;
  bytesIn?: number;
  /** The compressed file that gets uploaded, once prepared. */
  preparedUri?: string;
  bytesOut?: number;
  folder: string;
  /** What to do when the file is stored: which handler saves the database record, and with what. */
  target: { type: string; payload: Record<string, unknown> };
  /** The same thing picked twice maps to one job. */
  dedupeKey: string;
  status: JobStatus;
  stage: JobStage;
  attempts: number;
  error?: string;
  /** True when compression failed and the person has not yet chosen what to do. */
  canUseOriginal?: boolean;
  useOriginal?: boolean;
  uploaded?: { url: string; key: string };
  /** How much of the file has been sent (0..1), while uploading. Live only; never saved. */
  progress?: number;
  nextTryAt?: number;
  createdAt: number;
  updatedAt: number;
}

export type NewJob = Pick<MediaJob, 'kind' | 'sourceUri' | 'folder' | 'target'> & Partial<Pick<MediaJob, 'mimeType' | 'width' | 'height' | 'bytesIn' | 'id' | 'dedupeKey'>>;

export class PermanentError extends Error { permanent = true as const; }
export class CompressionError extends Error { compression = true as const; }

export interface QueueDeps {
  load: () => Promise<MediaJob[]>;
  save: (jobs: MediaJob[]) => Promise<void>;
  /** Copies a picked file somewhere the system will not clear, returns the new uri. May return the same uri. */
  adopt: (job: MediaJob) => Promise<string>;
  /** Compresses; throws CompressionError when it cannot. */
  prepare: (job: MediaJob) => Promise<{ uri: string; bytes?: number; width?: number; height?: number; mimeType?: string }>;
  /** Sends the file to storage. Reports how much has been sent (0..1) when it can. */
  upload: (job: MediaJob, uri: string, onProgress?: (p: number) => void) => Promise<{ url: string; key: string }>;
  /** Saves and CONFIRMS the database record. Must resolve only once saved (an already-saved record counts as saved). */
  complete: (job: MediaJob, uploaded: { url: string; key: string }) => Promise<void>;
  /** Deletes a stored file (used when a job is cancelled after upload but before its record was saved). */
  removeStored: (key: string) => Promise<void>;
  /** Deletes local temporary files. */
  cleanup: (uris: string[]) => Promise<void>;
  now?: () => number;
  /** Delay before retry n (1-based), in ms. */
  backoffMs?: (attempt: number) => number;
  newId?: () => string;
  /** Runs `fn` after `ms`. Replaced in tests. */
  later?: (fn: () => void, ms: number) => unknown;
}

/** No step may run forever: a stalled connection or a stuck compressor fails with a plain reason, and the normal retry rules take over. */
export const PREPARE_LIMIT_MS = 120_000;
export const UPLOAD_LIMIT_MS = 6 * 60_000;
export const RECORD_LIMIT_MS = 60_000;
export function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    work.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

export const MAX_ACTIVE = 3;
export const MAX_VIDEOS = 1;
export const MAX_AUTO_TRIES = 4;
const defaultBackoff = (n: number) => Math.min(60_000, 2_000 * 2 ** (n - 1));

/** Network trouble and server hiccups can pass; anything else (not allowed, too large, bad file) will not. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof PermanentError || (err as { permanent?: boolean })?.permanent) return false;
  const msg = String((err as { message?: string })?.message ?? err ?? '').toLowerCase();
  if (/network request failed|failed to fetch|network error|timed out|timeout|offline|connection|econn|enotfound|socket|aborted/.test(msg)) return true;
  const m = msg.match(/\b(4\d\d|5\d\d)\b/);
  if (m) { const c = Number(m[1]); return c >= 500 || c === 408 || c === 429; }
  return false;
}

export class MediaQueue {
  private jobs: MediaJob[] = [];
  private listeners = new Set<() => void>();
  private running = new Set<string>();
  private started = false;
  private d: Required<Pick<QueueDeps, 'now' | 'backoffMs' | 'newId' | 'later'>> & QueueDeps;
  private saving: Promise<void> = Promise.resolve();

  constructor(deps: QueueDeps) {
    this.d = {
      now: () => Date.now(),
      backoffMs: defaultBackoff,
      newId: () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      later: (fn, ms) => setTimeout(fn, ms),
      ...deps,
    };
  }

  // ── reading ──────────────────────────────────────────────────────────────
  list(): MediaJob[] { return this.jobs; }
  get(id: string): MediaJob | undefined { return this.jobs.find((j) => j.id === id); }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  /** Jobs that are not finished (preparing, uploading or failed). */
  pending(): MediaJob[] { return this.jobs.filter((j) => j.status !== 'uploaded'); }

  // ── starting up (after an app restart) ───────────────────────────────────
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const saved = await this.d.load();
    // A job that was running when the app stopped did not finish: it resumes from where it got to. Uploaded jobs are history.
    this.jobs = saved
      .filter((j) => j.status !== 'uploaded')
      .map((j) => (j.status === 'failed' ? j : { ...j, status: j.stage === 'prepare' ? 'preparing' as const : 'uploading' as const, nextTryAt: undefined }));
    this.emit();
    this.pump();
  }

  // ── adding ───────────────────────────────────────────────────────────────
  /** Adds one item. Returns at once (the screen shows the local preview straight away); work happens in the background. */
  enqueue(input: NewJob): MediaJob {
    const dedupeKey = input.dedupeKey ?? `${input.sourceUri}|${input.target.type}|${JSON.stringify(input.target.payload)}`;
    const existing = this.jobs.find((j) => j.dedupeKey === dedupeKey && j.status !== 'failed');
    if (existing) return existing;
    const now = this.d.now();
    const job: MediaJob = {
      id: input.id ?? this.d.newId(), kind: input.kind, sourceUri: input.sourceUri, mimeType: input.mimeType, width: input.width, height: input.height,
      bytesIn: input.bytesIn, folder: input.folder, target: input.target, dedupeKey,
      status: 'preparing', stage: 'prepare', attempts: 0, createdAt: now, updatedAt: now,
    };
    this.jobs = [...this.jobs, job];
    this.persist();
    this.emit();
    this.pump();
    return job;
  }

  /** Several items at once. */
  enqueueMany(inputs: NewJob[]): MediaJob[] { return inputs.map((i) => this.enqueue(i)); }

  // ── person's actions ─────────────────────────────────────────────────────
  /** Try a failed job again. */
  retry(id: string): void {
    const j = this.get(id);
    if (!j || j.status !== 'failed') return;
    this.patch(id, { status: j.stage === 'prepare' ? 'preparing' : 'uploading', error: undefined, attempts: 0, nextTryAt: undefined, canUseOriginal: false, progress: undefined });
    this.pump();
  }

  /** After a compression failure: upload the original file instead (larger, and the person is told so by the screen). */
  useOriginalFile(id: string): void {
    const j = this.get(id);
    if (!j || j.status !== 'failed' || !j.canUseOriginal) return;
    this.patch(id, { status: 'uploading', stage: 'upload', useOriginal: true, preparedUri: undefined, error: undefined, attempts: 0, canUseOriginal: false, nextTryAt: undefined });
    this.pump();
  }

  /** Stop and forget a job. If its file was already stored but its record was not saved, the stored file is deleted too. */
  async cancel(id: string): Promise<void> {
    const j = this.get(id);
    if (!j) return;
    this.jobs = this.jobs.filter((x) => x.id !== id);
    this.running.delete(id);
    this.persist();
    this.emit();
    if (j.status !== 'uploaded' && j.uploaded?.key) { try { await this.d.removeStored(j.uploaded.key); } catch { /* best effort; the file is unreachable from any record */ } }
    await this.cleanupFiles(j);
  }

  /** The app came back to the front or the network returned: failed-but-retryable jobs and waiting retries go again now. */
  resumeNow(): void {
    this.jobs = this.jobs.map((j) => (j.status !== 'failed' && j.nextTryAt ? { ...j, nextTryAt: undefined } : j));
    this.persist();
    this.pump();
  }

  // ── running ──────────────────────────────────────────────────────────────
  private activeVideos(): number { return [...this.running].filter((id) => this.get(id)?.kind === 'video').length; }

  private pump(): void {
    const now = this.d.now();
    for (const j of this.jobs) {
      if (this.running.size >= MAX_ACTIVE) break;
      if (j.status === 'uploaded' || j.status === 'failed' || this.running.has(j.id)) continue;
      if (j.nextTryAt && j.nextTryAt > now) { this.d.later(() => this.pump(), j.nextTryAt - now); continue; }
      if (j.kind === 'video' && this.activeVideos() >= MAX_VIDEOS) continue;
      this.running.add(j.id);
      void this.run(j.id);
    }
  }

  private async run(id: string): Promise<void> {
    try {
      let j = this.get(id);
      if (!j) return;

      if (j.stage === 'prepare') {
        const adopted = j.sourceUri.includes('/media-queue/') ? j.sourceUri : await this.d.adopt(j);
        if (adopted !== j.sourceUri) this.patch(id, { sourceUri: adopted });
        j = this.get(id); if (!j) return;
        const prepared = j.useOriginal ? { uri: j.sourceUri, bytes: j.bytesIn } : await withTimeout(this.d.prepare(j), PREPARE_LIMIT_MS, () => new CompressionError('Getting the photo ready took too long.'));
        if (!this.get(id)) { await this.d.cleanup(prepared.uri !== j.sourceUri ? [prepared.uri] : []); return; }
        this.patch(id, { preparedUri: prepared.uri, bytesOut: prepared.bytes, width: prepared.width ?? j.width, height: prepared.height ?? j.height, stage: 'upload', status: 'uploading', error: undefined });
        j = this.get(id); if (!j) return;
      }

      if (j.stage === 'upload') {
        const uri = j.preparedUri ?? j.sourceUri;
        const up = await withTimeout(this.d.upload(j, uri, (p) => this.reportProgress(id, p)), UPLOAD_LIMIT_MS, () => new Error(`The upload timed out after ${Math.round(UPLOAD_LIMIT_MS / 60_000)} minutes`));
        if (!this.get(id)) { try { await this.d.removeStored(up.key); } catch { /* nothing points at it */ } return; }
        this.patch(id, { uploaded: up, stage: 'record', status: 'uploading', error: undefined, progress: 1 });
        j = this.get(id); if (!j) return;
      }

      if (j.stage === 'record' && j.uploaded) {
        await withTimeout(this.d.complete(j, j.uploaded), RECORD_LIMIT_MS, () => new Error('Saving the photo timed out'));
        this.patch(id, { status: 'uploaded', error: undefined, nextTryAt: undefined });
        await this.cleanupFiles(this.get(id)!);
        // Finished jobs are kept in memory for the screen to show "Uploaded", but never saved again as pending work.
        this.persist();
      }
    } catch (err) {
      this.fail(id, err);
    } finally {
      this.running.delete(id);
      this.pump();
    }
  }

  /** Live progress for the screen: updated in memory and announced, never written to storage (it changes many times a second). */
  private reportProgress(id: string, p: number): void {
    const j = this.get(id);
    if (!j || j.status !== 'uploading') return;
    const next = Math.max(0, Math.min(1, p));
    if (j.progress !== undefined && next < 1 && next - j.progress < 0.02) return;
    this.jobs = this.jobs.map((x) => (x.id === id ? { ...x, progress: next } : x));
    this.emit();
  }

  private fail(id: string, err: unknown): void {
    const j = this.get(id);
    if (!j) return;
    const message = (err as Error)?.message || 'Something went wrong.';
    const isCompression = (err as CompressionError)?.compression === true;
    const attempts = j.attempts + 1;
    if (isCompression) {
      // Never skipped silently: the person sees why, and may retry or choose to upload the original.
      this.patch(id, { status: 'failed', error: message, attempts, canUseOriginal: j.kind === 'image' || j.kind === 'video' });
      return;
    }
    if (isRetryable(err) && attempts < MAX_AUTO_TRIES) {
      this.patch(id, { status: j.stage === 'prepare' ? 'preparing' : 'uploading', error: message, attempts, nextTryAt: this.d.now() + this.d.backoffMs(attempts) });
      return;
    }
    this.patch(id, { status: 'failed', error: message, attempts, nextTryAt: undefined });
  }

  private patch(id: string, p: Partial<MediaJob>): void {
    this.jobs = this.jobs.map((j) => (j.id === id ? { ...j, ...p, updatedAt: this.d.now() } : j));
    this.persist();
    this.emit();
  }

  private async cleanupFiles(j: MediaJob): Promise<void> {
    const uris = [j.preparedUri, j.sourceUri].filter((u): u is string => !!u && u.includes('/media-queue/'));
    if (uris.length) { try { await this.d.cleanup(uris); } catch { /* temporary files; the OS clears them eventually */ } }
  }

  private persist(): void {
    const toSave = this.jobs.filter((j) => j.status !== 'uploaded');
    this.saving = this.saving.then(() => this.d.save(toSave)).catch(() => undefined);
  }

  private emit(): void { for (const fn of this.listeners) fn(); }

  /** Test helper: resolves when nothing is running and nothing is waiting to run. */
  async idle(): Promise<void> {
    for (let i = 0; i < 200; i++) {
      await new Promise((r) => setTimeout(r, 1));
      if (this.running.size === 0) { await this.saving; return; }
    }
  }
}
