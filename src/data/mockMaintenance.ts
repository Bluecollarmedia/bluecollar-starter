/**
 * Demo-mode maintenance data (only used when no Supabase project is set up).
 * Every property is named "Sample · …" so nobody mistakes it for real company
 * records. Dates are relative to today so due/overdue always has something to show.
 */
import { localDateTime, offsetDateKey, todayKey } from '@/lib/ids';

type Row = Record<string, any>;

export function buildMockMaintenance(companyId: string) {
  const today = todayKey();
  const at = (dateKey: string, time: string) => localDateTime(dateKey, time).toISOString();
  const created = '2026-03-01T12:00:00.000Z';
  const year = today.slice(0, 4);
  const base = { companyId, createdAt: created, updatedAt: created };

  const properties: Row[] = [
    { id: 'mp-mitchell', name: 'Sample · Mitchell Residence', customerId: 'customer1', address: '2210 Fairmount Blvd', city: 'Cleveland Heights', state: 'OH', zip: '44106', latitude: 41.4998, longitude: -81.5713, checkinRadiusM: 150, accessNotes: 'Side gate code is with the owner. Dog in the back yard on weekdays.', isActive: true, createdBy: 'owner1' },
    { id: 'mp-oakridge', name: 'Sample · Oak Ridge HOA Entrance', address: '100 Oak Ridge Dr', city: 'Parma', state: 'OH', zip: '44134', latitude: 41.3846, longitude: -81.7229, checkinRadiusM: 200, accessNotes: 'Park on the service lane, not the main drive.', notes: 'Includes both entrance islands and the playground edge.', isActive: true, createdBy: 'owner1' },
    { id: 'mp-library', name: 'Sample · Brighton Library Grounds', address: '4480 Ridge Rd', city: 'Brooklyn', state: 'OH', zip: '44144', latitude: 41.4389, longitude: -81.7351, checkinRadiusM: 150, isActive: true, createdBy: 'owner1' },
    { id: 'mp-lakeview', name: 'Sample · Lakeview Office Park', address: '7800 Lake Ave', city: 'Cleveland', state: 'OH', zip: '44102', checkinRadiusM: 150, notes: 'No coordinates yet, so arrivals here can\'t be GPS-verified.', isActive: true, createdBy: 'owner1' },
    { id: 'mp-hillcrest', name: 'Sample · Hillcrest Cottage', address: '55 Hillcrest Ave', city: 'Lakewood', state: 'OH', zip: '44107', latitude: 41.4819, longitude: -81.7982, checkinRadiusM: 150, isActive: true, createdBy: 'owner1' },
  ].map((p) => ({ ...base, ...p }));

  const contracts: Row[] = [
    { id: 'mc-mitchell', propertyId: 'mp-mitchell', name: `${year} season`, status: 'active', seasonStart: `${year}-04-01`, seasonEnd: `${year}-11-30` },
    { id: 'mc-oakridge', propertyId: 'mp-oakridge', name: `${year} season`, status: 'active', seasonStart: `${year}-04-01`, seasonEnd: `${year}-11-15` },
    { id: 'mc-library', propertyId: 'mp-library', name: `${year} season`, status: 'active', seasonStart: `${year}-04-15`, seasonEnd: `${year}-11-15` },
    { id: 'mc-lakeview', propertyId: 'mp-lakeview', name: `${year} season`, status: 'active' },
    { id: 'mc-hillcrest', propertyId: 'mp-hillcrest', name: `${year} season`, status: 'inactive', deactivatedAt: '2026-08-15T12:00:00.000Z', notes: 'Customer paused service.' },
  ].map((c) => ({ ...base, createdBy: 'owner1', ...c }));

  const rule = (r: Row): Row => ({
    ...base, priorCompletedCount: 0, requiresPhotos: false, defaultChecklist: [], isActive: true, sortOrder: 0, ...r,
  });
  const rules: Row[] = [
    rule({ id: 'mr-mitchell-cut', contractId: 'mc-mitchell', propertyId: 'mp-mitchell', serviceType: 'lawn_cut', label: 'Lawn cut', frequency: 'weekly', seasonQuantity: 26, priorCompletedCount: 21, lastCompletedOn: offsetDateKey(-16), defaultChecklist: ['Blow off driveway and walks'] }),
    rule({ id: 'mr-mitchell-fall', contractId: 'mc-mitchell', propertyId: 'mp-mitchell', serviceType: 'fall_cleanup', label: 'Fall cleanup', frequency: 'seasonal_window', windowStart: offsetDateKey(-3), windowEnd: offsetDateKey(25), sortOrder: 1 }),
    rule({ id: 'mr-oak-cut', contractId: 'mc-oakridge', propertyId: 'mp-oakridge', serviceType: 'lawn_cut', label: 'Lawn cut', frequency: 'biweekly', lastCompletedOn: offsetDateKey(-14) }),
    rule({ id: 'mr-oak-shrub', contractId: 'mc-oakridge', propertyId: 'mp-oakridge', serviceType: 'shrub_trim', label: 'Shrub trimming', frequency: 'seasonal_window', windowStart: `${year}-07-01`, windowEnd: `${year}-07-31`, lastCompletedOn: `${year}-07-12`, sortOrder: 1 }),
    rule({ id: 'mr-lib-cut', contractId: 'mc-library', propertyId: 'mp-library', serviceType: 'lawn_cut', label: 'Lawn cut', frequency: 'weekly', priorCompletedCount: 22 }),
    rule({ id: 'mr-lib-fert', contractId: 'mc-library', propertyId: 'mp-library', serviceType: 'fertilization', label: 'Fertilization', frequency: 'seasonal_window', windowStart: offsetDateKey(-14), windowEnd: offsetDateKey(14), requiresPhotos: true, instructions: 'Keep 10 ft from the children\'s garden beds.', sortOrder: 1 }),
    rule({ id: 'mr-lake-cut', contractId: 'mc-lakeview', propertyId: 'mp-lakeview', serviceType: 'lawn_cut', label: 'Lawn cut', frequency: 'every_n_days', intervalDays: 10 }),
    rule({ id: 'mr-hill-cut', contractId: 'mc-hillcrest', propertyId: 'mp-hillcrest', serviceType: 'lawn_cut', label: 'Lawn cut', frequency: 'weekly', lastCompletedOn: offsetDateKey(-40) }),
  ];

  // A finished route 9 days ago, and today's route in progress.
  const past = offsetDateKey(-9);
  const routes: Row[] = [
    { ...base, id: 'mroute-past', serviceDate: past, status: 'completed', leadPersonId: 'worker2', createdBy: 'owner1', createdAt: at(past, '06:30') },
    { ...base, id: 'mroute-today', serviceDate: today, status: 'in_progress', notes: 'Start at Oak Ridge. The library lot is busy until 10, so it goes last.', createdBy: 'owner1', createdAt: at(today, '06:15') },
  ];
  const routeCrew: Row[] = ['mroute-past', 'mroute-today'].flatMap((routeId) =>
    ['worker2', 'worker4'].map((personId) => ({ id: `${routeId}-${personId}`, companyId, routeId, personId, addedBy: 'owner1', createdAt: routes.find((r) => r.id === routeId)!.createdAt })));

  const stop = (s: Row): Row => ({ ...base, status: 'pending', requiresPhotos: false, minPhotos: 1, ...s });
  const stops: Row[] = [
    stop({ id: 'ms-past-1', routeId: 'mroute-past', propertyId: 'mp-library', contractId: 'mc-library', sortOrder: 0, status: 'completed', arrivedAt: at(past, '07:40'), arrivedBy: 'worker2', arrivalLocationStatus: 'verified', completedAt: at(past, '08:35'), completedBy: 'worker2', completionLocationStatus: 'verified' }),
    stop({ id: 'ms-past-2', routeId: 'mroute-past', propertyId: 'mp-mitchell', contractId: 'mc-mitchell', sortOrder: 1, status: 'completed', arrivedAt: at(past, '09:05'), arrivedBy: 'worker4', arrivalLocationStatus: 'low_accuracy', completedAt: at(past, '09:50'), completedBy: 'worker4', completionLocationStatus: 'low_accuracy' }),
    stop({ id: 'ms-today-1', routeId: 'mroute-today', propertyId: 'mp-oakridge', contractId: 'mc-oakridge', sortOrder: 0, status: 'completed', arrivedAt: at(today, '07:35'), arrivedBy: 'worker2', arrivalLocationStatus: 'verified', completedAt: at(today, '08:40'), completedBy: 'worker2', completionLocationStatus: 'verified' }),
    stop({ id: 'ms-today-2', routeId: 'mroute-today', propertyId: 'mp-mitchell', contractId: 'mc-mitchell', sortOrder: 1, instructions: 'Customer said the strip by the swing set was missed last time. Trim and blow it out.' }),
    stop({ id: 'ms-today-3', routeId: 'mroute-today', propertyId: 'mp-library', contractId: 'mc-library', sortOrder: 2, requiresPhotos: true, minPhotos: 2 }),
  ];

  const svc = (id: string, stopId: string, ruleId: string, label: string, serviceType: string, completedAt?: string): Row => {
    const s = stops.find((x) => x.id === stopId)!;
    return { id, companyId, routeId: s.routeId, stopId, propertyId: s.propertyId, ruleId, serviceType, label, completed: !!completedAt, completedAt, createdAt: s.createdAt };
  };
  const stopServices: Row[] = [
    svc('mss-1', 'ms-past-1', 'mr-lib-cut', 'Lawn cut', 'lawn_cut', at(past, '08:35')),
    svc('mss-2', 'ms-past-2', 'mr-mitchell-cut', 'Lawn cut', 'lawn_cut', at(past, '09:50')),
    svc('mss-3', 'ms-today-1', 'mr-oak-cut', 'Lawn cut', 'lawn_cut', at(today, '08:40')),
    svc('mss-4', 'ms-today-2', 'mr-mitchell-cut', 'Lawn cut', 'lawn_cut'),
    svc('mss-5', 'ms-today-3', 'mr-lib-fert', 'Fertilization', 'fertilization'),
  ];

  const task = (id: string, stopId: string, title: string, sortOrder: number, completedAt?: string, completedBy?: string): Row => {
    const s = stops.find((x) => x.id === stopId)!;
    return { id, companyId, routeId: s.routeId, stopId, title, isRequired: true, sortOrder, completedAt, completedBy, createdAt: s.createdAt, updatedAt: completedAt ?? s.createdAt };
  };
  const stopTasks: Row[] = [
    task('mst-1', 'ms-today-1', 'Edge the playground border', 0, at(today, '08:20'), 'worker2'),
    task('mst-2', 'ms-today-2', 'Blow off driveway and walks', 0),
    task('mst-3', 'ms-today-2', 'Trim the strip by the swing set', 1),
  ];

  const attendance: Row[] = [
    { id: 'mda-1', companyId, personId: 'worker2', serviceDate: past, routeId: 'mroute-past', startedAt: at(past, '07:02'), source: 'worker', locationStatus: 'verified', distanceM: 35, accuracyM: 12, createdAt: at(past, '07:02'), updatedAt: at(past, '07:02') },
    { id: 'mda-2', companyId, personId: 'worker4', serviceDate: past, routeId: 'mroute-past', startedAt: at(past, '07:05'), source: 'worker', locationStatus: 'verified', distanceM: 48, accuracyM: 18, createdAt: at(past, '07:05'), updatedAt: at(past, '07:05') },
    // Today Tyler started at the yard; Carlos hasn't checked in.
    { id: 'mda-3', companyId, personId: 'worker2', serviceDate: today, routeId: 'mroute-today', startedAt: at(today, '07:01'), source: 'worker', locationStatus: 'verified', distanceM: 22, accuracyM: 9, createdAt: at(today, '07:01'), updatedAt: at(today, '07:01') },
  ];

  const ev = (id: string, e: Row): Row => ({ id, companyId, metadata: {}, createdAt: e.occurredAt, ...e });
  const events: Row[] = [
    ev('me-1', { personId: 'worker2', routeId: 'mroute-past', eventType: 'day_started', occurredAt: at(past, '07:02'), locationStatus: 'verified', distanceM: 35 }),
    ev('me-2', { personId: 'worker4', routeId: 'mroute-past', eventType: 'day_started', occurredAt: at(past, '07:05'), locationStatus: 'verified', distanceM: 48 }),
    ev('me-3', { personId: 'worker2', routeId: 'mroute-past', stopId: 'ms-past-1', eventType: 'arrived', occurredAt: at(past, '07:40'), locationStatus: 'verified' }),
    ev('me-4', { personId: 'worker2', routeId: 'mroute-past', stopId: 'ms-past-1', eventType: 'completed', occurredAt: at(past, '08:35'), locationStatus: 'verified' }),
    ev('me-5', { personId: 'worker4', routeId: 'mroute-past', stopId: 'ms-past-2', eventType: 'arrived', occurredAt: at(past, '09:05'), locationStatus: 'low_accuracy' }),
    ev('me-6', { personId: 'worker4', routeId: 'mroute-past', stopId: 'ms-past-2', eventType: 'completed', occurredAt: at(past, '09:50'), locationStatus: 'low_accuracy' }),
    ev('me-7', { personId: 'worker2', routeId: 'mroute-today', eventType: 'day_started', occurredAt: at(today, '07:01'), locationStatus: 'verified', distanceM: 22 }),
    ev('me-8', { personId: 'worker2', routeId: 'mroute-today', stopId: 'ms-today-1', eventType: 'arrived', occurredAt: at(today, '07:35'), locationStatus: 'verified' }),
    ev('me-9', { personId: 'worker4', routeId: 'mroute-today', stopId: 'ms-today-1', eventType: 'arrived', occurredAt: at(today, '07:38'), locationStatus: 'unavailable' }),
    ev('me-10', { personId: 'worker2', routeId: 'mroute-today', stopId: 'ms-today-1', eventType: 'task_checked', occurredAt: at(today, '08:20'), metadata: { task_id: 'mst-1', title: 'Edge the playground border' } }),
    ev('me-11', { personId: 'worker2', routeId: 'mroute-today', stopId: 'ms-today-1', eventType: 'completed', occurredAt: at(today, '08:40'), locationStatus: 'verified' }),
  ];

  return {
    /** Workers classified as maintenance in demo mode. */
    maintenanceWorkerIds: ['worker2', 'worker4'],
    tables: {
      maintenance_properties: properties,
      maintenance_contracts: contracts,
      maintenance_service_rules: rules,
      maintenance_routes: routes,
      maintenance_route_crew: routeCrew,
      maintenance_stops: stops,
      maintenance_stop_services: stopServices,
      maintenance_stop_tasks: stopTasks,
      maintenance_photos: [] as Row[],
      maintenance_day_attendance: attendance,
      maintenance_events: events,
    },
  };
}
