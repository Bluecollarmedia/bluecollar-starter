/**
 * Storms can cover several services (update 40). Small pure helpers for the
 * lists of services on a storm and the one service each route performs.
 */

import type { SnowService } from '@/types/snow';

/** The services a storm covers. Storms from before update 40 have only the old single `service`. */
export function stormServices(storm: { service: SnowService; services?: SnowService[] }): SnowService[] {
  return storm.services && storm.services.length ? storm.services : [storm.service];
}

/** "Plowing", "Plowing + Shoveling", "Plowing, Shoveling + Salting". */
export function servicesLabel(services: SnowService[], label: (s: SnowService) => string): string {
  const names = services.map(label);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} + ${names[names.length - 1]}`;
}

/** Add or remove a service from a pick, keeping the order the owner chose them in. */
export function toggleService(picked: SnowService[], s: SnowService): SnowService[] {
  return picked.includes(s) ? picked.filter((x) => x !== s) : [...picked, s];
}

/**
 * A starting name for a new storm: always "Jan 12 Storm". A storm runs plowing, salting and sidewalk crews, so naming it after one service
 * ("Jan 12 Plowing") was misleading on the dashboard. The owner can still type any name.
 */
export function defaultStormNameFor(_services: SnowService[], _label: (s: SnowService) => string, now = new Date()): string {
  const day = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${day} Storm`;
}
