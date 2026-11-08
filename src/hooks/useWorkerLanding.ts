import { useMemo } from 'react';
import { db, useDb } from '@/data/store';
import { todayKey } from '@/lib/ids';
import { hasOpenProjectWork, mayOpenMaintenance, worksOnLandscaping, worksOnMaintenance, workerLanding } from '@/lib/workerAreas';

/**
 * What the signed-in worker can reach: which home they land on, and whether they have project work and/or a route coming up.
 * Being put on a job or a route is what gives access to it; the worker's areas only decide which home they land on.
 */
export function useWorkerLanding() {
  const v = useDb();
  return useMemo(() => {
    const me = db.members.find((m) => m.personId === db.personId && (m.role === 'worker' || m.role === 'admin') && m.status === 'active');
    const today = todayKey();
    const projectWork = hasOpenProjectWork(db.assignments, db.personId, today);
    const onRoute = db.maintenance.routes.some((r) => r.status !== 'cancelled' && r.serviceDate >= today && r.crewIds.includes(db.personId));
    const maintenance = worksOnMaintenance(me);
    return {
      landing: workerLanding({ maintenance, landscaping: worksOnLandscaping(me), hasProjectWork: projectWork }),
      maintenanceAccess: mayOpenMaintenance({ maintenance, onRoute }),
      projectWork,
      onRoute,
    };
  }, [v]);
}
