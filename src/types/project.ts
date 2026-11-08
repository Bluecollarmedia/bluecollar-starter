import type { PersonSummary } from './company';

/** prospect: created from a quote for a new customer/property; not on the
 * schedule and without a team until the quote is approved and the owner
 * starts the project (it then becomes active). */
export type ProjectStatus = 'prospect' | 'active' | 'on_hold' | 'completed' | 'archived';
export type TaskStatus = 'pending' | 'in_progress' | 'completed';
export type PhotoType = 'progress' | 'before' | 'after' | 'issue' | 'general';
export type RequestStatus = 'pending' | 'acknowledged' | 'completed' | 'declined' | 'converted';
export type RequestCategory = 'change_request' | 'question' | 'additional_work' | 'other';
export type HistoryEventType =
  | 'project_created'
  | 'status_changed'
  | 'progress_updated'
  | 'team_member_added'
  | 'team_member_removed'
  | 'task_created'
  | 'task_completed'
  | 'photo_added'
  | 'update_posted'
  | 'request_created'
  | 'request_responded'
  | 'settings_changed'
  | 'note_added';

export interface Project {
  id: string;
  companyId: string;
  customerId?: string;
  /** The property (supabase/updates/075 and 79) this job is at; its address is kept in step with it. */
  propertyId?: string;
  name: string;
  /** The one worker who can start/complete this job's tasks (update 016). */
  taskLeadId?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;
  status: ProjectStatus;
  progress: number;
  startDate?: string;
  estimatedEndDate?: string;
  completedAt?: string;
  notes?: string;
  /** Owner-uploaded cover photo (falls back to a stock photo). */
  coverPhotoUrl?: string;
  createdAt: string;
  updatedAt: string;
  customer?: PersonSummary;
  teamCount?: number;
  taskCount?: number;
  openTaskCount?: number;
  customerProjectCode?: string;
  customerClaimedBy?: string;
  customerClaimedAt?: string;
}

export interface CustomerProjectAccess {
  projectId: string;
  projectName: string;
  code: string;
  portalEnabled: boolean;
  claimedBy?: string;
  claimedByEmail?: string;
  claimedAt?: string;
}

export interface ProjectTeamMember {
  id: string;
  projectId: string;
  personId: string;
  addedAt: string;
  removedAt?: string;
  person?: PersonSummary;
}

export interface ProjectTask {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  sortOrder: number;
  assignedTo?: string;
  completedAt?: string;
  /** Stamped by the database when the task is completed (update 016). */
  completedBy?: string;
  createdAt: string;
  updatedAt: string;
  assignee?: PersonSummary;
  /** Who completed it (stamped by the database, update 016). */
  completer?: PersonSummary;
}

/** A photo or video the owner attached to a task to show what to do. */
export interface TaskAttachment {
  id: string;
  companyId?: string;
  projectId: string;
  taskId: string;
  mediaType: 'image' | 'video';
  fileUrl: string;
  fileKey: string;
  sizeBytes?: number;
  createdBy?: string;
  createdAt: string;
}

export interface ProjectSettings {
  id: string;
  projectId: string;
  customerInteractionEnabled: boolean;
  completionPhotoRequired: boolean;
  checkinRadiusMeters?: number;
  customerCanRequest: boolean;
  customerCanViewPhotos: boolean;
  customerCanComment: boolean;
  /** Progress is estimated from the tasks (database, update 121). False = the owner sets it by hand. Missing means on. */
  autoProgress?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPhoto {
  id: string;
  projectId: string;
  taskId?: string;
  assignmentId?: string;
  uploadedBy: string;
  fileKey: string;
  fileUrl: string;
  /** Tiny placeholder hash shown while the photo loads, when the upload recorded one. */
  blurhash?: string;
  caption?: string;
  customerDescription?: string;
  isCustomerVisible: boolean;
  sharedBy?: string;
  sharedAt?: string;
  photoType: PhotoType;
  takenAt: string;
  createdAt: string;
  uploader?: PersonSummary;
  sharer?: PersonSummary;
  taskTitle?: string;
}

export interface ProjectUpdate {
  id: string;
  projectId: string;
  createdBy: string;
  title: string;
  body: string;
  isCustomerVisible: boolean;
  photoIds?: string[];
  createdAt: string;
  updatedAt: string;
  author?: PersonSummary;
}

export interface ProjectRequest {
  id: string;
  projectId: string;
  requestedBy: string;
  title: string;
  description?: string;
  category: RequestCategory;
  attachmentUrl?: string;
  status: RequestStatus;
  linkedTaskId?: string;
  respondedAt?: string;
  responseNote?: string;
  createdAt: string;
  updatedAt: string;
  requester?: PersonSummary;
}

/** One message in the customer ↔ owner conversation on a project. */
export interface ProjectMessage {
  id: string;
  companyId?: string;
  projectId: string;
  senderId: string;
  body: string;
  createdAt: string;
  sender?: PersonSummary;
}

export type CustomerTimelineType =
  | 'update_shared'
  | 'photo_shared'
  | 'progress_updated'
  | 'project_started'
  | 'project_completed'
  | 'request_responded';

export interface CustomerTimelineEvent {
  id: string;
  projectId: string;
  eventType: CustomerTimelineType;
  title: string;
  description?: string;
  photoUrl?: string;
  timestamp: string;
}

export interface ProjectHistoryEntry {
  id: string;
  projectId: string;
  actorId?: string;
  eventType: HistoryEventType;
  description: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  actor?: PersonSummary;
}


/** The owner's private note on a project (written while quoting or later). Owner only. */
export interface OwnerProjectNote {
  id: string;
  companyId: string;
  projectId: string;
  body: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** The owner's own picture of the site. Owner only (separate from the customer-visible project photos). */
export interface OwnerProjectPhoto {
  id: string;
  companyId: string;
  projectId: string;
  fileUrl: string;
  fileKey?: string;
  caption?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** A vendor-ready materials list sorted out from the owner's notes. Owner only. */
export interface OwnerMaterialList {
  id: string;
  companyId: string;
  projectId: string;
  title: string;
  items: { category: string; item: string; quantity: number | null; unit: string; notes: string }[];
  sourceText?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}
