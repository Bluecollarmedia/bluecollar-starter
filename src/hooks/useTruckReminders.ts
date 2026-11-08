/**
 * Keeps this phone's truck maintenance reminders (local notifications) in step with the due dates saved on the maintenance records.
 * Mounted once for the owner (maintenance records are owner-only).
 */
import { useEffect, useMemo } from 'react';
import { db, useDb } from '@/data/store';
import { rowsOf } from '@/data/store';
import { syncTruckReminders, truckRemindersSupported } from '@/lib/truckReminders';
import type { ReminderSource } from '@/lib/truckMaintenance';
import type { TruckMaintenance } from '@/types/truck';

export function useTruckReminders(enabled: boolean) {
  const v = useDb();
  const records = useMemo<ReminderSource[]>(() => {
    if (!enabled || !truckRemindersSupported || db.role !== 'owner') return [];
    const names = new Map((rowsOf('trucks') as unknown as { id: string; name: string }[]).map((t) => [t.id, t.name]));
    return (rowsOf('truck_maintenance') as unknown as TruckMaintenance[])
      .filter((m) => !!m.dueOn)
      .map((m) => ({ id: m.id, truckId: m.truckId, truckName: names.get(m.truckId) ?? 'Truck', title: m.title, dueOn: m.dueOn }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, v]);

  const signature = JSON.stringify([db.ready, records]);
  useEffect(() => {
    if (!enabled || !truckRemindersSupported || !db.ready) return;
    const t = setTimeout(() => { syncTruckReminders(records); }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, signature]);
}
