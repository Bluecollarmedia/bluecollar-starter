import type { MaintenanceRouteDetail } from '@/types/maintenance';

/**
 * Maintenance's share of "today" for the owner dashboard, from the routes already in the store (no new data):
 *  • scheduled: everyone on a route today (crew and leader), each person once;
 *  • onSite: the people on a route that has a stop the crew has checked in at and not finished (the leader checks the whole crew in);
 *  • finished: people whose routes today have nothing left to do (all stops completed or skipped);
 *  • propertyIds: distinct properties on today's stops that are not skipped.
 * Cancelled routes count for nothing. The dashboard merges these sets with the landscaping sets, so a person on both a job and a
 * route is counted once, and a property is counted once however many routes list it.
 */
export interface MaintenanceToday {
  scheduled: Set<string>;
  onSite: Set<string>;
  finished: Set<string>;
  propertyIds: Set<string>;
  routeCount: number;
  /** For the Crew Today list: where each maintenance person is today (their route, and the property they are at if checked in). */
  where: Map<string, { routeName: string; atProperty?: string; arrivedAt?: string }>;
}

export function maintenanceToday(routes: MaintenanceRouteDetail[], today: string): MaintenanceToday {
  const out: MaintenanceToday = { scheduled: new Set(), onSite: new Set(), finished: new Set(), propertyIds: new Set(), routeCount: 0, where: new Map() };
  const active = new Set<string>();   // people with something still to do on some route
  for (const r of routes) {
    if (r.serviceDate !== today || r.status === 'cancelled') continue;
    out.routeCount++;
    const people = new Set<string>(r.crewIds);
    if (r.lead?.id) people.add(r.lead.id);
    const arrivedStop = r.stops.find((s) => s.status === 'arrived');
    const here = !!arrivedStop;
    const open = r.stops.some((s) => s.status === 'pending' || s.status === 'arrived');
    for (const id of people) {
      out.scheduled.add(id);
      if (here) out.onSite.add(id);
      const prev = out.where.get(id);
      if (!prev || (here && !prev.atProperty)) out.where.set(id, { routeName: r.name || 'Maintenance route', atProperty: arrivedStop?.property?.name, arrivedAt: arrivedStop?.arrivedAt ?? undefined });
      if (open) active.add(id);
    }
    for (const s of r.stops) if (s.status !== 'skipped' && s.propertyId) out.propertyIds.add(s.propertyId);
  }
  for (const id of out.scheduled) if (!active.has(id)) out.finished.add(id);
  return out;
}
