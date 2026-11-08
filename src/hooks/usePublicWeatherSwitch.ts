import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { weatherSwitch } from '@/data/publicWeather';
import { effectiveWeatherOn } from '@/lib/launchRoute';
import { WEATHER_ON_THIS_DEVICE } from '@/lib/weatherPlatform';
import { isFeatureOn } from '@/config/brand';

/** The public visitor area exists in this app at all (settings file: features.publicVisitorArea and features.weather). */
export const PUBLIC_AREA_IN_APP = isFeatureOn('publicVisitorArea') && isFeatureOn('weather');

/**
 * Is the public visitor area (signed-out Weather + Request + Contact) on? Always false, and never asks the server, when the settings file
 * switches the area off (features.publicVisitorArea). Otherwise: Asks once at launch (without ever holding launch up: the answer is read from what the phone
 * remembers, and the request is capped at 1.5 seconds), and again whenever the app comes back to the foreground while nobody is signed in.
 *
 * While the Weather experience is not built (WEATHER_EXPERIENCE_BUILT in src/lib/launchRoute.ts) this is always false, whatever the
 * server says, so the app launches exactly as it always has. The re-check every 60 seconds while a Weather screen is open belongs to
 * the phase that builds those screens.
 */
export function usePublicWeatherSwitch(signedOut: boolean): boolean {
  const [on, setOn] = useState(false);
  const last = useRef(false);

  useEffect(() => {
    if (!PUBLIC_AREA_IN_APP) return;
    const update = () => {
      const next = effectiveWeatherOn(WEATHER_ON_THIS_DEVICE, weatherSwitch.getEnabled());
      if (next !== last.current) { last.current = next; setOn(next); }
    };
    const off = weatherSwitch.subscribe(update);
    // Remembered answer and fresh request start together; neither is waited for.
    void weatherSwitch.loadCache();
    void weatherSwitch.refresh();
    return off;
  }, []);

  useEffect(() => {
    if (!signedOut || !PUBLIC_AREA_IN_APP) return;
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void weatherSwitch.refresh(); });
    return () => sub.remove();
  }, [signedOut]);

  return on;
}
