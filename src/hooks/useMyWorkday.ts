import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { todayKey } from '@/lib/ids';
import { netMs, grossMs, type TimeBreak } from '@/lib/timeCalc';
import { isCurrent, needsAnswer, WORKDAY_STALE_HOURS } from '@/lib/clockSession';
import { getCurrentGps } from '@/lib/location';
import { reportClockInLocation } from '@/data/yard';
import { refresh as refreshStore } from '@/data/store';
import {
  onTimeChanged, clockIn as apiClockIn, clockOut as apiClockOut, completeVisit as apiCompleteVisit, endBreak as apiEndBreak, loadMyDay, loadTruckOptions,
  startBreak as apiStartBreak, startVisit as apiStartVisit, claimStaleEnd as apiClaimStale,
  type Gps, type MyDay, type MyWorkday, type Result, type TruckOptions,
} from '@/data/timeTracking';

const POLL_MS = 60_000;

export interface Workday {
  /** null while the first answer is loading; false when the database update isn't installed (the old check-in screens are used). */
  installed: boolean | null;
  day: MyDay | null;
  loading: boolean;
  /** An action is running (clock in, start a property, ...). */
  busy: boolean;
  /** The last problem, in plain words. Cleared by the next action. */
  error: string | null;
  /** Add this to Date.now() to get server time (a wrong phone clock can't skew the timers). */
  clockOffsetMs: number;
  /** The workday that is really running now. A day that was never clocked out of (stale or flagged) is NEVER this: see `stale`. */
  active?: MyWorkday;
  /** A day the worker never clocked out of. It blocks nothing and counts for nothing today; the screens show ONE card asking when they stopped. */
  stale?: MyWorkday;
  /** The workday that counts for "today" (the open one, else the latest closed one today). */
  today?: MyWorkday;
  onBreak: boolean;
  /** Net payable time across today's workdays at a moment (live while clocked in). */
  netMsAt: (nowMs: number) => number;
  refresh: () => Promise<void>;
  loadTrucks: () => Promise<Result<TruckOptions>>;
  clockIn: (truckId?: string) => Promise<Result<MyDay>>;
  clockOut: () => Promise<Result<MyDay>>;
  startBreak: () => Promise<Result<MyDay>>;
  endBreak: () => Promise<Result<MyDay>>;
  /** Tell the owner when you really stopped a day you never clocked out of (null = not sure). Saved only; no hours change. */
  claimStale: (workdayId: string, stoppedAtIso: string | null, note?: string) => Promise<Result<MyDay>>;
  startVisit: (source: 'maintenance_stop' | 'assignment', refId: string, gps?: Gps) => Promise<Result<MyDay>>;
  completeVisit: (visitId: string, note?: string, gps?: Gps) => Promise<Result<MyDay>>;
}

/**
 * The signed-in worker's workday: clock in/out, breaks, and the property they are working at. Everything comes from the database;
 * a tap shows as done only after the database says so. The screen refreshes every minute (which is also when the database looks for
 * alerts). This hook does not tick every second: the card that shows a running timer does that itself, so the rest of the app is not
 * re-drawn every second.
 */
export function useMyWorkday(enabled: boolean): Workday {
  const [day, setDay] = useState<MyDay | null>(null);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const apply = useCallback((r: Result<MyDay>) => {
    if (r.ok) { setDay(r.data); setInstalled(true); setError(null); }
    else if (r.notInstalled) setInstalled(false);
    else setError(r.error);
    return r;
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    const r = await loadMyDay(todayKey());
    inFlight.current = false;
    setLoading(false);
    apply(r);
  }, [enabled, apply]);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    refresh();
    const poll = setInterval(refresh, POLL_MS);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refresh(); });
    return () => { clearInterval(poll); sub.remove(); };
  }, [enabled, refresh]);

  // Something else (a maintenance stop screen, for example) started or finished a property: pick the new state up now.
  useEffect(() => (enabled ? onTimeChanged(() => { refresh(); }) : undefined), [enabled, refresh]);

  const act = useCallback(async <T,>(run: () => Promise<Result<T>>): Promise<Result<T>> => {
    setBusy(true);
    setError(null);
    const r = await run();
    setBusy(false);
    if (!r.ok) { if (r.notInstalled) setInstalled(false); else setError(r.error); }
    return r;
  }, []);
  const doApply = useCallback((r: Result<MyDay>) => (r.ok ? apply(r) : r), [apply]);

  // What counts as "clocked in" is decided in ONE place (lib/clockSession), the same for every clock: a day open for longer than the owner's
  // "open workday hours" (or already flagged by the database) is stale and never the running day.
  const staleHours = day?.settings.staleAfterHours ?? WORKDAY_STALE_HOURS;
  const asSession = (d: MyWorkday) => ({ clockInAt: d.clockInAt, clockOutAt: d.clockOutAt, flagged: d.status === 'needs_review' });
  const { active, stale, todays } = useMemo(() => {
    const nowMs = Date.now() + (day?.clockOffsetMs ?? 0);
    const days = day?.days ?? [];
    return {
      active: days.find((d) => !d.clockOutAt && isCurrent(asSession(d), nowMs, staleHours)),
      stale: days.find((d) => needsAnswer(asSession(d), nowMs, staleHours)),
      todays: days.filter((d) => d.status !== 'needs_review' && (d.workDate === day?.workDate || (!d.clockOutAt && isCurrent(asSession(d), nowMs, staleHours)))),
    };
  }, [day, staleHours]);
  const today = active ?? todays[todays.length - 1];
  const netMsAt = useCallback((nowMs: number) => todays.reduce((t, d) => {
    const breaks: TimeBreak[] = d.breaks.map((b) => ({ startedAt: b.startedAt, endedAt: b.endedAt ?? null, paid: b.paid }));
    return t + netMs({ clockInAt: d.clockInAt, clockOutAt: d.clockOutAt ?? null }, breaks, nowMs);
  }, 0), [todays]);
  void grossMs;

  const clockIn = useCallback((truckId?: string) => act(async () => {
    // The phone's location is read WHILE the clock-in happens, never before it: clocking in is never held up or refused because of it.
    const where = getCurrentGps();
    const r = await apiClockIn(todayKey(), truckId).then(doApply);
    if (r.ok) void reportClockInLocation(r.data, where);
    return r;
  }), [act, doApply]);
  // Clocking out for the day also ends any project the worker is still on (the database does it), so the jobs are reloaded to show that.
  const clockOut = useCallback(() => act(async () => {
    const r = await apiClockOut().then(doApply);
    if (r.ok) await refreshStore('assignments', 'check_ins', 'check_outs', 'work_sessions');
    return r;
  }), [act, doApply]);
  const startBreak = useCallback(() => act(() => apiStartBreak().then(doApply)), [act, doApply]);
  const endBreak = useCallback(() => act(() => apiEndBreak().then(doApply)), [act, doApply]);
  const claimStale = useCallback((workdayId: string, stoppedAtIso: string | null, note?: string) => act(() => apiClaimStale(workdayId, stoppedAtIso, note).then(doApply)), [act, doApply]);
  const startVisit = useCallback((source: 'maintenance_stop' | 'assignment', refId: string, gps?: Gps) => act(() => apiStartVisit(source, refId, gps).then(doApply)), [act, doApply]);
  const completeVisit = useCallback((visitId: string, note?: string, gps?: Gps) => act(() => apiCompleteVisit(visitId, note, gps).then(doApply)), [act, doApply]);
  const loadTrucks = useCallback(() => loadTruckOptions(todayKey()), []);

  return useMemo<Workday>(() => ({
    installed, day, loading, busy, error, clockOffsetMs: day?.clockOffsetMs ?? 0, active, stale, today,
    onBreak: !!active?.breaks.some((b) => !b.endedAt), netMsAt, refresh, loadTrucks, clockIn, clockOut, startBreak, endBreak, claimStale, startVisit, completeVisit,
  }), [installed, day, loading, busy, error, active, stale, today, netMsAt, refresh, loadTrucks, clockIn, clockOut, startBreak, endBreak, claimStale, startVisit, completeVisit]);
}
