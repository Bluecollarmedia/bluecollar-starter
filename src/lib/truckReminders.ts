/**
 * Truck maintenance reminders as local notifications on the owner's phone.
 *
 * The due date is saved on the maintenance record, so it is the same on every device. Each phone the owner is signed in on schedules its
 * own notification for 8:00 AM on the due date; syncing cancels this phone's earlier truck reminders and schedules the current ones, so a
 * changed, completed or deleted record never fires twice. (Same approach as the materials reminders.) A reminder is scheduled the next time
 * the app opens on that phone; it does not need the app to be open when it fires. The web app has no reminders.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { logger } from './logger';
import { remindersToSchedule, type ReminderSource } from './truckMaintenance';

const KIND = 'truck_maintenance_due';

export const truckRemindersSupported = Platform.OS === 'ios' || Platform.OS === 'android';

export async function syncTruckReminders(records: ReminderSource[]): Promise<void> {
  if (!truckRemindersSupported) return;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => (n.content.data as { kind?: string } | undefined)?.kind === KIND)
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );
    for (const r of remindersToSchedule(records, new Date())) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `${r.truckName}: service due`,
          body: `${r.title} is due today.`,
          sound: 'default',
          data: { kind: KIND, linkedEntityType: 'truck', linkedEntityId: r.truckId },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at },
      });
    }
  } catch (e) {
    logger.warn('Truck reminders not scheduled', { error: e instanceof Error ? e.message : String(e) });
  }
}
