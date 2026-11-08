/**
 * Keeps this phone's materials reminders (local notifications) in step with
 * the reminders saved on projects. Mounted once for the owner/admin.
 */

import { useEffect, useMemo } from 'react';
import { db, useDb } from '@/data/store';
import { materialsFor, isDone, nextJobDate } from '@/data/materials';
import { syncMaterialReminders, materialRemindersSupported, type ReminderToSchedule } from '@/lib/materialReminders';

export function useMaterialReminders(enabled: boolean) {
  const v = useDb();
  const reminders = useMemo<ReminderToSchedule[]>(() => {
    if (!enabled || !materialRemindersSupported) return [];
    return Object.values(db.materialPlans)
      .filter((p) => p.reminderAt)
      .map((p) => {
        const project = db.projects.find((x) => x.id === p.projectId);
        return {
          projectId: p.projectId,
          projectName: project?.name ?? 'Project',
          at: p.reminderAt!,
          jobDate: nextJobDate(p.projectId) ?? p.reminderJobDate,
          outstanding: materialsFor(p.projectId).filter((m) => !isDone(m)).length,
          note: p.reminderNote,
        };
      })
      .filter((r) => r.outstanding > 0 || !!r.note);
  }, [enabled, v]);

  // Only reschedule when something that's shown in the notification changed.
  const signature = JSON.stringify([db.ready, reminders]);
  useEffect(() => {
    if (!enabled || !materialRemindersSupported || !db.ready) return;
    const t = setTimeout(() => { syncMaterialReminders(reminders); }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, signature]);
}
