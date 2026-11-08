import { db } from '@/data/store';

/**
 * Where a worker is already booked on a day, or null when they are free. A project job counts;
 * a cancelled one does not. Used when a whole crew is added at once, so someone who is already
 * out on another job that day is flagged instead of double-booked.
 */
export function bookedOn(personId: string, dateKey: string): string | null {
  const job = db.assignments.find((a) =>
    a.personId === personId && a.scheduledDate === dateKey && a.status !== 'cancelled' && a.status !== 'reassigned');
  if (job) return db.projects.find((p) => p.id === job.projectId)?.name ?? 'another job';
  return null;
}
