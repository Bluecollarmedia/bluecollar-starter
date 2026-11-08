import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { fetchCurrentStorm, fetchStormHistory, readSavedHistory, readSavedStorm } from '@/data/stormOutlook';
import { isRunning } from '@/lib/sharedRequest';
import type { StormOutlook } from '@/lib/stormView';

const REFRESH_MS = 5 * 60_000;
/** A foreground or mount refresh is skipped when the storm was asked for less than this long ago (it is shared by the home card and the outlook page). */
const MIN_GAP_MS = 60_000;
let lastCurrentAsk = 0;

/** The storm outlook that is published right now (null when there is none): the saved one at once, a fresh one right after, then every 5 minutes. */
export function useCurrentStorm(): { storm: StormOutlook | null; ready: boolean; refresh: () => void } {
  const [storm, setStorm] = useState<StormOutlook | null>(null);
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async (force = false) => {
    if (!force && Date.now() - lastCurrentAsk < MIN_GAP_MS && !isRunning('storm.current')) { setStorm(await readSavedStorm()); setReady(true); return; }
    lastCurrentAsk = Date.now();
    const r = await fetchCurrentStorm();
    setStorm(r.storm);
    setReady(true);
  }, []);
  useEffect(() => {
    let alive = true;
    readSavedStorm().then((s) => { if (alive && s) setStorm(s); });
    void refresh();
    const timer = setInterval(() => { void refresh(); }, REFRESH_MS);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void refresh(); });
    return () => { alive = false; clearInterval(timer); sub.remove(); };
  }, [refresh]);
  return { storm, ready, refresh: () => { void refresh(true); } };
}

/** Every storm Brighton has posted, newest first, each with all its updates. */
export function useStormHistory(): { storms: StormOutlook[]; loading: boolean; refresh: () => void } {
  const [storms, setStorms] = useState<StormOutlook[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    const r = await fetchStormHistory();
    setStorms(r.storms);
    setLoading(false);
  }, []);
  useEffect(() => {
    let alive = true;
    readSavedHistory().then((s) => { if (alive && s.length) { setStorms(s); setLoading(false); } });
    void refresh();
    return () => { alive = false; };
  }, [refresh]);
  return { storms, loading, refresh: () => { void refresh(); } };
}
