/**
 * One worker's work for one date, from everything assigned to them: maintenance route stops (every route they are crew or leader on)
 * and landscaping jobs (assignments). Pure functions: no database, no screens.
 *
 * ORDER (display only. Nothing here changes a schedule, a stop order, an assignment or any stored record):
 *   1. Timed jobs, by start time. Ties: sort order, then creation time (the same order the database enforces for jobs).
 *   2. Route stops. Routes in creation order (then id), each route's stops in the owner's saved order.
 *   3. Full-day jobs, by sort order, then creation time.
 * A route has no start time, so a timed job always shows above it. Cancelled and reassigned jobs and cancelled routes are left out.
 * Each stop and each job appears once (by its own id). Nothing forces the worker to follow this order.
 */
import type { Assignment } from '@/types/schedule';
import type { MaintenanceRouteDetail, MaintenanceStopDetail } from '@/types/maintenance';

export type DayItem =
  | { kind: 'job'; id: string; job: Assignment; timed: boolean; done: boolean }
  | { kind: 'stop'; id: string; stop: MaintenanceStopDetail; route: MaintenanceRouteDetail; done: boolean };

const HIDDEN_JOB = new Set(['cancelled', 'reassigned']);
const cmp = (a: string | undefined, b: string | undefined) => (a ?? '') < (b ?? '') ? -1 : (a ?? '') > (b ?? '') ? 1 : 0;

/** Routes a person is on for a date, oldest first. */
export function routesForDay(routes: MaintenanceRouteDetail[], personId: string, date: string): MaintenanceRouteDetail[] {
  return routes
    .filter((r) => r.serviceDate === date && r.status !== 'cancelled' && r.crewIds.includes(personId))
    .sort((a, b) => cmp(a.createdAt, b.createdAt) || cmp(a.id, b.id));
}

export function buildDayWork(input: { routes: MaintenanceRouteDetail[]; jobs: Assignment[] }): DayItem[] {
  const jobs = input.jobs.filter((a) => !HIDDEN_JOB.has(a.status));
  const timed = jobs.filter((a) => !a.isFullDay && !!a.startTime)
    .sort((a, b) => cmp(a.startTime, b.startTime) || (a.sortOrder - b.sortOrder) || cmp(a.createdAt, b.createdAt));
  // A job with no start time and not marked full day has no time to respect: it sits with the full-day jobs.
  const untimed = jobs.filter((a) => a.isFullDay || !a.startTime)
    .sort((a, b) => (a.sortOrder - b.sortOrder) || cmp(a.createdAt, b.createdAt));

  const seen = new Set<string>();
  const stops: DayItem[] = [];
  for (const route of input.routes) {
    for (const stop of route.stops) {
      if (seen.has(stop.id)) continue;
      seen.add(stop.id);
      stops.push({ kind: 'stop', id: stop.id, stop, route, done: stop.status === 'completed' || stop.status === 'skipped' });
    }
  }
  const jobItem = (job: Assignment, isTimed: boolean): DayItem => ({ kind: 'job', id: job.id, job, timed: isTimed, done: job.status === 'completed' });
  return [...timed.map((j) => jobItem(j, true)), ...stops, ...untimed.map((j) => jobItem(j, false))];
}

/** Anything left to do (a stop not finished or skipped, a job not completed). Used to choose which screen to show; it says nothing about the clock. */
export const hasOpenWork = (items: DayItem[]) => items.some((i) => !i.done);
export const hasAnyWork = (items: DayItem[]) => items.length > 0;
/** The first open item in display order. */
export const nextItem = (items: DayItem[]) => items.find((i) => !i.done);
