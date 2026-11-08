import React, { useState } from 'react';
import { Alert, Platform } from 'react-native';
import { ListSection, ListRow } from '@/components/ui';
import { useWorkerContext } from '@/providers/WorkerProvider';
import { TruckPickSheet } from '@/components/time/TruckPickSheet';
import type { TruckOptions } from '@/data/timeTracking';
import { haptics } from '@/lib/haptics';
import { useT, tr } from '@/i18n';

function say(title: string, message: string) {
  if (Platform.OS === 'web') (globalThis as { alert?: (m: string) => void }).alert?.(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

/**
 * The ONLY place a worker clocks out by hand now (Settings), kept small on purpose: no timer, no hours, nothing about the day's total.
 *  - Clocked in: "Clock out". Uses the same clock-out as always, so the same safety rules apply (not while a property timer or a
 *    break is running) and it is allowed even when work remains.
 *  - Clocked out today and the server allows another session: "Clock in again" (a new session; the closed one is never touched).
 * Shows nothing when the time clock is not installed, or when neither applies.
 */
export function ClockRow() {
  const t = useT();
  const { workday: w } = useWorkerContext();
  const [pickTruck, setPickTruck] = useState<TruckOptions | null>(null);
  const [loading, setLoading] = useState(false);
  if (w.installed !== true) return null;

  const active = !!w.active;
  const canAgain = !active && !!w.today?.clockOutAt && w.day?.canClockIn !== false;
  if (!active && !canAgain) return null;

  function onClockOut() {
    haptics.select();
    const go = async () => {
      const r = await w.clockOut();
      if (r.ok) haptics.success(); else say(tr("Can't clock out yet"), r.error);
    };
    Alert.alert(tr('Clock out for today?'), undefined, [
      { text: tr('Not yet'), style: 'cancel' },
      { text: tr('Clock Out'), style: 'destructive', onPress: go },
    ]);
  }
  async function doClockIn(truckId?: string) {
    setPickTruck(null);
    const r = await w.clockIn(truckId);
    if (r.ok) haptics.success(); else say(tr("Couldn't start your workday"), r.error);
  }
  async function onClockInAgain() {
    haptics.select();
    setLoading(true);
    const opts = await w.loadTrucks();
    setLoading(false);
    if (!opts.ok) { say(tr("Couldn't start your workday"), opts.error); return; }
    if (opts.data.assignedTruckId || opts.data.trucks.length === 0) { await doClockIn(undefined); return; }
    setPickTruck(opts.data);
  }

  return (
    <>
      <ListSection title={t('Workday')}>
        {active ? (
          <ListRow icon="log-out" title={t('Clock out')} subtitle={t('End your workday')} showChevron disabled={w.busy} onPress={onClockOut} />
        ) : (
          <ListRow icon="log-in" title={t('Clock in again')} subtitle={t('Start a new session today')} showChevron disabled={w.busy || loading} onPress={onClockInAgain} />
        )}
      </ListSection>
      <TruckPickSheet options={pickTruck} onPick={doClockIn} onClose={() => setPickTruck(null)} />
    </>
  );
}
