import React, { createContext, useContext, useCallback, useEffect, useMemo } from 'react';
import type {
  Assignment, RepeatFrequency, ScheduleChange, ScheduleChangeType, ScheduleConflict, ScheduleSeries, TravelWarning,
} from '@/types/schedule';
import { db, useDb, insertRow, updateRow, flushWrites, rpc, refresh, isDemo, rowsOf } from '@/data/store';
import { todayKey, localDateKey, uuid } from '@/lib/ids';
import { addDaysKey, occurrenceDates, SERIES_HORIZON_DAYS } from '@/lib/recurrence';

// The day repeats were last topped up on this device (once a day is enough).
let lastTopUpDay = '';

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function timesOverlap(s1?: string, e1?: string, s2?: string, e2?: string): boolean {
  if (!s1 || !e1 || !s2 || !e2) return false;
  return timeToMinutes(s1) < timeToMinutes(e2) && timeToMinutes(s2) < timeToMinutes(e1);
}

function isActive(a: Assignment): boolean {
  return a.status !== 'cancelled' && a.status !== 'reassigned';
}

export interface ScheduleContextValue {
  assignments: Assignment[];
  series: ScheduleSeries[];
  changes: ScheduleChange[];
  stats: { total: number; confirmed: number; awaiting: number };
  getByDate: (date: string) => Assignment[];
  getAllByDate: (date: string) => Assignment[];
  getByWorker: (personId: string, date?: string) => Assignment[];
  getByProject: (projectId: string, date?: string) => Assignment[];
  getGroupedByWorker: (date: string) => Record<string, { person: Assignment['person']; truck?: Assignment['truck']; assignments: Assignment[] }>;
  weekSummary: (startDate: string) => { date: string; label: string; workerCount: number; projectCount: number; hasIssues: boolean }[];
  detectConflicts: (params: {
    personId: string; scheduledDate: string; startTime?: string; endTime?: string;
    isFullDay: boolean; truckId?: string; excludeId?: string;
  }) => ScheduleConflict[];
  detectTravelWarnings: (personId: string, date: string) => TravelWarning[];
  createAssignment: (params: {
    personId: string; projectId: string; scheduledDate: string;
    startTime?: string; endTime?: string; isFullDay: boolean;
    truckId?: string; notes?: string; seriesId?: string;
  }) => Assignment;
  /** Schedules a worker on a job on repeat from `scheduledDate`. The first
   * day is created right away; the rest are filled in a few weeks ahead. */
  createSeries: (params: {
    personId: string; projectId: string; scheduledDate: string;
    startTime?: string; endTime?: string; isFullDay: boolean;
    truckId?: string; notes?: string;
    frequency: RepeatFrequency; intervalDays?: number; horizonDays?: number; endDate?: string;
  }) => ScheduleSeries;
  /** Stops a repeat after `afterDate`: later days that haven't started are cancelled. */
  endSeriesAfter: (seriesId: string, afterDate: string) => void;
  cancelAssignment: (assignmentId: string, reason?: string) => void;
  moveWorker: (assignmentId: string, newProjectId: string, notes?: string) => Assignment | undefined;
  updateAssignment: (assignmentId: string, updates: Partial<Pick<Assignment, 'startTime' | 'endTime' | 'isFullDay' | 'truckId' | 'notes'>>, changeNotes?: string) => void;
  getChangesForAssignment: (assignmentId: string) => ScheduleChange[];
  getChangesForDate: (date: string) => ScheduleChange[];
}

const ScheduleContext = createContext<ScheduleContextValue | null>(null);

export function ScheduleProvider({ children }: { children: React.ReactNode }) {
  const v = useDb();
  const assignments = useMemo(() => db.assignments, [v]);
  const changes = useMemo(() => db.scheduleChanges, [v]);
  const series = useMemo(() => db.scheduleSeries, [v]);

  const getByDate = useCallback((date: string) => {
    return assignments.filter(a => a.scheduledDate === date && isActive(a));
  }, [assignments]);

  const getAllByDate = useCallback((date: string) => {
    return assignments.filter(a => a.scheduledDate === date);
  }, [assignments]);

  const getByWorker = useCallback((personId: string, date?: string) => {
    return assignments.filter(a => {
      if (a.personId !== personId) return false;
      if (date && a.scheduledDate !== date) return false;
      return isActive(a);
    });
  }, [assignments]);

  const getByProject = useCallback((projectId: string, date?: string) => {
    return assignments.filter(a => {
      if (a.projectId !== projectId) return false;
      if (date && a.scheduledDate !== date) return false;
      return isActive(a);
    });
  }, [assignments]);

  const getGroupedByWorker = useCallback((date: string) => {
    const active = assignments.filter(a => a.scheduledDate === date && isActive(a));
    const grouped: Record<string, { person: Assignment['person']; truck?: Assignment['truck']; assignments: Assignment[] }> = {};

    for (const a of active) {
      if (!a.person) continue;
      if (!grouped[a.personId]) {
        grouped[a.personId] = { person: a.person, assignments: [] };
      }
      grouped[a.personId].assignments.push(a);
      if (a.truck) grouped[a.personId].truck = a.truck;
    }

    for (const key of Object.keys(grouped)) {
      grouped[key].assignments.sort((a, b) => {
        if (a.isFullDay) return -1;
        if (b.isFullDay) return 1;
        return (a.startTime ?? '').localeCompare(b.startTime ?? '');
      });
    }
    return grouped;
  }, [assignments]);

  const detectConflicts = useCallback((params: {
    personId: string; scheduledDate: string; startTime?: string; endTime?: string;
    isFullDay: boolean; truckId?: string; excludeId?: string;
  }): ScheduleConflict[] => {
    const conflicts: ScheduleConflict[] = [];
    const active = assignments.filter(a =>
      a.scheduledDate === params.scheduledDate && isActive(a) && a.id !== params.excludeId
    );

    const workerAssignments = active.filter(a => a.personId === params.personId);
    for (const existing of workerAssignments) {
      if (params.isFullDay || existing.isFullDay ||
          timesOverlap(params.startTime, params.endTime, existing.startTime, existing.endTime)) {
        const timeStr = existing.isFullDay ? 'Full Day' : `${existing.startTime}–${existing.endTime}`;
        conflicts.push({
          type: 'time_overlap',
          assignment: existing,
          message: `${existing.person?.firstName} is already scheduled at ${existing.project?.name} (${timeStr})`,
        });
      }
    }

    if (params.truckId) {
      const truckAssignments = active.filter(a => a.truckId === params.truckId && a.personId !== params.personId);
      for (const existing of truckAssignments) {
        if (params.isFullDay || existing.isFullDay ||
            timesOverlap(params.startTime, params.endTime, existing.startTime, existing.endTime)) {
          const timeStr = existing.isFullDay ? 'Full Day' : `${existing.startTime}–${existing.endTime}`;
          conflicts.push({
            type: 'truck_overlap',
            assignment: existing,
            message: `${existing.truck?.name} is assigned to ${existing.person?.firstName} ${existing.person?.lastName} (${timeStr})`,
          });
        }
      }
    }

    return conflicts;
  }, [assignments]);

  const detectTravelWarnings = useCallback((personId: string, date: string): TravelWarning[] => {
    const dayAssignments = assignments
      .filter(a => a.personId === personId && a.scheduledDate === date && !a.isFullDay && isActive(a))
      .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));

    const warnings: TravelWarning[] = [];
    for (let i = 0; i < dayAssignments.length - 1; i++) {
      const current = dayAssignments[i];
      const next = dayAssignments[i + 1];
      if (current.endTime && next.startTime) {
        const gap = timeToMinutes(next.startTime) - timeToMinutes(current.endTime);
        if (gap >= 0 && gap < 30) {
          warnings.push({ fromAssignment: current, toAssignment: next, availableMinutes: gap });
        }
      }
    }
    return warnings;
  }, [assignments]);

  const addChange = useCallback((change: Omit<ScheduleChange, 'id' | 'createdAt' | 'companyId' | 'changedBy'>) => {
    return insertRow('schedule_changes', { ...change, changedBy: db.personId }) as unknown as ScheduleChange;
  }, []);

  const createAssignment = useCallback((params: {
    personId: string; projectId: string; scheduledDate: string;
    startTime?: string; endTime?: string; isFullDay: boolean;
    truckId?: string; notes?: string; seriesId?: string;
  }): Assignment => {
    const person = db.people[params.personId];
    const project = db.projects.find(pr => pr.id === params.projectId);
    const truck = params.truckId ? db.trucks.find(t => t.id === params.truckId) : undefined;

    const dayCount = assignments.filter(a =>
      a.personId === params.personId && a.scheduledDate === params.scheduledDate && isActive(a)
    ).length;

    const newAssignment: Assignment = {
      id: uuid(),
      companyId: db.companyId,
      projectId: params.projectId,
      personId: params.personId,
      scheduledDate: params.scheduledDate,
      startTime: params.isFullDay ? undefined : params.startTime,
      endTime: params.isFullDay ? undefined : params.endTime,
      isFullDay: params.isFullDay,
      sortOrder: dayCount + 1,
      status: 'scheduled',
      // Shows on the worker's Today screen for them to confirm.
      confirmationState: 'awaiting',
      truckId: params.truckId,
      notes: params.notes,
      // Only sent when set, so plain scheduling works before update 012 is run.
      ...(params.seriesId ? { seriesId: params.seriesId } : {}),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      person: person ? { ...person } : undefined,
      project: project ? { id: project.id, name: project.name, address: project.address } : undefined,
      truck: truck ? { id: truck.id, name: truck.name } : undefined,
    };

    const { person: _p, project: _pr, truck: _t, ...row } = newAssignment;
    insertRow('assignments', row);

    const timeStr = params.isFullDay ? 'Full Day' : `${params.startTime}–${params.endTime}`;
    addChange({
      assignmentId: newAssignment.id,
      changeType: 'created',
      newValue: JSON.stringify({ project: project?.name, time: timeStr, worker: person ? `${person.firstName} ${person.lastName}` : '' }),
    });

    return newAssignment;
  }, [assignments, addChange]);

  const cancelAssignment = useCallback((assignmentId: string, reason?: string) => {
    const original = assignments.find(a => a.id === assignmentId);
    if (!original) return;

    updateRow('assignments', assignmentId, {
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      cancelledBy: db.personId || undefined,
      cancellationReason: reason,
    });

    addChange({
      assignmentId,
      changeType: 'cancelled',
      previousValue: JSON.stringify({
        project: original.project?.name,
        time: original.isFullDay ? 'Full Day' : `${original.startTime}–${original.endTime}`,
      }),
      notes: reason,
    });
  }, [assignments, addChange]);

  const moveWorker = useCallback((assignmentId: string, newProjectId: string, notes?: string): Assignment | undefined => {
    const original = assignments.find(a => a.id === assignmentId);
    if (!original) return undefined;

    const project = db.projects.find(pr => pr.id === newProjectId);
    const now = new Date().toISOString();
    const newId = uuid();

    // A moved day no longer belongs to its repeat.
    const { seriesId: _series, ...rest } = original;
    const newAssignment: Assignment = {
      ...rest,
      id: newId,
      projectId: newProjectId,
      status: 'scheduled',
      confirmationState: original.confirmationState === 'confirmed' ? 'updated_since' as const : original.confirmationState,
      reassignedFrom: assignmentId,
      project: project ? { id: project.id, name: project.name, address: project.address } : undefined,
      notes: notes || original.notes,
      createdAt: now,
      updatedAt: now,
    };

    // Insert the new one first so the old one's reassigned_to can point at it.
    const { person: _p, project: _pr, truck: _t, ...row } = newAssignment;
    insertRow('assignments', { ...row, reassignedTo: undefined, cancelledAt: undefined, cancelledBy: undefined, cancellationReason: undefined });
    updateRow('assignments', assignmentId, { status: 'reassigned', reassignedTo: newId });

    addChange({
      assignmentId,
      changeType: 'reassigned',
      previousValue: JSON.stringify({ project: original.project?.name }),
      newValue: JSON.stringify({ project: project?.name }),
      notes: notes || `Moved to ${project?.name}`,
    });

    addChange({
      assignmentId: newId,
      changeType: 'emergency_override',
      newValue: JSON.stringify({ project: project?.name, movedFrom: original.project?.name }),
      notes,
    });

    return newAssignment;
  }, [assignments, addChange]);

  const updateAssignment = useCallback((assignmentId: string, updates: Partial<Pick<Assignment, 'startTime' | 'endTime' | 'isFullDay' | 'truckId' | 'notes'>>, changeNotes?: string) => {
    const original = assignments.find(a => a.id === assignmentId);
    if (!original) return;

    const wasConfirmed = original.confirmationState === 'confirmed';

    updateRow('assignments', assignmentId, {
      ...updates,
      ...(wasConfirmed ? { confirmationState: 'updated_since' } : {}),
    });

    let changeType: ScheduleChangeType = 'time_changed';
    if (updates.truckId !== undefined) changeType = 'truck_changed';
    else if (updates.notes !== undefined && updates.startTime === undefined) changeType = 'notes_changed';

    addChange({
      assignmentId,
      changeType,
      previousValue: JSON.stringify({
        startTime: original.startTime, endTime: original.endTime,
        isFullDay: original.isFullDay, truck: original.truck?.name,
      }),
      newValue: JSON.stringify({
        startTime: updates.startTime ?? original.startTime,
        endTime: updates.endTime ?? original.endTime,
        isFullDay: updates.isFullDay ?? original.isFullDay,
        truck: updates.truckId ? db.trucks.find(t => t.id === updates.truckId)?.name : original.truck?.name,
      }),
      notes: changeNotes,
    });
  }, [assignments, addChange]);

  /** Demo mode: fill in a repeat's days locally, the same way
   * extend_schedule_series() does in the database. */
  const extendLocally = useCallback((s: ScheduleSeries, today: string) => {
    if (s.stoppedAt) return;
    const to = addDaysKey(today, s.horizonDays ?? SERIES_HORIZON_DAYS);
    for (const d of occurrenceDates(s, today, to)) {
      // Raw rows, so days added earlier in this loop count too.
      const taken = (rowsOf('assignments') as Assignment[]).some(a =>
        (a.seriesId === s.id && a.scheduledDate === d) ||
        (a.personId === s.personId && a.projectId === s.projectId && a.scheduledDate === d && isActive(a))
      );
      if (taken) continue;
      createAssignment({
        personId: s.personId, projectId: s.projectId, scheduledDate: d,
        startTime: s.startTime, endTime: s.endTime, isFullDay: s.isFullDay,
        truckId: s.truckId, notes: s.notes, seriesId: s.id,
      });
    }
  }, [createAssignment]);

  /** Fills in repeats' days up to a few weeks ahead (one repeat, or all). */
  const topUp = useCallback(async (only?: ScheduleSeries) => {
    const today = todayKey();
    if (isDemo()) {
      const list = only ? [only] : (rowsOf('schedule_series') as ScheduleSeries[]);
      for (const s of list) extendLocally(s, today);
      return;
    }
    await flushWrites();
    const { data, error } = await rpc<number>('extend_schedule_series', {
      p_series: only?.id ?? null,
      p_today: today,
    });
    if (error) {
      console.warn('[schedule] filling in repeating schedules failed:', error.message);
      return;
    }
    if (data) await refresh('assignments', 'schedule_changes');
  }, [extendLocally]);

  // Owner/admin app: top up running repeats once a day.
  useEffect(() => {
    if (!db.ready || (db.role !== 'owner' && db.role !== 'admin')) return;
    if (!db.scheduleSeries.some(s => !s.stoppedAt)) return;
    const today = todayKey();
    if (lastTopUpDay === today) return;
    lastTopUpDay = today;
    topUp();
  }, [v, topUp]);

  const createSeries = useCallback((params: {
    personId: string; projectId: string; scheduledDate: string;
    startTime?: string; endTime?: string; isFullDay: boolean;
    truckId?: string; notes?: string;
    frequency: RepeatFrequency; intervalDays?: number; horizonDays?: number; endDate?: string;
  }): ScheduleSeries => {
    const row = insertRow('schedule_series', {
      projectId: params.projectId,
      personId: params.personId,
      frequency: params.frequency,
      intervalDays: params.frequency === 'custom' ? params.intervalDays : undefined,
      horizonDays: params.horizonDays ?? SERIES_HORIZON_DAYS,
      startDate: params.scheduledDate,
      endDate: params.endDate,
      startTime: params.isFullDay ? undefined : params.startTime,
      endTime: params.isFullDay ? undefined : params.endTime,
      isFullDay: params.isFullDay,
      truckId: params.truckId,
      notes: params.notes,
      createdBy: db.personId || undefined,
    }) as unknown as ScheduleSeries;

    // The chosen day shows up right away; the database fills in the rest.
    createAssignment({
      personId: params.personId, projectId: params.projectId, scheduledDate: params.scheduledDate,
      startTime: params.startTime, endTime: params.endTime, isFullDay: params.isFullDay,
      truckId: params.truckId, notes: params.notes, seriesId: row.id,
    });
    topUp(row);
    return row;
  }, [createAssignment, topUp]);

  const endSeriesAfter = useCallback((seriesId: string, afterDate: string) => {
    const s = db.scheduleSeries.find(x => x.id === seriesId);
    if (!s) return;
    updateRow('schedule_series', seriesId, {
      stoppedAt: new Date().toISOString(),
      endDate: afterDate < s.startDate ? s.startDate : afterDate,
    });
    const later = assignments.filter(a =>
      a.seriesId === seriesId && a.scheduledDate > afterDate &&
      (a.status === 'scheduled' || a.status === 'confirmed')
    );
    for (const a of later) cancelAssignment(a.id, 'Repeat ended');
  }, [assignments, cancelAssignment]);

  const getChangesForAssignment = useCallback((assignmentId: string) => {
    return changes.filter(c => c.assignmentId === assignmentId);
  }, [changes]);

  const getChangesForDate = useCallback((date: string) => {
    const dayAssignmentIds = new Set(
      assignments.filter(a => a.scheduledDate === date).map(a => a.id)
    );
    return changes.filter(c => dayAssignmentIds.has(c.assignmentId));
  }, [assignments, changes]);

  const weekSummary = useCallback((startDate: string) => {
    const start = new Date(startDate + 'T00:00:00');
    const days: { date: string; label: string; workerCount: number; projectCount: number; hasIssues: boolean }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const dateStr = localDateKey(d);
      const dayAssignments = assignments.filter(a => a.scheduledDate === dateStr && isActive(a));
      const workers = new Set(dayAssignments.map(a => a.personId));
      const projects = new Set(dayAssignments.map(a => a.projectId));
      const hasUnconfirmed = dayAssignments.some(a => a.confirmationState === 'awaiting');
      days.push({
        date: dateStr,
        label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        workerCount: workers.size,
        projectCount: projects.size,
        hasIssues: hasUnconfirmed,
      });
    }
    return days;
  }, [assignments]);

  const todayAssignments = useMemo(() => getByDate(todayKey()), [getByDate]);

  const stats = useMemo(() => {
    const active = todayAssignments;
    const confirmed = active.filter(a => a.confirmationState === 'confirmed').length;
    const awaiting = active.filter(a => a.confirmationState === 'awaiting').length;
    return { total: active.length, confirmed, awaiting };
  }, [todayAssignments]);

  const value: ScheduleContextValue = useMemo(() => ({
    assignments, series, changes, stats,
    getByDate, getAllByDate, getByWorker, getByProject,
    getGroupedByWorker, weekSummary,
    detectConflicts, detectTravelWarnings,
    createAssignment, createSeries, endSeriesAfter, cancelAssignment, moveWorker, updateAssignment,
    getChangesForAssignment, getChangesForDate,
  }), [
    assignments, series, changes, stats,
    getByDate, getAllByDate, getByWorker, getByProject,
    getGroupedByWorker, weekSummary,
    detectConflicts, detectTravelWarnings,
    createAssignment, createSeries, endSeriesAfter, cancelAssignment, moveWorker, updateAssignment,
    getChangesForAssignment, getChangesForDate,
  ]);

  return (
    <ScheduleContext.Provider value={value}>
      {children}
    </ScheduleContext.Provider>
  );
}

export function useScheduleContext(): ScheduleContextValue {
  const ctx = useContext(ScheduleContext);
  if (!ctx) throw new Error('useScheduleContext must be used within ScheduleProvider');
  return ctx;
}
