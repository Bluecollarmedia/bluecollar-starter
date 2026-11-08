/**
 * Importing a customer's existing addresses into Snow: which of their addresses the app already knows
 * (landscaping projects and maintenance properties). Pure functions; nothing here writes anything.
 */

export interface KnownPlace {
  /** Where the app already knows this address from. */
  source: 'project' | 'maintenance';
  sourceId: string;
  name: string;
  address: string;
  city?: string;
  state?: string;
  zip?: string;
}

interface PlaceRowLike {
  id: string;
  name?: string;
  customerId?: string;
  customerClaimedBy?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  isActive?: boolean;
  status?: string;
}

const SUFFIXES: Record<string, string> = {
  st: 'street', str: 'street', ave: 'avenue', av: 'avenue', rd: 'road', dr: 'drive', ln: 'lane', ct: 'court',
  blvd: 'boulevard', cir: 'circle', pl: 'place', ter: 'terrace', pkwy: 'parkway', hwy: 'highway', trl: 'trail',
  n: 'north', s: 'south', e: 'east', w: 'west',
};

/** An address in a form two spellings of it share ("205 Kathy Ln." and "205 kathy lane" match). */
export function normalizeAddress(address?: string): string {
  return (address ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SUFFIXES[w] ?? w)
    .join(' ');
}

/** Addresses already on file for this customer, one per distinct street address (projects first). */
export function knownPlacesFor(personId: string, projects: PlaceRowLike[], maintenanceProperties: PlaceRowLike[]): KnownPlace[] {
  const out: KnownPlace[] = [];
  const seen = new Set<string>();
  const add = (source: KnownPlace['source'], r: PlaceRowLike) => {
    const key = normalizeAddress(r.address);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ source, sourceId: r.id, name: r.name || r.address || '', address: r.address!.trim(), city: r.city, state: r.state, zip: r.zip });
  };
  for (const p of projects) {
    if ((p.customerId === personId || p.customerClaimedBy === personId) && p.status !== 'archived') add('project', p);
  }
  for (const p of maintenanceProperties) {
    if (p.customerId === personId && p.isActive !== false) add('maintenance', p);
  }
  return out;
}

export interface SnowPropertyLike { id: string; name: string; address?: string; zip?: string }

