/**
 * Does a worker have job work coming up? An assignment gives the worker the job (the owner added them to it, so it must show).
 * Open = today or later, not finished, cancelled or handed to someone else.
 */
export function hasOpenProjectWork(
  assignments: { personId: string; scheduledDate: string; status: string }[],
  personId: string | undefined,
  today: string,
): boolean {
  if (!personId) return false;
  return assignments.some((a) => a.personId === personId && a.scheduledDate >= today && !['completed', 'cancelled', 'reassigned'].includes(a.status)
    && !(a.scheduledDate === today && a.status === 'completed'));
}
