import { useMemo } from 'react';
import type { Project, ProjectStatus } from '@/types/project';
import { db, useDb } from '@/data/store';

interface UseProjectsOptions {
  search?: string;
  statusFilter?: ProjectStatus | 'all';
}

export function useProjects(options: UseProjectsOptions = {}) {
  const { search = '', statusFilter = 'all' } = options;
  const v = useDb();
  const projects = useMemo(() => db.projects, [v]);

  const filtered = useMemo(() => {
    let result = projects;

    if (statusFilter !== 'all') {
      result = result.filter((p) => p.status === statusFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.address?.toLowerCase().includes(q) ||
          p.customer?.firstName.toLowerCase().includes(q) ||
          p.customer?.lastName.toLowerCase().includes(q) ||
          p.city?.toLowerCase().includes(q),
      );
    }

    return result;
  }, [projects, search, statusFilter]);

  const grouped = useMemo(() => {
    const groups: Record<ProjectStatus, Project[]> = {
      prospect: [],
      active: [],
      on_hold: [],
      completed: [],
      archived: [],
    };
    for (const p of filtered) {
      groups[p.status].push(p);
    }
    return groups;
  }, [filtered]);

  const counts = useMemo(() => {
    const c: Record<ProjectStatus | 'all', number> = {
      all: projects.length,
      prospect: 0,
      active: 0,
      on_hold: 0,
      completed: 0,
      archived: 0,
    };
    for (const p of projects) {
      c[p.status]++;
    }
    return c;
  }, [projects]);

  return { projects: filtered, grouped, counts };
}
