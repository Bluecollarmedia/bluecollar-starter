// A route that does several services together (plowing + salting on one truck) has one visit per service at each property.
// The crew works the property once, so the screens treat those visits as one stop. These are pure helpers for that.

export interface GroupableStop { id: string; propertyId: string; service?: string; status: string }

/**
 * Consecutive visits at the same property, each a different service, are one stop. A property visited twice for the SAME
 * service (a repeat pass) stays two stops.
 */
export function groupStops<T extends GroupableStop>(stops: T[]): T[][] {
  const groups: T[][] = [];
  for (const s of stops) {
    const last = groups[groups.length - 1];
    if (last && last[0].propertyId === s.propertyId && !last.some((x) => x.service === s.service)) last.push(s);
    else groups.push([s]);
  }
  return groups;
}

export const flattenGroups = <T,>(groups: T[][]): T[] => groups.flat();

export type StopStatus = 'pending' | 'arrived' | 'completed' | 'skipped';

/** Where a combined stop stands: closed (all done or skipped) , in progress (any arrived or partly done), or not started. */
export function groupStatus(group: { status: string }[]): StopStatus {
  if (group.every((s) => s.status === 'completed')) return 'completed';
  if (group.every((s) => s.status === 'completed' || s.status === 'skipped')) return group.every((s) => s.status === 'skipped') ? 'skipped' : 'completed';
  if (group.every((s) => s.status === 'pending')) return 'pending';
  return 'arrived';
}

export const isGroupClosed = (group: { status: string }[]) => group.every((s) => s.status === 'completed' || s.status === 'skipped');
export const isGroupUntouched = (group: { status: string }[]) => group.every((s) => s.status === 'pending');

/** "Plowing + Salting". */
export function servicesText(services: string[], label: (s: string) => string): string {
  return services.map(label).join(' + ');
}

/** Which services to make visits for when a property is added to a route: the route's services the property offers. */
export function servicesToAdd(routeServices: string[], propertyServices: string[] | undefined, routeService: string): string[] {
  if (!propertyServices) return [routeService];
  return routeServices.filter((s) => propertyServices.includes(s));
}

/** Leads (or crew) who can do every one of a route's services: the people on every list. */
export function peopleWhoDoAll<T extends { personId: string }>(lists: T[][]): T[] {
  if (lists.length === 0) return [];
  return lists[0].filter((p) => lists.every((l) => l.some((q) => q.personId === p.personId)));
}
