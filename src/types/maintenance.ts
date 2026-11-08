/**
 * Maintenance: recurring service properties, separate from Projects.
 * Tables in supabase/updates/018_maintenance.sql.
 *
 *  property ──< contract ──< service rule
 *     │
 *     └──< stop >── route ──< route crew (snapshot of the maintenance crew)
 *              ├──< stop services   (completed rows = service history)
 *              ├──< stop tasks      (checklist for that visit only)
 *              └──< photos
 *  day attendance (one per worker per day) and events (append-only log).
 */

import type { PersonSummary } from './company';

/** On a company membership. Everyone is 'landscaping' until the owner says otherwise. */
export type WorkerType = 'landscaping' | 'maintenance';

// ── Properties, contracts, rules ────────────────────────────────────────────

export interface MaintenanceProperty {
  id: string;
  companyId: string;
  /** Recognizable label, e.g. "Oak Ridge HOA – front entrance". */
  name: string;
  /** Existing customer (a person with the customer role), when there is one. */
  customerId?: string;
  /** The shared property (supabase/updates/075 and 79); its address is kept in step with it. */
  propertyId?: string;
  /** The project this property was created from, if any. Never required. */
  sourceProjectId?: string;
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;
  /** Arrival within this many metres counts as GPS-verified. */
  checkinRadiusM: number;
  accessNotes?: string;
  notes?: string;
  isActive: boolean;
  deactivatedAt?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  // derived
  customer?: PersonSummary;
}

export type ContractStatus = 'active' | 'inactive';

export interface MaintenanceContract {
  id: string;
  companyId: string;
  propertyId: string;
  name: string;
  status: ContractStatus;
  /** 'YYYY-MM-DD' */
  seasonStart?: string;
  seasonEnd?: string;
  notes?: string;
  deactivatedAt?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 *  weekly / biweekly   every 7 / 14 days
 *  every_n_days        every `intervalDays`
 *  seasonal_window     once between windowStart and windowEnd (spring cleanup, July shrub trim…)
 *  fixed_dates         a set number of visits on saved dates (spread evenly across the season, or typed in)
 *  as_needed           never recommended automatically
 */
export type ServiceFrequency = 'weekly' | 'biweekly' | 'every_n_days' | 'seasonal_window' | 'as_needed' | 'fixed_dates';

/** Suggested service types. Any other text is allowed too. */
export const SERVICE_TYPES = [
  { key: 'lawn_cut', label: 'Lawn cut' },
  { key: 'spring_cleanup', label: 'Spring cleanup' },
  { key: 'fall_cleanup', label: 'Fall cleanup' },
  { key: 'shrub_trim', label: 'Shrub trimming' },
  { key: 'fertilization', label: 'Fertilization' },
  { key: 'mulch', label: 'Mulch' },
  { key: 'basin_cuts', label: 'Basin Cuts' },
  { key: 'other', label: 'Other' },
] as const;

export interface MaintenanceServiceRule {
  id: string;
  companyId: string;
  contractId: string;
  /** Filled in by the database from the contract. */
  propertyId: string;
  serviceType: string;
  label: string;
  frequency: ServiceFrequency;
  intervalDays?: number;
  /** First service date (anchors the cycle when there's no history). */
  startsOn?: string;
  windowStart?: string;
  windowEnd?: string;
  /** For fixed_dates: the saved visit dates ('YYYY-MM-DD', oldest first). */
  scheduledDates?: string[];
  /** e.g. 26 cuts this season. */
  seasonQuantity?: number;
  /** Done before the app started tracking. */
  priorCompletedCount: number;
  /** Last one done before the app started tracking. */
  lastCompletedOn?: string;
  requiresPhotos: boolean;
  /** How many photos a stop for this service needs (1 to 20). New stops start from this. */
  minPhotos: number;
  /** Checklist items copied onto each stop for this service. */
  defaultChecklist: string[];
  instructions?: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ── Routes ──────────────────────────────────────────────────────────────────

export type RouteStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';

export interface MaintenanceRoute {
  id: string;
  companyId: string;
  /** 'YYYY-MM-DD' */
  serviceDate: string;
  name?: string;
  /** Route-level instructions. */
  notes?: string;
  /** Optional Maintenance Lead. Nothing requires one. */
  leadPersonId?: string;
  /** The truck the owner assigned to this route (update 63). */
  truckId?: string;
  status: RouteStatus;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceRouteCrewMember {
  id: string;
  companyId: string;
  routeId: string;
  personId: string;
  addedBy?: string;
  createdAt: string;
}

export type StopStatus = 'pending' | 'arrived' | 'completed' | 'skipped';

/**
 * How trustworthy a recorded position was. Worked out by the database from
 * what the phone reported; never assumed.
 */
export type LocationStatus =
  | 'verified'
  | 'outside_radius'
  | 'low_accuracy'
  | 'denied'
  | 'unavailable'
  | 'no_target_location'
  | 'not_checked';

export interface MaintenanceStop {
  id: string;
  companyId: string;
  routeId: string;
  propertyId: string;
  contractId?: string;
  sortOrder: number;
  status: StopStatus;
  /** Work for this visit only, e.g. "Playground edge was missed last time". */
  instructions?: string;
  requiresPhotos: boolean;
  minPhotos: number;
  arrivedAt?: string;
  arrivedBy?: string;
  arrivalLocationStatus?: LocationStatus;
  completedAt?: string;
  completedBy?: string;
  completionLocationStatus?: LocationStatus;
  completionNote?: string;
  skippedAt?: string;
  skippedBy?: string;
  skipReason?: string;
  createdAt: string;
  updatedAt: string;
}

/** A service done at a stop. Completed rows are the service history. */
export interface MaintenanceStopService {
  id: string;
  companyId: string;
  routeId: string;
  stopId: string;
  propertyId: string;
  ruleId?: string;
  serviceType: string;
  label: string;
  completed: boolean;
  completedAt?: string;
  createdAt: string;
}

export interface MaintenanceStopTask {
  id: string;
  companyId: string;
  routeId: string;
  stopId: string;
  title: string;
  isRequired: boolean;
  sortOrder: number;
  completedAt?: string;
  completedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenancePhoto {
  id: string;
  companyId: string;
  routeId: string;
  stopId: string;
  propertyId: string;
  uploadedBy?: string;
  fileUrl: string;
  fileKey: string;
  sizeBytes?: number;
  caption?: string;
  /** Internal by default. Only the owner can share one. */
  isCustomerVisible: boolean;
  sharedBy?: string;
  sharedAt?: string;
  /** The task this photo is the proof for (when the stop needs one photo per task). */
  taskId?: string;
  takenAt?: string;
  createdAt: string;
}

// ── Attendance and events ───────────────────────────────────────────────────

/** Start of day at the yard. No row for a worker and date = not started. */
export interface MaintenanceDayAttendance {
  id: string;
  companyId: string;
  personId: string;
  serviceDate: string;
  routeId?: string;
  startedAt: string;
  source: 'worker' | 'owner_correction';
  latitude?: number;
  longitude?: number;
  accuracyM?: number;
  distanceM?: number;
  locationStatus: LocationStatus;
  /** What the worker recorded, when the owner corrected it. */
  originalStartedAt?: string;
  correctedAt?: string;
  correctedBy?: string;
  correctionNote?: string;
  createdAt: string;
  updatedAt: string;
}

export type MaintenanceEventType =
  | 'day_started'
  | 'arrived'
  | 'task_checked'
  | 'task_unchecked'
  | 'photo_added'
  | 'completed'
  | 'skipped'
  | 'correction';

export interface MaintenanceEvent {
  id: string;
  companyId: string;
  routeId?: string;
  stopId?: string;
  personId?: string;
  eventType: MaintenanceEventType;
  occurredAt: string;
  latitude?: number;
  longitude?: number;
  accuracyM?: number;
  distanceM?: number;
  locationStatus?: LocationStatus;
  note?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  // derived
  actor?: PersonSummary;
}

// ── Joined shapes for screens ───────────────────────────────────────────────

export interface MaintenanceStopDetail extends MaintenanceStop {
  property?: MaintenanceProperty;
  services: MaintenanceStopService[];
  tasks: MaintenanceStopTask[];
  photos: MaintenancePhoto[];
  /** 1-based position in the route's saved order. */
  number: number;
}

export interface MaintenanceRouteDetail extends MaintenanceRoute {
  /** In the owner's saved order. */
  stops: MaintenanceStopDetail[];
  crewIds: string[];
  crew: PersonSummary[];
  lead?: PersonSummary;
  completedCount: number;
  /** Stops still to do (pending or arrived). */
  remainingCount: number;
  /** First stop not yet finished, in order. */
  nextStop?: MaintenanceStopDetail;
}

// ── Due / overdue ───────────────────────────────────────────────────────────

/**
 *  overdue         past its due date (or past its window)
 *  due             due today or within the look-ahead
 *  upcoming        not due yet
 *  done_for_season seasonal quantity reached, or the window service is done
 *  not_configured  not enough schedule or history to say
 *  not_scheduled   as-needed service
 *  out_of_season   outside the contract's season
 *  inactive        contract or service turned off
 */
export type DueStatus =
  | 'overdue'
  | 'due'
  | 'upcoming'
  | 'done_for_season'
  | 'not_configured'
  | 'not_scheduled'
  | 'out_of_season'
  | 'inactive';

export interface ServiceDueInfo {
  rule: MaintenanceServiceRule;
  status: DueStatus;
  /** Last done: from history, else the owner's "last completed" date. */
  lastServiceDate?: string;
  dueDate?: string;
  /** Positive when overdue. */
  daysOverdue?: number;
  /** Includes priorCompletedCount. */
  completedCount: number;
  /** When there's a seasonal quantity. */
  remainingCount?: number;
  /** Is this service already on a route that isn't finished? */
  scheduledOn?: string;
}

export interface PropertyDueInfo {
  property: MaintenanceProperty;
  contract?: MaintenanceContract;
  services: ServiceDueInfo[];
  /** The most urgent status across its services. */
  status: DueStatus;
  /** Highest days overdue across its services. */
  daysOverdue?: number;
  lastServiceDate?: string;
}
