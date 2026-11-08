/**
 * Shapes the raw maintenance rows (supabase/updates/018) into what screens
 * read. Called from the store's derive(); only imports types so the store
 * doesn't import itself.
 */
import type { PersonSummary } from '@/types/company';
import { cleanDates } from '@/lib/serviceDates';
import type {
  MaintenanceContract, MaintenanceDayAttendance, MaintenanceEvent, MaintenancePhoto,
  MaintenanceProperty, MaintenanceRoute, MaintenanceRouteCrewMember, MaintenanceRouteDetail,
  MaintenanceServiceRule, MaintenanceStop, MaintenanceStopDetail, MaintenanceStopService,
  MaintenanceStopTask,
} from '@/types/maintenance';

type Row = Record<string, any>;

export interface MaintenanceRaw {
  maintenance_properties: Row[];
  maintenance_contracts: Row[];
  maintenance_service_rules: Row[];
  maintenance_routes: Row[];
  maintenance_route_crew: Row[];
  maintenance_stops: Row[];
  maintenance_stop_services: Row[];
  maintenance_stop_tasks: Row[];
  maintenance_photos: Row[];
  maintenance_day_attendance: Row[];
  maintenance_events: Row[];
}

export interface MaintenanceDb {
  /** By name. */
  properties: MaintenanceProperty[];
  propertyById: Record<string, MaintenanceProperty>;
  contracts: MaintenanceContract[];
  /** Per property, newest first. */
  contractsByProperty: Record<string, MaintenanceContract[]>;
  /** Per contract, in sortOrder. */
  rulesByContract: Record<string, MaintenanceServiceRule[]>;
  ruleById: Record<string, MaintenanceServiceRule>;
  /** Newest service date first. */
  routes: MaintenanceRouteDetail[];
  routeById: Record<string, MaintenanceRouteDetail>;
  stopById: Record<string, MaintenanceStopDetail>;
  /** Every visit to a property (any status), newest first. */
  stopsByProperty: Record<string, MaintenanceStopDetail[]>;
  /** Completed services per rule (the service history used for due dates). */
  historyByRule: Record<string, MaintenanceStopService[]>;
  /** Completed services per property, newest first. */
  historyByProperty: Record<string, MaintenanceStopService[]>;
  /** Rule id → service date of an unfinished route that already includes it. */
  scheduledByRule: Record<string, string>;
  attendance: MaintenanceDayAttendance[];
  /** Newest first. */
  events: MaintenanceEvent[];
}

export function emptyMaintenanceDb(): MaintenanceDb {
  return {
    properties: [], propertyById: {}, contracts: [], contractsByProperty: {}, rulesByContract: {}, ruleById: {},
    routes: [], routeById: {}, stopById: {}, stopsByProperty: {}, historyByRule: {}, historyByProperty: {},
    scheduledByRule: {}, attendance: [], events: [],
  };
}

function group<T extends Row>(rows: T[], key: string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows) {
    const k = r[key];
    if (k) (out[k] ??= []).push(r);
  }
  return out;
}

const num = (v: unknown) => (v == null ? undefined : Number(v));

export function deriveMaintenance(raw: MaintenanceRaw, people: Record<string, PersonSummary>): MaintenanceDb {
  const out = emptyMaintenanceDb();

  out.properties = raw.maintenance_properties
    .map((p) => ({
      ...p,
      latitude: num(p.latitude),
      longitude: num(p.longitude),
      checkinRadiusM: Number(p.checkinRadiusM ?? 150),
      isActive: p.isActive !== false,
      customer: p.customerId ? people[p.customerId] : undefined,
    }) as MaintenanceProperty)
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const p of out.properties) out.propertyById[p.id] = p;

  out.contracts = raw.maintenance_contracts.map((c) => ({ ...c, status: c.status ?? 'active' }) as MaintenanceContract);
  out.contractsByProperty = group(out.contracts, 'propertyId');
  for (const k of Object.keys(out.contractsByProperty)) {
    out.contractsByProperty[k].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  const rules = raw.maintenance_service_rules.map((r) => ({
    ...r,
    intervalDays: num(r.intervalDays),
    scheduledDates: Array.isArray(r.scheduledDates) ? cleanDates(r.scheduledDates) : undefined,
    seasonQuantity: num(r.seasonQuantity),
    priorCompletedCount: Number(r.priorCompletedCount ?? 0),
    requiresPhotos: !!r.requiresPhotos,
    minPhotos: Math.max(1, Number(r.minPhotos ?? 1) || 1),
    defaultChecklist: Array.isArray(r.defaultChecklist) ? r.defaultChecklist.map(String) : [],
    isActive: r.isActive !== false,
    sortOrder: Number(r.sortOrder ?? 0),
  }) as MaintenanceServiceRule);
  out.rulesByContract = group(rules, 'contractId');
  for (const k of Object.keys(out.rulesByContract)) {
    out.rulesByContract[k].sort((a, b) => a.sortOrder - b.sortOrder || String(a.createdAt).localeCompare(String(b.createdAt)));
  }
  for (const r of rules) out.ruleById[r.id] = r;

  const services = raw.maintenance_stop_services.map((s) => ({ ...s, completed: !!s.completed }) as MaintenanceStopService);
  const servicesByStop = group(services, 'stopId');
  const tasksByStop = group(
    raw.maintenance_stop_tasks
      .map((t) => ({ ...t, isRequired: t.isRequired !== false, sortOrder: Number(t.sortOrder ?? 0) }) as MaintenanceStopTask)
      .sort((a, b) => a.sortOrder - b.sortOrder || String(a.createdAt).localeCompare(String(b.createdAt))),
    'stopId',
  );
  const photosByStop = group(
    raw.maintenance_photos
      .map((p) => ({ ...p, isCustomerVisible: !!p.isCustomerVisible, sizeBytes: num(p.sizeBytes) }) as MaintenancePhoto)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
    'stopId',
  );

  const stopsByRoute = group(
    raw.maintenance_stops.map((s) => ({
      ...s,
      sortOrder: Number(s.sortOrder ?? 0),
      requiresPhotos: !!s.requiresPhotos,
      minPhotos: Number(s.minPhotos ?? 1),
    }) as MaintenanceStop),
    'routeId',
  );
  const crewByRoute = group(raw.maintenance_route_crew as MaintenanceRouteCrewMember[], 'routeId');

  out.routes = (raw.maintenance_routes as MaintenanceRoute[])
    .map((r): MaintenanceRouteDetail => {
      const stops = (stopsByRoute[r.id] ?? [])
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder || String(a.createdAt).localeCompare(String(b.createdAt)))
        .map((s, i): MaintenanceStopDetail => ({
          ...s,
          number: i + 1,
          property: out.propertyById[s.propertyId],
          services: servicesByStop[s.id] ?? [],
          tasks: tasksByStop[s.id] ?? [],
          photos: photosByStop[s.id] ?? [],
        }));
      const crewIds = (crewByRoute[r.id] ?? [])
        .slice()
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
        .map((c) => c.personId);
      const open = stops.filter((s) => s.status === 'pending' || s.status === 'arrived');
      return {
        ...r,
        status: r.status ?? 'planned',
        stops,
        crewIds,
        crew: crewIds.map((id) => people[id]).filter(Boolean),
        lead: r.leadPersonId ? people[r.leadPersonId] : undefined,
        completedCount: stops.filter((s) => s.status === 'completed').length,
        remainingCount: open.length,
        nextStop: open[0],
      };
    })
    .sort((a, b) => b.serviceDate.localeCompare(a.serviceDate) || String(b.createdAt).localeCompare(String(a.createdAt)));

  for (const r of out.routes) {
    out.routeById[r.id] = r;
    for (const s of r.stops) {
      out.stopById[s.id] = s;
      (out.stopsByProperty[s.propertyId] ??= []).push(s);
      if (r.status !== 'cancelled' && (s.status === 'pending' || s.status === 'arrived')) {
        for (const svc of s.services) {
          if (svc.ruleId && !svc.completed) {
            const cur = out.scheduledByRule[svc.ruleId];
            if (!cur || r.serviceDate < cur) out.scheduledByRule[svc.ruleId] = r.serviceDate;
          }
        }
      }
    }
  }

  const done = services
    .filter((s) => s.completed && s.completedAt)
    .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
  out.historyByRule = group(done.filter((s) => s.ruleId), 'ruleId');
  out.historyByProperty = group(done, 'propertyId');

  out.attendance = raw.maintenance_day_attendance.map((a) => ({
    ...a,
    latitude: num(a.latitude),
    longitude: num(a.longitude),
    accuracyM: num(a.accuracyM),
    distanceM: num(a.distanceM),
  }) as MaintenanceDayAttendance);

  out.events = raw.maintenance_events
    .map((e) => ({
      ...e,
      latitude: num(e.latitude),
      longitude: num(e.longitude),
      accuracyM: num(e.accuracyM),
      distanceM: num(e.distanceM),
      metadata: e.metadata ?? {},
      actor: e.personId ? people[e.personId] : undefined,
    }) as MaintenanceEvent)
    .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));

  return out;
}
