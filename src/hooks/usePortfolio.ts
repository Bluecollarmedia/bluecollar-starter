import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { cachePortfolioEnabled, fetchPortfolioEnabled, getLoadedPortfolio, loadPublicPortfolio, readCachedPortfolioEnabled } from '@/data/portfolio';
import { WEATHER_ON_THIS_DEVICE } from '@/lib/weatherPlatform';
import type { PublicPortfolio } from '@/lib/portfolio';

/**
 * Is Our Work on? Starts from the answer remembered on the phone (so the tab never flickers or waits), asks the server right away and
 * whenever the app comes back, and follows the answer. Never true on the website (the public area is for the phone app only).
 */
export function usePortfolioEnabled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!WEATHER_ON_THIS_DEVICE) return;
    let alive = true;
    const ask = async () => {
      const fresh = await fetchPortfolioEnabled();
      if (!alive || fresh === null) return;   // cannot be read: keep what we had
      setOn(fresh);
      void cachePortfolioEnabled(fresh);
    };
    readCachedPortfolioEnabled().then((v) => { if (alive) setOn(v); });
    void ask();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void ask(); });
    return () => { alive = false; sub.remove(); };
  }, []);
  return on && WEATHER_ON_THIS_DEVICE;
}

export type PortfolioView =
  | { status: 'loading' }
  | { status: 'ready'; data: PublicPortfolio; stale: boolean }
  | { status: 'off' }
  | { status: 'unavailable' };

/** The feed: loaded on open and whenever asked (pull to refresh). */
export function usePublicPortfolio(): { view: PortfolioView; refresh: () => Promise<void> } {
  const [view, setView] = useState<PortfolioView>(() => {
    const have = getLoadedPortfolio();
    return have ? { status: 'ready', data: have, stale: false } : { status: 'loading' };
  });
  const refresh = useCallback(async () => {
    const r = await loadPublicPortfolio();
    if (!r.ok) return setView((v) => (v.status === 'ready' ? v : { status: 'unavailable' }));
    setView(r.data.enabled ? { status: 'ready', data: r.data, stale: r.stale } : { status: 'off' });
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { view, refresh };
}
