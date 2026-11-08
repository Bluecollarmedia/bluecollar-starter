import type { NotificationEventType } from '@/types/operations';

export const EVENT_LABELS: Record<NotificationEventType, { label: string; icon: string; description: string }> = {
  issue_reported: { label: 'Problem Reported', icon: 'alert-triangle', description: 'When a worker reports a problem at a property' },
  worker_checked_in: { label: 'Worker Checked In', icon: 'log-in', description: 'When a worker checks in at a job site' },
  worker_checked_out: { label: 'Worker Checked Out', icon: 'log-out', description: 'When a worker checks out from a job site' },
  worker_checked_in_late: { label: 'Late Check-In', icon: 'alert-circle', description: 'When a worker checks in after the scheduled time' },
  worker_outside_radius: { label: 'Outside Job Radius', icon: 'map-pin', description: 'When a worker checks in far from the job site' },
  worker_not_checked_in: { label: 'Missing Check-In', icon: 'x-circle', description: 'When a worker hasn\'t checked in after grace period' },
  worker_past_scheduled_end: { label: 'Past Scheduled End', icon: 'clock', description: 'When a worker is still checked in past their end time' },
  worker_completed_task: { label: 'Task Completed', icon: 'check-square', description: 'When a worker marks a task as done' },
  worker_completed_job: { label: 'Job Completed', icon: 'check-circle', description: 'When all tasks at a job site are finished' },
  photo_waiting_review: { label: 'Photos Pending', icon: 'camera', description: 'When new photos need your review' },
  customer_request_submitted: { label: 'Customer Request', icon: 'message-square', description: 'When a customer submits a request' },
  customer_message: { label: 'Customer Message', icon: 'message-circle', description: 'When a customer sends you a message' },
  service_request: { label: 'Service Request', icon: 'inbox', description: 'When someone asks for work from the app' },
  schedule_changed: { label: 'Schedule Changed', icon: 'calendar', description: 'When the schedule is modified' },
  announcement_posted: { label: 'Announcement', icon: 'volume-2', description: 'When an announcement is posted' },
  schedule_conflict: { label: 'Schedule Conflict', icon: 'alert-triangle', description: 'When a scheduling conflict is detected' },
  quote_approved: { label: 'Quote Approved', icon: 'check-circle', description: 'When a customer approves a quote or change order' },
  quote_declined: { label: 'Quote Declined', icon: 'x-circle', description: 'When a customer declines a quote or change order' },
  quote_sent: { label: 'Quote Ready', icon: 'file-text', description: 'Tells the customer a quote or change order is ready to review' },
  invoice_issued: { label: 'Invoice', icon: 'dollar-sign', description: 'Tells the customer an invoice was issued' },
  time_skip_request: { label: 'Skip Request', icon: 'skip-forward', description: 'When a worker asks to skip a property' },
  time_over_target: { label: 'Over Target', icon: 'clock', description: 'When a property visit runs past its time target' },
  time_overtime: { label: 'Daily Overtime Alert', icon: 'trending-up', description: 'When an employee approaches or reaches their daily alert hours' },
  time_unusual: { label: 'Needs Review', icon: 'alert-circle', description: 'An unusually long visit or a workday left open' },
  time_progress_check: { label: 'Check Your Progress', icon: 'clock', description: 'A neutral reminder to the crew when a visit passes its target' },
};

export const ALL_EVENTS: NotificationEventType[] = [
  'worker_checked_in', 'worker_checked_out', 'worker_checked_in_late',
  'worker_outside_radius', 'worker_not_checked_in', 'worker_past_scheduled_end',
  'worker_completed_task', 'worker_completed_job',
  'photo_waiting_review', 'customer_request_submitted', 'customer_message',
  'schedule_changed', 'schedule_conflict',
];
