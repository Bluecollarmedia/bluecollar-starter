/**
 * "Customer Message Notifications": a personal on/off for the PHONE ALERT only.
 * It is stored as the owner's own row in notification_preferences (event "customer_message_push"), so it follows the owner
 * across restarts and devices. Off never hides anything: the message still lands in the in-app notification center and the
 * unread badge still counts it. The send-notification Edge Function reads this same row before it pushes.
 * No row means on (the default).
 */
import { db, findRow, insertRow, updateRow } from '@/data/store';

export const CUSTOMER_MESSAGE_PUSH = 'customer_message_push';

function myRow() {
  return db.notificationPreferences.find((p) => p.personId === db.personId && (p.eventType as string) === CUSTOMER_MESSAGE_PUSH);
}

export function customerMessagePushEnabled(): boolean {
  return myRow()?.enabled ?? true;
}

export function setCustomerMessagePush(enabled: boolean): void {
  const row = myRow();
  if (row) {
    if (findRow('notification_preferences', row.id)) updateRow('notification_preferences', row.id, { enabled });
    return;
  }
  insertRow('notification_preferences', { personId: db.personId, eventType: CUSTOMER_MESSAGE_PUSH, enabled });
}
