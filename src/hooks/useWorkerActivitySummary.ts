import { useMemo } from 'react';
import { useWorkerContext } from '@/providers/WorkerProvider';
import { db } from '@/data/store';
import type { Assignment } from '@/types/schedule';
import type { WorkerActivity, WorkerActivityType, CheckIn, CheckOut } from '@/types/worker';
import type { ProjectPhoto } from '@/types/project';

// Event types worth surfacing to the worker. Internal/audit-only events
// (schedule_confirmed, schedule_acknowledged, overtime_flagged) are kept in
// the underlying activity log for the system, but never shown here.
const VISIBLE_EVENT_TYPES: WorkerActivityType[] = [
  'checked_in', 'task_started', 'task_completed', 'photo_taken', 'checked_out',
];

export interface WorkSession {
  assignmentId: string;
  projectId: string;
  projectName: string;
  address?: string;
  checkInAt: string;
  checkOutAt?: string;
  workedMs: number;
  incomplete: boolean;
  tasksCompleted: number;
  photosUploaded: number;
  events: WorkerActivity[];
}

export interface DayGroup {
  date: string;
  sessions: WorkSession[];
  totalWorkedMs: number;
  jobs: number;
  tasksCompleted: number;
  photosUploaded: number;
  thumbnailUri?: string;
}

export interface WeekSummary {
  rangeLabel: string;
  totalWorkedMs: number;
  jobs: number;
  tasksCompleted: number;
  photosUploaded: number;
  days: DayGroup[];
}

function localDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type ActivityPeriod = 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_year' | 'all_time';

export const ACTIVITY_PERIODS: { key: ActivityPeriod; label: string }[] = [
  { key: 'this_week', label: 'This Week' },
  { key: 'last_week', label: 'Last Week' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'this_year', label: 'This Year' },
  { key: 'all_time', label: 'All Time' },
];

/** Start/end of a period. Weeks start on Sunday. */
function getPeriodRange(period: ActivityPeriod): { start: Date; end: Date; label: string } {
  const now = new Date();
  const label = ACTIVITY_PERIODS.find(p => p.key === period)!.label;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  let end = new Date(now);
  end.setHours(23, 59, 59, 999);

  switch (period) {
    case 'this_week':
    case 'last_week':
      start.setDate(start.getDate() - start.getDay() - (period === 'last_week' ? 7 : 0));
      end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      break;
    case 'this_month':
      start.setDate(1);
      break;
    case 'last_month':
      start.setDate(1);
      start.setMonth(start.getMonth() - 1);
      end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
      break;
    case 'this_year':
      start.setMonth(0, 1);
      break;
    case 'all_time':
      start.setTime(0);
      break;
  }
  return { start, end, label };
}

function buildSession(
  checkIn: CheckIn,
  checkOuts: CheckOut[],
  completedAssignments: Assignment[],
  activities: WorkerActivity[],
): WorkSession {
  const assignment = completedAssignments.find(a => a.id === checkIn.assignmentId);
  const checkOut = checkOuts.find(c => c.assignmentId === checkIn.assignmentId);
  const workedMs = checkOut
    ? new Date(checkOut.timestamp).getTime() - new Date(checkIn.timestamp).getTime()
    : 0;

  const events = activities
    .filter(a => a.assignmentId === checkIn.assignmentId && VISIBLE_EVENT_TYPES.includes(a.activityType))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return {
    assignmentId: checkIn.assignmentId,
    projectId: checkIn.projectId,
    // A job still in progress isn't in completedAssignments yet, so fall back to the project itself.
    projectName: (assignment?.project ?? db.projects.find(p => p.id === checkIn.projectId))?.name ?? 'Unknown Project',
    address: (assignment?.project ?? db.projects.find(p => p.id === checkIn.projectId))?.address,
    checkInAt: checkIn.timestamp,
    checkOutAt: checkOut?.timestamp,
    workedMs,
    incomplete: !checkOut,
    tasksCompleted: events.filter(e => e.activityType === 'task_completed').length,
    photosUploaded: events.filter(e => e.activityType === 'photo_taken').length,
    events,
  };
}

function groupSessionsByDay(sessions: WorkSession[]): DayGroup[] {
  const dayMap = new Map<string, WorkSession[]>();
  for (const session of sessions) {
    const key = localDateKey(session.checkInAt);
    if (!dayMap.has(key)) dayMap.set(key, []);
    dayMap.get(key)!.push(session);
  }

  return Array.from(dayMap.entries())
    .map(([date, daySessions]) => {
      daySessions.sort((a, b) => a.checkInAt.localeCompare(b.checkInAt));
      return {
        date,
        sessions: daySessions,
        totalWorkedMs: daySessions.reduce((sum, s) => sum + s.workedMs, 0),
        jobs: daySessions.length,
        tasksCompleted: daySessions.reduce((sum, s) => sum + s.tasksCompleted, 0),
        photosUploaded: daySessions.reduce((sum, s) => sum + s.photosUploaded, 0),
        thumbnailUri: (db.photos[daySessions[0].projectId] ?? [])[0]?.fileUrl,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Finds the real ProjectPhoto record behind a photo_taken activity, so it can
 * be opened in the real photo viewer. Matched by exact capture timestamp —
 * the mock upload flow stamps both records at the same moment. A real
 * backend should instead carry the photo id directly on the activity's
 * metadata to avoid relying on timestamp equality. */
export function findPhotoForActivity(activity: WorkerActivity, workerId?: string): ProjectPhoto | undefined {
  if (activity.activityType !== 'photo_taken' || !activity.projectId) return undefined;
  const photos = db.photos[activity.projectId] ?? [];
  const photoId = (activity.metadata as { photoId?: string } | undefined)?.photoId;
  if (photoId) return photos.find(p => p.id === photoId);
  return photos.find(p => p.uploadedBy === workerId && p.takenAt === activity.timestamp);
}

export function useWorkerActivitySummary(period: ActivityPeriod): WeekSummary {
  const { completedAssignments, checkIns, checkOuts, activities } = useWorkerContext();

  return useMemo(() => {
    const { start, end, label } = getPeriodRange(period);

    const sessions = checkIns
      .filter(c => {
        const d = new Date(c.timestamp);
        return d >= start && d <= end;
      })
      .map(c => buildSession(c, checkOuts, completedAssignments, activities));

    const days = groupSessionsByDay(sessions);

    return {
      rangeLabel: label,
      totalWorkedMs: days.reduce((sum, d) => sum + d.totalWorkedMs, 0),
      jobs: days.reduce((sum, d) => sum + d.jobs, 0),
      tasksCompleted: days.reduce((sum, d) => sum + d.tasksCompleted, 0),
      photosUploaded: days.reduce((sum, d) => sum + d.photosUploaded, 0),
      days,
    };
  }, [period, completedAssignments, checkIns, checkOuts, activities]);
}

/** Resolves a single day's work sessions directly by date key, independent of
 * which period it happened to be viewed from. */
export function useWorkerDayDetail(dateKey: string): DayGroup | undefined {
  const { completedAssignments, checkIns, checkOuts, activities } = useWorkerContext();

  return useMemo(() => {
    const sessions = checkIns
      .filter(c => localDateKey(c.timestamp) === dateKey)
      .map(c => buildSession(c, checkOuts, completedAssignments, activities));

    if (sessions.length === 0) return undefined;
    return groupSessionsByDay(sessions)[0];
  }, [dateKey, completedAssignments, checkIns, checkOuts, activities]);
}

export function formatWorkedDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}
