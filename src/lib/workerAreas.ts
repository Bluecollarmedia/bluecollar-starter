/**
 * What a worker works on (supabase/updates/078_invite_links.sql). There is no "maintenance worker" versus "regular worker":
 * every worker is added the same way and the owner then switches on the areas: Landscaping, Maintenance, and (separately) Snow.
 * Rows from before update 78 only have the older worker type, which means Maintenance-only when it says 'maintenance'.
 */
import type { CompanyMember } from '@/types/company';

type Areas = Pick<CompanyMember, 'workerType' | 'worksLandscaping' | 'worksMaintenance'>;

export function worksOnMaintenance(m?: Areas): boolean {
  if (!m) return false;
  return m.worksMaintenance ?? m.workerType === 'maintenance';
}

export function worksOnLandscaping(m?: Areas): boolean {
  if (!m) return false;
  return m.worksLandscaping ?? m.workerType !== 'maintenance';
}

/**
 * An assignment gives the worker the job, whatever areas they are set to work in (the owner added them to it, so it must show).
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

/**
 * Which home a worker lands on. Only a worker who works Maintenance and nothing else, and has no project job coming up,
 * lands on the Maintenance home; everyone else lands on the main home, which links to a route when they have one.
 */
export function workerLanding(input: { maintenance: boolean; landscaping: boolean; hasProjectWork: boolean }): 'maintenance' | 'landscaping' {
  return input.maintenance && !input.landscaping && !input.hasProjectWork ? 'maintenance' : 'landscaping';
}

/** May this worker open the Maintenance screens? Their area, or a route they were put on. */
export function mayOpenMaintenance(input: { maintenance: boolean; onRoute: boolean }): boolean {
  return input.maintenance || input.onRoute;
}
