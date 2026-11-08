import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { loadLabor } from '@/data/timeTracking';
import { todayKey } from '@/lib/ids';

export interface DayWorkday { clockInAt: string; clockOutAt?: string }

/**
 * Each person's workday on one date, from the time-tracking system (the time clock). `known` is false when time tracking is not
 * installed or cannot be reached (demo mode, offline, older database): screens then fall back to the older day-attendance ("Start Day")
 * wording. This is the single source the owner's Maintenance cards and the Dashboard use for "clocked in", so they always agree.
 */
export function useWorkdaysOn(date: string): { known: boolean; byPerson: Map<string, DayWorkday> } {
  const [state, setState] = useState<{ known: boolean; byPerson: Map<string, DayWorkday> }>({ known: false, byPerson: new Map() });

  const load = useCallback(async () => {
    const res = await loadLabor(date, date);
    if (!res.ok) { setState((s) => (s.known ? { known: false, byPerson: new Map() } : s)); return; }
    const byPerson = new Map<string, DayWorkday>();
    for (const w of res.data.workdays) {
      const prev = byPerson.get(w.personId);
      // the latest workday of the day wins (someone may clock out and back in)
      if (!prev || w.clockInAt > prev.clockInAt) byPerson.set(w.personId, { clockInAt: w.clockInAt, clockOutAt: w.clockOutAt });
    }
    // Someone still on the clock from an earlier day is clocked in today too.
    if (date === todayKey()) for (const w of res.data.staleOpen) if (!byPerson.has(w.personId)) byPerson.set(w.personId, { clockInAt: w.clockInAt });
    setState({ known: true, byPerson });
  }, [date]);

  useFocusEffect(useCallback(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]));

  return state;
}

/** Who is clocked in right now (an open workday today). */
export function useClockedInToday(): { known: boolean; ids: Set<string> } {
  const { known, byPerson } = useWorkdaysOn(todayKey());
  return useMemo(() => ({ known, ids: new Set([...byPerson].filter(([, w]) => !w.clockOutAt).map(([id]) => id)) }), [known, byPerson]);
}
