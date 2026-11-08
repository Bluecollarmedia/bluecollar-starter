import type { Feather } from '@expo/vector-icons';

export type ResourceCategory = 'access_code' | 'vehicle' | 'equipment' | 'company_info' | 'company_card';

/**
 * A company resource. The protected code itself is never part of this
 * object: it lives encrypted in Supabase Vault and only comes back from
 * reveal_resource_secret(), one resource at a time, after an access check.
 */
export interface CompanyResource {
  id: string;
  companyId: string;
  category: ResourceCategory;
  name: string;
  description?: string;
  /** Trucks & Trailers: the existing truck record (trailers are trucks too). */
  truckId?: string;
  /** Equipment, or anything without its own record. */
  itemName?: string;
  /** Company cards: safe metadata only, never a full number or PIN. */
  cardLastFour?: string;
  cardHolderId?: string;
  /** True when a protected code is stored. Set by the server only. */
  hasSecret?: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceAccess {
  id: string;
  companyId: string;
  resourceId: string;
  personId: string;
  grantedBy?: string;
  createdAt: string;
}

export type ResourceAuditEvent =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'access_granted'
  | 'access_revoked'
  | 'code_changed'
  | 'code_removed'
  | 'code_revealed';

export interface ResourceAuditEntry {
  id: string;
  companyId: string;
  resourceId?: string;
  resourceName?: string;
  actorId?: string;
  eventType: ResourceAuditEvent;
  targetPersonId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ResourceCategoryInfo {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  /** Label for the protected-code field, when the category has one. */
  secretLabel?: string;
}

export const RESOURCE_CATEGORIES: Record<ResourceCategory, ResourceCategoryInfo> = {
  access_code: { label: 'Access Codes', icon: 'key', secretLabel: 'Code' },
  vehicle: { label: 'Trucks & Trailers', icon: 'truck', secretLabel: 'Lock or access code' },
  equipment: { label: 'Equipment', icon: 'tool', secretLabel: 'Code' },
  company_info: { label: 'Company Information', icon: 'info', secretLabel: 'Protected info' },
  company_card: { label: 'Company Cards', icon: 'credit-card' },
};

export const RESOURCE_CATEGORY_ORDER: ResourceCategory[] = [
  'access_code',
  'vehicle',
  'equipment',
  'company_info',
  'company_card',
];
