import type { PersonSummary } from './company';
import type { GPSCoordinates } from './worker';

// ── Work Sessions ──────────────────────────────────────────────

export type WorkSessionStatus = 'active' | 'completed' | 'corrected';

export interface WorkSessionCorrection {
  originalCheckIn?: string;
  originalCheckOut?: string;
  correctedBy: string;
  correctedAt: string;
  reason: string;
  corrector?: PersonSummary;
}

export interface WorkSession {
  id: string;
  companyId: string;
  personId: string;
  projectId: string;
  assignmentId: string;
  checkInTime: string;
  checkOutTime?: string;
  durationMinutes?: number;
  checkInGps?: GPSCoordinates;
  checkOutGps?: GPSCoordinates;
  offlineCheckIn?: string;
  offlineCheckOut?: string;
  syncedCheckInAt?: string;
  syncedCheckOutAt?: string;
  status: WorkSessionStatus;
  correction?: WorkSessionCorrection;
  createdAt: string;
  updatedAt: string;
  worker?: PersonSummary;
  project?: { id: string; name: string; address?: string };
}

// ── Hourly Rates ───────────────────────────────────────────────

export interface WorkerHourlyRate {
  id: string;
  companyId: string;
  personId: string;
  hourlyRate: number;
  effectiveDate: string;
  endDate?: string;
  setBy: string;
  createdAt: string;
  worker?: PersonSummary;
}

// ── Overtime ───────────────────────────────────────────────────

/** A worker's own overtime terms. Workers with no row use the company rule. */
export interface WorkerPaySettings {
  personId: string;
  companyId: string;
  overtimeEnabled: boolean;
  /** Hours worked in a week before overtime starts. */
  overtimeAfterHours: number;
  overtimeMultiplier: number;
  /** Target-Pay Mode: what the worker should earn per hour worked, overtime included. */
  targetHourlyRate?: number;
  updatedAt?: string;
}

export type OvertimeRuleType = 'weekly_40' | 'daily_8' | 'custom' | 'none';

export interface OvertimeRule {
  id: string;
  companyId: string;
  ruleType: OvertimeRuleType;
  weeklyThresholdHours?: number;
  dailyThresholdHours?: number;
  overtimeMultiplier: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Notifications ──────────────────────────────────────────────

export type NotificationEventType =
  | 'issue_reported'
  | 'worker_checked_in'
  | 'worker_checked_out'
  | 'worker_checked_in_late'
  | 'worker_outside_radius'
  | 'worker_not_checked_in'
  | 'worker_past_scheduled_end'
  | 'worker_completed_task'
  | 'worker_completed_job'
  | 'photo_waiting_review'
  | 'customer_request_submitted'
  | 'customer_message'
  | 'service_request'
  | 'schedule_changed'
  | 'schedule_conflict'
  | 'announcement_posted'
  // Hours & Labor (update 64)
  | 'time_skip_request'
  | 'time_over_target'
  | 'time_overtime'
  | 'time_unusual'
  | 'time_progress_check'
  | 'quote_approved'
  | 'quote_declined'
  // To the customer
  | 'quote_sent'
  | 'invoice_issued';

export interface NotificationPreference {
  id: string;
  companyId: string;
  personId?: string;
  eventType: NotificationEventType;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type NotificationStatus = 'unread' | 'read' | 'dismissed';

export interface AppNotification {
  id: string;
  companyId: string;
  recipientId: string;
  eventType: NotificationEventType;
  title: string;
  body: string;
  status: NotificationStatus;
  linkedEntityType?: 'worker' | 'project' | 'message' | 'assignment' | 'request' | 'photo' | 'checkin' | 'announcement' | 'quote' | 'change_order' | 'invoice' | 'issue' | 'time_workday' | 'time_visit' | 'time_skip' | 'service_request';
  linkedEntityId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  readAt?: string;
}

// ── Attendance ─────────────────────────────────────────────────

export type AttendanceStatus =
  | 'checked_in'
  | 'checked_out'
  | 'late'
  | 'not_checked_in'
  | 'past_scheduled_end'
  | 'off_today';

export interface WorkerAttendance {
  personId: string;
  scheduledDate: string;
  assignments: {
    assignmentId: string;
    projectId: string;
    projectName: string;
    projectAddress?: string;
    scheduledStart?: string;
    scheduledEnd?: string;
    actualCheckIn?: string;
    actualCheckOut?: string;
    status: AttendanceStatus;
    lateMinutes?: number;
    distanceFromSite?: number;
    withinRadius?: boolean;
  }[];
  worker?: PersonSummary;
}

// ── Company Settings Extension ─────────────────────────────────

export interface CompanyOperationsSettings {
  id: string;
  companyId: string;
  missingCheckinGraceMinutes: number;
  lateCheckinThresholdMinutes: number;
  pastEndAlertEnabled: boolean;
  overtimeRuleId?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Announcement Extensions ────────────────────────────────────

export type WeatherActionType = 'no_work' | 'delayed_start' | 'early_finish' | 'project_cancel' | 'weather_warning';
export type ScheduleActionType = 'none' | 'cancel_today' | 'delay_today';

export interface AnnouncementScheduleAction {
  actionType: ScheduleActionType;
  delayMinutes?: number;
  affectedAssignmentIds?: string[];
  executedAt?: string;
  executedBy?: string;
}

// ── Worker Reminders ───────────────────────────────────────────

export type ReminderType =
  | 'assignment_ending_soon'
  | 'next_job_upcoming'
  | 'past_scheduled_end'
  | 'schedule_changed';

export interface WorkerReminder {
  id: string;
  personId: string;
  assignmentId: string;
  reminderType: ReminderType;
  title: string;
  body: string;
  nextAssignment?: {
    id: string;
    projectName: string;
    startTime: string;
  };
  actions?: { label: string; action: string }[];
  createdAt: string;
  readAt?: string;
}
