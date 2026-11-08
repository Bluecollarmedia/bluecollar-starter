/**
 * What the owner's Maintenance home shows: today's route(s), what's due or
 * overdue, and a count for the Properties entry point.
 *
 * A thin view over the shared Maintenance hooks (useMaintenance.ts), so the
 * home screen doesn't depend on table shapes.
 */
import { useCallback, useMemo } from 'react';
import { db, loadErrorOf, refresh as refreshTables, useDb } from '@/data/store';
import { useMaintenance, useMaintenanceDue } from '@/hooks/useMaintenance';
import { daysBetween, dueLabel } from '@/lib/maintenanceSchedule';

function shortDate(key: string): string {
  return new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
import { todayKey } from '@/lib/ids';

/** Upcoming services this many days out still show under "Needs service". */
const UPCOMING_DAYS = 7;

export type HomeDueStatus = 'overdue' | 'due' | 'upcoming';

export interface MaintenanceDueItem {
  /** property id + rule id, unique per row */
  key: string;
  propertyId: string;
  propertyName: string;
  serviceName: string;
  status: HomeDueStatus;
  /** "Overdue by 5 days", "Due today", "Due in 3 days" */
  label: string;
  lastServiceDate: string | null;
  /** For seasonal quantities like 26 cuts. */
  seasonalCompleted?: number;
  seasonalTotal?: number;
}

export interface MaintenanceRouteSummary {
  id: string;
  name?: string;
  stopCount: number;
  completedCount: number;
  crewNames: string[];
  /** Crew who tapped the older "Start Day" at the yard (day attendance). Used only when time tracking is not available. */
  checkedInCount: number;
  /** Everyone on the route (crew and leader), so screens can count who is clocked in from the time clock. */
  crewIds: string[];
  /** The property the crew is checked in at right now, if any (a stop in progress). */
  activeStop?: { propertyName: string; arrivedAt?: string };
}

export interface MaintenanceHome {
  ready: boolean;
  loadError: string | null;
  activePropertyCount: number;
  dueItems: MaintenanceDueItem[];
  todayRoutes: MaintenanceRouteSummary[];
  refresh: () => Promise<void>;
}

export function useMaintenanceHome(): MaintenanceHome {
  useDb(); // re-render on store changes so ready / loadError stay current
  const m = useMaintenance();
  const today = todayKey();
  const due = useMaintenanceDue(today);

  const dueItems = useMemo(() => {
    const items: MaintenanceDueItem[] = [];
    for (const info of due) {
      for (const s of info.services) {
        let status: HomeDueStatus;
        let label: string;
        if (s.status === 'overdue' || s.status === 'due') {
          status = s.status;
          // A seasonal window is 'due' until its end date: say until when.
          label = s.status === 'due' && s.dueDate && s.dueDate > today
            ? `Due by ${shortDate(s.dueDate)}`
            : dueLabel(s, today);
        } else if (s.status === 'upcoming' && s.dueDate && daysBetween(today, s.dueDate) <= UPCOMING_DAYS) {
          const n = daysBetween(today, s.dueDate);
          status = 'upcoming';
          label = `Due in ${n} day${n === 1 ? '' : 's'}`;
        } else {
          continue;
        }
        items.push({
          key: `${info.property.id}:${s.rule.id}`,
          propertyId: info.property.id,
          propertyName: info.property.name,
          serviceName: s.rule.label,
          status,
          label,
          lastServiceDate: s.lastServiceDate ?? null,
          seasonalCompleted: s.rule.seasonQuantity != null ? s.completedCount : undefined,
          seasonalTotal: s.rule.seasonQuantity ?? undefined,
        });
      }
    }
    // `due` is already most urgent first per property; keep overdue, then due, then upcoming across properties.
    const rank: Record<HomeDueStatus, number> = { overdue: 0, due: 1, upcoming: 2 };
    return items
      .map((item, i) => ({ item, i }))
      .sort((a, b) => rank[a.item.status] - rank[b.item.status] || a.i - b.i)
      .map(({ item }) => item);
  }, [due, today]);

  const todayRoutes = useMemo<MaintenanceRouteSummary[]>(() => m.routes
    .filter((r) => r.serviceDate === today && r.status !== 'cancelled')
    .map((r) => ({
      id: r.id,
      name: r.name,
      stopCount: r.stops.length,
      completedCount: r.completedCount,
      crewNames: r.crew.map((p) => p.firstName),
      checkedInCount: r.crewIds.filter((pid) => m.attendance.some((a) => a.personId === pid && a.serviceDate === today)).length,
      crewIds: [...new Set([...r.crewIds, ...(r.lead?.id ? [r.lead.id] : [])])],
      activeStop: (() => { const s = r.stops.find((x) => x.status === 'arrived'); return s ? { propertyName: s.property?.name ?? 'a property', arrivedAt: s.arrivedAt ?? undefined } : undefined; })(),
    })), [m, today]);

  const refresh = useCallback(() => refreshTables(
    'maintenance_properties', 'maintenance_contracts', 'maintenance_service_rules',
    'maintenance_routes', 'maintenance_route_crew', 'maintenance_stops',
    'maintenance_stop_services', 'maintenance_day_attendance',
  ), []);

  return {
    ready: db.ready,
    loadError: loadErrorOf('maintenance_properties') ?? loadErrorOf('maintenance_routes') ?? null,
    activePropertyCount: m.properties.filter((p) => p.isActive).length,
    dueItems,
    todayRoutes,
    refresh,
  };
}
