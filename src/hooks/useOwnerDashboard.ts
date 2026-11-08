import { useMemo } from 'react';
import type { Feather } from '@expo/vector-icons';
import { useSchedule } from '@/hooks/useSchedule';
import { useAttendance } from '@/hooks/useOperations';
import { db, useDb } from '@/data/store';
import { todayKey } from '@/lib/ids';
import { maintenanceToday } from '@/data/maintenanceToday';
import { useClockedInToday } from '@/hooks/useClockedInToday';
import type { Project } from '@/types/project';
import type { Assignment } from '@/types/schedule';
import type { PersonSummary } from '@/types/company';
import type { WorkerAttendance } from '@/types/operations';

type IconName = keyof typeof Feather.glyphMap;
type Severity = 'critical' | 'warning' | 'info';

export interface AttentionItem {
  id: string;
  title: string;
  subtitle: string;
  icon: IconName;
  severity: Severity;
  actionLabel: string;
  route: string;
  /** Remind: the button sends this worker a push for this job instead of opening a page. */
  remind?: { assignmentId: string; firstName: string };
  /** The signed-in owner/admin is the one on the job: the button confirms it for them (they cannot remind themselves). */
  confirmOwn?: { assignmentId: string };
}

export type CrewStatus = 'on_site' | 'late' | 'awaiting_confirmation' | 'scheduled' | 'completed';

export interface CrewMember {
  personId: string;
  person?: PersonSummary;
  status: CrewStatus;
  statusLabel: string;
  timeLabel?: string;
  projectName?: string;
}

export interface ProjectHomeSummary extends Project {
  todayStatusLabel?: string;
}

type AttendanceDetail = WorkerAttendance['assignments'][number] & { worker?: PersonSummary };

function formatTime(time?: string): string | undefined {
  if (!time) return undefined;
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Check-in timestamps are real instants (UTC); show them in the device's
 * local time. (Sample data in demo mode stamps naive local times with a 'Z'
 * suffix, so it reads those back as-is.)
 */
function formatClockIso(iso: string): string {
  const d = new Date(iso);
  const hh = String(db.demo ? d.getUTCHours() : d.getHours()).padStart(2, '0');
  const mm = String(db.demo ? d.getUTCMinutes() : d.getMinutes()).padStart(2, '0');
  return formatTime(`${hh}:${mm}`)!;
}

function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function sortByStart(assignments: Assignment[]): Assignment[] {
  return [...assignments].sort((a, b) => {
    if (a.isFullDay) return -1;
    if (b.isFullDay) return 1;
    return (a.startTime ?? '').localeCompare(b.startTime ?? '');
  });
}

const ON_SITE_STATUSES = new Set(['checked_in', 'late', 'past_scheduled_end']);
const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/**
 * Live operational summary for the Owner/Admin dashboard. Everything here is
 * derived from real assignment/attendance/request data for "today" — nothing
 * is hardcoded, so mock and (eventually) real backend data both flow through
 * the same rules.
 */
export function useOwnerDashboard() {
  const { getByDate } = useSchedule();
  const { getAttendanceForDate, settings } = useAttendance();

  const v = useDb();
  const today = todayKey();
  const todayAssignments = useMemo(() => getByDate(today), [getByDate, today]);
  const attendance = useMemo(() => getAttendanceForDate(today), [getAttendanceForDate, today]);

  const attendanceByAssignment = useMemo(() => {
    const map = new Map<string, AttendanceDetail>();
    for (const worker of attendance) {
      for (const a of worker.assignments) {
        map.set(a.assignmentId, { ...a, worker: worker.worker });
      }
    }
    return map;
  }, [attendance]);

  // Maintenance routes count too: the crew and leader of today's routes are scheduled, the crew at a property they checked in at is on
  // site, and a person on both a job and a route is counted once.
  const maint = useMemo(() => maintenanceToday(db.maintenance.routes, today), [v, today]);
  const clocked = useClockedInToday();

  const jobWorkerIds = useMemo(
    () => [...new Set(todayAssignments.map(a => a.personId))],
    [todayAssignments],
  );
  const workerIds = useMemo(
    () => [...new Set([...jobWorkerIds, ...maint.scheduled])],
    [jobWorkerIds, maint],
  );

  const onSiteWorkerIds = useMemo(() => {
    const set = new Set<string>();
    for (const a of todayAssignments) {
      const detail = attendanceByAssignment.get(a.id);
      if (detail && ON_SITE_STATUSES.has(detail.status)) set.add(a.personId);
    }
    return set;
  }, [todayAssignments, attendanceByAssignment]);

  const allOnSiteIds = useMemo(() => new Set([...onSiteWorkerIds, ...maint.onSite]), [onSiteWorkerIds, maint]);

  // Upcoming = scheduled and not on site yet. Someone whose only work today is routes that are all finished is not upcoming.
  const upcomingWorkerCount = useMemo(
    () => workerIds.filter(id => !allOnSiteIds.has(id) && !(maint.finished.has(id) && !jobWorkerIds.includes(id))).length,
    [workerIds, allOnSiteIds, maint, jobWorkerIds],
  );

  const jobsInProgress = useMemo(
    () => new Set(todayAssignments.map(a => a.projectId)).size + maint.propertyIds.size,
    [todayAssignments, maint],
  );

  // ── Needs Attention: actionable exceptions only ─────────────────
  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    const handledWorkers = new Set<string>();

    const byWorker = new Map<string, Assignment[]>();
    for (const a of todayAssignments) {
      if (!byWorker.has(a.personId)) byWorker.set(a.personId, []);
      byWorker.get(a.personId)!.push(a);
    }

    for (const [personId, list] of byWorker) {
      const sorted = sortByStart(list);

      const unconfirmed = sorted.find(a => a.confirmationState === 'awaiting');
      if (unconfirmed) {
        const name = unconfirmed.person ? `${unconfirmed.person.firstName} ${unconfirmed.person.lastName}` : 'A worker';
        const mine = personId === db.personId;
        items.push({
          id: `unconfirmed_${personId}`,
          title: mine ? "You haven't confirmed" : `${name} hasn't confirmed`,
          subtitle: `${unconfirmed.project?.name ?? 'Today’s job'} · Starts ${unconfirmed.isFullDay ? 'Full Day' : formatTime(unconfirmed.startTime)}`,
          icon: 'alert-circle',
          severity: 'warning',
          actionLabel: mine ? 'Confirm' : 'Remind',
          route: `/(owner)/workers/${personId}`,
          ...(mine ? { confirmOwn: { assignmentId: unconfirmed.id } } : { remind: { assignmentId: unconfirmed.id, firstName: unconfirmed.person?.firstName ?? '' } }),
        });
        handledWorkers.add(personId);
        continue;
      }

      const missed = sorted.find(a => {
        if (a.isFullDay || !a.startTime) return false;
        const detail = attendanceByAssignment.get(a.id);
        if (!detail || detail.status !== 'not_checked_in') return false;
        return nowMinutes() > timeToMinutes(a.startTime) + settings.missingCheckinGraceMinutes;
      });
      if (missed) {
        const name = missed.person ? `${missed.person.firstName} ${missed.person.lastName}` : 'A worker';
        items.push({
          id: `missed_${personId}`,
          title: `${name} hasn't checked in`,
          subtitle: `${missed.project?.name ?? 'Today’s job'} · Was due at ${formatTime(missed.startTime)}`,
          icon: 'user-x',
          severity: 'critical',
          actionLabel: 'Follow Up',
          route: `/(owner)/workers/${personId}`,
        });
        handledWorkers.add(personId);
      }
    }

    for (const detail of attendanceByAssignment.values()) {
      if (detail.withinRadius === false && detail.worker && !handledWorkers.has(detail.worker.id)) {
        items.push({
          id: `radius_${detail.assignmentId}`,
          title: `${detail.worker.firstName} ${detail.worker.lastName} checked in outside the job site`,
          subtitle: `${detail.projectName} · Needs approval`,
          icon: 'map-pin',
          severity: 'critical',
          actionLabel: 'Review',
          route: '/(owner)/more/attendance',
        });
        handledWorkers.add(detail.worker.id);
      }
    }

    for (const a of todayAssignments) {
      if (!a.truckId) continue;
      const truck = db.trucks.find(t => t.id === a.truckId);
      if (truck && (truck.status === 'maintenance' || truck.status === 'out_of_service')) {
        items.push({
          id: `truck_${a.id}`,
          title: `${truck.name} is unavailable but assigned to ${a.person?.firstName ?? 'a worker'}`,
          subtitle: `${a.project?.name ?? 'Today’s job'} · Needs a different truck`,
          icon: 'truck',
          severity: 'critical',
          actionLabel: 'Fix Assignment',
          route: '/(owner)/schedule',
        });
      }
    }

    const pendingRequests = Object.values(db.requests).flat().filter(r => r.status === 'pending');
    for (const req of pendingRequests) {
      const project = db.projects.find(p => p.id === req.projectId);
      items.push({
        id: `request_${req.id}`,
        title: `${req.requester ? `${req.requester.firstName} ${req.requester.lastName}` : 'A customer'} sent a request`,
        subtitle: `"${req.title}"${project ? ` · ${project.name}` : ''}`,
        icon: 'message-square',
        severity: 'info',
        actionLabel: 'Review',
        route: `/(owner)/projects/${req.projectId}?section=requests`,
      });
    }

    return items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }, [todayAssignments, attendanceByAssignment, settings, v]);

  // ── Crew Today: one live status row per worker ──────────────────
  const crewToday = useMemo<CrewMember[]>(() => {
    const byWorker = new Map<string, Assignment[]>();
    for (const a of todayAssignments) {
      if (!byWorker.has(a.personId)) byWorker.set(a.personId, []);
      byWorker.get(a.personId)!.push(a);
    }

    const members: CrewMember[] = [];
    for (const [personId, list] of byWorker) {
      const sorted = sortByStart(list);
      const primary = sorted.find(a => {
        const detail = attendanceByAssignment.get(a.id);
        return detail && ON_SITE_STATUSES.has(detail.status);
      }) ?? sorted[0];

      const detail = attendanceByAssignment.get(primary.id);
      let status: CrewStatus = 'scheduled';
      let timeLabel: string | undefined;

      if (detail?.status === 'late' || detail?.status === 'checked_in' || detail?.status === 'past_scheduled_end') {
        status = detail.status === 'late' ? 'late' : 'on_site';
        timeLabel = detail.actualCheckIn ? formatClockIso(detail.actualCheckIn) : undefined;
      } else if (detail?.status === 'checked_out') {
        status = 'completed';
      } else if (primary.confirmationState === 'awaiting') {
        status = 'awaiting_confirmation';
        timeLabel = primary.isFullDay ? 'Full Day' : formatTime(primary.startTime);
      } else {
        status = 'scheduled';
        timeLabel = primary.isFullDay ? 'Full Day' : formatTime(primary.startTime);
      }

      const statusLabelMap: Record<CrewStatus, string> = {
        on_site: 'On Site',
        late: 'Late',
        awaiting_confirmation: 'Awaiting Confirmation',
        scheduled: 'Scheduled',
        completed: 'Completed',
      };

      // Someone on a job AND a maintenance route is one row; if their route crew is at a property now they are on site.
      const mw = maint.where.get(personId);
      if (mw && maint.onSite.has(personId) && status !== 'on_site' && status !== 'late') {
        status = 'on_site';
        timeLabel = mw.arrivedAt ? formatClockIso(mw.arrivedAt) : timeLabel;
      }

      members.push({
        personId,
        person: primary.person,
        status,
        statusLabel: statusLabelMap[status],
        timeLabel,
        projectName: primary.project?.name,
      });
    }

    // Maintenance crew who are not on a landscaping job today get their own row (never a second row for the same person).
    for (const personId of maint.scheduled) {
      if (byWorker.has(personId)) continue;
      const mw = maint.where.get(personId);
      const person = db.people[personId];
      const isOn = maint.onSite.has(personId);
      const done = maint.finished.has(personId);
      const status: CrewStatus = isOn ? 'on_site' : done ? 'completed' : 'scheduled';
      members.push({
        personId,
        person,
        status,
        statusLabel: isOn ? 'On Site' : done ? 'Route done' : clocked.known && clocked.ids.has(personId) ? 'Clocked in' : 'Scheduled',
        timeLabel: isOn && mw?.arrivedAt ? formatClockIso(mw.arrivedAt) : undefined,
        projectName: isOn && mw?.atProperty ? `${mw.atProperty} (maintenance)` : mw?.routeName,
      });
    }

    const order: Record<CrewStatus, number> = { on_site: 0, late: 0, awaiting_confirmation: 1, scheduled: 1, completed: 2 };
    return members.sort((a, b) => order[a.status] - order[b.status]);
  }, [todayAssignments, attendanceByAssignment, maint, clocked, v]);

  // ── Active Projects: today's activity surfaced first ─────────────
  const activeProjects = useMemo<ProjectHomeSummary[]>(() => {
    const active = db.projects.filter(p => p.status === 'active');
    const withMeta = active.map(p => {
      const todaysForProject = todayAssignments.filter(a => a.projectId === p.id);
      const anyOnSite = todaysForProject.some(a => onSiteWorkerIds.has(a.personId));
      let todayStatusLabel: string | undefined;
      if (anyOnSite) {
        todayStatusLabel = 'Crew on site';
      } else if (todaysForProject.length > 0) {
        const next = sortByStart(todaysForProject)[0];
        todayStatusLabel = next.isFullDay ? 'Crew scheduled today' : `Next visit today · ${formatTime(next.startTime)}`;
      }
      return { project: p, todayStatusLabel, hasToday: todaysForProject.length > 0 };
    });

    withMeta.sort((a, b) => {
      if (a.hasToday !== b.hasToday) return a.hasToday ? -1 : 1;
      return new Date(b.project.updatedAt).getTime() - new Date(a.project.updatedAt).getTime();
    });

    return withMeta.map(({ project, todayStatusLabel }) => ({ ...project, todayStatusLabel }));
  }, [todayAssignments, onSiteWorkerIds, v]);

  return {
    todayStats: {
      jobsInProgress,
      workersScheduled: workerIds.length,
      onSite: allOnSiteIds.size,
      upcoming: upcomingWorkerCount,
    },
    attentionItems: attentionItems.slice(0, 3),
    attentionTotalCount: attentionItems.length,
    crewToday: crewToday.slice(0, 5),
    crewTodayTotal: crewToday.length,
    activeProjects: activeProjects.slice(0, 3),
    activeProjectsTotal: activeProjects.length,
  };
}
