import { openDirections, findCoords, distanceMeters, formatDistance, DEFAULT_CHECKIN_RADIUS_M, type Place } from '@/lib/maps';
import { evaluateCheckIn, checkInRefusal } from '@/lib/checkInRadius';
import { tr } from '@/i18n';
import { getCurrentGps } from '@/lib/location';
import { isSupabaseConfigured } from '@/lib/supabase';
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import { useAuth } from './AuthProvider';
import { db, useDb, insertRow, updateRow, upsertRow, findRow, refresh as refreshStore, type TableName } from '@/data/store';

/** What a check-in or finish changes on the database side: the job's status and its check-in / check-out and session records. */
export const JOB_TABLES: TableName[] = ['assignments', 'check_ins', 'check_outs', 'work_sessions'];
import { useMyWorkday, type Workday } from '@/hooks/useMyWorkday';
import { addProjectPhoto, logProjectHistory, notifyStaff } from '@/data/actions';
import { todayKey, localDateTime } from '@/lib/ids';
import type { Assignment } from '@/types/schedule';
import type { ProjectTask, ProjectSettings } from '@/types/project';
import type {
  CheckIn,
  CheckOut,
  GPSCoordinates,
  WorkerActivity,
  WorkerSettings,
  NavAppPreference,
  OfflineAction,
  OfflineSyncStatus,
} from '@/types/worker';

export type CheckInLocation =
  | { ok: true; gps: GPSCoordinates | null }
  | { ok: false; title: string; message: string; openSettings?: boolean };

/** Demo mode has no real phone location; pretend the worker is on site. */
const DEMO_GPS: GPSCoordinates = { latitude: 41.4756, longitude: -81.5558, accuracy: 10, distanceFromSite: 20 };


type JobState = 'not_started' | 'confirmed' | 'en_route' | 'checked_in' | 'working' | 'completed';

function showTaskLeadNotice(message: string) {
  if (Platform.OS === 'web') (globalThis as { alert?: (m: string) => void }).alert?.(message);
  else Alert.alert(tr('Task Lead only'), message);
}

interface WorkerContextValue {
  todayAssignments: Assignment[];
  upcomingAssignments: Assignment[];
  completedAssignments: Assignment[];
  currentJob: Assignment | null;
  nextJob: Assignment | null;
  jobState: JobState;
  scheduleConfirmed: boolean;
  hasScheduleChanges: boolean;

  confirmSchedule: () => void;
  acknowledgeChanges: () => void;

  /** Checks in to the given job (or the current/next one). Works again after checking out, to resume a job. */
  checkIn: (gps: GPSCoordinates | null, assignmentId?: string) => void;
  checkOut: (gps: GPSCoordinates | null) => void;
  /** The workday clock (update 63). `timeOn` is true once the database update is installed; then check-in and check-out go through the workday. */
  workday: Workday;
  timeOn: boolean;
  checkInTimed: (gps: GPSCoordinates | null, assignmentId?: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  checkOutTimed: (gps: GPSCoordinates | null) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Reads the phone's location and checks it against the job site. Check-in is only allowed when ok. */
  locateForCheckIn: (assignmentId?: string) => Promise<CheckInLocation>;
  /** Reads the phone's location for check-out (never blocks). */
  locateForCheckOut: () => Promise<GPSCoordinates | null>;
  checkIns: CheckIn[];
  checkOuts: CheckOut[];

  projectTasks: (projectId: string) => ProjectTask[];
  /** Whether this worker is the job's Task Lead (only the lead can change its tasks, update 016). */
  isTaskLead: (projectId: string) => boolean;
  /** Both refuse (with a message) when this worker isn't the job's Task Lead. */
  startTask: (taskId: string) => boolean;
  completeTask: (taskId: string) => boolean;
  projectSettings: (projectId: string) => ProjectSettings | undefined;
  taskPhotoCaptured: Record<string, boolean>;
  taskPhotoUris: Record<string, string>;
  captureTaskPhoto: (taskId: string, uri?: string) => void;

  activities: WorkerActivity[];
  settings: WorkerSettings;
  updateNavApp: (app: NavAppPreference) => void;
  updateNotificationsEnabled: (enabled: boolean) => void;

  offlineQueue: OfflineAction[];
  isOnline: boolean;

  openMapsNavigation: (place: Place) => void;
  moveToNextJob: () => void;
}

const WorkerContext = createContext<WorkerContextValue | null>(null);

export function useWorkerContext() {
  const ctx = useContext(WorkerContext);
  if (!ctx) throw new Error('useWorkerContext must be used within WorkerProvider');
  return ctx;
}

export function WorkerProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const workerId = user?.id ?? '';
  const v = useDb();

  const today = todayKey();

  const allAssignments = useMemo(() =>
    db.assignments.filter(a => a.personId === workerId && a.status !== 'cancelled' && a.status !== 'reassigned'),
    [workerId, v],
  );

  const checkInList = useMemo(() => db.checkIns.filter(c => c.personId === workerId), [workerId, v]);
  const checkOutList = useMemo(() => db.checkOuts.filter(c => c.personId === workerId), [workerId, v]);
  const activityList = useMemo(() => db.workerActivities.filter(a => a.personId === workerId), [workerId, v]);
  const workerSettings = useMemo(() => db.workerSettings, [v]);

  const [localTaskPhotos, setLocalTaskPhotos] = useState<Record<string, boolean>>({});
  const [taskPhotoUris, setTaskPhotoUris] = useState<Record<string, string>>({});
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const workday = useMyWorkday(!!workerId && isSupabaseConfigured);
  const timeOn = workday.installed === true;
  const [offlineQueue] = useState<OfflineAction[]>([]);
  const [isOnline] = useState(true);

  const getAssignmentStatus = useCallback((a: Assignment) => a.status, []);

  const todayAssignments = useMemo(() =>
    allAssignments
      .filter(a => a.scheduledDate === today)
      .sort((a, b) => {
        if (a.isFullDay && !b.isFullDay) return 1;
        if (!a.isFullDay && b.isFullDay) return -1;
        return (a.startTime ?? '').localeCompare(b.startTime ?? '');
      }),
    [allAssignments, today],
  );

  const upcomingAssignments = useMemo(() =>
    allAssignments
      // Today's unfinished jobs count as upcoming too, so My Jobs never looks empty on the day of a job.
      .filter(a => a.scheduledDate > today || (a.scheduledDate === today && a.status !== 'completed'))
      .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.sortOrder - b.sortOrder),
    [allAssignments, today],
  );

  const completedAssignments = useMemo(() =>
    allAssignments
      .filter(a => a.scheduledDate < today || a.status === 'completed')
      .sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate)),
    [allAssignments, today],
  );

  const currentJob = useMemo(() => {
    if (currentJobId) return todayAssignments.find(a => a.id === currentJobId) ?? null;
    return todayAssignments.find(a => a.status === 'checked_in' || a.status === 'working') ?? null;
  }, [todayAssignments, currentJobId]);

  const nextJob = useMemo(() => {
    if (!currentJob) return todayAssignments.find(a => a.status !== 'completed') ?? null;
    const idx = todayAssignments.findIndex(a => a.id === currentJob.id);
    return todayAssignments.slice(idx + 1).find(a => a.status !== 'completed') ?? null;
  }, [todayAssignments, currentJob]);

  // Where the worker is with the current job, from the saved assignment status
  // (so it survives closing the app).
  const jobState = useMemo<JobState>(() => {
    if (!currentJob) return 'not_started';
    if (currentJob.status === 'checked_in') return 'checked_in';
    if (currentJob.status === 'working') return 'working';
    if (currentJob.status === 'completed') return 'completed';
    return 'not_started';
  }, [currentJob]);

  // The worker never has to confirm the schedule before starting: having a job today is enough. "I'm here" marks the jobs confirmed
  // (see the Today screen), so the owner's "hasn't confirmed" alert still clears.
  const scheduleConfirmed = useMemo(() => todayAssignments.length > 0, [todayAssignments]);

  const hasScheduleChanges = useMemo(() =>
    todayAssignments.some(a =>
      a.confirmationState === 'updated_since' || a.confirmationState === 'awaiting',
    ),
    [todayAssignments],
  );

  const logActivity = useCallback((activity: Omit<WorkerActivity, 'id' | 'companyId' | 'personId' | 'timestamp' | 'project'>) => {
    insertRow('worker_activities', { ...activity, personId: workerId, timestamp: new Date().toISOString() });
  }, [workerId]);

  const workerName = user ? `${user.firstName} ${user.lastName}`.trim() : 'A worker';

  const confirmSchedule = useCallback(() => {
    for (const a of todayAssignments) {
      if (a.confirmationState !== 'confirmed') updateRow('assignments', a.id, { confirmationState: 'confirmed' });
    }
    logActivity({ activityType: 'schedule_confirmed', description: 'Confirmed today\'s schedule' });
  }, [todayAssignments, logActivity]);

  const acknowledgeChanges = useCallback(() => {
    for (const a of todayAssignments) {
      if (a.confirmationState === 'updated_since' || a.confirmationState === 'awaiting') {
        updateRow('assignments', a.id, { confirmationState: 'confirmed' });
      }
    }
    logActivity({ activityType: 'schedule_acknowledged', description: 'Acknowledged schedule changes' });
  }, [todayAssignments, logActivity]);

  /** The job "I'm here" applies to: the given one, else the current/next unfinished one, else the last (to resume). */
  const resolveCheckInJob = useCallback((assignmentId?: string) =>
    (assignmentId && allAssignments.find(a => a.id === assignmentId))
      || (currentJob && currentJob.status !== 'completed' ? currentJob : undefined)
      || todayAssignments.find(a => a.status !== 'completed')
      // Everything's checked out: let them check back in to the job they just left.
      || currentJob
      || todayAssignments[todayAssignments.length - 1],
  [allAssignments, currentJob, todayAssignments]);

  const locateForCheckIn = useCallback(async (assignmentId?: string): Promise<CheckInLocation> => {
    if (!isSupabaseConfigured) return { ok: true, gps: DEMO_GPS };
    const job = resolveCheckInJob(assignmentId);
    if (!job) return { ok: true, gps: null };

    const here = await getCurrentGps();
    if (here.status === 'denied') {
      return {
        ok: false,
        title: tr('Turn on location'),
        message: tr('Brighton Lawn needs your location to check you in at the job site. Turn it on in Settings, then try again.'),
        openSettings: true,
      };
    }
    if (here.status === 'unavailable') {
      return {
        ok: false,
        title: tr('Can’t find your location'),
        message: tr('Your phone couldn’t get a GPS fix. Step outside or wait a moment, then try again.'),
      };
    }

    const gps = here.gps;
    const radius = db.settings[job.projectId]?.checkinRadiusMeters ?? DEFAULT_CHECKIN_RADIUS_M;
    const site = job.project ? await findCoords(job.project) : null;

    // The real check: the phone's actual position against the project's coordinates and its saved distance.
    // A job with no findable location, or a GPS fix too vague to trust, is refused with a clear reason (never waved through).
    const verdict = evaluateCheckIn({ gps, site, radiusM: radius });
    if (!verdict.ok) {
      const jobName = job.project?.name ?? tr('the job site');
      const say = checkInRefusal(verdict, jobName, formatDistance);
      // The same wording as checkInRefusal (src/lib/checkInRadius.ts), in the worker's language.
      if (verdict.reason === 'too_far') {
        return {
          ok: false,
          title: tr('You are too far from this project to check in'),
          message: tr('You are about {distance} from {job}. You need to be within {radius} to check in.', { distance: formatDistance(verdict.distance ?? 0), job: jobName, radius: formatDistance(verdict.radius) }),
        };
      }
      if (verdict.reason === 'inaccurate') {
        return {
          ok: false,
          title: tr('Your location is not accurate enough'),
          message: tr("Your phone's GPS is only accurate to about {distance} right now. Step into the open, wait a moment, then try again.", { distance: formatDistance(verdict.accuracy ?? 0) }),
        };
      }
      if (verdict.reason === 'bad_gps') {
        return { ok: false, title: tr("Can't read your location"), message: tr('Your phone gave an unusable location. Wait a moment, then try again.') };
      }
      if (verdict.reason === 'no_site') {
        return {
          ok: false,
          title: tr("This project's location isn't set"),
          message: tr("We can't find {job}'s address on the map, so your location can't be checked. Ask the office to fix the project address, then try again.", { job: jobName }),
        };
      }
      return { ok: false, title: say.title, message: say.message };
    }
    return { ok: true, gps: { ...gps, distanceFromSite: verdict.distance } };
  }, [resolveCheckInJob]);

  const locateForCheckOut = useCallback(async (): Promise<GPSCoordinates | null> => {
    if (!isSupabaseConfigured) return DEMO_GPS;
    const here = await getCurrentGps();
    if (here.status !== 'ok') return null;
    const site = currentJob?.project ? await findCoords(currentJob.project) : null;
    return site ? { ...here.gps, distanceFromSite: Math.round(distanceMeters(here.gps, site)) } : here.gps;
  }, [currentJob]);

  /** What follows a check-in: remember the job, log it, tell the owner. (The records themselves are written by checkIn or by the database.) */
  const afterCheckIn = useCallback((job: Assignment, resuming: boolean) => {
    const now = new Date();
    const projectName = job.project?.name ?? 'job site';
    setCurrentJobId(job.id);
    logActivity({ assignmentId: job.id, projectId: job.projectId, activityType: 'checked_in', description: `${resuming ? 'Checked back in' : 'Checked in'} at ${projectName}` });

    // Tell the owner.
    const link = { type: 'assignment' as const, id: job.id };
    const late = !job.isFullDay && job.startTime
      ? now.getTime() > localDateTime(job.scheduledDate, job.startTime).getTime() + (db.operationsSettings.lateCheckinThresholdMinutes ?? 0) * 60000
      : false;
    if (resuming) {
      notifyStaff('worker_checked_in', 'Worker checked back in', `${workerName} checked back in at ${projectName}.`, link, undefined, workerId);
    } else if (late) {
      notifyStaff('worker_checked_in_late', 'Late check-in', `${workerName} checked in late at ${projectName} (scheduled ${job.startTime}).`, link, undefined, workerId);
    } else {
      notifyStaff('worker_checked_in', 'Worker checked in', `${workerName} checked in at ${projectName}.`, link, undefined, workerId);
    }
  }, [workerId, logActivity, workerName]);

  const checkIn = useCallback((gps: GPSCoordinates | null, assignmentId?: string) => {
    const job = resolveCheckInJob(assignmentId);
    if (!job) return;
    const resuming = job.status === 'completed';
    const nowIso = new Date().toISOString();
    // locateForCheckIn already refused anyone outside the job's distance.
    insertRow('check_ins', {
      assignmentId: job.id, personId: workerId, projectId: job.projectId,
      timestamp: nowIso, gps, withinRadius: true,
    });
    insertRow('work_sessions', {
      personId: workerId, projectId: job.projectId, assignmentId: job.id,
      checkInTime: nowIso, checkInGps: gps, status: 'active',
    });
    updateRow('assignments', job.id, { status: 'checked_in' });
    afterCheckIn(job, resuming);
  }, [resolveCheckInJob, workerId, afterCheckIn]);

  /** Check-in through the workday: the database checks the clock-in, job order, photo rule and radius, then writes every record. */
  const checkInTimed = useCallback(async (gps: GPSCoordinates | null, assignmentId?: string): Promise<{ ok: true } | { ok: false; error: string }> => {
    const job = resolveCheckInJob(assignmentId);
    if (!job) return { ok: false, error: 'There is no job to check in to.' };
    if (!workday.active) return { ok: false, error: 'Clock in first on the Clock tab.' };
    const resuming = job.status === 'completed';
    const g = gps ? { lat: gps.latitude, lng: gps.longitude, accuracy: gps.accuracy, raw: gps as unknown as Record<string, unknown> } : {};
    const r = await workday.startVisit('assignment', job.id, g);
    if (!r.ok) return { ok: false, error: r.error };
    // The database already marked the job checked in; reload the jobs now so the screen moves on at once (an empty refresh reloaded nothing).
    await refreshStore(...JOB_TABLES);
    afterCheckIn(job, resuming);
    return { ok: true };
  }, [resolveCheckInJob, workday, afterCheckIn]);

  const checkOut = useCallback((gps: GPSCoordinates | null) => {
    const job = currentJob;
    if (!job) return;

    const nowIso = new Date().toISOString();
    const projectName = job.project?.name ?? 'job site';
    insertRow('check_outs', {
      assignmentId: job.id, personId: workerId, projectId: job.projectId,
      timestamp: nowIso, gps,
    });
    const session = db.workSessions.find(s => s.assignmentId === job.id && s.personId === workerId && s.status === 'active');
    if (session) {
      const minutes = Math.max(0, Math.round((Date.now() - new Date(session.checkInTime).getTime()) / 60000));
      updateRow('work_sessions', session.id, {
        checkOutTime: nowIso, checkOutGps: gps, durationMinutes: minutes, status: 'completed',
      });
    }
    updateRow('assignments', job.id, { status: 'completed' });
    logActivity({ assignmentId: job.id, projectId: job.projectId, activityType: 'checked_out', description: `Checked out from ${projectName}` });
    notifyStaff('worker_checked_out', 'Worker checked out', `${workerName} checked out from ${projectName}.`, { type: 'assignment', id: job.id }, undefined, workerId);
  }, [currentJob, workerId, logActivity, workerName]);

  /** Check-out through the workday: ends this employee's own time at the property. The workday keeps running. */
  const checkOutTimed = useCallback(async (gps: GPSCoordinates | null): Promise<{ ok: true } | { ok: false; error: string }> => {
    const job = currentJob;
    if (!job) return { ok: false, error: 'There is no job to check out of.' };
    const cur = workday.day?.current;
    if (!cur || cur.projectId !== job.projectId) { checkOut(gps); return { ok: true }; }  // started before time tracking was switched on
    const g = gps ? { lat: gps.latitude, lng: gps.longitude, accuracy: gps.accuracy, raw: gps as unknown as Record<string, unknown> } : {};
    const r = await workday.completeVisit(cur.visitId, undefined, g);
    if (!r.ok) return { ok: false, error: r.error };
    await refreshStore(...JOB_TABLES);
    const projectName = job.project?.name ?? 'job site';
    logActivity({ assignmentId: job.id, projectId: job.projectId, activityType: 'checked_out', description: `Checked out from ${projectName}` });
    notifyStaff('worker_checked_out', 'Worker checked out', `${workerName} checked out from ${projectName}.`, { type: 'assignment', id: job.id }, undefined, workerId);
    return { ok: true };
  }, [currentJob, workday, checkOut, logActivity, workerName, workerId]);

  const moveToNextJob = useCallback(() => {
    setCurrentJobId(nextJob ? nextJob.id : null);
  }, [nextJob]);

  const projectTasksFn = useCallback((projectId: string): ProjectTask[] =>
    db.tasks[projectId] ?? [], [v]);

  // Who may check off a job's tasks (update 120): its Task Lead always; anyone else on the job too, unless the owner turned on
  // "Only the Task Lead checks off tasks" (company.taskLeadOnly). Kept under the old name: every screen asks "may I change tasks here?".
  const isTaskLead = useCallback((projectId: string) => {
    if (db.projects.find(p => p.id === projectId)?.taskLeadId === workerId) return true;
    if (db.company?.taskLeadOnly) return false;
    return db.assignments.some(a => a.projectId === projectId && a.personId === workerId && a.status !== 'cancelled' && a.status !== 'reassigned');
  }, [v, workerId]);

  // The database refuses task changes from anyone but the Task Lead, so stop
  // here with the reason instead of showing a change that won't save.
  const leadOrExplain = useCallback((projectId?: string) => {
    const lead = db.projects.find(p => p.id === projectId)?.taskLeadId;
    if (projectId && isTaskLead(projectId)) return true;
    const name = lead ? db.people[lead] : undefined;
    showTaskLeadNotice(lead
      ? (name ? tr('Only the Task Lead, {name}, can change tasks on this job.', { name: name.firstName }) : tr('Only the Task Lead can change tasks on this job.'))
      : tr('This job has no Task Lead yet. Ask the owner to pick one.'));
    return false;
  }, [v, workerId, isTaskLead]);

  const startTask = useCallback((taskId: string) => {
    const task = findRow('project_tasks', taskId);
    if (!leadOrExplain(task?.projectId)) return false;
    updateRow('project_tasks', taskId, { status: 'in_progress' });
    if (currentJob?.status === 'checked_in') updateRow('assignments', currentJob.id, { status: 'working' });
    logActivity({
      assignmentId: currentJob?.id, projectId: task?.projectId,
      activityType: 'task_started', description: `Started: ${task?.title ?? 'task'}`,
    });
    return true;
  }, [currentJob, logActivity, leadOrExplain]);

  const completeTask = useCallback((taskId: string) => {
    const task = findRow('project_tasks', taskId);
    if (!leadOrExplain(task?.projectId)) return false;
    updateRow('project_tasks', taskId, { status: 'completed', completedAt: new Date().toISOString(), completedBy: workerId });
    logActivity({
      assignmentId: currentJob?.id, projectId: task?.projectId,
      activityType: 'task_completed', description: `Completed: ${task?.title ?? 'task'}`,
    });
    if (task?.projectId) {
      logProjectHistory(task.projectId, 'task_completed', `Task completed: ${task.title}`, { taskId });
      const projectName = db.projects.find(p => p.id === task.projectId)?.name ?? 'a project';
      notifyStaff('worker_completed_task', 'Task completed', `${workerName} completed "${task.title}" at ${projectName}.`, { type: 'project', id: task.projectId }, undefined, workerId);
    }
    return true;
  }, [currentJob, logActivity, workerName, workerId, leadOrExplain]);

  const projectSettingsFn = useCallback((projectId: string) =>
    db.settings[projectId], [v]);

  // A task counts as photographed once a photo is attached to it (from this
  // device or saved earlier).
  const taskPhotos = useMemo(() => {
    const out: Record<string, boolean> = { ...localTaskPhotos };
    for (const list of Object.values(db.photos)) {
      for (const ph of list) if (ph.taskId) out[ph.taskId] = true;
    }
    return out;
  }, [localTaskPhotos, v]);

  const captureTaskPhoto = useCallback((taskId: string, uri?: string) => {
    setLocalTaskPhotos(prev => ({ ...prev, [taskId]: true }));
    if (uri) setTaskPhotoUris(prev => ({ ...prev, [taskId]: uri }));
    const task = findRow('project_tasks', taskId);
    const projectId = task?.projectId ?? currentJob?.projectId;
    let photoId: string | undefined;
    if (uri && projectId) {
      photoId = addProjectPhoto({
        projectId,
        taskId,
        assignmentId: currentJob?.id,
        uploadedBy: workerId,
        fileUrl: uri,
        isCustomerVisible: false,
        photoType: 'progress',
        takenAt: new Date().toISOString(),
      }).id;
      notifyStaff('photo_waiting_review', 'New photo to review', `${workerName} added a photo for "${task?.title ?? 'a task'}".`, { type: 'project', id: projectId }, undefined, workerId);
    }
    logActivity({
      assignmentId: currentJob?.id, projectId,
      activityType: 'photo_taken', description: 'Completion photo captured',
      metadata: photoId ? { photoId } : undefined,
    });
  }, [workerId, currentJob, logActivity, workerName]);

  const updateNavApp = useCallback((app: NavAppPreference) => {
    upsertRow('worker_settings', { personId: workerId, navApp: app, notificationsEnabled: db.workerSettings.notificationsEnabled });
  }, [workerId]);

  const updateNotificationsEnabled = useCallback((enabled: boolean) => {
    upsertRow('worker_settings', { personId: workerId, navApp: db.workerSettings.navApp, notificationsEnabled: enabled });
  }, [workerId]);

  const openMapsNavigation = useCallback((place: Place) => {
    openDirections(place, workerSettings.navApp);
  }, [workerSettings.navApp]);

  const value = useMemo<WorkerContextValue>(() => ({
    todayAssignments,
    upcomingAssignments,
    completedAssignments,
    currentJob,
    nextJob,
    jobState,
    scheduleConfirmed,
    hasScheduleChanges,
    confirmSchedule,
    acknowledgeChanges,
    checkIn,
    checkOut,
    workday,
    timeOn,
    checkInTimed,
    checkOutTimed,
    locateForCheckIn,
    locateForCheckOut,
    checkIns: checkInList,
    checkOuts: checkOutList,
    projectTasks: projectTasksFn,
    isTaskLead,
    startTask,
    completeTask,
    projectSettings: projectSettingsFn,
    taskPhotoCaptured: taskPhotos,
    taskPhotoUris,
    captureTaskPhoto,
    activities: activityList,
    settings: workerSettings,
    updateNavApp,
    updateNotificationsEnabled,
    offlineQueue,
    isOnline,
    openMapsNavigation,
    moveToNextJob,
  }), [
    todayAssignments, upcomingAssignments, completedAssignments,
    currentJob, nextJob, jobState, scheduleConfirmed, hasScheduleChanges,
    confirmSchedule, acknowledgeChanges,
    checkIn, checkOut, workday, timeOn, checkInTimed, checkOutTimed, locateForCheckIn, locateForCheckOut, checkInList, checkOutList,
    projectTasksFn, isTaskLead, startTask, completeTask, projectSettingsFn,
    taskPhotos, taskPhotoUris, captureTaskPhoto, activityList, workerSettings,
    updateNavApp, updateNotificationsEnabled, offlineQueue, isOnline, openMapsNavigation, moveToNextJob,
  ]);

  return <WorkerContext.Provider value={value}>{children}</WorkerContext.Provider>;
}
