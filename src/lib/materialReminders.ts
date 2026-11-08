/**
 * Materials prep reminders as local notifications on the owner's phone.
 *
 * The reminder itself is saved on the project (project_material_plans), so
 * it's the same on every device. Each phone the owner is signed in on
 * schedules its own notification from that saved time; syncing cancels this
 * phone's earlier materials reminders and schedules the current ones, so a
 * changed or cleared reminder never fires twice. The web app shows reminders
 * in the Materials screens only.
 */

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { logger } from './logger';
import { formatDocDate } from './documentHtml';

const KIND = 'materials_reminder';

export const materialRemindersSupported = Platform.OS === 'ios' || Platform.OS === 'android';

export interface ReminderToSchedule {
  projectId: string;
  projectName: string;
  at: string;
  jobDate?: string;
  outstanding: number;
  note?: string;
}

export async function syncMaterialReminders(reminders: ReminderToSchedule[]): Promise<void> {
  if (!materialRemindersSupported) return;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => (n.content.data as { kind?: string } | undefined)?.kind === KIND)
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );
    const now = Date.now();
    for (const r of reminders) {
      const when = new Date(r.at);
      if (!(when.getTime() > now)) continue;
      const items = r.outstanding === 1 ? '1 item' : `${r.outstanding} items`;
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `Materials: ${r.projectName}`,
          body: [r.jobDate ? `${items} to prepare for ${formatDocDate(r.jobDate)}` : `${items} to prepare`, r.note].filter(Boolean).join(' · '),
          sound: 'default',
          data: { kind: KIND, linkedEntityType: 'materials', linkedEntityId: r.projectId },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
      });
    }
  } catch (e) {
    logger.warn('Materials reminders not scheduled', { error: e instanceof Error ? e.message : String(e) });
  }
}
