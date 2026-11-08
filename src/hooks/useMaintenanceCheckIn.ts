import { useCallback, useMemo, useState } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import { db, useDb } from '@/data/store';
import { startDay as saveDayStart, markArrived, myAttendance, classifyLocation, type Result } from '@/data/maintenance';
import { getCurrentGps, type GpsResult } from '@/lib/location';
import { unverifiedPrompt } from '@/lib/maintenanceCheckIn';
import { todayKey } from '@/lib/ids';
import { haptics } from '@/lib/haptics';
import { useCompanyYard } from '@/hooks/useCompanyYard';
import { tr } from '@/i18n';
import type { LocationStatus, MaintenanceDayAttendance, MaintenanceStop } from '@/types/maintenance';

/** Yard radius used by maintenance_start_day() in the database. */
const YARD_RADIUS_M = 300;

export interface DayStartState {
  started: boolean;
  startedAt?: string;
  locationStatus?: LocationStatus;
  /** True only when the phone's location placed the worker at the yard. */
  verified: boolean;
  /** The owner set or changed this start time (the original is kept on the record). */
  corrected: boolean;
}

export interface StopArrival {
  /** First crew arrival: the stop's shared "arrived" state. */
  arrivedAt?: string;
  arrivedBy?: string;
  locationStatus?: LocationStatus;
  /** This worker's own I'M HERE for the stop (each worker checks in separately). */
  mine?: { occurredAt: string; locationStatus?: LocationStatus };
}

type Choice = 'continue' | 'cancel';

/**
 * Asks whether to save a check-in the phone couldn't verify. Never a dead
 * end: "continue" is always offered, Open Settings too when location is off.
 */
function askToContinue(prompt: { title: string; message: string; openSettings?: boolean }, continueLabel: string): Promise<Choice> {
  return new Promise((resolve) => {
    Alert.alert(prompt.title, prompt.message, [
      { text: tr('Cancel'), style: 'cancel', onPress: () => resolve('cancel') },
      ...(prompt.openSettings
        ? [{ text: tr('Open Settings'), onPress: () => { Linking.openSettings().catch(() => {}); resolve('cancel'); } }]
        : []),
      { text: continueLabel, onPress: () => resolve('continue') },
    ], { cancelable: true, onDismiss: () => resolve('cancel') });
  });
}

function showError(message: string) {
  if (Platform.OS === 'web') (globalThis as { alert?: (m: string) => void }).alert?.(tr(message));
  else Alert.alert(tr('Couldn’t save'), tr(message));
}

/**
 * Start Day at the yard and I'M HERE at each stop, for the signed-in
 * maintenance worker. Both read the phone's location when they can, warn
 * honestly when it can't be verified, and always let the worker carry on.
 * Saving (and the final location grading) is done by src/data/maintenance.ts.
 */
export function useMaintenanceCheckIn(serviceDate: string = todayKey()) {
  const v = useDb();
  const { yard, label: yardName } = useCompanyYard();
  /** 'day' while starting the day, a stop id while checking in there. */
  const [busy, setBusy] = useState<string | null>(null);

  const attendance: MaintenanceDayAttendance | undefined = useMemo(() => myAttendance(serviceDate), [v, serviceDate]);

  const dayStart: DayStartState = useMemo(() => ({
    started: !!attendance,
    startedAt: attendance?.startedAt,
    locationStatus: attendance?.locationStatus,
    verified: attendance?.locationStatus === 'verified',
    corrected: attendance?.source === 'owner_correction',
  }), [attendance]);

  const startDay = useCallback(async (routeId?: string): Promise<Result<MaintenanceDayAttendance> | null> => {
    if (busy) return null;
    const existing = myAttendance(serviceDate);
    if (existing) return { ok: true, data: existing };
    setBusy('day');
    try {
      const gps: GpsResult = await getCurrentGps();
      const { status } = classifyLocation(gps, { latitude: yard?.latitude, longitude: yard?.longitude }, YARD_RADIUS_M);
      const prompt = unverifiedPrompt(status, yardName, 'day');
      if (prompt && (await askToContinue(prompt, tr('Start day anyway'))) === 'cancel') return null;
      const res = await saveDayStart({ gps, routeId, serviceDate });
      if (res.ok) haptics.success();
      else showError(res.error);
      return res;
    } finally {
      setBusy(null);
    }
  }, [busy, serviceDate, yard, yardName]);

  const arriveAtStop = useCallback(async (stopId: string): Promise<Result<MaintenanceStop> | null> => {
    if (busy) return null;
    const stop = db.maintenance.stopById[stopId];
    if (!stop) return { ok: false, error: tr('Stop not found.') };
    setBusy(stopId);
    try {
      const gps: GpsResult = await getCurrentGps();
      const p = stop.property;
      const { status } = classifyLocation(gps, p, p?.checkinRadiusM ?? 150);
      const prompt = unverifiedPrompt(status, p?.name ?? tr('this property'), 'stop');
      if (prompt && (await askToContinue(prompt, tr('Check in anyway'))) === 'cancel') return null;
      const res = await markArrived(stopId, gps);
      if (res.ok) haptics.success();
      else showError(res.error);
      return res;
    } finally {
      setBusy(null);
    }
  }, [busy]);

  const arrivalFor = useCallback((stopId: string): StopArrival | null => {
    const stop = db.maintenance.stopById[stopId];
    if (!stop) return null;
    const mineEvent = db.maintenance.events.find(
      (e) => e.stopId === stopId && e.personId === db.personId && e.eventType === 'arrived',
    );
    if (!stop.arrivedAt && !mineEvent) return null;
    return {
      arrivedAt: stop.arrivedAt,
      arrivedBy: stop.arrivedBy,
      locationStatus: stop.arrivalLocationStatus,
      mine: mineEvent ? { occurredAt: mineEvent.occurredAt, locationStatus: mineEvent.locationStatus } : undefined,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);

  return { yard, yardName, dayStart, startDay, arriveAtStop, arrivalFor, busy };
}
