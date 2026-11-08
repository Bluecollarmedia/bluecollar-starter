import type { PersonSummary } from './company';

export type CheckInStatus = 'checked_in' | 'checked_out';

export interface GPSCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
  distanceFromSite?: number;
}

export interface CheckIn {
  id: string;
  assignmentId: string;
  personId: string;
  projectId: string;
  companyId: string;
  timestamp: string;
  gps: GPSCoordinates;
  withinRadius: boolean;
  createdAt: string;
}

export interface CheckOut {
  id: string;
  assignmentId: string;
  personId: string;
  projectId: string;
  companyId: string;
  timestamp: string;
  gps: GPSCoordinates;
  createdAt: string;
}

export type WorkerPhotoType = 'task_completion' | 'progress' | 'issue' | 'general';

export interface WorkerPhoto {
  id: string;
  projectId: string;
  taskId?: string;
  assignmentId?: string;
  uploadedBy: string;
  fileKey: string;
  fileUrl: string;
  caption?: string;
  isCustomerVisible: boolean;
  photoType: WorkerPhotoType;
  takenAt: string;
  createdAt: string;
}

export type OfflineActionType =
  | 'check_in'
  | 'check_out'
  | 'task_start'
  | 'task_complete'
  | 'photo_capture'
  | 'schedule_confirm';

export type OfflineSyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface OfflineAction {
  id: string;
  idempotencyKey: string;
  actionType: OfflineActionType;
  payload: Record<string, unknown>;
  originalTimestamp: string;
  syncStatus: OfflineSyncStatus;
  syncedAt?: string;
  retryCount: number;
  createdAt: string;
}

export type WorkerActivityType =
  | 'schedule_confirmed'
  | 'checked_in'
  | 'task_started'
  | 'task_completed'
  | 'photo_taken'
  | 'checked_out'
  | 'schedule_acknowledged'
  | 'overtime_flagged';

export interface WorkerActivity {
  id: string;
  personId: string;
  companyId: string;
  assignmentId?: string;
  projectId?: string;
  activityType: WorkerActivityType;
  description: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
  project?: { id: string; name: string };
}

export type NavAppPreference = 'apple_maps' | 'google_maps' | 'waze' | 'default';

export interface WorkerSettings {
  navApp: NavAppPreference;
  notificationsEnabled: boolean;
}
