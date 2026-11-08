import { useMemo, useCallback } from 'react';
import type { CompanyMember, PersonSummary } from '@/types/company';
import type { Assignment } from '@/types/schedule';
import { db, useDb, updateRow, refresh } from '@/data/store';
import { dropLocalResourceAccess } from '@/hooks/useResources';
import { todayKey } from '@/lib/ids';

export type WorkerTodayStatus = 'confirmed' | 'scheduled' | 'not_scheduled' | 'inactive';

export interface WorkerWithStatus {
  member: CompanyMember;
  person: PersonSummary;
  todayStatus: WorkerTodayStatus;
  todayAssignments: Assignment[];
  todayProject?: string;
  todayTruck?: string;
  activeProjectCount: number;
}

interface UseWorkersOptions {
  search?: string;
  statusFilter?: WorkerTodayStatus | 'all';
  includeInactive?: boolean;
}

export function useWorkers(options: UseWorkersOptions = {}) {
  const { search = '', statusFilter = 'all', includeInactive = false } = options;
  const v = useDb();

  const refreshMembers = useCallback(() => {
    refresh('company_members', 'people');
  }, []);

  const workers = useMemo<WorkerWithStatus[]>(() => {
    const today = todayKey();
    const workerMembers = db.members.filter(
      (m) => m.role === 'worker' && !!m.person && (includeInactive || m.status !== 'inactive'),
    );

    return workerMembers.map((m) => {
      const person = m.person!;
      const todayAssignments = db.assignments.filter(
        (a) => a.personId === m.personId && a.scheduledDate === today &&
               a.status !== 'cancelled' && a.status !== 'reassigned'
      );
      const truck = db.trucks.find((t) => t.assignedTo === m.personId);

      const activeProjects = db.projects.filter(
        (p) => p.status === 'active' && (db.team[p.id] ?? []).some((tm) => tm.personId === m.personId),
      ).length;

      let todayStatus: WorkerTodayStatus;
      if (m.status === 'inactive') {
        todayStatus = 'inactive';
      } else if (todayAssignments.some(a => a.confirmationState === 'confirmed')) {
        todayStatus = 'confirmed';
      } else if (todayAssignments.length > 0) {
        todayStatus = 'scheduled';
      } else {
        todayStatus = 'not_scheduled';
      }

      return {
        member: m,
        person,
        todayStatus,
        todayAssignments,
        todayProject: todayAssignments[0]?.project?.name,
        todayTruck: truck?.name,
        activeProjectCount: activeProjects,
      };
    });
  }, [v, includeInactive]);

  const filtered = useMemo(() => {
    let result = workers;

    if (statusFilter !== 'all') {
      result = result.filter((w) => w.todayStatus === statusFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (w) =>
          w.person.firstName.toLowerCase().includes(q) ||
          w.person.lastName.toLowerCase().includes(q) ||
          w.person.email.toLowerCase().includes(q) ||
          w.person.phone?.includes(q),
      );
    }

    return result;
  }, [workers, search, statusFilter]);

  const counts = useMemo(() => {
    const c = { all: workers.length, confirmed: 0, scheduled: 0, not_scheduled: 0, inactive: 0 };
    for (const w of workers) {
      c[w.todayStatus]++;
    }
    return c;
  }, [workers]);

  /** Changes a worker's membership (e.g. deactivate). */
  const updateWorker = useCallback((personId: string, updates: Partial<CompanyMember>) => {
    const m = db.members.find((x) => x.personId === personId);
    if (!m) return;
    const { person, ...changes } = updates;
    if (changes.status === 'inactive' && m.status !== 'inactive') {
      Object.assign(changes, { deactivatedAt: new Date().toISOString(), deactivatedBy: db.personId || undefined });
    }
    updateRow('company_members', m.id, changes);
    // The database revokes their resource access on deactivation; mirror it
    // locally right away (and in demo mode, where there's no database).
    if (changes.status && changes.status !== 'active') dropLocalResourceAccess(personId);
  }, []);

  const getWorker = useCallback(
    (personId: string) => workers.find((w) => w.person.id === personId),
    [workers],
  );

  return { workers: filtered, allWorkers: workers, counts, updateWorker, getWorker, refreshMembers };
}
