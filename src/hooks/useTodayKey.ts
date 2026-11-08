/**
 * Today's local date key (YYYY-MM-DD) that stays right after midnight: it is worked out again every minute, when the app comes back to the
 * front, and when the screen is focused. Only a real change of day re-renders the screen.
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { todayKey } from '@/lib/ids';

export function useTodayKey(): string {
  const [today, setToday] = useState(() => todayKey());
  const refresh = useCallback(() => setToday(todayKey()), []);

  useEffect(() => {
    const id = setInterval(refresh, 60_000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refresh(); });
    return () => { clearInterval(id); sub.remove(); };
  }, [refresh]);

  useFocusEffect(refresh);

  return today;
}
