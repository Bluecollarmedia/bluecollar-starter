/**
 * Snow Mode notifications (supabase/updates/031).
 */

/** Per property, for every snow service there. Persists across storms. */
export interface SnowNotifyPrefs {
  propertyId: string;
  companyId: string;
  notifyOnArrival: boolean;
  notifyOnCompletion: boolean;
  updatedBy?: string;
  updatedAt: string;
}

export type SnowNotificationCategory = 'owner_alert' | 'customer' | 'employee';
export type SnowNotificationEvent = 'visit.arrived' | 'visit.completed';
export type SnowDeliveryChannel = 'in_app' | 'push' | 'email';

/**
 * pending      handed to the sender, no answer yet
 * stored       saved in the person's in-app notifications
 * accepted     Expo / Resend took it; not proof it reached the phone or inbox
 * delivered    a provider confirmed it (nothing sets this yet)
 * failed       the provider refused it
 * unavailable  nothing to send with (no phone, no email, sender not set up)
 */
export type SnowDeliveryStatus = 'pending' | 'stored' | 'accepted' | 'delivered' | 'failed' | 'unavailable';

export interface SnowNotificationDelivery {
  id: string;
  notificationId: string;
  channel: SnowDeliveryChannel;
  status: SnowDeliveryStatus;
  provider?: 'app' | 'expo' | 'resend';
  providerRef?: string;
  detail?: string;
  attemptedAt?: string;
  createdAt: string;
}

export interface SnowNotification {
  id: string;
  companyId: string;
  category: SnowNotificationCategory;
  event: SnowNotificationEvent;
  stormId?: string;
  routeId?: string;
  visitId?: string;
  propertyId?: string;
  service?: string;
  recipientPersonId?: string;
  recipientContactId?: string;
  recipientName?: string;
  recipientEmail?: string;
  title: string;
  body: string;
  dispatchedAt?: string;
  createdAt: string;
  deliveries: SnowNotificationDelivery[];
}
