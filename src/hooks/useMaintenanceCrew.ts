import { useCallback, useMemo } from 'react';
import { db, useDb } from '@/data/store';
import { maintenanceCrew, maintenanceWorkers, eligibleMaintenanceCrew, setMaintenanceCrew } from '@/data/maintenance';
import type { CompanyMember } from '@/types/company';
import type { WorkerType } from '@/types/maintenance';
import { worksOnMaintenance } from '@/lib/workerAreas';

export { setWorkerAreas } from '@/data/maintenance';

/** A member's worker type. Missing (older rows) means landscaping. */
export function workerTypeOf(member?: Pick<CompanyMember, 'workerType'>): WorkerType {
  return member?.workerType ?? 'landscaping';
}

/** Approved, active maintenance worker. Holding a maintenance code or being on
 * the team is not enough. Mirrors person_is_maintenance_worker() in update 018. */
export function isMaintenanceWorker(personId?: string): boolean {
  if (!personId) return false;
  const m = db.members.find((x) => x.personId === personId);
  return !!m && m.role === 'worker' && m.status === 'active' && worksOnMaintenance(m);
}

/** The Maintenance Crew, for the crew and worker screens. Route screens use
 * useMaintenanceWorkers() in useMaintenance.ts. */
export function useMaintenanceCrew() {
  const v = useDb();
  const crew = useMemo(() => maintenanceCrew(), [v]);
  const workers = useMemo(() => maintenanceWorkers(), [v]);
  const eligibleCrew = useMemo(() => eligibleMaintenanceCrew(), [v]);
  const isEligible = useCallback((personId?: string) => isMaintenanceWorker(personId), [v]);
  return { maintenanceCrew: crew, maintenanceWorkers: workers, eligibleCrew, isEligible, setMaintenanceCrew };
}
