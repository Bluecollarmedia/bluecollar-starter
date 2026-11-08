/**
 * Snow photos and videos that go through the shared background queue (src/lib/mediaQueue.ts). The queue sends the file to the private
 * Snow bucket; the last step, once the file is stored, saves its record. One entry per kind of Snow photo:
 *  - snow_completion: a crew lead's photo on a stop (snow_add_completion_media)
 *  - snow_reference:  an owner's reference photo for a property service (snow_reference_media)
 *  - snow_owner_media: an owner adding a photo to a finished stop in Photo review (snow_owner_add_media)
 */
import type { MediaJob } from '@/lib/mediaQueue';

export const SNOW_COMPLETION_TARGET = 'snow_completion';
export const SNOW_REFERENCE_TARGET = 'snow_reference';
export const SNOW_OWNER_MEDIA_TARGET = 'snow_owner_media';

export const isSnowTarget = (type: string) => type === SNOW_COMPLETION_TARGET || type === SNOW_REFERENCE_TARGET || type === SNOW_OWNER_MEDIA_TARGET;

/** Folder fragments the queue uses to tell a Snow file apart from a public-bucket one when it has to delete a stored file. */
export const isSnowKey = (key: string) => key.includes('/completion/') || key.includes('/reference/');

/** Saves the record for a stored Snow file. Throws with a plain message on failure (the queue then retries or shows Retry). */
export async function completeSnowTarget(job: MediaJob, key: string): Promise<void> {
  if (job.target.type === SNOW_COMPLETION_TARGET) {
    const { saveCompletionRecord } = require('@/data/snowRoutes') as typeof import('@/data/snowRoutes');
    return saveCompletionRecord(job, key);
  }
  if (job.target.type === SNOW_REFERENCE_TARGET) {
    const { saveReferenceRecord } = require('@/data/snowProperties') as typeof import('@/data/snowProperties');
    return saveReferenceRecord(job, key);
  }
  if (job.target.type === SNOW_OWNER_MEDIA_TARGET) {
    const { saveOwnerMediaRecord } = require('@/data/snowMediaReview') as typeof import('@/data/snowMediaReview');
    return saveOwnerMediaRecord(job, key);
  }
  throw new Error(`Unknown Snow media target ${job.target.type}`);
}
