/**
 * App data store.
 *
 * One in-memory copy of the signed-in company's data, shaped exactly like the
 * old mock fixtures (src/data/mock.ts) so screens and hooks keep working with
 * the same objects. Data comes from Supabase (or from the mock fixtures in
 * demo mode, when no Supabase project is configured).
 *
 *  • `db` holds the shaped collections hooks read from.
 *  • `useDb()` subscribes a component to changes (returns a version number to
 *    use as a memo dependency).
 *  • `insertRow` / `updateRow` / `deleteRow` change the local copy right away
 *    and save to Supabase in the background. If a save fails, the table is
 *    re-fetched from the server and the user sees an alert.
 *  • Supabase Realtime pushes other people's changes in as they happen, so the
 *    owner sees a worker check in without refreshing.
 */

import { useSyncExternalStore } from 'react';
import { properName } from '@/lib/names';
import { Alert, AppState, Platform } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { sweepStorageSoon } from '@/lib/storageSweep';
import { uuid } from '@/lib/ids';
import type { Company, CompanyMember, PersonSummary } from '@/types/company';
import type {
  Project, ProjectTask, ProjectTeamMember, ProjectSettings, ProjectPhoto, ProjectUpdate,
  ProjectRequest, ProjectHistoryEntry, CustomerTimelineEvent, ProjectMessage, TaskAttachment,
} from '@/types/project';
import type { Assignment, ScheduleChange, ScheduleSeries } from '@/types/schedule';
import type { Truck } from '@/types/truck';
import type { Crew } from '@/types/crew';
import type { Announcement, AnnouncementRead } from '@/types/announcement';
import type { CheckIn, CheckOut, WorkerActivity, WorkerSettings } from '@/types/worker';
import type {
  WorkSession, WorkerHourlyRate, WorkerPaySettings, OvertimeRule, CompanyOperationsSettings,
  NotificationPreference, AppNotification, WorkerReminder,
} from '@/types/operations';
import type { Quote, ChangeOrder, Invoice, FinancialEvent, LineItem, FinancialSettings } from '@/types/financial';
import type { MaterialVendor, ProjectMaterial, MaterialPlan } from '@/types/materials';
import type {
  MembershipAuditEvent,
  CompanyMembership,
} from '@/types/onboarding';

// ── Table definitions ───────────────────────────────────────────────────────

type Scope = 'company' | 'company_self' | 'all' | 'me';

interface TableDef {
  /** camelCase columns that exist in the database (anything else is derived). */
  cols: string[];
  pk?: string;
  scope: Scope;
}

const TABLES = {
  companies: { scope: 'company_self', cols: ['id', 'name', 'logoUrl', 'phone', 'email', 'address', 'city', 'state', 'zip', 'yardAddress', 'yardCity', 'yardState', 'yardZip', 'yardLatitude', 'yardLongitude', 'coverPhotoUrl', 'workerCoverPhotoUrl', 'storageLimitGb', 'maxFileSizeMb', 'taskLeadOnly', 'targetPayEnabled', 'setupState', 'setupCompletedAt', 'createdAt', 'updatedAt'] },
  people: { scope: 'all', cols: ['id', 'userId', 'email', 'firstName', 'lastName', 'avatarUrl', 'phone', 'createdAt', 'updatedAt'] },
  company_members: { scope: 'company', cols: ['id', 'companyId', 'personId', 'role', 'status', 'joinMethod', 'joinRequestId', 'approvedBy', 'approvedAt', 'deactivatedAt', 'deactivatedBy', 'createdAt', 'updatedAt'] },
  projects: { scope: 'company', cols: ['id', 'companyId', 'customerId', 'propertyId', 'name', 'taskLeadId', 'address', 'city', 'state', 'zip', 'latitude', 'longitude', 'status', 'progress', 'startDate', 'estimatedEndDate', 'completedAt', 'notes', 'coverPhotoUrl', 'customerClaimedBy', 'customerClaimedAt', 'createdAt', 'updatedAt'] },
  project_team: { scope: 'company', cols: ['id', 'companyId', 'projectId', 'personId', 'addedAt', 'removedAt'] },
  project_tasks: { scope: 'company', cols: ['id', 'companyId', 'projectId', 'title', 'description', 'status', 'sortOrder', 'assignedTo', 'completedAt', 'completedBy', 'createdAt', 'updatedAt'] },
  project_settings: { scope: 'company', cols: ['id', 'companyId', 'projectId', 'customerInteractionEnabled', 'completionPhotoRequired', 'checkinRadiusMeters', 'customerCanRequest', 'customerCanViewPhotos', 'customerCanComment', 'autoProgress', 'createdAt', 'updatedAt'] },
  project_photos: { scope: 'company', cols: ['id', 'companyId', 'projectId', 'taskId', 'assignmentId', 'uploadedBy', 'fileKey', 'fileUrl', 'caption', 'customerDescription', 'isCustomerVisible', 'sharedBy', 'sharedAt', 'photoType', 'timePhase', 'takenAt', 'createdAt'] },
  project_updates: { scope: 'company', cols: ['id', 'companyId', 'projectId', 'createdBy', 'title', 'body', 'isCustomerVisible', 'photoIds', 'createdAt', 'updatedAt'] },
  project_messages: { scope: 'company', cols: ['id', 'companyId', 'projectId', 'senderId', 'body', 'createdAt'] },
  project_requests: { scope: 'company', cols: ['id', 'companyId', 'projectId', 'requestedBy', 'title', 'description', 'category', 'attachmentUrl', 'status', 'linkedTaskId', 'respondedAt', 'responseNote', 'createdAt', 'updatedAt'] },
  project_history: { scope: 'company', cols: ['id', 'companyId', 'projectId', 'actorId', 'eventType', 'description', 'metadata', 'createdAt'] },
  customer_timeline: { scope: 'company', cols: ['id', 'companyId', 'projectId', 'eventType', 'title', 'description', 'photoUrl', 'timestamp'] },
  truck_documents: { scope: 'company', cols: ['id', 'companyId', 'truckId', 'kind', 'title', 'fileUrl', 'fileKey', 'contentType', 'sizeBytes', 'expiresOn', 'createdBy', 'createdAt', 'updatedAt'] },
  truck_notes: { scope: 'company', cols: ['id', 'companyId', 'truckId', 'body', 'createdBy', 'createdAt', 'updatedAt'] },
  truck_maintenance: { scope: 'company', cols: ['id', 'companyId', 'truckId', 'title', 'servicedOn', 'dueOn', 'notes', 'createdBy', 'createdAt', 'updatedAt'] },
  owner_project_notes: { scope: 'company', cols: ['id', 'companyId', 'projectId', 'body', 'createdBy', 'createdAt', 'updatedAt'] },
  owner_project_photos: { scope: 'company', cols: ['id', 'companyId', 'projectId', 'fileUrl', 'fileKey', 'caption', 'createdBy', 'createdAt', 'updatedAt'] },
  owner_material_lists: { scope: 'company', cols: ['id', 'companyId', 'projectId', 'title', 'items', 'sourceText', 'createdBy', 'createdAt', 'updatedAt'] },
  trucks: { scope: 'company', cols: ['id', 'companyId', 'name', 'make', 'model', 'year', 'licensePlate', 'vin', 'color', 'photoUrl', 'status', 'notes', 'assignedTo', 'createdAt', 'updatedAt'] },
  assignments: { scope: 'company', cols: ['id', 'companyId', 'projectId', 'personId', 'scheduledDate', 'startTime', 'endTime', 'isFullDay', 'sortOrder', 'status', 'confirmationState', 'truckId', 'notes', 'cancelledAt', 'cancelledBy', 'cancellationReason', 'reassignedFrom', 'reassignedTo', 'seriesId', 'createdAt', 'updatedAt'] },
  // Repeating schedules (supabase/updates/012). Their days are filled in as
  // assignments by extend_schedule_series().
  // Crews (supabase/updates/014). A worker is in at most one crew.
  crews: { scope: 'company', cols: ['id', 'companyId', 'name', 'color', 'createdAt', 'updatedAt'] },
  crew_members: { scope: 'company', cols: ['id', 'companyId', 'crewId', 'personId', 'createdAt'] },
  schedule_series: { scope: 'company', cols: ['id', 'companyId', 'projectId', 'personId', 'frequency', 'intervalDays', 'horizonDays', 'startDate', 'endDate', 'startTime', 'endTime', 'isFullDay', 'truckId', 'notes', 'createdBy', 'stoppedAt', 'createdAt', 'updatedAt'] },
  schedule_changes: { scope: 'company', cols: ['id', 'companyId', 'assignmentId', 'changedBy', 'changeType', 'previousValue', 'newValue', 'notes', 'createdAt'] },
  announcements: { scope: 'company', cols: ['id', 'companyId', 'createdBy', 'title', 'body', 'audience', 'priority', 'weatherAction', 'recipientIds', 'expiresAt', 'createdAt', 'updatedAt'] },
  announcement_reads: { scope: 'company', cols: ['id', 'companyId', 'announcementId', 'personId', 'readAt'] },
  check_ins: { scope: 'company', cols: ['id', 'companyId', 'assignmentId', 'personId', 'projectId', 'timestamp', 'gps', 'withinRadius', 'createdAt'] },
  check_outs: { scope: 'company', cols: ['id', 'companyId', 'assignmentId', 'personId', 'projectId', 'timestamp', 'gps', 'createdAt'] },
  worker_activities: { scope: 'company', cols: ['id', 'companyId', 'personId', 'assignmentId', 'projectId', 'activityType', 'description', 'metadata', 'timestamp'] },
  work_sessions: { scope: 'company', cols: ['id', 'companyId', 'personId', 'projectId', 'assignmentId', 'checkInTime', 'checkOutTime', 'durationMinutes', 'checkInGps', 'checkOutGps', 'offlineCheckIn', 'offlineCheckOut', 'syncedCheckInAt', 'syncedCheckOutAt', 'status', 'correction', 'createdAt', 'updatedAt'] },
  worker_hourly_rates: { scope: 'company', cols: ['id', 'companyId', 'personId', 'hourlyRate', 'effectiveDate', 'endDate', 'setBy', 'createdAt'] },
  worker_pay_settings: { scope: 'company', pk: 'personId', cols: ['personId', 'companyId', 'overtimeEnabled', 'overtimeAfterHours', 'overtimeMultiplier', 'targetHourlyRate', 'updatedAt'] },
  overtime_rules: { scope: 'company', cols: ['id', 'companyId', 'ruleType', 'weeklyThresholdHours', 'dailyThresholdHours', 'overtimeMultiplier', 'isActive', 'createdAt', 'updatedAt'] },
  company_operations_settings: { scope: 'company', cols: ['id', 'companyId', 'missingCheckinGraceMinutes', 'lateCheckinThresholdMinutes', 'pastEndAlertEnabled', 'overtimeRuleId', 'createdAt', 'updatedAt'] },
  notification_preferences: { scope: 'company', cols: ['id', 'companyId', 'personId', 'eventType', 'enabled', 'createdAt', 'updatedAt'] },
  app_notifications: { scope: 'company', cols: ['id', 'companyId', 'recipientId', 'eventType', 'title', 'body', 'status', 'linkedEntityType', 'linkedEntityId', 'metadata', 'createdAt', 'readAt'] },
  worker_reminders: { scope: 'company', cols: ['id', 'companyId', 'personId', 'assignmentId', 'reminderType', 'title', 'body', 'nextAssignment', 'actions', 'createdAt', 'readAt'] },
  worker_settings: { scope: 'me', pk: 'personId', cols: ['personId', 'navApp', 'notificationsEnabled', 'updatedAt'] },
  membership_audit_log: { scope: 'company', cols: ['id', 'companyId', 'eventType', 'actorId', 'targetId', 'metadata', 'createdAt'] },
  // Company Resources. hasSecret/createdBy/updatedBy are set by the database
  // only, so they aren't listed as writable columns. Codes never come through
  // here — see reveal_resource_secret() in supabase/updates/006.
  company_resources: { scope: 'company', cols: ['id', 'companyId', 'category', 'name', 'description', 'truckId', 'itemName', 'cardLastFour', 'cardHolderId', 'createdAt', 'updatedAt'] },
  resource_access: { scope: 'company', cols: ['id', 'companyId', 'resourceId', 'personId', 'createdAt'] },
  resource_audit_log: { scope: 'company', cols: ['id', 'companyId', 'resourceId', 'resourceName', 'actorId', 'eventType', 'targetPersonId', 'metadata', 'createdAt'] },
  quotes: { scope: 'company', cols: ['id', 'companyId', 'projectId', 'customerId', 'number', 'title', 'status', 'lineItems', 'taxRate', 'subtotal', 'taxAmount', 'total', 'notes', 'exclusions', 'terms', 'issueDate', 'validUntil', 'snapshot', 'sentAt', 'approvedAt', 'approvedBy', 'approvedName', 'approvedSignature', 'shareToken', 'declinedAt', 'declinedBy', 'declineReason', 'createdBy', 'createdAt', 'updatedAt'] },
  change_orders: { scope: 'company', cols: ['id', 'companyId', 'projectId', 'quoteId', 'customerId', 'number', 'title', 'description', 'status', 'lineItems', 'taxRate', 'subtotal', 'taxAmount', 'total', 'notes', 'terms', 'issueDate', 'snapshot', 'sentAt', 'approvedAt', 'approvedBy', 'approvedName', 'approvedSignature', 'shareToken', 'declinedAt', 'declinedBy', 'declineReason', 'createdBy', 'createdAt', 'updatedAt'] },
  invoices: { scope: 'company', cols: ['id', 'companyId', 'projectId', 'quoteId', 'changeOrderIds', 'customerId', 'number', 'title', 'status', 'lineItems', 'taxRate', 'subtotal', 'taxAmount', 'total', 'notes', 'paymentInstructions', 'invoiceDate', 'dueDate', 'snapshot', 'shareToken', 'issuedAt', 'voidedAt', 'voidReason', 'createdBy', 'createdAt', 'updatedAt'] },
  financial_events: { scope: 'company', cols: ['id', 'companyId', 'projectId', 'documentType', 'documentId', 'eventType', 'actorId', 'note', 'metadata', 'createdAt'] },
  // Update 015: document defaults and materials preparation (owner/admin only).
  financial_settings: { scope: 'company', pk: 'companyId', cols: ['companyId', 'defaultTaxRate', 'defaultTerms', 'defaultExclusions', 'defaultPaymentInstructions', 'defaultInvoiceNotes', 'updatedAt'] },
  material_vendors: { scope: 'company', cols: ['id', 'companyId', 'name', 'contactName', 'phone', 'email', 'address', 'pickupInstructions', 'notes', 'createdAt', 'updatedAt'] },
  // Update 017: photos/videos the owner attaches to a task.
  task_attachments: { scope: 'company', cols: ['id', 'companyId', 'projectId', 'taskId', 'mediaType', 'fileUrl', 'fileKey', 'sizeBytes', 'createdBy', 'createdAt'] },
  project_materials: { scope: 'company', cols: ['id', 'companyId', 'projectId', 'name', 'quantity', 'unit', 'status', 'vendorId', 'notes', 'source', 'sortOrder', 'createdBy', 'createdAt', 'updatedAt'] },
  project_material_plans: { scope: 'company', pk: 'projectId', cols: ['projectId', 'companyId', 'vendorId', 'pickupLocation', 'pickupInstructions', 'handlingNotes', 'reminderAt', 'reminderJobDate', 'reminderNote', 'dismissedSources', 'updatedAt'] },
  // Job sites (customer properties).
  properties: { scope: 'company', cols: ['id', 'companyId', 'customerId', 'name', 'address', 'city', 'state', 'zip', 'latitude', 'longitude', 'notes', 'addressKey', 'isActive', 'createdBy', 'createdAt', 'updatedAt'] },
  property_issues: { scope: 'company', cols: ['id', 'companyId', 'reportedBy', 'issueType', 'notes', 'photos', 'projectId', 'placeName', 'status', 'resolvedBy', 'resolvedAt', 'resolutionNote', 'createdAt', 'updatedAt'] },
} satisfies Record<string, TableDef>;

export type TableName = keyof typeof TABLES;
type Row = Record<string, any>;

const TABLE_NAMES = Object.keys(TABLES) as TableName[];

function pkOf(table: TableName): string {
  return (TABLES[table] as TableDef).pk ?? 'id';
}

// ── snake_case ⇄ camelCase ──────────────────────────────────────────────────

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function camel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function snake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** Database row → app object. NULL becomes undefined (the app's optional
 * fields), and timestamps are normalised to one ISO format so string sorting
 * stays correct. */
function fromDb(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null) continue;
    out[camel(k)] = typeof v === 'string' && ISO_TIMESTAMP.test(v) ? new Date(v).toISOString() : v;
  }
  return out;
}

/** App object → database row, keeping only real columns. */
function toDb(table: TableName, obj: Row): Row {
  const out: Row = {};
  for (const col of TABLES[table].cols as string[]) {
    if (col in obj) out[snake(col)] = obj[col] === undefined ? null : obj[col];
  }
  return out;
}

// ── Raw state ───────────────────────────────────────────────────────────────

export type SessionRole = 'owner' | 'admin' | 'worker' | 'customer';

interface Session {
  companyId: string;
  personId: string;
  role: SessionRole;
}

const raw: Record<TableName, Row[]> = Object.fromEntries(TABLE_NAMES.map((t) => [t, []])) as unknown as Record<TableName, Row[]>;
let session: Session | null = null;
let demoMode = !isSupabaseConfigured;

// ── Shaped data (what hooks read) ───────────────────────────────────────────

export interface Db {
  ready: boolean;
  demo: boolean;
  companyId: string;
  personId: string;
  role: SessionRole | null;
  company: Company | null;
  people: Record<string, PersonSummary>;
  members: CompanyMember[];
  memberships: CompanyMembership[];
  projects: Project[];
  tasks: Record<string, ProjectTask[]>;
  team: Record<string, ProjectTeamMember[]>;
  settings: Record<string, ProjectSettings>;
  photos: Record<string, ProjectPhoto[]>;
  /** Owner's instruction photos/videos per task, oldest first. */
  taskAttachments: Record<string, TaskAttachment[]>;
  updates: Record<string, ProjectUpdate[]>;
  requests: Record<string, ProjectRequest[]>;
  /** Customer ↔ owner messages per project, oldest first. */
  messages: Record<string, ProjectMessage[]>;
  history: Record<string, ProjectHistoryEntry[]>;
  customerTimeline: Record<string, CustomerTimelineEvent[]>;
  trucks: Truck[];
  assignments: Assignment[];
  scheduleSeries: ScheduleSeries[];
  crews: Crew[];
  /** Each worker's crew, by person id. */
  /** Every crew a person is in (a worker can be in several). */
  crewsByPerson: Record<string, Crew[]>;
  scheduleChanges: ScheduleChange[];
  announcements: Announcement[];
  announcementReads: AnnouncementRead[];
  checkIns: CheckIn[];
  checkOuts: CheckOut[];
  workerActivities: WorkerActivity[];
  workSessions: WorkSession[];
  hourlyRates: WorkerHourlyRate[];
  /** Keyed by personId. */
  paySettings: Record<string, WorkerPaySettings>;
  overtimeRule: OvertimeRule;
  operationsSettings: CompanyOperationsSettings;
  notificationPreferences: NotificationPreference[];
  notifications: AppNotification[];
  workerReminders: WorkerReminder[];
  workerSettings: WorkerSettings;
  auditEvents: MembershipAuditEvent[];
  /** Newest first. Customers only receive sent/issued ones (database rules). */
  quotes: Quote[];
  changeOrders: ChangeOrder[];
  invoices: Invoice[];
  /** Oldest first. */
  financialEvents: FinancialEvent[];
  financialSettings: FinancialSettings | null;
  vendors: MaterialVendor[];
  /** Per project, in checklist order. */
  materials: Record<string, ProjectMaterial[]>;
  materialPlans: Record<string, MaterialPlan>;
}

const DEFAULT_OVERTIME: OvertimeRule = {
  id: '', companyId: '', ruleType: 'weekly_40', weeklyThresholdHours: 40,
  overtimeMultiplier: 1.5, isActive: true, createdAt: '', updatedAt: '',
};
const DEFAULT_OPS: CompanyOperationsSettings = {
  id: '', companyId: '', missingCheckinGraceMinutes: 10, lateCheckinThresholdMinutes: 0,
  pastEndAlertEnabled: true, createdAt: '', updatedAt: '',
};
const DEFAULT_WORKER_SETTINGS: WorkerSettings = { navApp: 'default', notificationsEnabled: true };

export const db: Db = {
  ready: false,
  demo: demoMode,
  companyId: '',
  personId: '',
  role: null,
  company: null,
  people: {},
  members: [],
  memberships: [],
  projects: [],
  tasks: {},
  team: {},
  settings: {},
  photos: {},
  taskAttachments: {},
  updates: {},
  requests: {},
  messages: {},
  history: {},
  customerTimeline: {},
  trucks: [],
  assignments: [],
  scheduleSeries: [],
  crews: [],
  crewsByPerson: {},
  scheduleChanges: [],
  announcements: [],
  announcementReads: [],
  checkIns: [],
  checkOuts: [],
  workerActivities: [],
  workSessions: [],
  hourlyRates: [],
  paySettings: {},
  overtimeRule: DEFAULT_OVERTIME,
  operationsSettings: DEFAULT_OPS,
  notificationPreferences: [],
  notifications: [],
  workerReminders: [],
  workerSettings: DEFAULT_WORKER_SETTINGS,
  auditEvents: [],
  quotes: [],
  changeOrders: [],
  invoices: [],
  financialEvents: [],
  financialSettings: null,
  vendors: [],
  materials: {},
  materialPlans: {},
};

function groupBy<T extends Row>(rows: T[], key: string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows) {
    const k = r[key];
    if (!k) continue;
    (out[k] ??= []).push(r);
  }
  return out;
}

const byCreated = (a: Row, b: Row) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));

function personSummary(p: Row): PersonSummary {
  return {
    id: p.id,
    firstName: properName(p.firstName ?? ''),
    lastName: properName(p.lastName ?? ''),
    email: p.email ?? '',
    phone: p.phone,
    avatarUrl: p.avatarUrl,
  };
}

/** Rebuilds every shaped collection (with joined people/projects/trucks) from raw rows. */
function derive() {
  const people: Record<string, PersonSummary> = {};
  for (const p of raw.people) people[p.id] = personSummary(p);
  const person = (id?: string) => (id ? people[id] : undefined);

  const companyRow = raw.companies.find((c) => c.id === db.companyId) ?? raw.companies[0];
  db.company = (companyRow as Company) ?? null;
  db.people = people;

  db.members = raw.company_members
    .slice()
    .sort(byCreated)
    .map((m) => ({ ...m, person: person(m.personId) }) as CompanyMember);

  db.memberships = db.members.map((m) => ({
    id: m.id,
    companyId: m.companyId,
    personId: m.personId,
    role: m.role,
    status: m.status === 'invited' ? 'active' : m.status,
    joinMethod: ((m as Row).joinMethod ?? 'company_creator') as CompanyMembership['joinMethod'],
    joinRequestId: (m as Row).joinRequestId,
    approvedBy: (m as Row).approvedBy,
    approvedAt: (m as Row).approvedAt,
    deactivatedAt: (m as Row).deactivatedAt,
    deactivatedBy: (m as Row).deactivatedBy,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    person: m.person ? { ...m.person, profilePhotoUrl: m.person.avatarUrl } : undefined,
  }) as CompanyMembership);

  // Project children
  const tasks = groupBy(raw.project_tasks.map((t): Row => ({ ...t, assignee: person(t.assignedTo), completer: person(t.completedBy) })), 'projectId');
  for (const k of Object.keys(tasks)) tasks[k].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || byCreated(a, b));
  const team = groupBy(
    raw.project_team.filter((t) => !t.removedAt).map((t) => ({ ...t, person: person(t.personId) })),
    'projectId',
  );
  const settings: Record<string, ProjectSettings> = {};
  for (const s of raw.project_settings) settings[s.projectId] = s as ProjectSettings;

  const taskTitles: Record<string, string> = {};
  for (const t of raw.project_tasks) taskTitles[t.id] = t.title;
  const photos = groupBy(
    raw.project_photos.map((p) => ({ ...p, uploader: person(p.uploadedBy), sharer: person(p.sharedBy), taskTitle: p.taskId ? taskTitles[p.taskId] : undefined })),
    'projectId',
  );
  for (const k of Object.keys(photos)) photos[k].sort((a, b) => byCreated(b, a));

  db.tasks = tasks as Record<string, ProjectTask[]>;
  db.team = team as Record<string, ProjectTeamMember[]>;
  db.settings = settings;
  db.photos = photos as Record<string, ProjectPhoto[]>;
  const taskAttachments = groupBy(raw.task_attachments.map((a) => ({ ...a, sizeBytes: a.sizeBytes != null ? Number(a.sizeBytes) : undefined })), 'taskId');
  for (const k of Object.keys(taskAttachments)) taskAttachments[k].sort((a, b) => byCreated(a, b));
  db.taskAttachments = taskAttachments as Record<string, TaskAttachment[]>;
  db.updates = groupBy(raw.project_updates.map((u) => ({ ...u, author: person(u.createdBy) })), 'projectId') as Record<string, ProjectUpdate[]>;
  db.requests = groupBy(raw.project_requests.map((r) => ({ ...r, requester: person(r.requestedBy) })), 'projectId') as Record<string, ProjectRequest[]>;
  db.messages = groupBy(
    raw.project_messages
      .slice()
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .map((m) => ({ ...m, sender: person(m.senderId) })),
    'projectId',
  ) as Record<string, ProjectMessage[]>;
  db.history = groupBy(raw.project_history.map((h) => ({ ...h, actor: person(h.actorId) })), 'projectId') as Record<string, ProjectHistoryEntry[]>;
  db.customerTimeline = groupBy(raw.customer_timeline, 'projectId') as Record<string, CustomerTimelineEvent[]>;

  db.projects = raw.projects
    .slice()
    .sort((a, b) => byCreated(b, a))
    .map((p) => {
      const pt = tasks[p.id] ?? [];
      return {
        ...p,
        name: properName(p.name),
        progress: p.progress ?? 0,
        customer: person(p.customerId),
        teamCount: (team[p.id] ?? []).length,
        taskCount: pt.length,
        openTaskCount: pt.filter((t) => t.status !== 'completed').length,
      } as Project;
    });

  const projectRef: Record<string, { id: string; name: string; address?: string }> = {};
  for (const p of raw.projects) projectRef[p.id] = { id: p.id, name: p.name, address: p.address };

  db.trucks = raw.trucks
    .slice()
    .sort(byCreated)
    .map((t) => {
      const a = person(t.assignedTo);
      return { ...t, assigneeName: a ? `${a.firstName} ${a.lastName}`.trim() : undefined } as Truck;
    });
  const truckRef: Record<string, { id: string; name: string }> = {};
  for (const t of raw.trucks) truckRef[t.id] = { id: t.id, name: t.name };

  db.assignments = raw.assignments
    .slice()
    .sort(byCreated)
    .map((a) => ({
      ...a,
      person: person(a.personId),
      project: projectRef[a.projectId],
      truck: a.truckId ? truckRef[a.truckId] : undefined,
    }) as Assignment);

  const crewMemberIds = groupBy(raw.crew_members, 'crewId');
  db.crews = raw.crews
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((c) => ({ ...c, memberIds: (crewMemberIds[c.id] ?? []).map((m) => m.personId) }) as Crew);
  db.crewsByPerson = {};
  for (const c of db.crews) for (const pid of c.memberIds) (db.crewsByPerson[pid] ??= []).push(c);

  db.scheduleSeries = raw.schedule_series.slice().sort(byCreated) as ScheduleSeries[];

  db.scheduleChanges = raw.schedule_changes
    .slice()
    .sort((a, b) => byCreated(b, a))
    .map((c) => ({ ...c, changer: person(c.changedBy) }) as ScheduleChange);

  const activeWorkerCount = raw.company_members.filter((m) => m.role === 'worker' && m.status === 'active').length;
  const readCounts: Record<string, number> = {};
  for (const r of raw.announcement_reads) readCounts[r.announcementId] = (readCounts[r.announcementId] ?? 0) + 1;
  db.announcements = raw.announcements
    .slice()
    .sort((a, b) => byCreated(b, a))
    .map((a) => ({
      ...a,
      author: person(a.createdBy),
      readCount: readCounts[a.id] ?? 0,
      totalRecipients: Array.isArray(a.recipientIds) && a.recipientIds.length > 0 ? a.recipientIds.length : activeWorkerCount,
    }) as Announcement);
  db.announcementReads = raw.announcement_reads as AnnouncementRead[];

  db.checkIns = raw.check_ins.slice().sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))) as CheckIn[];
  db.checkOuts = raw.check_outs.slice().sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))) as CheckOut[];
  db.workerActivities = raw.worker_activities
    .slice()
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .map((w) => ({ ...w, project: w.projectId && projectRef[w.projectId] ? { id: w.projectId, name: projectRef[w.projectId].name } : undefined }) as WorkerActivity);
  db.workSessions = raw.work_sessions
    .slice()
    .sort((a, b) => String(a.checkInTime).localeCompare(String(b.checkInTime)))
    .map((s) => ({
      ...s,
      durationMinutes: s.durationMinutes != null ? Number(s.durationMinutes) : undefined,
      worker: person(s.personId),
      project: s.projectId ? projectRef[s.projectId] : undefined,
    }) as WorkSession);
  db.hourlyRates = raw.worker_hourly_rates.map((r) => ({ ...r, hourlyRate: Number(r.hourlyRate), worker: person(r.personId) }) as WorkerHourlyRate);

  db.paySettings = {};
  for (const p of raw.worker_pay_settings) {
    db.paySettings[p.personId] = {
      ...p,
      overtimeEnabled: p.overtimeEnabled !== false,
      overtimeAfterHours: Number(p.overtimeAfterHours ?? 40),
      overtimeMultiplier: Number(p.overtimeMultiplier ?? 1.5),
      targetHourlyRate: p.targetHourlyRate != null ? Number(p.targetHourlyRate) : undefined,
    } as WorkerPaySettings;
  }

  const ot = raw.overtime_rules[0];
  db.overtimeRule = ot
    ? ({
        ...ot,
        weeklyThresholdHours: ot.weeklyThresholdHours != null ? Number(ot.weeklyThresholdHours) : undefined,
        dailyThresholdHours: ot.dailyThresholdHours != null ? Number(ot.dailyThresholdHours) : undefined,
        overtimeMultiplier: Number(ot.overtimeMultiplier ?? 1.5),
      } as OvertimeRule)
    : DEFAULT_OVERTIME;
  db.operationsSettings = (raw.company_operations_settings[0] as CompanyOperationsSettings) ?? DEFAULT_OPS;
  db.notificationPreferences = raw.notification_preferences as NotificationPreference[];
  db.notifications = raw.app_notifications
    .filter((n) => !db.personId || n.recipientId === db.personId)
    .sort((a, b) => byCreated(b, a)) as AppNotification[];
  db.workerReminders = raw.worker_reminders as WorkerReminder[];
  const ws = raw.worker_settings.find((s) => s.personId === db.personId);
  db.workerSettings = ws ? { navApp: ws.navApp ?? 'default', notificationsEnabled: ws.notificationsEnabled ?? true } : DEFAULT_WORKER_SETTINGS;

  db.auditEvents = raw.membership_audit_log.slice().sort((a, b) => byCreated(b, a)) as MembershipAuditEvent[];

  // Quotes, change orders, invoices. Postgres numerics can arrive as strings.
  const projectNames: Record<string, string> = {};
  for (const p of raw.projects) projectNames[p.id] = p.name;
  const money = (d: Row): Row => ({
    ...d,
    lineItems: (Array.isArray(d.lineItems) ? d.lineItems : []).map((li: Row): LineItem => ({
      ...(li as LineItem),
      quantity: Number(li.quantity) || 0,
      unitPrice: Number(li.unitPrice) || 0,
      amount: Number(li.amount) || 0,
    })),
    taxRate: Number(d.taxRate ?? 0),
    subtotal: Number(d.subtotal ?? 0),
    taxAmount: Number(d.taxAmount ?? 0),
    total: Number(d.total ?? 0),
    customer: person(d.customerId),
    projectName: projectNames[d.projectId],
  });
  db.quotes = raw.quotes.slice().sort((a, b) => byCreated(b, a)).map(money) as Quote[];
  db.changeOrders = raw.change_orders.slice().sort((a, b) => byCreated(b, a)).map(money) as ChangeOrder[];
  db.invoices = raw.invoices
    .slice()
    .sort((a, b) => byCreated(b, a))
    .map((i) => ({ ...money(i), changeOrderIds: Array.isArray(i.changeOrderIds) ? i.changeOrderIds : [] })) as Invoice[];
  db.financialEvents = raw.financial_events
    .slice()
    .sort(byCreated)
    .map((e) => ({ ...e, actor: person(e.actorId) })) as FinancialEvent[];

  const fs = raw.financial_settings[0];
  db.financialSettings = fs
    ? ({ ...fs, defaultTaxRate: fs.defaultTaxRate != null ? Number(fs.defaultTaxRate) : undefined } as FinancialSettings)
    : null;
  db.vendors = raw.material_vendors
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name))) as MaterialVendor[];
  const mats = groupBy(
    raw.project_materials.map((m) => ({ ...m, quantity: m.quantity != null ? Number(m.quantity) : undefined, sortOrder: m.sortOrder ?? 0 })),
    'projectId',
  );
  for (const k of Object.keys(mats)) mats[k].sort((a, b) => a.sortOrder - b.sortOrder || byCreated(a, b));
  db.materials = mats as Record<string, ProjectMaterial[]>;
  const plans: Record<string, MaterialPlan> = {};
  for (const p of raw.project_material_plans) {
    plans[p.projectId] = { ...p, dismissedSources: Array.isArray(p.dismissedSources) ? p.dismissedSources : [] } as MaterialPlan;
  }
  db.materialPlans = plans;

}

// ── Subscription ────────────────────────────────────────────────────────────

let version = 0;
const listeners = new Set<() => void>();
let notifyScheduled = false;

function emitChange() {
  if (notifyScheduled) return;
  notifyScheduled = true;
  Promise.resolve().then(() => {
    notifyScheduled = false;
    derive();
    version++;
    for (const l of listeners) l();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getVersion() {
  return version;
}

/** Re-renders the calling component whenever store data changes. Returns a
 * version number to include in useMemo/useCallback dependency lists. */
export function useDb(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}

// ── Errors ──────────────────────────────────────────────────────────────────

let lastAlertAt = 0;

function reportError(action: string, error: { message?: string } | null | undefined) {
  const message = error?.message ?? 'Unknown error';
  console.warn(`[store] ${action} failed:`, message);
  const now = Date.now();
  if (now - lastAlertAt < 4000) return;
  lastAlertAt = now;
  const text = `${action} didn't save. ${message}`;
  if (Platform.OS === 'web') {
    (globalThis as { alert?: (m: string) => void }).alert?.(text);
  } else {
    Alert.alert("Couldn't save", text);
  }
}

// ── Loading ─────────────────────────────────────────────────────────────────

const loadErrors: Partial<Record<TableName, string>> = {};

/** The last load error for a table, if its most recent fetch failed. */
export function loadErrorOf(table: TableName): string | undefined {
  return loadErrors[table];
}

async function fetchTable(table: TableName): Promise<Row[] | null> {
  if (!session) return [];
  const def = TABLES[table] as TableDef;
  let q = supabase.from(table).select('*');
  if (def.scope === 'company') q = q.eq('company_id', session.companyId);
  else if (def.scope === 'company_self') q = q.eq('id', session.companyId);
  else if (def.scope === 'me') q = q.eq('person_id', session.personId);
  const { data, error } = await q.limit(5000);
  if (error) {
    console.warn(`[store] load ${table} failed:`, error.message);
    loadErrors[table] = error.message;
    return null;
  }
  delete loadErrors[table];
  return (data ?? []).map(fromDb);
}

async function reloadTable(table: TableName) {
  const rows = await fetchTable(table);
  if (rows) {
    raw[table] = rows;
    emitChange();
  }
}

/** Fetches everything for the signed-in company. */
export async function reloadAll(): Promise<void> {
  if (!session || demoMode) return;
  const results = await Promise.all(TABLE_NAMES.map(fetchTable));
  TABLE_NAMES.forEach((t, i) => {
    const rows = results[i];
    if (rows) raw[t] = rows;
  });
  db.ready = true;
  emitChange();
}

// ── Realtime ────────────────────────────────────────────────────────────────

let channel: RealtimeChannel | null = null;

function applyRealtime(table: TableName, payload: { eventType: string; new: Row; old: Row }) {
  const pk = pkOf(table);
  const pkSnake = snake(pk);
  if (payload.eventType === 'DELETE') {
    const id = payload.old?.[pkSnake];
    if (!id) return;
    raw[table] = raw[table].filter((r) => r[pk] !== id);
  } else {
    const row = fromDb(payload.new ?? {});
    const id = row[pk];
    if (!id) return;
    const idx = raw[table].findIndex((r) => r[pk] === id);
    if (idx >= 0) raw[table] = raw[table].map((r, i) => (i === idx ? row : r));
    else raw[table] = [...raw[table], row];
  }
  emitChange();
  // A worker who was just granted a resource gets the access row live, but
  // the resource row itself didn't change, so fetch the ones now visible.
  if (table === 'resource_access') reloadTable('company_resources');
}

function startRealtime() {
  stopRealtime();
  if (!session || demoMode) return;
  const cid = session.companyId;
  let ch = supabase.channel(`company-${cid}`);
  for (const table of TABLE_NAMES) {
    const def = TABLES[table] as TableDef;
    if (def.scope === 'me') continue;
    const filter = def.scope === 'company' ? `company_id=eq.${cid}` : def.scope === 'company_self' ? `id=eq.${cid}` : undefined;
    ch = ch.on(
      'postgres_changes' as any,
      { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
      (payload: any) => applyRealtime(table, payload),
    );
  }
  channel = ch.subscribe();
}

function stopRealtime() {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
}

// Catch up on anything missed while the app was in the background.
let appStateSub: { remove: () => void } | null = null;
function watchAppState() {
  appStateSub?.remove();
  appStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active' && session && !demoMode) reloadAll();
  });
}

// ── Session lifecycle ───────────────────────────────────────────────────────

/** Called by AuthProvider once we know who is signed in and which company. */
export async function startSession(next: Session): Promise<void> {
  session = next;
  demoMode = false;
  db.demo = false;
  db.companyId = next.companyId;
  db.personId = next.personId;
  db.role = next.role;
  db.ready = false;
  for (const t of TABLE_NAMES) raw[t] = [];
  emitChange();
  await reloadAll();
  startRealtime();
  watchAppState();
  // Resume photos/videos that were still waiting to upload when the app last closed (and show their local previews again).
  try { void (require('@/lib/mediaQueueRuntime') as typeof import('@/lib/mediaQueueRuntime')).startMediaQueue(); } catch { /* the queue also starts on the next pick */ }
}

export function endSession(): void {
  session = null;
  stopRealtime();
  appStateSub?.remove();
  appStateSub = null;
  for (const t of TABLE_NAMES) raw[t] = [];
  db.ready = false;
  db.companyId = '';
  db.personId = '';
  db.role = null;
  emitChange();
}

/** Demo mode (no Supabase configured): load the built-in sample data so the
 * app is explorable exactly as before. Changes stay in memory only. */
export function startDemoSession(personId: string, role: SessionRole): void {
  // Lazy-required so the sample data isn't bundled into the real-mode code path's startup.
  const mock = require('./mock') as typeof import('./mock');
  const ops = require('./mockOperations') as typeof import('./mockOperations');
  const onb = require('./mockOnboarding') as typeof import('./mockOnboarding');
  demoMode = true;
  db.demo = true;
  session = { companyId: mock.mockCompany.id, personId, role };
  db.companyId = mock.mockCompany.id;
  db.personId = personId;
  db.role = role;
  if (!db.ready) {
    raw.companies = [mock.mockCompany];
    raw.people = Object.values(mock.mockPeople);
    raw.company_members = mock.mockMembers.map(({ person, ...m }) => m);
    raw.projects = mock.mockProjects.map(({ customer, teamCount, taskCount, openTaskCount, ...p }) => p);
    raw.project_tasks = Object.values(mock.mockTasks).flat();
    raw.project_team = Object.values(mock.mockTeam).flat();
    raw.project_settings = Object.values(mock.mockSettings);
    raw.project_photos = Object.values(mock.mockProjectPhotos).flat();
    raw.project_updates = Object.values(mock.mockUpdates).flat();
    raw.project_requests = Object.values(mock.mockRequests).flat();
    raw.project_history = Object.values(mock.mockHistory).flat();
    raw.customer_timeline = Object.values(mock.mockCustomerTimeline).flat();
    raw.trucks = mock.mockTrucks.map(({ assigneeName, ...t }) => t);
    raw.assignments = mock.mockAssignments.map(({ person, project, truck, ...a }) => a);
    raw.schedule_changes = mock.mockScheduleChanges.map(({ changer, ...c }) => c);
    raw.announcements = mock.mockAnnouncements.map(({ author, readCount, totalRecipients, ...a }) => a);
    raw.announcement_reads = [...mock.mockAnnouncementReads];
    raw.check_ins = [...mock.mockCheckIns, ...ops.mockExpandedCheckIns];
    raw.check_outs = [...mock.mockCheckOuts];
    raw.worker_activities = mock.mockWorkerActivities.map(({ project, ...w }) => w);
    raw.work_sessions = ops.mockWorkSessions.map(({ worker, project, ...s }) => s);
    raw.worker_hourly_rates = ops.mockHourlyRates.map(({ worker, ...r }) => r);
    raw.worker_pay_settings = ops.mockWorkerPaySettings.map((p) => ({ ...p }));
    raw.overtime_rules = [ops.mockOvertimeRule];
    raw.company_operations_settings = [ops.mockOperationsSettings];
    raw.notification_preferences = [...ops.mockNotificationPreferences];
    raw.app_notifications = [...ops.mockNotifications];
    raw.worker_reminders = [...ops.mockWorkerReminders];
    raw.worker_settings = [{ personId, ...mock.mockWorkerSettings }];
    raw.membership_audit_log = [...onb.mockAuditEvents];
    raw.company_resources = mock.mockResources.map((r) => ({ ...r }));
    raw.resource_access = mock.mockResourceAccess.map((a) => ({ ...a }));
    raw.resource_audit_log = [];
    // A sample crew so the Crews row has something to show.
    raw.crews = [{ id: 'crew-a', companyId: mock.mockCompany.id, name: 'Crew A', color: '#7CB342', createdAt: '2025-03-01T08:00:00Z', updatedAt: '2025-03-01T08:00:00Z' }];
    raw.crew_members = ['worker2', 'worker4'].map((pid) => ({ id: `crew-a-${pid}`, companyId: mock.mockCompany.id, crewId: 'crew-a', personId: pid, createdAt: '2025-03-01T08:00:00Z' }));
    const fin = (require('./mockFinancials') as typeof import('./mockFinancials')).buildMockFinancials(mock.mockProjects);
    raw.quotes = fin.quotes;
    raw.change_orders = fin.changeOrders;
    raw.invoices = fin.invoices;
    raw.financial_events = fin.events;
    raw.financial_settings = [];
    raw.material_vendors = fin.vendors;
    raw.project_materials = fin.materials;
    raw.project_material_plans = fin.materialPlans;
    db.ready = true;
  }
  emitChange();
}

export function getSession(): Session | null {
  return session;
}

// ── Writes ──────────────────────────────────────────────────────────────────

/** Saves run one after another, in the order they were made, so a new
 * project is saved before its settings, tasks, etc. (foreign keys). */
let writeChain: Promise<unknown> = Promise.resolve();
function enqueue(run: () => PromiseLike<{ error: { message?: string } | null }>, onError: (e: { message?: string }) => void) {
  writeChain = writeChain
    .then(() => run())
    .then(({ error }) => { if (error) onError(error); }, (err) => onError(err ?? {}));
}

/** Resolves once every save made so far has finished. */
export function flushWrites(): Promise<void> {
  return writeChain.then(() => undefined);
}

/** Adds a row locally and saves it. Fills id, companyId and timestamps when
 * the table has them and they weren't given. Returns the full row. */
export function insertRow<T extends Row>(table: TableName, values: T, opts: { deferSave?: boolean } = {}): T & Row {
  const cols = TABLES[table].cols as string[];
  const now = new Date().toISOString();
  const row: Row = { ...values };
  if (cols.includes('id') && !row.id) row.id = uuid();
  if (cols.includes('companyId') && !row.companyId) row.companyId = session?.companyId;
  for (const ts of ['createdAt', 'updatedAt']) {
    if (cols.includes(ts) && !row[ts]) row[ts] = now;
  }
  raw[table] = [...raw[table], stripUndefined(row)];
  emitChange();

  if (!demoMode && !opts.deferSave) {
    enqueue(
      () => supabase
        .from(table)
        .insert(toDb(table, row)),
      (e) => { reportError(`Adding to ${label(table)}`, e); reloadTable(table); },
    );
  }
  return row as T & Row;
}

/** Saves a row created with `insertRow(..., { deferSave: true })`, after
 * applying `patch` (e.g. the uploaded photo URL). */
export function saveDeferredRow(table: TableName, id: string, patch: Row = {}): void {
  const pk = pkOf(table);
  raw[table] = raw[table].map((r) => (r[pk] === id ? stripUndefined({ ...r, ...patch }) : r));
  emitChange();
  const row = raw[table].find((r) => r[pk] === id);
  if (demoMode || !row) return;
  enqueue(
    () => supabase
      .from(table)
      .insert(toDb(table, row)),
    (e) => { reportError(`Adding to ${label(table)}`, e); reloadTable(table); },
  );
}

/** Drops a row that was never saved (deferred insert that failed). */
/**
 * Like saveDeferredRow, but WAITS for the database and reports the result, so the media queue can say "uploaded" only once the record is
 * really saved. If the row is not in the local store (the app was restarted since the photo was picked) it is added from `fallback`.
 * Saving the same row twice is fine: "already exists" counts as saved (a retry after a dropped connection must not fail or duplicate).
 */
export async function confirmDeferredRow(table: TableName, id: string, patch: Row, fallback?: Row): Promise<{ ok: true } | { ok: false; error: string }> {
  const pk = pkOf(table);
  let row = raw[table].find((r) => r[pk] === id);
  if (!row && fallback) {
    const cols = TABLES[table].cols as string[];
    const now = new Date().toISOString();
    const base: Row = { ...fallback, [pk]: id };
    if (cols.includes('companyId') && !base.companyId) base.companyId = session?.companyId;
    for (const ts of ['createdAt', 'updatedAt']) if (cols.includes(ts) && !base[ts]) base[ts] = now;
    raw[table] = [...raw[table], stripUndefined(base)];
  }
  raw[table] = raw[table].map((r) => (r[pk] === id ? stripUndefined({ ...r, ...patch }) : r));
  emitChange();
  row = raw[table].find((r) => r[pk] === id);
  if (demoMode) return { ok: true };
  if (!row) return { ok: false, error: 'The photo record is missing.' };
  const { error } = await supabase.from(table).insert(toDb(table, row));
  if (error && (error as { code?: string }).code !== '23505') return { ok: false, error: error.message };
  return { ok: true };
}

export function discardLocalRow(table: TableName, id: string): void {
  const pk = pkOf(table);
  raw[table] = raw[table].filter((r) => r[pk] !== id);
  emitChange();
}

/** Inserts several rows into one table in a single request. */
export function insertRows(table: TableName, rows: Row[]): Row[] {
  if (rows.length === 0) return [];
  const cols = TABLES[table].cols as string[];
  const now = new Date().toISOString();
  const full = rows.map((values) => {
    const row: Row = { ...values };
    if (cols.includes('id') && !row.id) row.id = uuid();
    if (cols.includes('companyId') && !row.companyId) row.companyId = session?.companyId;
    for (const ts of ['createdAt', 'updatedAt']) {
      if (cols.includes(ts) && !row[ts]) row[ts] = now;
    }
    return row;
  });
  raw[table] = [...raw[table], ...full.map(stripUndefined)];
  emitChange();
  if (!demoMode) {
    enqueue(
      () => supabase
        .from(table)
        .insert(full.map((r) => toDb(table, r))),
      (e) => { reportError(`Adding to ${label(table)}`, e); reloadTable(table); },
    );
  }
  return full;
}

/** Updates a row locally and saves the changed fields. */
export function updateRow(table: TableName, id: string, patch: Row): void {
  const pk = pkOf(table);
  const cols = TABLES[table].cols as string[];
  const changes: Row = { ...patch };
  if (cols.includes('updatedAt') && !('updatedAt' in changes)) changes.updatedAt = new Date().toISOString();
  raw[table] = raw[table].map((r) => (r[pk] === id ? stripUndefined({ ...r, ...changes }) : r));
  emitChange();

  if (!demoMode) {
    const dbPatch = toDb(table, changes);
    delete dbPatch[snake(pk)];
    if (Object.keys(dbPatch).length === 0) return;
    enqueue(
      () => supabase
        .from(table)
        .update(dbPatch)
        .eq(snake(pk), id),
      (e) => { reportError(`Updating ${label(table)}`, e); reloadTable(table); },
    );
  }
}

/** Inserts or replaces a row by primary key (for one-row-per-key tables like worker_settings). */
export function upsertRow(table: TableName, values: Row): void {
  const pk = pkOf(table);
  const cols = TABLES[table].cols as string[];
  const row: Row = { ...values };
  if (cols.includes('updatedAt')) row.updatedAt = new Date().toISOString();
  const exists = raw[table].some((r) => r[pk] === row[pk]);
  raw[table] = exists
    ? raw[table].map((r) => (r[pk] === row[pk] ? stripUndefined({ ...r, ...row }) : r))
    : [...raw[table], stripUndefined(row)];
  emitChange();
  if (!demoMode) {
    enqueue(
      () => supabase
        .from(table)
        .upsert(toDb(table, row), { onConflict: snake(pk) }),
      (e) => { reportError(`Saving ${label(table)}`, e); reloadTable(table); },
    );
  }
}

export function deleteRow(table: TableName, id: string): void {
  const pk = pkOf(table);
  raw[table] = raw[table].filter((r) => r[pk] !== id);
  emitChange();
  if (!demoMode) {
    enqueue(
      () => supabase
        .from(table)
        .delete()
        .eq(snake(pk), id),
      (e) => { reportError(`Removing from ${label(table)}`, e); reloadTable(table); },
    );
    // Whatever stored file the deleted row (or a row that goes with it) held is deleted from storage a few seconds later (update 119).
    sweepStorageSoon();
  }
}

/** Looks up a raw row (all real columns, no joins). */
export function findRow(table: TableName, id: string): Row | undefined {
  const pk = pkOf(table);
  return raw[table].find((r) => r[pk] === id);
}

export function rowsOf(table: TableName): Row[] {
  return raw[table];
}

/** Calls a database function. In demo mode returns null. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<{ data: T | null; error: { message: string } | null }> {
  if (demoMode) return { data: null, error: null };
  const { data, error } = await supabase.rpc(fn, args);
  return { data: (data as T) ?? null, error: error ? { message: error.message } : null };
}

/** Re-fetch specific tables now (e.g. after an RPC changed several rows). */
export async function refresh(...tables: TableName[]): Promise<void> {
  if (demoMode) return;
  await Promise.all(tables.map(reloadTable));
}

export function isDemo(): boolean {
  return demoMode;
}

function stripUndefined(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

function label(table: TableName): string {
  return table.replace(/_/g, ' ');
}
