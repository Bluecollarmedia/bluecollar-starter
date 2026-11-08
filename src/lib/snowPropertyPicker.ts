/**
 * Add Properties sheet helpers (pure). The database decides which properties are eligible for the storm; these only narrow
 * the list the owner is looking at (search, the route's service, a customer) and word the Add button.
 */
import type { SnowService } from '@/types/snow';

/** 'service' = the route's own service(s); 'svc:salting' etc. = one other service; 'all' = everything eligible. */
export type PropertyFilter = 'all' | 'service' | 'customer' | `svc:${SnowService}`;

export interface PickableProperty {
  propertyId: string;
  name: string;
  address: string;
  city?: string;
  services?: SnowService[];
}

export interface PickerState {
  query: string;
  filter: PropertyFilter;
  /** The customer chosen under the Customer filter. */
  customer: string | null;
  /** Customer contact names per property id. */
  contacts: Record<string, string[]>;
  /** The route's services. */
  services: SnowService[];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Search by property name, address or customer, then apply the chosen filter. Selections live elsewhere, so they survive any change here. */
export function filterProperties<T extends PickableProperty>(all: T[], st: PickerState): T[] {
  const q = norm(st.query);
  return all
    .filter((p) => {
      if (st.filter === 'service') {
        // A property with no per-service list is eligible for the route's own service.
        if (p.services && !p.services.some((s) => st.services.includes(s))) return false;
      }
      if (st.filter.startsWith('svc:')) {
        const one = st.filter.slice(4) as SnowService;
        if (p.services && !p.services.includes(one)) return false;
      }
      if (st.filter === 'customer' && st.customer) {
        if (!(st.contacts[p.propertyId] ?? []).includes(st.customer)) return false;
      }
      if (!q) return true;
      const hay = [p.name, p.address, p.city ?? '', ...(st.contacts[p.propertyId] ?? [])].map(norm).join(' | ');
      return q.split(' ').every((w) => hay.includes(w));
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** "Select Properties" until something is ticked, then "Add 1 Property" / "Add 5 Properties". */
export function addButtonLabel(n: number): string {
  if (n <= 0) return 'Select Properties';
  return `Add ${n} ${n === 1 ? 'Property' : 'Properties'}`;
}
