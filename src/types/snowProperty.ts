import type { SnowService } from './snow';
export type { SnowService };
export { SNOW_SERVICES } from './snow';
export { SERVICE_LABEL as SNOW_SERVICE_LABELS } from './snow';

export { SERVICE_ICON as SNOW_SERVICE_ICONS } from './snow';

export interface SnowPropertyContact {
  id: string;
  companyId: string;
  propertyId: string;
  name: string;
  title?: string;
  phone?: string;
  email?: string;
  /** Linked customer account; lets that customer see this property. */
  personId?: string;
  isPrimary: boolean;
  sortOrder: number;
  removedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SnowPropertyService {
  id: string;
  companyId: string;
  propertyId: string;
  service: SnowService;
  isActive: boolean;
  deactivatedAt?: string;
  /** Photos for this service at this property: true / false, or empty to follow the route (update 112). */
  photosRequired?: boolean | null;
  /** How many photos when required, or empty to follow the route's number (update 112). */
  photoCount?: number | null;
  createdAt: string;
  updatedAt: string;
}

/** One saved version. Editing adds a version; old ones never change. */
export interface SnowServiceInstructions {
  id: string;
  companyId: string;
  propertyServiceId: string;
  version: number;
  body: string;
  createdBy?: string;
  createdAt: string;
}

/** Reference photo/video. Never deleted: removing sets retiredAt. */
export interface SnowReferenceMedia {
  id: string;
  companyId: string;
  propertyServiceId: string;
  mediaType: 'image' | 'video';
  fileKey: string;
  sizeBytes?: number;
  caption?: string;
  createdBy?: string;
  createdAt: string;
  retiredAt?: string;
  retiredBy?: string;
}

/** A service with what's in effect for it (now, or at a past moment). */
export interface SnowServiceReference {
  service: SnowPropertyService;
  instructions?: SnowServiceInstructions;
  media: SnowReferenceMedia[];
}
