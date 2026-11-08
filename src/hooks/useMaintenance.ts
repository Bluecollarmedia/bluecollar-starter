import { useMemo } from 'react';
import { db, useDb } from '@/data/store';
import { eligibleMaintenanceCrew, maintenanceCrew, maintenanceWorkers } from '@/data/maintenance';
import { compareUrgency, propertyDue } from '@/lib/maintenanceSchedule';
import { todayKey } from '@/lib/ids';
import { worksOnMaintenance } from '@/lib/workerAreas';
import type {
  MaintenanceContract, MaintenanceDayAttendance, MaintenanceEvent, MaintenanceRouteDetail,
  MaintenanceServiceRule, MaintenanceStopDetail, MaintenanceStopService, PropertyDueInfo,
} from '@/types/maintenance';

/** Everything maintenance, shaped (see src/data/maintenanceDerive.ts). Writes live in src/data/maintenance.ts. */
export function useMaintenance() {
  const v = useDb();
  return useMemo(() => db.maintenance, [v]);
}

/** A property's active contract (newest active one), if any. */
export function activeContractOf(propertyId: string): MaintenanceContract | undefined {
  return (db.maintenance.contractsByProperty[propertyId] ?? []).find((c) => c.status === 'active');
}

/**
 * Due / overdue for every active property on `onDate` (default today), most
 * urgent first. Each service is judged on its own rule and history.
 */
export function useMaintenanceDue(onDate: string = todayKey(), lookAheadDays = 0): PropertyDueInfo[] {
  const v = useDb();
  return useMemo(() => {
    const m = db.maintenance;
    return m.properties
      .filter((p) => p.isActive)
      .map((p) => {
        const contract = activeContractOf(p.id);
        const rules = contract ? m.rulesByContract[contract.id] ?? [] : [];
        return propertyDue(p, contract, rules, m.historyByRule, { onDate, lookAheadDays }, m.scheduledByRule);
      })
      .sort((a, b) => compareUrgency(a, b) || a.property.name.localeCompare(b.property.name));
  }, [v, onDate, lookAheadDays]);
}

export interface PropertyDetail {
  property: PropertyDueInfo['property'];
  contracts: MaintenanceContract[];
  activeContract?: MaintenanceContract;
  /** Rules of the active contract. */
  rules: MaintenanceServiceRule[];
  due: PropertyDueInfo;
  /** Every visit, newest first. */
  visits: MaintenanceStopDetail[];
  /** Completed services, newest first. */
  history: MaintenanceStopService[];
}

export function useMaintenanceProperty(propertyId: string | undefined, onDate: string = todayKey()): PropertyDetail | undefined {
  const v = useDb();
  return useMemo(() => {
    const m = db.maintenance;
    const property = propertyId ? m.propertyById[propertyId] : undefined;
    if (!property) return undefined;
    const contracts = m.contractsByProperty[property.id] ?? [];
    const activeContract = contracts.find((c) => c.status === 'active');
    const rules = activeContract ? m.rulesByContract[activeContract.id] ?? [] : [];
    const visits = (m.stopsByProperty[property.id] ?? [])
      .slice()
      .sort((a, b) => (m.routeById[b.routeId]?.serviceDate ?? '').localeCompare(m.routeById[a.routeId]?.serviceDate ?? ''));
    return {
      property,
      contracts,
      activeContract,
      rules,
      due: propertyDue(property, activeContract, rules, m.historyByRule, { onDate }, m.scheduledByRule),
      visits,
      history: m.historyByProperty[property.id] ?? [],
    };
  }, [v, propertyId, onDate]);
}

export function useMaintenanceRoute(routeId: string | undefined): MaintenanceRouteDetail | undefined {
  const v = useDb();
  return useMemo(() => (routeId ? db.maintenance.routeById[routeId] : undefined), [v, routeId]);
}

/**
 * The signed-in worker's route for a day (default today): the one they're
 * on that isn't cancelled. Every crew member gets the same route object, so
 * order, instructions and progress are shared.
 */
export function useMyMaintenanceRoute(serviceDate: string = todayKey()): MaintenanceRouteDetail | undefined {
  const v = useDb();
  return useMemo(() => db.maintenance.routes.find(
    (r) => r.serviceDate === serviceDate && r.status !== 'cancelled' && r.crewIds.includes(db.personId),
  ), [v, serviceDate]);
}

/**
 * EVERY route the worker is on for a day (a worker can be on more than one), oldest first. Use this wherever the answer must cover all of
 * the worker's work. useMyMaintenanceRoute (the first one only) stays for screens that handle a single route.
 */
export function useMyMaintenanceRoutes(serviceDate: string = todayKey()): MaintenanceRouteDetail[] {
  const v = useDb();
  return useMemo(() => db.maintenance.routes
    .filter((r) => r.serviceDate === serviceDate && r.status !== 'cancelled' && r.crewIds.includes(db.personId))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1)), [v, serviceDate]);
}

export interface RouteAttendanceRow {
  personId: string;
  person?: MaintenanceRouteDetail['crew'][number];
  isLead: boolean;
  /** Undefined = hasn't started the day. */
  attendance?: MaintenanceDayAttendance;
}

/** Each crew member's day-start for a route (owner view). */
export function useRouteAttendance(routeId: string | undefined): RouteAttendanceRow[] {
  const v = useDb();
  return useMemo(() => {
    const route = routeId ? db.maintenance.routeById[routeId] : undefined;
    if (!route) return [];
    return route.crewIds.map((personId) => ({
      personId,
      person: db.people[personId],
      isLead: route.leadPersonId === personId,
      attendance: db.maintenance.attendance.find((a) => a.personId === personId && a.serviceDate === route.serviceDate),
    }));
  }, [v, routeId]);
}

/** Events for a route, oldest first (owner review / timeline). */
export function useRouteEvents(routeId: string | undefined): MaintenanceEvent[] {
  const v = useDb();
  return useMemo(() => (routeId
    ? db.maintenance.events.filter((e) => e.routeId === routeId).slice().reverse()
    : []), [v, routeId]);
}

/** The signed-in worker's maintenance activity, newest first. */
export function useMyMaintenanceActivity(limit = 100): MaintenanceEvent[] {
  const v = useDb();
  return useMemo(() => db.maintenance.events.filter((e) => e.personId === db.personId).slice(0, limit), [v, limit]);
}

/** Who can be put on a maintenance route. */
export function useMaintenanceWorkers() {
  const v = useDb();
  return useMemo(() => ({
    /** Active workers classified as maintenance. */
    workers: maintenanceWorkers(),
    /** Who "Assign Maintenance Crew" adds. */
    eligibleCrew: eligibleMaintenanceCrew(),
    maintenanceCrew: maintenanceCrew(),
  }), [v]);
}

/** Is the signed-in person an active maintenance worker? */
export function useIsMaintenanceWorker(): boolean {
  const v = useDb();
  return useMemo(() => db.members.some(
    (m) => m.personId === db.personId && m.role === 'worker' && m.status === 'active' && worksOnMaintenance(m),
  ), [v]);
}
