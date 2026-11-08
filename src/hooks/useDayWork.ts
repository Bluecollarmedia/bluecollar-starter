import { useMemo } from 'react';
import { db, useDb } from '@/data/store';
import { todayKey } from '@/lib/ids';
import { useWorkerContext } from '@/providers/WorkerProvider';
import { buildDayWork, routesForDay, hasOpenWork, hasAnyWork, nextItem, type DayItem } from '@/lib/dayWork';
import type { MaintenanceRouteDetail } from '@/types/maintenance';

export interface DayWork {
  routes: MaintenanceRouteDetail[];
  items: DayItem[];
  /** Only the route stops, in display order (each once). */
  stops: Extract<DayItem, { kind: 'stop' }>[];
  /** Only the landscaping jobs, in display order. */
  jobs: Extract<DayItem, { kind: 'job' }>[];
  hasStops: boolean;
  hasJobs: boolean;
  /** Both a route and at least one job today: this worker gets the combined Today screen. */
  both: boolean;
  anyWork: boolean;
  openWork: boolean;
  next?: DayItem;
}

/**
 * Everything the signed-in worker has to do for a date (default today): every route they are on, plus their jobs. Used to choose which
 * Today screen to show and what it lists. It reads schedule data only. It never says whether the worker is clocked in.
 */
export function useDayWork(date: string = todayKey()): DayWork {
  const v = useDb();
  const { todayAssignments } = useWorkerContext();
  return useMemo(() => {
    const routes = routesForDay(db.maintenance.routes, db.personId, date);
    const jobs = todayAssignments.filter((a) => a.scheduledDate === date);
    const items = buildDayWork({ routes, jobs });
    const stops = items.filter((i): i is Extract<DayItem, { kind: 'stop' }> => i.kind === 'stop');
    const jobItems = items.filter((i): i is Extract<DayItem, { kind: 'job' }> => i.kind === 'job');
    return {
      routes, items, stops, jobs: jobItems,
      hasStops: stops.length > 0, hasJobs: jobItems.length > 0,
      both: routes.length > 0 && jobItems.length > 0,
      anyWork: hasAnyWork(items), openWork: hasOpenWork(items), next: nextItem(items),
    };
  }, [v, date, todayAssignments]);
}
