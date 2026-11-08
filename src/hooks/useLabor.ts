import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { loadLabor, type LaborSnapshot } from '@/data/timeTracking';

export interface LaborState {
  snapshot: LaborSnapshot | null;
  loading: boolean;
  error: string | null;
  /** The database update is not installed yet. */
  notInstalled: boolean;
  reload: () => Promise<void>;
}

/**
 * The owner's time records for a date range (and one employee when given). Reloads whenever the screen comes into view,
 * every minute while it is open (so "clocked in now" stays true), and after any change the screen makes (call reload()).
 */
export function useLabor(fromDate: string, toDate: string, personId?: string, autoRefreshMs = 60_000): LaborState {
  const [snapshot, setSnapshot] = useState<LaborSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notInstalled, setNotInstalled] = useState(false);
  const ticket = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++ticket.current;
    if (!fromDate) { setLoading(false); return; }
    const r = await loadLabor(fromDate, toDate, personId);
    if (mine !== ticket.current) return;
    setLoading(false);
    if (r.ok) { setSnapshot(r.data); setError(null); setNotInstalled(false); }
    else if (r.notInstalled) setNotInstalled(true);
    else setError(r.error);
  }, [fromDate, toDate, personId]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    reload();
    const id = autoRefreshMs > 0 ? setInterval(reload, autoRefreshMs) : undefined;
    return () => { if (id) clearInterval(id); };
  }, [reload, autoRefreshMs]));

  useEffect(() => () => { ticket.current++; }, []);

  return { snapshot, loading, error, notInstalled, reload };
}
