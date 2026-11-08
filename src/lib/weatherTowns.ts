/**
 * The places Brighton Weather can show. Any town in the US can be picked (see placeSearch.ts); these eight are the ones near Brighton, listed
 * first in the picker. Their keys, names and points are the same as supabase/functions/weather/index.ts (a check keeps the two lists identical),
 * and the function has each one's forecast grid already verified. Any other place is looked up by its coordinates.
 */
export interface Place { key: string; name: string; state: string; lat: number; lon: number }

export const WEATHER_TOWNS = [
  { key: 'lakewood', name: 'Lakewood', state: 'NJ', lat: 40.0771, lon: -74.1985 },
  { key: 'jackson', name: 'Jackson', state: 'NJ', lat: 40.0909, lon: -74.3613 },
  { key: 'howell', name: 'Howell', state: 'NJ', lat: 40.1781, lon: -74.2062 },
  { key: 'toms-river', name: 'Toms River', state: 'NJ', lat: 39.9943, lon: -74.1662 },
  { key: 'brick', name: 'Brick', state: 'NJ', lat: 40.0618, lon: -74.1096 },
  { key: 'manchester', name: 'Manchester', state: 'NJ', lat: 39.9616, lon: -74.3753 },
  { key: 'freehold', name: 'Freehold', state: 'NJ', lat: 40.2602, lon: -74.2759 },
  { key: 'point-pleasant', name: 'Point Pleasant', state: 'NJ', lat: 40.0777, lon: -74.0699 },
] as const;

export type TownKey = (typeof WEATHER_TOWNS)[number]['key'];
export const DEFAULT_TOWN: TownKey = 'lakewood';
export const DEFAULT_PLACE: Place = { key: 'lakewood', name: 'Lakewood', state: 'NJ', lat: 40.0771, lon: -74.1985 };
export const isTownKey = (v: unknown): v is TownKey => WEATHER_TOWNS.some((t) => t.key === v);
export const townName = (key: string): string => WEATHER_TOWNS.find((t) => t.key === key)?.name ?? key;
/** The point of one of the eight towns (the first, Lakewood, if the key is not one of them). */
export const townCoords = (key: string): { lat: number; lon: number } => {
  const t = WEATHER_TOWNS.find((x) => x.key === key) ?? WEATHER_TOWNS[0];
  return { lat: t.lat, lon: t.lon };
};

/** The key for a place that is not one of the eight: its point, to three decimals (about 100 metres). */
export const placeKey = (lat: number, lon: number): string => `p:${lat.toFixed(3)},${lon.toFixed(3)}`;
export const isBuiltInKey = (key: string): boolean => isTownKey(key);

/** A saved place read back from the phone, or null when it is not a usable place. */
export function asPlace(v: unknown): Place | null {
  const p = v as Partial<Place> | null;
  if (!p || typeof p.key !== 'string' || typeof p.name !== 'string' || typeof p.lat !== 'number' || typeof p.lon !== 'number') return null;
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || p.lat < 17 || p.lat > 72 || p.lon < -180 || p.lon > -60) return null;
  return { key: p.key, name: p.name.slice(0, 60), state: typeof p.state === 'string' ? p.state.slice(0, 2) : '', lat: p.lat, lon: p.lon };
}
