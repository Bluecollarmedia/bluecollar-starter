/**
 * Brighton Weather data, as the app reads it: one call to the `weather` function (supabase/functions/weather) for the chosen place, and the
 * last good answer kept on the phone so a dropped connection still shows something (with its age). The chosen place and the last few picked
 * are kept on the phone too.
 *
 * The function refuses while the owner's public Weather switch is off (403 "disabled"); that is passed up so the app can leave Weather.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { DEFAULT_PLACE, WEATHER_TOWNS, asPlace, isBuiltInKey, type Place } from '@/lib/weatherTowns';
import { completePayload, type WeatherPayload } from '@/lib/weatherView';
import { shareInFlight } from '@/lib/sharedRequest';

const PLACE_KEY = 'weather.place.v1';
const OLD_TOWN_KEY = 'weather.town.v1';
const RECENT_KEY = 'weather.recent.v1';
const cacheKey = (key: string) => `weather.last.${key}.v1`;
const REQUEST_LIMIT_MS = 12_000;
const RECENT_MAX = 5;
/** How many places keep a saved forecast on the phone (the most recently saved ones); older ones are removed so the cache never grows. */
export const FORECAST_CACHE_MAX = 12;
const INDEX_KEY = 'weather.last.index.v1';

export type WeatherResult =
  | { ok: true; data: WeatherPayload; stale: boolean }
  | { ok: false; reason: 'disabled' | 'unavailable' };

/** One request per place at a time: a second ask while the first is on its way shares its answer. */
export function loadWeather(place: Place): Promise<WeatherResult> {
  return shareInFlight(`weather:${place.key}`, () => loadWeatherNow(place));
}

async function loadWeatherNow(place: Place): Promise<WeatherResult> {
  if (!isSupabaseConfigured) return { ok: false, reason: 'unavailable' };
  try {
    // The eight towns near Brighton are asked for by name (their forecast grid is already known); any other place by its point.
    const body = isBuiltInKey(place.key) ? { town: place.key } : { lat: place.lat, lon: place.lon, name: place.name, state: place.state };
    const call = supabase.functions.invoke('weather', { body });
    const stop = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timed out.')), REQUEST_LIMIT_MS));
    const { data, error } = await Promise.race([Promise.resolve(call), stop]);
    if (error) {
      const status = (error as { context?: { status?: number } }).context?.status;
      return { ok: false, reason: status === 403 ? 'disabled' : 'unavailable' };
    }
    const answer = data as { ok?: boolean; stale?: boolean; data?: WeatherPayload } | null;
    if (!answer?.ok || !answer.data) return { ok: false, reason: 'unavailable' };
    return { ok: true, data: completePayload({ ...answer.data, town: place.key, townName: place.name }, place), stale: !!answer.stale };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

export async function readLastWeather(place: Place): Promise<WeatherPayload | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(place.key));
    if (!raw) return null;
    const v = JSON.parse(raw) as WeatherPayload;
    return v && v.town === place.key && typeof v.fetchedAt === 'number' ? completePayload(v, place) : null;
  } catch {
    return null;
  }
}
export async function saveLastWeather(data: WeatherPayload): Promise<void> {
  try {
    await AsyncStorage.setItem(cacheKey(data.town), JSON.stringify(data));
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    const known: string[] = raw ? (JSON.parse(raw) as string[]).filter((k) => typeof k === 'string') : [];
    const next = [data.town, ...known.filter((k) => k !== data.town)];
    const drop = next.slice(FORECAST_CACHE_MAX);
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(next.slice(0, FORECAST_CACHE_MAX)));
    for (const k of drop) await AsyncStorage.removeItem(cacheKey(k));
  } catch { /* the phone's storage is best effort */ }
}

/** The place last chosen (Lakewood the first time, or when nothing usable is saved). An older save that held one of the eight towns' names still works. */
export async function readPlace(): Promise<Place> {
  try {
    const raw = await AsyncStorage.getItem(PLACE_KEY);
    const saved = raw ? asPlace(JSON.parse(raw)) : null;
    if (saved) return saved;
    const old = await AsyncStorage.getItem(OLD_TOWN_KEY);
    const t = WEATHER_TOWNS.find((x) => x.key === old);
    return t ? { ...t } : DEFAULT_PLACE;
  } catch {
    return DEFAULT_PLACE;
  }
}
export async function savePlace(place: Place): Promise<void> {
  try { await AsyncStorage.setItem(PLACE_KEY, JSON.stringify(place)); } catch { /* best effort */ }
}

/** The last few places picked, newest first. */
export async function readRecents(): Promise<Place[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown[]) : [];
    return list.map(asPlace).filter((p): p is Place => !!p).slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}
export async function pushRecent(place: Place): Promise<Place[]> {
  const next = [place, ...(await readRecents()).filter((p) => p.key !== place.key)].slice(0, RECENT_MAX);
  try { await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* best effort */ }
  return next;
}
