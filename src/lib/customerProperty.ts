// Pure helpers for the customer's property-first home: the customer's projects grouped by property (street address), one property at a
// time, with finished projects in "Past work". No network, no screens; every value comes from real data passed in.
import type { HomeItem } from './customerHome';

export interface PropertyGroup {
  key: string;
  /** What the chip and the big title say. */
  name: string;
  address: string;
  items: HomeItem[];
}

/**
 * The customer's properties. Items at the same street address are one property (customerHome.propertyKeyOf); an item with no address stays on its
 * own. Completed projects are not properties: they go to "Past work" (pastWork below), so pass only what is still going.
 */
export function groupProperties(items: HomeItem[]): PropertyGroup[] {
  const byKey = new Map<string, HomeItem[]>();
  for (const i of items) {
    if (i.status === 'completed') continue;
    const k = i.propertyKey || i.key;
    byKey.set(k, [...(byKey.get(k) ?? []), i]);
  }
  return [...byKey.entries()].map(([key, list]) => {
    const street = (list.find((i) => i.address)?.address ?? '').split(',')[0];
    // One project names the property; several fall back to the street.
    const name = list.length === 1 ? list[0].name : street || list[0].name;
    return { key, name, address: list.find((i) => i.address)?.address ?? '', items: list };
  });
}

export const pastWork = (items: HomeItem[]): HomeItem[] =>
  items.filter((i) => i.status === 'completed').sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));

/** Properties by name. */
export function sortGroups(groups: PropertyGroup[]): PropertyGroup[] {
  return [...groups].sort((a, b) => a.name.localeCompare(b.name));
}
