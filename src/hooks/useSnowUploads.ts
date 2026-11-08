import { useMediaJobs } from '@/lib/mediaQueueRuntime';
import type { MediaJob } from '@/lib/mediaQueue';

export interface SnowUploadState { uploading: MediaJob[]; failed: MediaJob[]; saved: number }

/** Of all the queue's jobs, the Snow photos of one kind that match: still on their way, failed, and how many have been saved so far. */
export function snowUploadState(all: MediaJob[], type: string, match: (payload: Record<string, unknown>) => boolean): SnowUploadState {
  const mine = all.filter((j) => j.target.type === type && match(j.target.payload));
  return {
    uploading: mine.filter((j) => j.status === 'preparing' || j.status === 'uploading'),
    failed: mine.filter((j) => j.status === 'failed'),
    saved: mine.filter((j) => j.status === 'uploaded').length,
  };
}

/**
 * The Snow photos of one kind for this screen (`match` picks them from the job's payload, for example one stop or one property service):
 * uploading in the background, failed, and how many have been saved. `saved` goes up each time one finishes, so a screen can reload its
 * list when it changes. Call it at the top of a component; a screen that must pick jobs after an early return uses
 * `useMediaJobs()` at the top and `snowUploadState` later instead.
 */
export function useSnowUploads(type: string, match: (payload: Record<string, unknown>) => boolean): SnowUploadState {
  return snowUploadState(useMediaJobs(), type, match);
}
