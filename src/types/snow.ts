/**
 * Snow Mode base records. Tables in supabase/updates/020b_snow_foundation.sql
 * (access in 020, property details in 022, and later snow updates build on these).
 *
 *  property ──< visit >── route >── storm (one service each)
 *                 ├──< completion media   (proof of work, never customer-facing here)
 *                 └──< skip requests      (lead asks, owner decides)
 *  route ──< lead assignments (every lead a route has had)
 *  activity events: one append-only log, written by the database.
 *
 * Rows are snake_case in the database; these types are the camelCase app shape.
 */

/** Snow services. Each is a separate permission on the snow team. */
export type SnowService = 'plowing' | 'shoveling' | 'salting';

/** The one place the services are named and drawn. Every screen reads these (two spellings of "Shoveling" used to exist). */
export const SERVICE_LABEL: Record<SnowService, string> = { plowing: 'Plowing', shoveling: 'Shoveling / Sidewalks', salting: 'Salting' };
export const SERVICE_ICON = { plowing: 'truck', shoveling: 'users', salting: 'droplet' } as const;

export const SNOW_SERVICES: SnowService[] = ['plowing', 'shoveling', 'salting'];

export type SnowPropertyStatus = 'active' | 'inactive';

/** draft → dispatched → ended; reopening sets it back to dispatched. */
export type StormStatus = 'draft' | 'dispatched' | 'ended';

export interface SnowStorm {
  id: string;
  companyId: string;
  name: string;
  /** The first service (kept for older records). Use `services` (update 40) when it is there. */
  service: SnowService;
  /** Every service this storm covers (update 40). Missing on older databases: see `stormServices`. */
  services?: SnowService[];
  status: StormStatus;
  notes?: string;
  createdBy?: string;
  dispatchedAt?: string;
  dispatchedBy?: string;
  endedAt?: string;
  endedBy?: string;
  reopenedCount: number;
  lastReopenedAt?: string;
  lastReopenedBy?: string;
  /** Set by the create call so a double tap makes one storm (update 024). */
  clientRequestId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SnowRoute {
  id: string;
  companyId: string;
  stormId: string;
  /** Always the storm's service. */
  service: SnowService;
  name: string;
  position: number;
  /** Current lead. One person can lead several routes. */
  leadPersonId?: string;
  mediaRequired: boolean;
  /** How many photos/videos a stop needs when mediaRequired. */
  minMedia: number;
  notes?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** completed and skipped are final; skipped never counts as done. */
export type SnowVisitStatus = 'pending' | 'arrived' | 'completed' | 'skipped';

/** One stop on one route. Repeat passes at a property are separate visits. */
export interface SnowVisit {
  id: string;
  companyId: string;
  stormId: string;
  routeId: string;
  service: SnowService;
  propertyId: string;
  /** Order on the route, set by the owner only. */
  position: number;
  status: SnowVisitStatus;
  arrivedAt?: string;
  arrivedBy?: string;
  completedAt?: string;
  completedBy?: string;
  completionNote?: string;
  skippedAt?: string;
  skippedBy?: string;
  /** Property name/address as they were when the visit was created. */
  propertyName: string;
  propertyAddress: string;
  addedAfterDispatch: boolean;
  /** Send a fresh uuid per create so a retry can't make two visits. */
  clientRequestId?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export type SnowMediaKind = 'photo' | 'video';

export type SnowSkipRequestStatus = 'pending' | 'approved' | 'denied' | 'withdrawn';

export interface SnowSkipRequest {
  id: string;
  companyId: string;
  stormId: string;
  routeId: string;
  visitId: string;
  propertyId: string;
  requestedBy?: string;
  reason: string;
  status: SnowSkipRequestStatus;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
  clientRequestId?: string;
  createdAt: string;
  updatedAt: string;
}

/** e.g. 'storm.dispatched', 'visit.completed', 'route.lead_assigned'. */
export type SnowActivityAction = `${string}.${string}`;

export interface SnowActivityEvent {
  id: string;
  companyId: string;
  occurredAt: string;
  actorId?: string;
  action: SnowActivityAction;
  entityType: string;
  entityId?: string;
  stormId?: string;
  routeId?: string;
  visitId?: string;
  propertyId?: string;
  /** The worker the event is about. */
  personId?: string;
  service?: SnowService;
  /** Changed columns only, before and after. */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  note?: string;
}
