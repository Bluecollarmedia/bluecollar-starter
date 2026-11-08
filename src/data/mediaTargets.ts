/**
 * What happens when a queued photo/video is safely in storage: which database record is saved for it. One entry per kind of record,
 * all using the SAME record shape the app already used (so job, property, project and customer links, and the internal/shared setting,
 * are exactly what they were). The queue (src/lib/mediaQueue.ts) calls complete() only after the file is stored, and treats a failure
 * here as "not uploaded yet".
 *
 * The record id is the job id, so a retry can never create a second record. Maintenance photos are always saved internal
 * (isCustomerVisible false): compression and uploading never change who can see a photo.
 */
import { db, insertRow, confirmDeferredRow, discardLocalRow, rowsOf, type TableName } from './store';
import type { MediaJob } from '@/lib/mediaQueue';

export type MediaTargetType = 'project_photo' | 'maintenance_photo' | 'task_attachment';

const TABLES: Record<MediaTargetType, TableName> = {
  project_photo: 'project_photos',
  maintenance_photo: 'maintenance_photos',
  task_attachment: 'task_attachments',
};

const tableOf = (job: MediaJob): TableName | undefined => TABLES[job.target.type as MediaTargetType];

/** The fields of the record other than the file itself (which is filled in once it is stored). */
function baseRow(job: MediaJob): Record<string, unknown> {
  const row: Record<string, unknown> = { ...job.target.payload, id: job.id };
  if (job.target.type === 'maintenance_photo') { row.isCustomerVisible = false; row.sharedBy = undefined; row.sharedAt = undefined; }
  return row;
}

export async function completeMediaTarget(job: MediaJob, uploaded: { url: string; key: string }): Promise<void> {
  const table = tableOf(job);
  if (!table) throw new Error(`Unknown media target ${job.target.type}`);
  const fileFields: Record<string, unknown> = { fileUrl: uploaded.url, fileKey: uploaded.key };
  // Only the tables that keep a file size (project photos do not).
  if (job.target.type !== 'project_photo' && (job.bytesOut ?? job.bytesIn)) fileFields.sizeBytes = job.bytesOut ?? job.bytesIn;
  const res = await confirmDeferredRow(table, job.id, fileFields, { ...baseRow(job), ...fileFields });
  if (!res.ok) throw new Error(res.error);
  if (job.target.type === 'maintenance_photo') {
    // A worker who pressed a task that needs its own photo: the task ticks as soon as that photo is saved. Never lets a failure here undo the photo.
    try { await (require('./maintenance') as typeof import('./maintenance')).afterStopPhotoSaved(job.id, job.target.payload.taskId as string | undefined); } catch { /* the worker can tick it by hand */ }
  }
}

/** After an app restart: show the pending item again with its local file (nothing is saved yet). */
export function restoreMediaTarget(job: MediaJob): void {
  const table = tableOf(job);
  if (!table || db.demo) return;
  if (rowsOf(table).some((r) => (r as { id?: string }).id === job.id)) return;
  insertRow(table, { ...baseRow(job), fileUrl: job.uploaded?.url ?? job.sourceUri, fileKey: job.uploaded?.key ?? '' }, { deferSave: true });
}

/** Removes the local preview of a job the person cancelled. */
export function discardMediaTarget(job: MediaJob): void {
  const table = tableOf(job);
  if (table) discardLocalRow(table, job.id);
}
