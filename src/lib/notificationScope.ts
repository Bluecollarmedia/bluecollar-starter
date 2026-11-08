// Snow alerts and landscaping alerts share one table (app_notifications) so one push system delivers both, but they belong to different
// modes: a plowing alert must never show up in the landscaping notification center, its bell number, or a customer's banner.

interface Scopable {
  eventType?: string;
  linkedEntityType?: string;
  metadata?: Record<string, unknown> | null;
}

/** True for a notification made by the Snow side (stop done, storm dispatched, crew alerts, customer snow updates). */
export function isSnowNotification(n: Scopable | null | undefined): boolean {
  if (!n) return false;
  if (typeof n.eventType === 'string' && n.eventType.startsWith('snow_')) return true;
  if (typeof n.linkedEntityType === 'string' && n.linkedEntityType.startsWith('snow_')) return true;
  return !!n.metadata && typeof n.metadata === 'object' && 'snow_notification_id' in n.metadata;
}

/** The landscaping side's notifications: everything except the Snow ones. */
export function landscapingNotifications<T extends Scopable>(all: T[]): T[] {
  return all.filter((n) => !isSnowNotification(n));
}
