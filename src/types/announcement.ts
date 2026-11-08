import type { PersonSummary } from './company';
import type { WeatherActionType } from './operations';

export type AnnouncementAudience = 'all_workers' | 'all_members' | 'selected';
export type AnnouncementPriority = 'normal' | 'urgent';

export interface Announcement {
  id: string;
  companyId: string;
  createdBy: string;
  title: string;
  body: string;
  /** Workers' announcements, or a message to customers (customers_all, customers_landscaping, customers_maintenance, customers_snow). */
  audience: AnnouncementAudience | 'customers_all' | 'customers_landscaping' | 'customers_maintenance' | 'customers_snow';
  priority: AnnouncementPriority;
  weatherAction?: WeatherActionType;
  /** Who it was sent to (active workers at send time). Empty = everyone. */
  recipientIds?: string[];
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
  author?: PersonSummary;
  readCount?: number;
  totalRecipients?: number;
}

export interface AnnouncementRead {
  id: string;
  announcementId: string;
  personId: string;
  readAt: string;
}
