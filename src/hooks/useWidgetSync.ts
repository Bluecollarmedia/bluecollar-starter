import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { loadWeather, readLastWeather, readPlace, saveLastWeather } from '@/data/weather';
import { syncWidgets } from '@/data/widgetSync';
import { isFeatureOn } from '@/config/brand';

/** Widgets exist in this app (settings file: features.widgets, which also needs features.weather). */
const WIDGETS_ON = isFeatureOn('widgets') && isFeatureOn('weather');

const REFRESH_MS = 30 * 60_000;
/** A launch or foreground refresh is skipped when the last one was this recent. */
const MIN_GAP_MS = 5 * 60_000;

/**
 * Keeps the Forecast widgets supplied with a forecast for whoever has the phone, signed in or not. The widgets cannot ask for weather
 * themselves, and they used to be fed only while the Weather screen was open, which a signed-in person never sees: so they stayed empty.
 * This asks for the last chosen place (the settings file's weather.defaultPlace the first time) at launch, every 30 minutes and when the app comes back, and falls back to
 * the saved forecast when the phone is offline. iPhone only; never throws; never holds anything up.
 */
export function useWidgetSync(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios' || !WIDGETS_ON) return;
    let alive = true;
    let lastAt = 0;
    const run = async () => {
      if (Date.now() - lastAt < MIN_GAP_MS) return;
      lastAt = Date.now();
      try {
        const place = await readPlace();
        const r = await loadWeather(place);
        if (!alive) return;
        if (r.ok) {
          void saveLastWeather(r.data);
          await syncWidgets(r.data);
          return;
        }
        const saved = await readLastWeather(place);
        if (alive && saved) await syncWidgets(saved);
      } catch {
        /* best effort */
      }
    };
    void run();
    const timer = setInterval(() => { lastAt = 0; void run(); }, REFRESH_MS);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void run(); });
    return () => { alive = false; clearInterval(timer); sub.remove(); };
  }, []);
}
