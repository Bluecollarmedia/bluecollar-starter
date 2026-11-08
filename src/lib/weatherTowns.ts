/**
 * The places Weather can show. Any town in the US can be picked (see placeSearch.ts); the settings file's nearby towns
 * (src/config/brand.js, weather.nearbyTowns) are listed first in the picker, and weather.defaultPlace is shown the first time.
 * The settings file is the ONLY town list: the weather server function keeps none and looks every place up by the map point the app
 * sends (NWS /points).
 */
import { brand } from '@/config/brand';

export interface Place { key: string; name: string; state: string; lat: number; lon: number }

export const WEATHER_TOWNS: readonly Place[] = brand.weather.nearbyTowns;

export type TownKey = string;
export const DEFAULT_PLACE: Place = brand.weather.defaultPlace;
export const DEFAULT_TOWN: TownKey = DEFAULT_PLACE.key;
export const isTownKey = (v: unknown): v is TownKey => WEATHER_TOWNS.some((t) => t.key === v);
export const townName = (key: string): string => WEATHER_TOWNS.find((t) => t.key === key)?.name ?? key;
/** The point of one of the nearby towns (the default place if the key is not one of them). */
export const townCoords = (key: string): { lat: number; lon: number } => {
  const t = WEATHER_TOWNS.find((x) => x.key === key) ?? DEFAULT_PLACE;
  return { lat: t.lat, lon: t.lon };
};

/** The key for a place that is not one of the nearby towns: its point, to three decimals (about 100 metres). */
export const placeKey = (lat: number, lon: number): string => `p:${lat.toFixed(3)},${lon.toFixed(3)}`;

/** A saved place read back from the phone, or null when it is not a usable place. */
export function asPlace(v: unknown): Place | null {
  const p = v as Partial<Place> | null;
  if (!p || typeof p.key !== 'string' || typeof p.name !== 'string' || typeof p.lat !== 'number' || typeof p.lon !== 'number') return null;
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || p.lat < 17 || p.lat > 72 || p.lon < -180 || p.lon > -60) return null;
  return { key: p.key, name: p.name.slice(0, 60), state: typeof p.state === 'string' ? p.state.slice(0, 2) : '', lat: p.lat, lon: p.lon };
}
