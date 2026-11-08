/**
 * Materials preparation: each project's checklist of materials to order or
 * pick up, saved vendors / pickup places, and a reminder tied to the job's
 * scheduled date. Owner/admin only; never shown to customers.
 */

export type MaterialStatus = 'needs_review' | 'to_order' | 'ordered' | 'ready' | 'picked_up' | 'complete';

/** Where a suggested material came from (an approved quote / change order line). */
export interface MaterialSource {
  type: 'quote' | 'change_order';
  id: string;
  number: string;
  lineItemId: string;
  /** The quantity and unit as written on the document. */
  quantity?: number;
  unit?: string;
}

export interface MaterialVendor {
  id: string;
  companyId: string;
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  pickupInstructions?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMaterial {
  id: string;
  companyId: string;
  projectId: string;
  name: string;
  /** Undefined when not known yet. */
  quantity?: number;
  unit?: string;
  status: MaterialStatus;
  vendorId?: string;
  /** Internal only. */
  notes?: string;
  source?: MaterialSource;
  sortOrder: number;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialPlan {
  projectId: string;
  companyId: string;
  vendorId?: string;
  pickupLocation?: string;
  pickupInstructions?: string;
  handlingNotes?: string;
  /** ISO timestamp. */
  reminderAt?: string;
  /** The job date (YYYY-MM-DD) the reminder was set for. */
  reminderJobDate?: string;
  reminderNote?: string;
  /** "<docId>:<lineItemId>" of suggestions the owner removed. */
  dismissedSources: string[];
  updatedAt?: string;
}
