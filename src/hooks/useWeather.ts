import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { loadWeather, readLastWeather, saveLastWeather } from '@/data/weather';
import { weatherSwitch } from '@/data/publicWeather';
import type { Place } from '@/lib/weatherTowns';
import type { WeatherPayload } from '@/lib/weatherView';

export type WeatherView =
  | { status: 'loading'; data: null }
  | { status: 'ready'; data: WeatherPayload }
  /** A fresh answer could not be had: this is the last good one, and how old it is is shown with it. */
  | { status: 'stale'; data: WeatherPayload }
  | { status: 'unavailable'; data: null };

const REFRESH_MS = 10 * 60_000;
/** A foreground or launch refresh is skipped when the app asked less than this long ago (iOS can announce "active" right after launch). */
const MIN_GAP_MS = 2 * 60_000;

/** The forecast for a place: the saved one at once, a fresh one right after, and a new one every 10 minutes and whenever the app comes back. */
export function useWeather(place: Place): { view: WeatherView; refresh: () => void; busy: boolean } {
  const [view, setView] = useState<WeatherView>({ status: 'loading', data: null });
  const [busy, setBusy] = useState(false);
  const current = useRef<Place>(place);
  current.current = place;
  const have = useRef<WeatherPayload | null>(null);
  const lastAsk = useRef<{ key: string; at: number }>({ key: '', at: 0 });

  const refresh = useCallback(async (force = false) => {
    const asked = current.current;
    if (!force && lastAsk.current.key === asked.key && Date.now() - lastAsk.current.at < MIN_GAP_MS) return;
    lastAsk.current = { key: asked.key, at: Date.now() };
    setBusy(true);
    const r = await loadWeather(asked);
    if (asked.key !== current.current.key) return;
    setBusy(false);
    if (r.ok) {
      have.current = r.data;
      void saveLastWeather(r.data);
      setView(r.stale ? { status: 'stale', data: r.data } : { status: 'ready', data: r.data });
      return;
    }
    if (r.reason === 'disabled') {
      // The owner switched Weather off: ask the switch now, so a visitor is moved to the welcome screen straight away.
      void weatherSwitch.refresh();
      return;
    }
    setView(have.current ? { status: 'stale', data: have.current } : { status: 'unavailable', data: null });
  }, []);

  useEffect(() => {
    let alive = true;
    have.current = null;
    setView({ status: 'loading', data: null });
    readLastWeather(place).then((saved) => {
      if (!alive || !saved || have.current) return;
      have.current = saved;
      setView({ status: 'stale', data: saved });
    });
    void refresh();
    const timer = setInterval(() => { void refresh(); }, REFRESH_MS);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void refresh(); });
    return () => { alive = false; clearInterval(timer); sub.remove(); };
  }, [place.key, refresh]);

  return { view, refresh: () => { void refresh(true); }, busy };
}
