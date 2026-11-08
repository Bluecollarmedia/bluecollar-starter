import type {
  WorkSession,
  WorkerHourlyRate,
  WorkerPaySettings,
  OvertimeRule,
  NotificationPreference,
  AppNotification,
  CompanyOperationsSettings,
  WorkerReminder,
} from '@/types/operations';
import type { CheckIn, CheckOut } from '@/types/worker';
import { mockPeople } from './mock';

const today = new Date().toISOString().split('T')[0];

function offsetDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// ── Work Sessions ──────────────────────────────────────────────
// Built from actual check-in/out records. Duration calculated from actual times.

export const mockWorkSessions: WorkSession[] = [
  // worker1 — Yesterday (Mon equivalent): Beachwood Residence 7:05–15:02
  {
    id: 'ws1', companyId: 'company1', personId: 'worker1', projectId: 'proj1', assignmentId: 'a11',
    checkInTime: offsetDate(-1) + 'T07:05:00Z', checkOutTime: offsetDate(-1) + 'T15:02:00Z',
    durationMinutes: 477,
    checkInGps: { latitude: 41.4756, longitude: -81.5558, accuracy: 12, distanceFromSite: 35 },
    checkOutGps: { latitude: 41.4758, longitude: -81.5556, accuracy: 8, distanceFromSite: 20 },
    status: 'completed',
    createdAt: offsetDate(-1) + 'T07:05:00Z', updatedAt: offsetDate(-1) + 'T15:02:00Z',
    worker: mockPeople.worker1,
    project: { id: 'proj1', name: 'Beachwood Residence', address: '142 Beachwood Dr' },
  },
  // worker1 — 2 days ago: Beachwood 7:12–12:05, Chen Property 12:50–16:18
  {
    id: 'ws2', companyId: 'company1', personId: 'worker1', projectId: 'proj1', assignmentId: 'a12',
    checkInTime: offsetDate(-2) + 'T07:12:00Z', checkOutTime: offsetDate(-2) + 'T12:05:00Z',
    durationMinutes: 293,
    checkInGps: { latitude: 41.4756, longitude: -81.5558, accuracy: 10, distanceFromSite: 30 },
    checkOutGps: { latitude: 41.4757, longitude: -81.5557, accuracy: 6, distanceFromSite: 15 },
    status: 'completed',
    createdAt: offsetDate(-2) + 'T07:12:00Z', updatedAt: offsetDate(-2) + 'T12:05:00Z',
    worker: mockPeople.worker1,
    project: { id: 'proj1', name: 'Beachwood Residence', address: '142 Beachwood Dr' },
  },
  {
    id: 'ws3', companyId: 'company1', personId: 'worker1', projectId: 'proj2', assignmentId: 'a13',
    checkInTime: offsetDate(-2) + 'T12:50:00Z', checkOutTime: offsetDate(-2) + 'T16:18:00Z',
    durationMinutes: 208,
    checkInGps: { latitude: 41.4900, longitude: -81.5700, accuracy: 15, distanceFromSite: 42 },
    checkOutGps: { latitude: 41.4901, longitude: -81.5699, accuracy: 10, distanceFromSite: 30 },
    status: 'completed',
    createdAt: offsetDate(-2) + 'T12:50:00Z', updatedAt: offsetDate(-2) + 'T16:18:00Z',
    worker: mockPeople.worker1,
    project: { id: 'proj2', name: 'Chen Property', address: '890 Overlook Rd' },
  },
  // worker1 — 3 days ago: Beachwood 8:03–16:12
  {
    id: 'ws4', companyId: 'company1', personId: 'worker1', projectId: 'proj1', assignmentId: 'a14',
    checkInTime: offsetDate(-3) + 'T08:03:00Z', checkOutTime: offsetDate(-3) + 'T16:12:00Z',
    durationMinutes: 489,
    checkInGps: { latitude: 41.4756, longitude: -81.5558, accuracy: 8, distanceFromSite: 25 },
    checkOutGps: { latitude: 41.4757, longitude: -81.5557, accuracy: 12, distanceFromSite: 28 },
    status: 'completed',
    createdAt: offsetDate(-3) + 'T08:03:00Z', updatedAt: offsetDate(-3) + 'T16:12:00Z',
    worker: mockPeople.worker1,
    project: { id: 'proj1', name: 'Beachwood Residence', address: '142 Beachwood Dr' },
  },
  // worker1 — 4 days ago: Chen 7:30–15:45
  {
    id: 'ws5', companyId: 'company1', personId: 'worker1', projectId: 'proj2', assignmentId: 'a15',
    checkInTime: offsetDate(-4) + 'T07:30:00Z', checkOutTime: offsetDate(-4) + 'T15:45:00Z',
    durationMinutes: 495,
    checkInGps: { latitude: 41.4900, longitude: -81.5700, accuracy: 10, distanceFromSite: 38 },
    checkOutGps: { latitude: 41.4901, longitude: -81.5699, accuracy: 8, distanceFromSite: 22 },
    status: 'completed',
    createdAt: offsetDate(-4) + 'T07:30:00Z', updatedAt: offsetDate(-4) + 'T15:45:00Z',
    worker: mockPeople.worker1,
    project: { id: 'proj2', name: 'Chen Property', address: '890 Overlook Rd' },
  },
  // worker1 — 5 days ago: Beachwood 7:55–15:30
  {
    id: 'ws6', companyId: 'company1', personId: 'worker1', projectId: 'proj1', assignmentId: 'a16',
    checkInTime: offsetDate(-5) + 'T07:55:00Z', checkOutTime: offsetDate(-5) + 'T15:30:00Z',
    durationMinutes: 455,
    checkInGps: { latitude: 41.4756, longitude: -81.5558, accuracy: 9, distanceFromSite: 32 },
    checkOutGps: { latitude: 41.4757, longitude: -81.5558, accuracy: 7, distanceFromSite: 18 },
    status: 'completed',
    createdAt: offsetDate(-5) + 'T07:55:00Z', updatedAt: offsetDate(-5) + 'T15:30:00Z',
    worker: mockPeople.worker1,
    project: { id: 'proj1', name: 'Beachwood Residence', address: '142 Beachwood Dr' },
  },

  // worker2 — Yesterday: Beachwood 7:18–12:10, Greenwood 13:15–17:08
  {
    id: 'ws7', companyId: 'company1', personId: 'worker2', projectId: 'proj1', assignmentId: 'a21',
    checkInTime: offsetDate(-1) + 'T07:18:00Z', checkOutTime: offsetDate(-1) + 'T12:10:00Z',
    durationMinutes: 292,
    checkInGps: { latitude: 41.4756, longitude: -81.5558, accuracy: 18, distanceFromSite: 55 },
    checkOutGps: { latitude: 41.4757, longitude: -81.5557, accuracy: 10, distanceFromSite: 25 },
    status: 'completed',
    createdAt: offsetDate(-1) + 'T07:18:00Z', updatedAt: offsetDate(-1) + 'T12:10:00Z',
    worker: mockPeople.worker2,
    project: { id: 'proj1', name: 'Beachwood Residence', address: '142 Beachwood Dr' },
  },
  {
    id: 'ws8', companyId: 'company1', personId: 'worker2', projectId: 'proj3', assignmentId: 'a22',
    checkInTime: offsetDate(-1) + 'T13:15:00Z', checkOutTime: offsetDate(-1) + 'T17:08:00Z',
    durationMinutes: 233,
    checkInGps: { latitude: 41.5100, longitude: -81.5400, accuracy: 12, distanceFromSite: 40 },
    checkOutGps: { latitude: 41.5101, longitude: -81.5399, accuracy: 9, distanceFromSite: 30 },
    status: 'completed',
    createdAt: offsetDate(-1) + 'T13:15:00Z', updatedAt: offsetDate(-1) + 'T17:08:00Z',
    worker: mockPeople.worker2,
    project: { id: 'proj3', name: 'Greenwood Estate', address: '2100 Greenwood Ave' },
  },
  // worker2 — 2 days ago: Greenwood 8:05–16:22
  {
    id: 'ws9', companyId: 'company1', personId: 'worker2', projectId: 'proj3', assignmentId: 'a23',
    checkInTime: offsetDate(-2) + 'T08:05:00Z', checkOutTime: offsetDate(-2) + 'T16:22:00Z',
    durationMinutes: 497,
    checkInGps: { latitude: 41.5100, longitude: -81.5400, accuracy: 15, distanceFromSite: 45 },
    checkOutGps: { latitude: 41.5101, longitude: -81.5399, accuracy: 10, distanceFromSite: 28 },
    status: 'completed',
    createdAt: offsetDate(-2) + 'T08:05:00Z', updatedAt: offsetDate(-2) + 'T16:22:00Z',
    worker: mockPeople.worker2,
    project: { id: 'proj3', name: 'Greenwood Estate', address: '2100 Greenwood Ave' },
  },
  // worker2 — 3 days ago: Beachwood 7:22–15:40
  {
    id: 'ws10', companyId: 'company1', personId: 'worker2', projectId: 'proj1', assignmentId: 'a24',
    checkInTime: offsetDate(-3) + 'T07:22:00Z', checkOutTime: offsetDate(-3) + 'T15:40:00Z',
    durationMinutes: 498,
    checkInGps: { latitude: 41.4756, longitude: -81.5558, accuracy: 14, distanceFromSite: 48 },
    checkOutGps: { latitude: 41.4757, longitude: -81.5557, accuracy: 8, distanceFromSite: 20 },
    status: 'completed',
    createdAt: offsetDate(-3) + 'T07:22:00Z', updatedAt: offsetDate(-3) + 'T15:40:00Z',
    worker: mockPeople.worker2,
    project: { id: 'proj1', name: 'Beachwood Residence', address: '142 Beachwood Dr' },
  },

  // worker3 — Yesterday: Chen Property 7:35–16:05
  {
    id: 'ws11', companyId: 'company1', personId: 'worker3', projectId: 'proj2', assignmentId: 'a31',
    checkInTime: offsetDate(-1) + 'T07:35:00Z', checkOutTime: offsetDate(-1) + 'T16:05:00Z',
    durationMinutes: 510,
    checkInGps: { latitude: 41.4900, longitude: -81.5700, accuracy: 11, distanceFromSite: 28 },
    checkOutGps: { latitude: 41.4901, longitude: -81.5699, accuracy: 9, distanceFromSite: 22 },
    status: 'completed',
    createdAt: offsetDate(-1) + 'T07:35:00Z', updatedAt: offsetDate(-1) + 'T16:05:00Z',
    worker: mockPeople.worker3,
    project: { id: 'proj2', name: 'Chen Property', address: '890 Overlook Rd' },
  },
  // worker3 — 2 days ago: Chen 7:42–15:50
  {
    id: 'ws12', companyId: 'company1', personId: 'worker3', projectId: 'proj2', assignmentId: 'a32',
    checkInTime: offsetDate(-2) + 'T07:42:00Z', checkOutTime: offsetDate(-2) + 'T15:50:00Z',
    durationMinutes: 488,
    checkInGps: { latitude: 41.4900, longitude: -81.5700, accuracy: 13, distanceFromSite: 35 },
    checkOutGps: { latitude: 41.4901, longitude: -81.5699, accuracy: 8, distanceFromSite: 18 },
    status: 'completed',
    createdAt: offsetDate(-2) + 'T07:42:00Z', updatedAt: offsetDate(-2) + 'T15:50:00Z',
    worker: mockPeople.worker3,
    project: { id: 'proj2', name: 'Chen Property', address: '890 Overlook Rd' },
  },
  // worker3 — 3 days ago: Chen 8:17–16:30 (LATE: scheduled at 8:00, arrived 8:17 = 17min late)
  {
    id: 'ws13', companyId: 'company1', personId: 'worker3', projectId: 'proj2', assignmentId: 'a33',
    checkInTime: offsetDate(-3) + 'T08:17:00Z', checkOutTime: offsetDate(-3) + 'T16:30:00Z',
    durationMinutes: 493,
    checkInGps: { latitude: 41.4900, longitude: -81.5700, accuracy: 20, distanceFromSite: 65 },
    checkOutGps: { latitude: 41.4901, longitude: -81.5699, accuracy: 10, distanceFromSite: 25 },
    status: 'completed',
    createdAt: offsetDate(-3) + 'T08:17:00Z', updatedAt: offsetDate(-3) + 'T16:30:00Z',
    worker: mockPeople.worker3,
    project: { id: 'proj2', name: 'Chen Property', address: '890 Overlook Rd' },
  },

  // worker4 — Yesterday: Greenwood 8:10–16:45 (past scheduled end of 16:00)
  {
    id: 'ws14', companyId: 'company1', personId: 'worker4', projectId: 'proj3', assignmentId: 'a41',
    checkInTime: offsetDate(-1) + 'T08:10:00Z', checkOutTime: offsetDate(-1) + 'T16:45:00Z',
    durationMinutes: 515,
    checkInGps: { latitude: 41.5100, longitude: -81.5400, accuracy: 10, distanceFromSite: 32 },
    checkOutGps: { latitude: 41.5101, longitude: -81.5399, accuracy: 12, distanceFromSite: 38 },
    status: 'completed',
    createdAt: offsetDate(-1) + 'T08:10:00Z', updatedAt: offsetDate(-1) + 'T16:45:00Z',
    worker: mockPeople.worker4,
    project: { id: 'proj3', name: 'Greenwood Estate', address: '2100 Greenwood Ave' },
  },

  // worker1 — A session with manual correction (forgot to check out)
  {
    id: 'ws15', companyId: 'company1', personId: 'worker1', projectId: 'proj1', assignmentId: 'a17',
    checkInTime: offsetDate(-6) + 'T07:45:00Z', checkOutTime: offsetDate(-6) + 'T15:10:00Z',
    durationMinutes: 445,
    checkInGps: { latitude: 41.4756, longitude: -81.5558, accuracy: 10, distanceFromSite: 30 },
    status: 'corrected',
    correction: {
      originalCheckOut: undefined,
      correctedBy: 'owner1',
      correctedAt: offsetDate(-5) + 'T09:00:00Z',
      reason: 'Worker forgot to check out. Confirmed departure at 3:10 PM with worker.',
      corrector: mockPeople.owner1,
    },
    createdAt: offsetDate(-6) + 'T07:45:00Z', updatedAt: offsetDate(-5) + 'T09:00:00Z',
    worker: mockPeople.worker1,
    project: { id: 'proj1', name: 'Beachwood Residence', address: '142 Beachwood Dr' },
  },

  // worker1 — Session with offline check-in (Scenario E)
  {
    id: 'ws16', companyId: 'company1', personId: 'worker1', projectId: 'proj2', assignmentId: 'a18',
    checkInTime: offsetDate(-7) + 'T08:03:00Z', checkOutTime: offsetDate(-7) + 'T16:15:00Z',
    durationMinutes: 492,
    offlineCheckIn: offsetDate(-7) + 'T08:03:00Z',
    syncedCheckInAt: offsetDate(-7) + 'T09:10:00Z',
    checkInGps: { latitude: 41.4900, longitude: -81.5700, accuracy: 25, distanceFromSite: 50 },
    checkOutGps: { latitude: 41.4901, longitude: -81.5699, accuracy: 10, distanceFromSite: 20 },
    status: 'completed',
    createdAt: offsetDate(-7) + 'T09:10:00Z', updatedAt: offsetDate(-7) + 'T16:15:00Z',
    worker: mockPeople.worker1,
    project: { id: 'proj2', name: 'Chen Property', address: '890 Overlook Rd' },
  },
];

// ── Expanded Check-Ins ─────────────────────────────────────────

export const mockExpandedCheckIns: CheckIn[] = [
  // Today: worker1 and worker3 both checked in on time (within the late-checkin grace window)
  {
    id: 'ci10', assignmentId: 'a1', personId: 'worker1', projectId: 'proj1', companyId: 'company1',
    timestamp: today + 'T07:03:00Z',
    gps: { latitude: 41.4756, longitude: -81.5558, accuracy: 12, distanceFromSite: 35 },
    withinRadius: true, createdAt: today + 'T07:03:00Z',
  },
  {
    id: 'ci11', assignmentId: 'a4', personId: 'worker3', projectId: 'proj2', companyId: 'company1',
    timestamp: today + 'T07:31:00Z',
    gps: { latitude: 41.4900, longitude: -81.5700, accuracy: 15, distanceFromSite: 42 },
    withinRadius: true, createdAt: today + 'T07:31:00Z',
  },
  // Yesterday
  {
    id: 'ci12', assignmentId: 'a11', personId: 'worker1', projectId: 'proj1', companyId: 'company1',
    timestamp: offsetDate(-1) + 'T07:05:00Z',
    gps: { latitude: 41.4756, longitude: -81.5558, accuracy: 12, distanceFromSite: 35 },
    withinRadius: true, createdAt: offsetDate(-1) + 'T07:05:00Z',
  },
  {
    id: 'ci13', assignmentId: 'a21', personId: 'worker2', projectId: 'proj1', companyId: 'company1',
    timestamp: offsetDate(-1) + 'T07:18:00Z',
    gps: { latitude: 41.4756, longitude: -81.5558, accuracy: 18, distanceFromSite: 55 },
    withinRadius: true, createdAt: offsetDate(-1) + 'T07:18:00Z',
  },
  {
    id: 'ci14', assignmentId: 'a31', personId: 'worker3', projectId: 'proj2', companyId: 'company1',
    timestamp: offsetDate(-1) + 'T07:35:00Z',
    gps: { latitude: 41.4900, longitude: -81.5700, accuracy: 11, distanceFromSite: 28 },
    withinRadius: true, createdAt: offsetDate(-1) + 'T07:35:00Z',
  },
  {
    id: 'ci15', assignmentId: 'a41', personId: 'worker4', projectId: 'proj3', companyId: 'company1',
    timestamp: offsetDate(-1) + 'T08:10:00Z',
    gps: { latitude: 41.5100, longitude: -81.5400, accuracy: 10, distanceFromSite: 32 },
    withinRadius: true, createdAt: offsetDate(-1) + 'T08:10:00Z',
  },
];

// ── Worker Hourly Rates (effective-dated) ──────────────────────

export const mockHourlyRates: WorkerHourlyRate[] = [
  // worker1 (Marcus Brooks): was $20, changed to $22 on Sep 1
  {
    id: 'hr1', companyId: 'company1', personId: 'worker1',
    hourlyRate: 20, effectiveDate: '2026-01-01', endDate: '2026-08-31',
    setBy: 'owner1', createdAt: '2026-01-01T00:00:00Z',
    worker: mockPeople.worker1,
  },
  {
    id: 'hr2', companyId: 'company1', personId: 'worker1',
    hourlyRate: 22, effectiveDate: '2026-09-01',
    setBy: 'owner1', createdAt: '2026-09-01T00:00:00Z',
    worker: mockPeople.worker1,
  },
  // worker2 (Tyler Brooks): $18
  {
    id: 'hr3', companyId: 'company1', personId: 'worker2',
    hourlyRate: 18, effectiveDate: '2026-03-01',
    setBy: 'owner1', createdAt: '2026-03-01T00:00:00Z',
    worker: mockPeople.worker2,
  },
  // worker3 (Marcus Rivera): $24
  {
    id: 'hr4', companyId: 'company1', personId: 'worker3',
    hourlyRate: 24, effectiveDate: '2026-02-01',
    setBy: 'owner1', createdAt: '2026-02-01T00:00:00Z',
    worker: mockPeople.worker3,
  },
  // worker4 (David Kim): $19
  {
    id: 'hr5', companyId: 'company1', personId: 'worker4',
    hourlyRate: 19, effectiveDate: '2026-04-01',
    setBy: 'owner1', createdAt: '2026-04-01T00:00:00Z',
    worker: mockPeople.worker4,
  },
];

// ── Per-worker overtime ───────────────────────────────────────
// worker1/worker2 have no row, so they use the company rule.

export const mockWorkerPaySettings: WorkerPaySettings[] = [
  { personId: 'worker3', companyId: 'company1', overtimeEnabled: true, overtimeAfterHours: 45, overtimeMultiplier: 2 },
  { personId: 'worker4', companyId: 'company1', overtimeEnabled: false, overtimeAfterHours: 40, overtimeMultiplier: 1.5 },
];

// ── Overtime Rules ─────────────────────────────────────────────

export const mockOvertimeRule: OvertimeRule = {
  id: 'ot1', companyId: 'company1',
  ruleType: 'weekly_40', weeklyThresholdHours: 40,
  overtimeMultiplier: 1.5, isActive: false,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

// ── Notification Preferences ───────────────────────────────────
// Company-wide defaults (personId undefined).
// Worker-specific overrides have personId set.

export const mockNotificationPreferences: NotificationPreference[] = [
  // Company defaults
  { id: 'np1', companyId: 'company1', eventType: 'worker_checked_in', enabled: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'np2', companyId: 'company1', eventType: 'worker_checked_out', enabled: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'np3', companyId: 'company1', eventType: 'worker_checked_in_late', enabled: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'np4', companyId: 'company1', eventType: 'worker_outside_radius', enabled: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'np5', companyId: 'company1', eventType: 'worker_not_checked_in', enabled: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'np6', companyId: 'company1', eventType: 'worker_past_scheduled_end', enabled: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'np7', companyId: 'company1', eventType: 'worker_completed_task', enabled: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'np8', companyId: 'company1', eventType: 'worker_completed_job', enabled: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'np9', companyId: 'company1', eventType: 'photo_waiting_review', enabled: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'np10', companyId: 'company1', eventType: 'customer_request_submitted', enabled: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'np11', companyId: 'company1', eventType: 'schedule_changed', enabled: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'np12', companyId: 'company1', eventType: 'schedule_conflict', enabled: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },

  // Worker-specific overrides (Scenario D: check-in OFF for worker1, missing check-in ON)
  { id: 'np13', companyId: 'company1', personId: 'worker1', eventType: 'worker_checked_in', enabled: false, createdAt: '2026-08-15T00:00:00Z', updatedAt: '2026-08-15T00:00:00Z' },
  { id: 'np14', companyId: 'company1', personId: 'worker1', eventType: 'worker_not_checked_in', enabled: true, createdAt: '2026-08-15T00:00:00Z', updatedAt: '2026-08-15T00:00:00Z' },
];

// ── App Notifications ──────────────────────────────────────────

export const mockNotifications: AppNotification[] = [
  {
    id: 'n1', companyId: 'company1', recipientId: 'owner1',
    eventType: 'worker_checked_in_late',
    title: 'Marcus Rivera checked in late',
    body: 'Scheduled for 8:00 AM at Chen Property, checked in at 8:17 AM (17 minutes late)',
    status: 'unread',
    linkedEntityType: 'checkin', linkedEntityId: 'ci11',
    createdAt: today + 'T07:47:00Z',
  },
  {
    id: 'n2', companyId: 'company1', recipientId: 'owner1',
    eventType: 'worker_not_checked_in',
    title: 'Tyler Brooks has not checked in',
    body: 'Scheduled for Beachwood Residence at 7:00 AM. 10+ minutes past scheduled start.',
    status: 'unread',
    linkedEntityType: 'worker', linkedEntityId: 'worker2',
    metadata: { assignmentId: 'a2', projectId: 'proj1' },
    createdAt: today + 'T07:10:00Z',
  },
  {
    id: 'n3', companyId: 'company1', recipientId: 'owner1',
    eventType: 'worker_not_checked_in',
    title: 'David Kim has not checked in',
    body: 'Scheduled for Greenwood Estate. Full day assignment, no check-in recorded.',
    status: 'unread',
    linkedEntityType: 'worker', linkedEntityId: 'worker4',
    metadata: { assignmentId: 'a5', projectId: 'proj3' },
    createdAt: today + 'T08:10:00Z',
  },
  {
    id: 'n4', companyId: 'company1', recipientId: 'owner1',
    eventType: 'customer_request_submitted',
    title: 'New customer request',
    body: 'Sarah Mitchell submitted: "Can we change the mulch color?"',
    status: 'unread',
    linkedEntityType: 'request', linkedEntityId: 'r2',
    createdAt: offsetDate(-1) + 'T14:00:00Z',
  },
  {
    id: 'n5', companyId: 'company1', recipientId: 'owner1',
    eventType: 'customer_request_submitted',
    title: 'New customer request',
    body: 'Sarah Mitchell submitted: "Timeline question"',
    status: 'unread',
    linkedEntityType: 'request', linkedEntityId: 'r3',
    createdAt: today + 'T09:00:00Z',
  },
  {
    id: 'n6', companyId: 'company1', recipientId: 'owner1',
    eventType: 'photo_waiting_review',
    title: '3 new photos waiting for review',
    body: 'Workers uploaded 3 photos at Beachwood Residence that need your review.',
    status: 'read',
    linkedEntityType: 'project', linkedEntityId: 'proj1',
    createdAt: offsetDate(-1) + 'T11:32:00Z',
    readAt: offsetDate(-1) + 'T13:00:00Z',
  },
  {
    id: 'n7', companyId: 'company1', recipientId: 'owner1',
    eventType: 'worker_past_scheduled_end',
    title: 'David Kim still working past scheduled end',
    body: 'Greenwood Estate assignment was scheduled to end. David is still checked in.',
    status: 'read',
    linkedEntityType: 'worker', linkedEntityId: 'worker4',
    metadata: { assignmentId: 'a41' },
    createdAt: offsetDate(-1) + 'T16:10:00Z',
    readAt: offsetDate(-1) + 'T16:15:00Z',
  },
  {
    id: 'n8', companyId: 'company1', recipientId: 'owner1',
    eventType: 'worker_checked_in',
    title: 'Marcus Brooks checked in',
    body: 'Checked in at Beachwood Residence at 7:07 AM. At job site.',
    status: 'read',
    linkedEntityType: 'checkin', linkedEntityId: 'ci10',
    createdAt: today + 'T07:07:00Z',
    readAt: today + 'T07:30:00Z',
  },
];

// ── Company Operations Settings ────────────────────────────────

export const mockOperationsSettings: CompanyOperationsSettings = {
  id: 'cos1', companyId: 'company1',
  missingCheckinGraceMinutes: 10,
  lateCheckinThresholdMinutes: 5,
  pastEndAlertEnabled: true,
  overtimeRuleId: 'ot1',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

// ── Worker Reminders ───────────────────────────────────────────

export const mockWorkerReminders: WorkerReminder[] = [
  {
    id: 'wr1', personId: 'worker1', assignmentId: 'a1',
    reminderType: 'assignment_ending_soon',
    title: 'Beachwood Residence',
    body: 'You have 30 minutes remaining.',
    nextAssignment: { id: 'a6', projectName: 'Chen Property', startTime: '16:00' },
    createdAt: today + 'T14:30:00Z',
  },
  {
    id: 'wr2', personId: 'worker2', assignmentId: 'a2',
    reminderType: 'assignment_ending_soon',
    title: 'Beachwood Residence',
    body: 'You have 30 minutes remaining.',
    nextAssignment: { id: 'a3', projectName: 'Greenwood Estate', startTime: '13:00' },
    createdAt: today + 'T11:30:00Z',
  },
  {
    id: 'wr3', personId: 'worker4', assignmentId: 'a41',
    reminderType: 'past_scheduled_end',
    title: 'Your Greenwood Estate assignment was scheduled to end',
    body: 'You are still checked in past the scheduled end time.',
    actions: [
      { label: "I'M STILL WORKING", action: 'still_working' },
      { label: "I'M LEAVING", action: 'leaving' },
    ],
    createdAt: offsetDate(-1) + 'T16:05:00Z',
  },
];
