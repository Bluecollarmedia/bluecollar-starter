import type { PersonSummary } from './company';

export type AssignmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'en_route'
  | 'checked_in'
  | 'working'
  | 'completed'
  | 'cancelled'
  | 'reassigned';

export type ConfirmationState =
  | 'not_sent'
  | 'awaiting'
  | 'confirmed'
  | 'updated_since'
  | 'acknowledged';

export interface Assignment {
  id: string;
  companyId: string;
  projectId: string;
  personId: string;
  scheduledDate: string;
  startTime?: string;
  endTime?: string;
  isFullDay: boolean;
  sortOrder: number;
  status: AssignmentStatus;
  confirmationState: ConfirmationState;
  truckId?: string;
  notes?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancellationReason?: string;
  reassignedFrom?: string;
  reassignedTo?: string;
  /** Set when this day was filled in by a repeating schedule. */
  seriesId?: string;
  createdAt: string;
  updatedAt: string;
  person?: PersonSummary;
  project?: { id: string; name: string; address?: string };
  truck?: { id: string; name: string };
}

export type RepeatFrequency = 'weekly' | 'biweekly' | 'monthly' | 'custom';

/** A repeating schedule for one worker on one job (e.g. the maintenance crew
 * every 2 weeks). Its days are filled in as normal assignments a few weeks
 * ahead, so workers confirm and check in exactly as usual. */
export interface ScheduleSeries {
  id: string;
  companyId: string;
  projectId: string;
  personId: string;
  frequency: RepeatFrequency;
  /** Custom repeats: days between visits. */
  intervalDays?: number;
  /** How many days ahead its days are filled in. */
  horizonDays: number;
  /** First day; later days fall on the same weekday (or day of the month). */
  startDate: string;
  /** Last day it can land on. Open-ended when missing. */
  endDate?: string;
  startTime?: string;
  endTime?: string;
  isFullDay: boolean;
  truckId?: string;
  notes?: string;
  createdBy?: string;
  /** Set when the owner stops it; nothing new is filled in after that. */
  stoppedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type ScheduleChangeType =
  | 'created'
  | 'time_changed'
  | 'project_changed'
  | 'truck_changed'
  | 'truck_removed'
  | 'cancelled'
  | 'reassigned'
  | 'status_changed'
  | 'emergency_override'
  | 'notes_changed';

export interface ScheduleChange {
  id: string;
  assignmentId: string;
  companyId: string;
  changedBy: string;
  changeType: ScheduleChangeType;
  previousValue?: string;
  newValue?: string;
  notes?: string;
  createdAt: string;
  changer?: PersonSummary;
}

export interface ScheduleConflict {
  type: 'time_overlap' | 'truck_overlap';
  assignment: Assignment;
  message: string;
}

export interface TravelWarning {
  fromAssignment: Assignment;
  toAssignment: Assignment;
  availableMinutes: number;
  estimatedTravelMinutes?: number;
}
