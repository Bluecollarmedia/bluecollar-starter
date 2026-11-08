import type { MaintenanceStopDetail } from '@/types/maintenance';

/**
 * How a stop reads on the worker's screens. The stored status is pending /
 * arrived / completed / skipped; "next" is just the first unfinished pending
 * stop in the owner's saved order.
 */
export type StopDisplayStatus = 'upcoming' | 'next' | 'arrived' | 'completed' | 'skipped';

export function displayStatus(stop: MaintenanceStopDetail, nextStopId?: string): StopDisplayStatus {
  if (stop.status === 'pending') return stop.id === nextStopId ? 'next' : 'upcoming';
  return stop.status;
}
