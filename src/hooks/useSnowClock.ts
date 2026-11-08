import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { canClockIn, checkMyShift, claimStaleShift, clockIn, loadMyUnsettledShifts, loadShifts, splitShifts, startOfWeekIso, type SnowShift } from '@/data/snowShifts';

/**
 * A Snow worker's clock state, for any screen that shows it (the Route tab's Clock In gate and the Time Clock tab). There
 * is one clock: whichever screen is showing reads it fresh every time the person comes to it, so the two can never disagree.
 * `open` is the shift they are clocked in on, if any; `allowed` is whether the database would let them clock in right now (on a route in a
 * dispatched storm).
 */
export function useSnowClock() {
  const [open, setOpen] = useState<SnowShift | null>(null);
  /** A shift never clocked out of: counts as zero hours, blocks nothing, and shows ONE card asking when they stopped. */
  const [stale, setStale] = useState<SnowShift | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    // First let the database flag any shift that was never clocked out of, so nothing stale is ever shown as "clocked in".
    await checkMyShift();
    const [week, unsettled, can] = await Promise.all([loadShifts(startOfWeekIso()), loadMyUnsettledShifts(), canClockIn()]);
    if (week.ok || unsettled.ok) {
      const byId = new Map<string, SnowShift>();
      for (const sh of [...(week.ok ? week.data : []), ...(unsettled.ok ? unsettled.data : [])]) byId.set(sh.id, sh);
      const split = splitShifts([...byId.values()]);
      setOpen(split.open ?? null);
      setStale(split.stale ?? null);
    }
    setAllowed(can);
    setLoading(false);
  }, []);

  // Tabs stay mounted, so reload each time this screen comes back to the front.
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  // While not clocked in the owner may put them on a route or dispatch a storm at any moment: look again every minute and whenever the app
  // comes back to the front, so the right screen appears without anyone reopening the app.
  useEffect(() => {
    if (open) return;
    const timer = setInterval(() => { void refresh(); }, 60_000);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') void refresh(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [open, refresh]);

  /** Clocks in, then reads the clock again. Resolves with an error sentence, or null when it worked. */
  const clockInNow = useCallback(async (): Promise<string | null> => {
    setBusy(true);
    const res = await clockIn();
    setBusy(false);
    await refresh();
    return res.ok ? null : res.error;
  }, [refresh]);

  /** Saves the worker's answer about the shift they never clocked out of (null = not sure). Resolves with an error sentence, or null when it worked. */
  const claimStale = useCallback(async (shiftId: string, stoppedAtIso: string | null): Promise<string | null> => {
    setBusy(true);
    const res = await claimStaleShift(shiftId, stoppedAtIso);
    setBusy(false);
    await refresh();
    return res.ok ? null : res.error;
  }, [refresh]);

  return { open, stale, allowed, loading, busy, refresh, clockInNow, claimStale };
}
