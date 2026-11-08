/**
 * Maintenance writes. Screens call these instead of touching tables directly.
 *
 *  • Owner/admin setup (properties, contracts, service rules, routes, stops,
 *    crew, lead) are plain row writes: saved locally right away, then to
 *    Supabase in the background (the database only lets owner/admin do them).
 *  • Crew actions (start day, I'm here, checklist, finish stop) and owner
 *    corrections go through database functions in supabase/updates/018 so a
 *    stop is finished once for the whole crew, repeat taps change nothing,
 *    and the location check is done by the database. In demo mode the same
 *    rules run locally.
 *
 * Nothing here marks a service done or counts it until a stop is finished.
 */
import { db, insertRow, insertRows, updateRow, deleteRow, rowsOf, rpc, refresh, isDemo, type TableName } from './store';
import { emitTimeChanged, isTimeTrackingOn, lastMyDay, timeRpc } from './timeTracking';
import { localDateKey, todayKey } from '@/lib/ids';
import { cleanDates } from '@/lib/serviceDates';
import { worksOnLandscaping, worksOnMaintenance } from '@/lib/workerAreas';
import type { GpsResult } from '@/lib/location';
import type { PersonSummary } from '@/types/company';
import type {
  LocationStatus, MaintenanceContract, MaintenanceDayAttendance, MaintenanceEventType, MaintenancePhoto,
  MaintenanceProperty, MaintenanceRoute, MaintenanceServiceRule, MaintenanceStop, MaintenanceStopDetail,
  MaintenanceStopTask, WorkerType,
} from '@/types/maintenance';

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
const fail = (error: string): Result<never> => ({ ok: false, error });

// ── Who can be on a maintenance route ───────────────────────────────────────

/** Active workers the owner classified as maintenance workers. */
export function maintenanceWorkers(): PersonSummary[] {
  return db.members
    .filter((m) => m.role === 'worker' && m.status === 'active' && worksOnMaintenance(m) && m.person)
    .map((m) => m.person!);
}

/**
 * Everyone the owner may put on a route: EVERY active worker, Maintenance workers first. Nobody is hidden for what they usually work on;
 * putting someone on a route turns Maintenance on for them (ensureMaintenanceArea), and the route is what gives them access to it.
 */
export function routeCandidates(): { person: PersonSummary; maintenance: boolean }[] {
  return db.members
    .filter((m) => m.role === 'worker' && m.status === 'active' && m.person)
    .map((m) => ({ person: m.person!, maintenance: worksOnMaintenance(m) }))
    .sort((a, b) => Number(b.maintenance) - Number(a.maintenance) || a.person.firstName.localeCompare(b.person.firstName));
}

/** The company's maintenance crew (crews.is_maintenance), if one is set up. */
export function maintenanceCrew() {
  return db.crews.find((c) => c.isMaintenance);
}

/**
 * Who "Assign Maintenance Crew" puts on a route: the maintenance crew's
 * members who are active maintenance workers. With no maintenance crew set
 * up yet, every active maintenance worker. Landscaping workers never.
 */
export function eligibleMaintenanceCrew(): PersonSummary[] {
  const workers = maintenanceWorkers();
  const crew = maintenanceCrew();
  return crew ? workers.filter((w) => crew.memberIds.includes(w.id)) : workers;
}

/** Owner/admin: mark which crew is the maintenance crew (`null` = none).
 * Fails when the crew has landscaping workers in it (the database refuses
 * that too, supabase/updates/019). `memberIds` overrides the crew's saved
 * members, for when they were changed in the same save. */
export function setMaintenanceCrew(crewId: string | null, memberIds?: string[]): Result {
  if (crewId) {
    const crew = db.crews.find((c) => c.id === crewId);
    const maint = new Set(maintenanceWorkers().map((p) => p.id));
    const others = (memberIds ?? crew?.memberIds ?? []).filter((pid) => !maint.has(pid));
    if (others.length) {
      const names = others.map((pid) => db.people[pid]?.firstName ?? 'A worker').join(', ');
      return fail(`${names} ${others.length === 1 ? 'is not a maintenance worker' : 'are not maintenance workers'}. Only maintenance workers can be in the Maintenance Crew.`);
    }
  }
  for (const c of db.crews) {
    if (c.isMaintenance && c.id !== crewId) updateRow('crews', c.id, { isMaintenance: false });
  }
  if (crewId && !db.crews.find((c) => c.id === crewId && c.isMaintenance)) updateRow('crews', crewId, { isMaintenance: true });
  return ok(undefined);
}

/** Local mirror of what the database does on approval / reclassification
 * (supabase/updates/019): maintenance workers join the Maintenance Crew if
 * one is set up, and a worker who is no longer maintenance leaves it. */
export function placeInMaintenanceCrew(personId: string, workerType: WorkerType) {
  const crew = maintenanceCrew();
  if (!crew) return;
  const current = (rowsOf('crew_members') as { id: string; crewId: string; personId: string }[]).find((r) => r.personId === personId && r.crewId === crew.id);
  if (workerType === 'maintenance') {
    if (!current) insertRow('crew_members', { crewId: crew.id, personId });
  } else if (current) {
    deleteRow('crew_members', current.id);
  }
}

/** Owner/admin only. Chooses which areas a worker works on (Landscaping, Maintenance). A plain row update can't change them;
 * the set_worker_areas function (supabase/updates/078) does, and writes it to the membership audit log. */
export async function setWorkerAreas(personId: string, areas: { landscaping: boolean; maintenance: boolean }): Promise<Result> {
  const m = db.members.find((x) => x.personId === personId && x.role === 'worker');
  if (!m) return fail('Only workers have areas.');
  if (worksOnLandscaping(m) === areas.landscaping && worksOnMaintenance(m) === areas.maintenance) return ok(undefined);
  if (isDemo()) {
    updateRow('company_members', m.id, {
      worksLandscaping: areas.landscaping, worksMaintenance: areas.maintenance,
      workerType: areas.maintenance && !areas.landscaping ? 'maintenance' : 'landscaping',
    });
    placeInMaintenanceCrew(personId, areas.maintenance ? 'maintenance' : 'landscaping');
    insertRow('membership_audit_log', {
      eventType: 'worker_areas_changed', actorId: db.personId, targetId: personId, metadata: { ...areas },
    });
    return ok(undefined);
  }
  const { error } = await rpc('set_worker_areas', { p_person_id: personId, p_landscaping: areas.landscaping, p_maintenance: areas.maintenance });
  await refresh('company_members', 'crew_members');
  return error ? fail(error.message) : ok(undefined);
}

/** Turns Maintenance on for any of these workers who do not work it yet (keeping their other areas). Used when the owner puts them on a route. */
export async function ensureMaintenanceArea(personIds: string[]): Promise<Result> {
  for (const pid of Array.from(new Set(personIds))) {
    const m = db.members.find((x) => x.personId === pid && x.role === 'worker');
    if (!m || worksOnMaintenance(m)) continue;
    const r = await setWorkerAreas(pid, { landscaping: worksOnLandscaping(m), maintenance: true });
    if (!r.ok) return fail(`Couldn't add ${db.people[pid]?.firstName ?? 'that worker'} to Maintenance: ${r.error}`);
  }
  return ok(undefined);
}

// ── Properties, contracts, rules ────────────────────────────────────────────

export type PropertyInput = Partial<Omit<MaintenanceProperty, 'id' | 'companyId' | 'createdAt' | 'updatedAt' | 'customer'>> & { name: string };

export function createProperty(input: PropertyInput): MaintenanceProperty {
  return insertRow('maintenance_properties', {
    address: '', checkinRadiusM: 150, isActive: true, createdBy: db.personId || undefined, ...input, name: input.name.trim(),
  }) as unknown as MaintenanceProperty;
}

export function updateProperty(id: string, patch: Partial<PropertyInput>) {
  updateRow('maintenance_properties', id, patch.name ? { ...patch, name: patch.name.trim() } : patch);
}

/** Deactivating keeps every past visit. */
export function setPropertyActive(id: string, active: boolean) {
  updateRow('maintenance_properties', id, { isActive: active, deactivatedAt: active ? undefined : new Date().toISOString() });
}

export type ContractInput = Partial<Omit<MaintenanceContract, 'id' | 'companyId' | 'propertyId' | 'createdAt' | 'updatedAt'>>;

export function createContract(propertyId: string, input: ContractInput = {}): MaintenanceContract {
  return insertRow('maintenance_contracts', {
    name: `${todayKey().slice(0, 4)} season`, status: 'active', createdBy: db.personId || undefined, ...input, propertyId,
  }) as unknown as MaintenanceContract;
}

export function updateContract(id: string, patch: ContractInput) {
  updateRow('maintenance_contracts', id, patch);
}

/** Deactivating keeps every past visit; the contract just stops being recommended. */
export function setContractActive(id: string, active: boolean) {
  updateRow('maintenance_contracts', id, { status: active ? 'active' : 'inactive', deactivatedAt: active ? undefined : new Date().toISOString() });
}

export type ServiceRuleInput = Partial<Omit<MaintenanceServiceRule, 'id' | 'companyId' | 'contractId' | 'propertyId' | 'createdAt' | 'updatedAt'>>
  & Pick<MaintenanceServiceRule, 'serviceType' | 'label' | 'frequency'>;

export function addServiceRule(contractId: string, input: ServiceRuleInput): Result<MaintenanceServiceRule> {
  // Raw rows, not db.maintenance: a contract created a moment ago (same save)
  // isn't in the shaped data until the next derive.
  const contract = rowsOf('maintenance_contracts').find((c) => c.id === contractId) as MaintenanceContract | undefined;
  if (!contract) return fail('Contract not found.');
  const problem = ruleProblem(input);
  if (problem) return fail(problem);
  const sortOrder = input.sortOrder ?? (db.maintenance.rulesByContract[contractId]?.length ?? 0);
  return ok(insertRow('maintenance_service_rules', {
    priorCompletedCount: 0, requiresPhotos: false, defaultChecklist: [], isActive: true,
    ...input, sortOrder, contractId, propertyId: contract.propertyId, label: input.label.trim(),
  }) as unknown as MaintenanceServiceRule);
}

export function updateServiceRule(id: string, patch: Partial<ServiceRuleInput>): Result {
  const current = db.maintenance.ruleById[id];
  if (!current) return fail('Service not found.');
  const problem = ruleProblem({ ...current, ...patch });
  if (problem) return fail(problem);
  updateRow('maintenance_service_rules', id, patch);
  return ok(undefined);
}

export function setServiceRuleActive(id: string, active: boolean) {
  updateRow('maintenance_service_rules', id, { isActive: active });
}

/** What the database would reject, in plain words. */
export function ruleProblem(r: Partial<ServiceRuleInput>): string | undefined {
  if (!r.label?.trim()) return 'Give the service a name.';
  if (r.frequency === 'every_n_days' && !(r.intervalDays && r.intervalDays >= 1 && r.intervalDays <= 365)) return 'Pick how many days between visits (1–365).';
  if (r.frequency === 'seasonal_window') {
    if (!r.windowStart || !r.windowEnd) return 'Pick when this service is due (start and end).';
    if (r.windowEnd < r.windowStart) return 'The end date is before the start date.';
  }
  if (r.frequency === 'fixed_dates') {
    const dates = cleanDates(r.scheduledDates);
    if (dates.length === 0) return 'Add at least one visit date, or spread the visits across the season.';
    if (dates.length !== (r.scheduledDates ?? []).length) return 'Some visit dates are repeated or not real dates.';
  }
  if (r.seasonQuantity != null && !(r.seasonQuantity >= 1 && r.seasonQuantity <= 365)) return 'Visits per season must be 1–365.';
  return undefined;
}

// ── Routes (owner/admin) ────────────────────────────────────────────────────

export interface NewStopInput {
  propertyId: string;
  /** Services done at this visit (from the property's active contract). */
  ruleIds: string[];
  /** Stop-specific work for this visit only. */
  instructions?: string;
  /** Extra checklist items for this visit (rule checklists are added too). */
  tasks?: { title: string; isRequired?: boolean }[];
  /** Defaults to true when any chosen service requires photos. */
  requiresPhotos?: boolean;
  minPhotos?: number;
}

export interface NewRouteInput {
  serviceDate: string;
  name?: string;
  notes?: string;
  leadPersonId?: string;
  /** A truck for the whole route (workers then don't have to pick one when they clock in). */
  truckId?: string;
  /** In the owner's order. */
  stops: NewStopInput[];
  /** People to put on the route. Use eligibleMaintenanceCrew() for "Assign Maintenance Crew". */
  crewIds?: string[];
}

function activeContractFor(propertyId: string): MaintenanceContract | undefined {
  return (db.maintenance.contractsByProperty[propertyId] ?? []).find((c) => c.status === 'active');
}

function insertStopChildren(stop: MaintenanceStop, input: NewStopInput) {
  const rules = input.ruleIds.map((id) => db.maintenance.ruleById[id]).filter(Boolean);
  insertRows('maintenance_stop_services', rules.map((r) => ({
    routeId: stop.routeId, stopId: stop.id, propertyId: stop.propertyId, ruleId: r.id,
    serviceType: r.serviceType, label: r.label, completed: false,
  })));
  const titles = [
    ...rules.flatMap((r) => r.defaultChecklist.map((title) => ({ title, isRequired: true }))),
    ...(input.tasks ?? []),
  ].filter((t) => t.title.trim());
  insertRows('maintenance_stop_tasks', titles.map((t, i) => ({
    routeId: stop.routeId, stopId: stop.id, title: t.title.trim(), isRequired: t.isRequired !== false, sortOrder: i,
  })));
}

function insertStop(routeId: string, sortOrder: number, input: NewStopInput): MaintenanceStop {
  const rules = input.ruleIds.map((id) => db.maintenance.ruleById[id]).filter(Boolean);
  const contractId = rules[0]?.contractId ?? activeContractFor(input.propertyId)?.id;
  const stop = insertRow('maintenance_stops', {
    routeId,
    propertyId: input.propertyId,
    contractId,
    sortOrder,
    status: 'pending',
    instructions: input.instructions?.trim() || undefined,
    requiresPhotos: input.requiresPhotos ?? rules.some((r) => r.requiresPhotos),
    minPhotos: input.minPhotos ?? Math.max(1, ...rules.filter((r) => r.requiresPhotos).map((r) => r.minPhotos ?? 1)),
  }) as unknown as MaintenanceStop;
  insertStopChildren(stop, input);
  return stop;
}

/** Creates a new route with its stops (in the given order) and crew. Never marks anything done. */
export function createRoute(input: NewRouteInput): Result<MaintenanceRoute> {
  if (!input.serviceDate) return fail('Pick a service date.');
  const eligible = new Set(maintenanceWorkers().map((p) => p.id));
  const crewIds = Array.from(new Set(input.crewIds ?? []));
  if (crewIds.some((id) => !eligible.has(id))) return fail('Only approved maintenance workers can be on a maintenance route.');
  if (input.leadPersonId && !eligible.has(input.leadPersonId)) return fail('The Maintenance Lead must be an approved maintenance worker.');
  // Every route with a crew needs one explicitly chosen crew leader (nobody becomes leader by default).
  if (crewIds.length > 0 && !input.leadPersonId) return fail('Choose the crew leader for this route.');
  if (input.leadPersonId && !crewIds.includes(input.leadPersonId)) return fail('The crew leader has to be on the crew of this route.');
  const route = insertRow('maintenance_routes', {
    serviceDate: input.serviceDate,
    name: input.name?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    leadPersonId: input.leadPersonId,
    // Only sent when set, so a database without update 63 keeps taking routes.
    ...(input.truckId ? { truckId: input.truckId } : {}),
    status: 'planned',
    createdBy: db.personId || undefined,
  }) as unknown as MaintenanceRoute;
  input.stops.forEach((s, i) => insertStop(route.id, i, s));
  insertRows('maintenance_route_crew', crewIds.map((personId) => ({ routeId: route.id, personId, addedBy: db.personId || undefined })));
  return ok(route);
}

/** createRoute for a crew chosen from every worker: anyone not on Maintenance yet is added to it first. */
export async function createRouteWithCrew(input: NewRouteInput): Promise<Result<MaintenanceRoute>> {
  const ensured = await ensureMaintenanceArea([...(input.crewIds ?? []), ...(input.leadPersonId ? [input.leadPersonId] : [])]);
  if (!ensured.ok) return ensured;
  return createRoute(input);
}

export function updateRoute(id: string, patch: Partial<Pick<MaintenanceRoute, 'serviceDate' | 'name' | 'notes'>>) {
  updateRow('maintenance_routes', id, patch);
}

/**
 * Chooses (or changes) a route's crew leader. A route always needs one: there is no way to clear it, and nobody becomes leader
 * implicitly. The leader has to be an approved maintenance worker who is on the route's crew. The database checks all of it.
 */
export async function setRouteLead(routeId: string, personId: string): Promise<Result> {
  if (!personId) return fail('Choose a crew leader. A route always needs one.');
  if (!maintenanceWorkers().some((p) => p.id === personId)) return fail('The crew leader must be an approved maintenance worker.');
  if (isDemo()) {
    updateRow('maintenance_routes', routeId, { leadPersonId: personId });
    return ok(undefined);
  }
  const { error } = await rpc('maintenance_set_route_leader', { p_route: routeId, p_person: personId });
  await refresh(...MAINT_TABLES);
  return error ? fail(error.message) : ok(undefined);
}

/**
 * "Assign Maintenance Crew": puts everyone in eligibleMaintenanceCrew() on the
 * route in one go. Fails with a clear message when there's nobody eligible.
 */
export function assignMaintenanceCrew(routeId: string): Result<{ added: number; total: number }> {
  const crew = eligibleMaintenanceCrew();
  if (crew.length === 0) {
    return fail(maintenanceWorkers().length === 0
      ? 'There are no approved maintenance workers yet. Add or approve a maintenance worker first.'
      : 'Nobody in the maintenance crew is an approved maintenance worker.');
  }
  const current = new Set(db.maintenance.routeById[routeId]?.crewIds ?? []);
  const toAdd = crew.filter((p) => !current.has(p.id));
  insertRows('maintenance_route_crew', toAdd.map((p) => ({ routeId, personId: p.id, addedBy: db.personId || undefined })));
  return ok({ added: toAdd.length, total: current.size + toAdd.length });
}

export function addRouteCrewMember(routeId: string, personId: string): Result {
  if (!maintenanceWorkers().some((p) => p.id === personId)) return fail('Only approved maintenance workers can be on a maintenance route.');
  if (db.maintenance.routeById[routeId]?.crewIds.includes(personId)) return ok(undefined);
  insertRow('maintenance_route_crew', { routeId, personId, addedBy: db.personId || undefined });
  return ok(undefined);
}

export function removeRouteCrewMember(routeId: string, personId: string) {
  const row = rowsOf('maintenance_route_crew').find((r) => r.routeId === routeId && r.personId === personId);
  if (row) deleteRow('maintenance_route_crew', row.id);
}

/** Adds a stop at the end of the route. */
export function addStop(routeId: string, input: NewStopInput): MaintenanceStop {
  const n = db.maintenance.routeById[routeId]?.stops.length ?? 0;
  const maxOrder = Math.max(-1, ...(db.maintenance.routeById[routeId]?.stops.map((s) => s.sortOrder) ?? []));
  const stop = insertStop(routeId, Math.max(n, maxOrder + 1), input);
  // A finished route that gets another stop has open work again, so it goes back to in progress (the new stop just adds on).
  if (db.maintenance.routeById[routeId]?.status === 'completed') updateRow('maintenance_routes', routeId, { status: 'in_progress' });
  return stop;
}

/** Only a stop nobody has started can be removed. */
export function removeStop(stopId: string): Result {
  const s = db.maintenance.stopById[stopId];
  if (!s) return fail('Stop not found.');
  if (s.status !== 'pending') return fail('This stop has recorded work. Skip it instead.');
  deleteRow('maintenance_stops', stopId);
  return ok(undefined);
}

/** Saves the owner's order exactly as given. */
export function reorderStops(routeId: string, orderedStopIds: string[]) {
  const route = db.maintenance.routeById[routeId];
  if (!route) return;
  orderedStopIds.forEach((id, i) => {
    const s = route.stops.find((x) => x.id === id);
    if (s && s.sortOrder !== i) updateRow('maintenance_stops', id, { sortOrder: i });
  });
}

/** One rule for every stop of a route that is not finished (photos on or off, and how many). The owner can still change any one stop afterwards. */
export function setRoutePhotoRule(routeId: string, requiresPhotos: boolean, minPhotos: number) {
  const n = Math.max(1, Math.min(20, Math.round(minPhotos) || 1));
  for (const s of Object.values(db.maintenance.stopById)) {
    if (s.routeId !== routeId || s.status === 'completed' || s.status === 'skipped') continue;
    updateRow('maintenance_stops', s.id, { requiresPhotos, minPhotos: n });
  }
}

export function updateStop(stopId: string, patch: Partial<Pick<MaintenanceStop, 'instructions' | 'requiresPhotos' | 'minPhotos'>>) {
  updateRow('maintenance_stops', stopId, patch);
}

export function addStopTask(stopId: string, title: string, isRequired = true): MaintenanceStopTask | undefined {
  const s = db.maintenance.stopById[stopId];
  if (!s || !title.trim()) return undefined;
  return insertRow('maintenance_stop_tasks', {
    routeId: s.routeId, stopId, title: title.trim(), isRequired, sortOrder: s.tasks.length,
  }) as unknown as MaintenanceStopTask;
}

export function removeStopTask(taskId: string) {
  deleteRow('maintenance_stop_tasks', taskId);
}

export function cancelRoute(routeId: string) {
  updateRow('maintenance_routes', routeId, { status: 'cancelled' });
}

/** Only a route with no recorded work can be deleted. Otherwise cancel it. */
export function deleteRoute(routeId: string): Result {
  const r = db.maintenance.routeById[routeId];
  if (!r) return fail('Route not found.');
  if (r.stops.some((s) => s.status !== 'pending')) return fail('This route has recorded work. Cancel it instead.');
  deleteRow('maintenance_routes', routeId);
  return ok(undefined);
}

// ── Location ────────────────────────────────────────────────────────────────

function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

/** Same rules as _maint_location() in the database (used in demo mode). */
export function classifyLocation(
  gps: GpsResult | undefined,
  target: { latitude?: number; longitude?: number } | undefined,
  radiusM: number,
): { status: LocationStatus; distanceM?: number } {
  if (!gps || gps.status !== 'ok') return { status: gps?.status === 'denied' ? 'denied' : 'unavailable' };
  // "Anywhere" (distance 0): there is no zone to be outside of.
  if (radiusM <= 0) return { status: 'verified' };
  if (target?.latitude == null || target?.longitude == null) return { status: 'no_target_location' };
  const d = Math.round(distanceM(gps.gps.latitude, gps.gps.longitude, target.latitude, target.longitude) * 10) / 10;
  if (!gps.gps.accuracy || gps.gps.accuracy > Math.max(100, radiusM)) return { status: 'low_accuracy', distanceM: d };
  return { status: d > radiusM ? 'outside_radius' : 'verified', distanceM: d };
}

/** Plain words for a location status. Only 'verified' may be called GPS-verified. */
export function locationLabel(status?: LocationStatus): string {
  switch (status) {
    case 'verified': return 'GPS verified';
    case 'outside_radius': return 'Not at the property (GPS)';
    case 'low_accuracy': return 'GPS too inaccurate to verify';
    case 'denied': return 'Location permission off';
    case 'unavailable': return 'No GPS signal';
    case 'no_target_location': return 'Property location not set';
    case 'not_checked':
    default: return 'Not verified';
  }
}

function gpsArgs(gps?: GpsResult) {
  return gps?.status === 'ok'
    ? { p_lat: gps.gps.latitude, p_lng: gps.gps.longitude, p_accuracy: gps.gps.accuracy, p_location_state: 'ok' }
    : { p_lat: null, p_lng: null, p_accuracy: null, p_location_state: gps?.status ?? 'unavailable' };
}

function gpsFields(gps?: GpsResult) {
  return gps?.status === 'ok' ? { latitude: gps.gps.latitude, longitude: gps.gps.longitude, accuracyM: gps.gps.accuracy } : {};
}

// ── Crew actions ────────────────────────────────────────────────────────────

/** One request at a time per action+record: repeat taps share the first one. */
const inFlight = new Map<string, Promise<Result<any>>>();
function once<T>(key: string, run: () => Promise<Result<T>>): Promise<Result<T>> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<Result<T>>;
  const p = run().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

const MAINT_TABLES: TableName[] = ['maintenance_stops', 'maintenance_stop_services', 'maintenance_stop_tasks', 'maintenance_routes', 'maintenance_events'];

function logLocal(eventType: MaintenanceEventType, e: Record<string, unknown>) {
  insertRow('maintenance_events', { eventType, personId: db.personId, occurredAt: new Date().toISOString(), metadata: {}, ...e });
}

/** The signed-in worker's day start, if any. */
export function myAttendance(serviceDate = todayKey()): MaintenanceDayAttendance | undefined {
  return db.maintenance.attendance.find((a) => a.personId === db.personId && a.serviceDate === serviceDate);
}

/**
 * Start of day at the yard. Never blocked by GPS: whatever the phone reports
 * (or doesn't) is recorded as is. A second tap returns the first record.
 */
export function startDay(opts: { gps?: GpsResult; routeId?: string; serviceDate?: string } = {}): Promise<Result<MaintenanceDayAttendance>> {
  const serviceDate = opts.serviceDate ?? todayKey();
  return once(`start:${serviceDate}`, async () => {
    const existing = myAttendance(serviceDate);
    if (existing) return ok(existing);
    if (isDemo()) {
      const c = db.company;
      const loc = classifyLocation(opts.gps, { latitude: c?.yardLatitude, longitude: c?.yardLongitude }, 300);
      const row = insertRow('maintenance_day_attendance', {
        personId: db.personId, serviceDate, routeId: opts.routeId, startedAt: new Date().toISOString(),
        source: 'worker', locationStatus: loc.status, distanceM: loc.distanceM, ...gpsFields(opts.gps),
      }) as unknown as MaintenanceDayAttendance;
      logLocal('day_started', { routeId: opts.routeId, locationStatus: loc.status, distanceM: loc.distanceM, ...gpsFields(opts.gps) });
      return ok(row);
    }
    const { data, error } = await rpc<MaintenanceDayAttendance>('maintenance_start_day', {
      p_company_id: db.companyId, p_service_date: serviceDate, p_route_id: opts.routeId ?? null, ...gpsArgs(opts.gps),
    });
    await refresh('maintenance_day_attendance', 'maintenance_events');
    if (error) return fail(error.message);
    return ok(myAttendance(serviceDate) ?? (data as MaintenanceDayAttendance));
  });
}

/** "I'm here" at a stop. Records this worker's arrival once; never blocked by GPS. */
export function markArrived(stopId: string, gps?: GpsResult): Promise<Result<MaintenanceStop>> {
  return once(`arrive:${stopId}`, async () => {
    const stop = db.maintenance.stopById[stopId];
    if (!stop) return fail('Stop not found.');
    if (isDemo()) {
      if (stop.status === 'completed' || stop.status === 'skipped') return ok(stop);
      const p = stop.property;
      const loc = classifyLocation(gps, p, p?.checkinRadiusM ?? 150);
      const already = db.maintenance.events.some((e) => e.stopId === stopId && e.personId === db.personId && e.eventType === 'arrived');
      if (!already) logLocal('arrived', { routeId: stop.routeId, stopId, locationStatus: loc.status, distanceM: loc.distanceM, ...gpsFields(gps) });
      if (stop.status === 'pending') {
        updateRow('maintenance_stops', stopId, { status: 'arrived', arrivedAt: new Date().toISOString(), arrivedBy: db.personId, arrivalLocationStatus: loc.status });
        const route = db.maintenance.routeById[stop.routeId];
        if (route?.status === 'planned') updateRow('maintenance_routes', route.id, { status: 'in_progress' });
      }
      return ok(db.maintenance.stopById[stopId] ?? stop);
    }
    if (isTimeTrackingOn()) {
      // Workday time tracking is on: the CREW LEADER checks the crew in (update 68). The database saves one visit with the real arrival time.
      const lead = await rpc('maintenance_leader_arrive', { p_stop_id: stopId, ...gpsArgs(gps) });
      if (!lead.error || !/could not find the function|schema cache/i.test(lead.error.message)) {
        await refresh(...MAINT_TABLES);
        emitTimeChanged();
        return lead.error ? fail(lead.error.message) : ok(db.maintenance.stopById[stopId]);
      }
      // An older database (before update 68): the earlier per-worker start.
      const r = await timeRpc('time_start_visit', { p_source: 'maintenance_stop', p_ref: stopId, ...gpsArgs(gps), p_gps: null }, "Couldn't start this property.");
      await refresh(...MAINT_TABLES);
      return r.ok ? ok(db.maintenance.stopById[stopId]) : fail(r.error);
    }
    const { error } = await rpc('maintenance_mark_arrived', { p_stop_id: stopId, ...gpsArgs(gps) });
    await refresh(...MAINT_TABLES);
    if (error) return fail(error.message);
    return ok(db.maintenance.stopById[stopId]);
  });
}

export function setTaskDone(taskId: string, done: boolean): Promise<Result> {
  return once(`task:${taskId}`, async () => {
    const task = rowsOf('maintenance_stop_tasks').find((t) => t.id === taskId) as MaintenanceStopTask | undefined;
    if (!task) return fail('Checklist item not found.');
    const stop = db.maintenance.stopById[task.stopId];
    if (stop && (stop.status === 'completed' || stop.status === 'skipped')) return fail('This stop is already finished.');
    if (isDemo()) {
      if (!!task.completedAt === done) return ok(undefined);
      updateRow('maintenance_stop_tasks', taskId, done ? { completedAt: new Date().toISOString(), completedBy: db.personId } : { completedAt: undefined, completedBy: undefined });
      logLocal(done ? 'task_checked' : 'task_unchecked', { routeId: task.routeId, stopId: task.stopId, metadata: { task_id: taskId, title: task.title } });
      return ok(undefined);
    }
    const { error } = await rpc('maintenance_set_task_done', { p_task_id: taskId, p_done: done });
    await refresh('maintenance_stop_tasks', 'maintenance_events');
    return error ? fail(error.message) : ok(undefined);
  });
}

/** Photos whose task should be ticked as soon as the photo is saved (the worker already pressed the task). */
const tickWhenSaved = new Set<string>();
/** Called once a queued photo is saved: ticks its task if the worker asked for that. */
export async function afterStopPhotoSaved(photoId: string, taskId?: string): Promise<void> {
  if (!tickWhenSaved.delete(photoId) || !taskId) return;
  await setTaskDone(taskId, true);
}

/** Adds a stop photo (internal only). Uploads in the background. */
export function addStopPhoto(stopId: string, localUri: string, caption?: string, taskId?: string, tickTaskWhenSaved = false): MaintenancePhoto | undefined {
  const stop = db.maintenance.stopById[stopId];
  if (!stop || stop.status === 'completed' || stop.status === 'skipped') return undefined;
  const needsUpload = !db.demo && !/^https?:\/\//i.test(localUri);
  const row = insertRow('maintenance_photos', {
    routeId: stop.routeId, stopId, propertyId: stop.propertyId, uploadedBy: db.personId, fileUrl: localUri, fileKey: '',
    caption: caption?.trim() || undefined, isCustomerVisible: false, takenAt: new Date().toISOString(), taskId: taskId || undefined,
  }, { deferSave: needsUpload }) as unknown as MaintenancePhoto;
  // The photo is uploaded in the background; the task it proves is ticked the moment its photo is safely saved (see completeMediaTarget).
  if (taskId && tickTaskWhenSaved) tickWhenSaved.add(row.id);
  if (db.demo) logLocal('photo_added', { routeId: stop.routeId, stopId, metadata: { photo_id: row.id } });
  if (needsUpload) {
    // The shared queue compresses, uploads, and saves the record (always internal) only once the file is stored. A failure stays in the
    // stop's photo list as "Failed" with Retry, so a required photo is never silently lost.
    const { fileUrl: _f, fileKey: _k, id: _i, ...payload } = row as unknown as Record<string, unknown>;
    void _f; void _k; void _i;
    const { queueMedia } = require('@/lib/mediaQueueRuntime') as typeof import('@/lib/mediaQueueRuntime');
    queueMedia({ id: row.id, kind: 'image', sourceUri: localUri, folder: `${db.companyId}/maintenance/${stop.propertyId}`, target: { type: 'maintenance_photo', payload } });
  }
  return row;
}

/**
 * Owner/admin: share a stop photo with the property's customer, or make it
 * internal again. Photos are internal by default and only the owner can share
 * one; the customer sees it in Maintenance updates (supabase/updates/034).
 */
export function setStopPhotoShared(photoId: string, shared: boolean) {
  updateRow('maintenance_photos', photoId, shared
    ? { isCustomerVisible: true, sharedBy: db.personId, sharedAt: new Date().toISOString() }
    : { isCustomerVisible: false, sharedBy: null, sharedAt: null });
}

/** Until the stop is finished, the person who took a photo (or owner/admin) can remove it. */
export function removeStopPhoto(photoId: string) {
  deleteRow('maintenance_photos', photoId);
}

/** What still stops this stop from being finished. Empty = ready. */
export function finishBlockers(stop: MaintenanceStopDetail, opts: { asStaff?: boolean } = {}): string[] {
  const out: string[] = [];
  if (stop.status === 'completed') return ['This stop is already finished.'];
  if (stop.status === 'skipped') return ['This stop was skipped.'];
  if (stop.status !== 'arrived' && !opts.asStaff) out.push("Tap I'm Here at this property first.");
  const open = stop.tasks.filter((t) => t.isRequired && !t.completedAt);
  if (open.length) out.push(`${open.length} required checklist item${open.length === 1 ? '' : 's'} still open.`);
  if (stop.requiresPhotos) {
    // Photos still uploading don't count yet.
    const saved = stop.photos.filter((p) => db.demo || /^https?:\/\//i.test(p.fileUrl)).length;
    if (saved < stop.minPhotos) {
      const n = stop.minPhotos - saved;
      out.push(`Add ${n} more photo${n === 1 ? '' : 's'}.`);
    }
  }
  return out;
}

/**
 * "Finish stop": completes it once for the whole crew and records the
 * services as done (service history and season counts). Repeat taps, or a
 * crewmate finishing at the same time, never count it twice.
 */
export function finishStop(stopId: string, opts: { note?: string; gps?: GpsResult } = {}): Promise<Result<MaintenanceStop>> {
  return once(`finish:${stopId}`, async () => {
    const stop = db.maintenance.stopById[stopId];
    if (!stop) return fail('Stop not found.');
    if (stop.status === 'completed') return ok(stop);
    const asStaff = db.role === 'owner' || db.role === 'admin';
    if (isDemo()) {
      const blockers = finishBlockers(stop, { asStaff });
      if (blockers.length) return fail(blockers[0]);
      const p = stop.property;
      const loc = classifyLocation(opts.gps, p, p?.checkinRadiusM ?? 150);
      const now = new Date().toISOString();
      const note = opts.note?.trim() || undefined;
      updateRow('maintenance_stops', stopId, { status: 'completed', completedAt: now, completedBy: db.personId, completionLocationStatus: loc.status, completionNote: note });
      for (const s of stop.services) updateRow('maintenance_stop_services', s.id, { completed: true, completedAt: now });
      logLocal('completed', { routeId: stop.routeId, stopId, locationStatus: loc.status, distanceM: loc.distanceM, note, ...gpsFields(opts.gps), metadata: { recorded_by_staff_without_arrival: asStaff && !stop.arrivedAt } });
      settleRouteLocal(stop.routeId);
      return ok(db.maintenance.stopById[stopId] ?? stop);
    }
    if (isTimeTrackingOn()) {
      // The crew leader finishes the stop; the visit's completion time and elapsed time are saved (update 68).
      const lead = await rpc('maintenance_leader_complete', { p_stop_id: stopId, p_note: opts.note?.trim() || null, ...gpsArgs(opts.gps) });
      if (!lead.error || !/could not find the function|schema cache/i.test(lead.error.message)) {
        await refresh(...MAINT_TABLES);
        emitTimeChanged();
        return lead.error ? fail(lead.error.message) : ok(db.maintenance.stopById[stopId]);
      }
    }
    const timed = lastMyDay()?.current;
    if (isTimeTrackingOn() && timed?.stopId === stopId) {
      // This worker is timed at the stop: completing ends their own time and finishes the stop through the same rules.
      const r = await timeRpc('time_complete_visit', { p_visit_id: timed.visitId, p_note: opts.note?.trim() || null, ...gpsArgs(opts.gps), p_gps: null }, "Couldn't complete this property.");
      await refresh(...MAINT_TABLES);
      return r.ok ? ok(db.maintenance.stopById[stopId]) : fail(r.error);
    }
    const { error } = await rpc('maintenance_finish_stop', { p_stop_id: stopId, p_note: opts.note?.trim() || null, ...gpsArgs(opts.gps) });
    await refresh(...MAINT_TABLES);
    if (error) return fail(error.message);
    return ok(db.maintenance.stopById[stopId]);
  });
}

function settleRouteLocal(routeId: string) {
  const r = rowsOf('maintenance_routes').find((x) => x.id === routeId);
  if (!r || r.status === 'cancelled' || r.status === 'completed') return;
  const open = rowsOf('maintenance_stops').some((s) => s.routeId === routeId && (s.status === 'pending' || s.status === 'arrived'));
  if (!open) updateRow('maintenance_routes', routeId, { status: 'completed' });
  else if (r.status === 'planned') updateRow('maintenance_routes', routeId, { status: 'in_progress' });
}

/** Owner/admin: skip a stop with a reason. Nothing is counted as done. */
export function skipStop(stopId: string, reason: string): Promise<Result<MaintenanceStop>> {
  return once(`skip:${stopId}`, async () => {
    const stop = db.maintenance.stopById[stopId];
    if (!stop) return fail('Stop not found.');
    if (stop.status === 'completed' || stop.status === 'skipped') return ok(stop);
    if (isDemo()) {
      updateRow('maintenance_stops', stopId, { status: 'skipped', skippedAt: new Date().toISOString(), skippedBy: db.personId, skipReason: reason.trim() || undefined });
      logLocal('skipped', { routeId: stop.routeId, stopId, note: reason.trim() || undefined });
      settleRouteLocal(stop.routeId);
      return ok(db.maintenance.stopById[stopId] ?? stop);
    }
    const { error } = await rpc('maintenance_skip_stop', { p_stop_id: stopId, p_reason: reason });
    await refresh(...MAINT_TABLES);
    if (error) return fail(error.message);
    return ok(db.maintenance.stopById[stopId]);
  });
}

/**
 * Owner/admin: set a worker's day-start time (forgot to tap, or tapped late).
 * The worker's own time is kept as originalStartedAt; a note is required.
 */
export async function correctAttendance(personId: string, serviceDate: string, startedAt: Date, note: string): Promise<Result> {
  if (!note.trim()) return fail('Add a note explaining the correction.');
  if (isDemo()) {
    const existing = db.maintenance.attendance.find((a) => a.personId === personId && a.serviceDate === serviceDate);
    const now = new Date().toISOString();
    if (existing) {
      updateRow('maintenance_day_attendance', existing.id, {
        originalStartedAt: existing.originalStartedAt ?? existing.startedAt,
        startedAt: startedAt.toISOString(), correctedAt: now, correctedBy: db.personId, correctionNote: note.trim(),
      });
    } else {
      insertRow('maintenance_day_attendance', {
        personId, serviceDate, startedAt: startedAt.toISOString(), source: 'owner_correction', locationStatus: 'not_checked',
        correctedAt: now, correctedBy: db.personId, correctionNote: note.trim(),
      });
    }
    logLocal('correction', { note: note.trim(), metadata: { kind: 'attendance', worker_id: personId, service_date: serviceDate, started_at: startedAt.toISOString(), original_started_at: existing?.originalStartedAt ?? existing?.startedAt } });
    return ok(undefined);
  }
  const { error } = await rpc('maintenance_correct_attendance', {
    p_company_id: db.companyId, p_person_id: personId, p_service_date: serviceDate, p_started_at: startedAt.toISOString(), p_note: note.trim(),
  });
  await refresh('maintenance_day_attendance', 'maintenance_events');
  return error ? fail(error.message) : ok(undefined);
}

/** Local date of an attendance/event timestamp. */
export const dateKeyOf = (iso: string) => localDateKey(new Date(iso));
