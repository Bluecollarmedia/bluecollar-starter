import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { readLastWeather, readPlace } from '@/data/weather';
import { degrees, type WxIcon } from '@/lib/weatherView';

export interface WeatherGlance { icon: WxIcon | null; temp: string | null }

const NONE: WeatherGlance = { icon: null, temp: null };

/**
 * The little weather button's picture and temperature: read from the forecast already saved on the phone (the Weather screen and the
 * background sync keep it fresh), so the button never makes a network request of its own. Nothing saved yet: no picture, no number.
 */
export function useWeatherGlance(): WeatherGlance {
  const [glance, setGlance] = useState<WeatherGlance>(NONE);
  useEffect(() => {
    let alive = true;
    const read = async () => {
      try {
        const place = await readPlace();
        const d = await readLastWeather(place);
        if (!alive) return;
        const icon = d?.current?.icon ?? d?.hourly?.[0]?.icon ?? null;
        const f = d?.current?.tempF ?? d?.hourly?.[0]?.tempF;
        setGlance(d && icon ? { icon, temp: degrees(f) } : NONE);
      } catch {
        /* the button just shows its plain picture */
      }
    };
    void read();
    const timer = setInterval(() => { void read(); }, 60_000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void read(); });
    return () => { alive = false; clearInterval(timer); sub.remove(); };
  }, []);
  return glance;
}
