/**
 * The public Weather master switch, as the app reads it (supabase/updates/103). One anonymous question to the database ("is Weather on?")
 * and a small remembered answer on the phone. All the deciding lives in src/lib/weatherSwitch.ts.
 *
 * The only place that CHANGES the switch is setPublicWeatherEnabled below, called from the owner's Settings row. The database refuses anyone
 * who is not the company owner (an admin is refused too).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { createWeatherSwitch, type CachedAnswer } from '@/lib/weatherSwitch';
import { shareInFlight } from '@/lib/sharedRequest';

const KEY = 'publicWeather.v1';
/** The decision never waits for this (it waits at most REQUEST_CAP_MS); this only stops a request that never finishes. */
const HARD_STOP_MS = 15_000;

/** One question at a time: callers that ask while one is on its way share its answer (launch, foreground and the 60-second check can overlap). */
function fetchAnswer(): Promise<boolean> {
  return shareInFlight('weather.switch', fetchAnswerNow);
}
async function fetchAnswerNow(): Promise<boolean> {
  if (!isSupabaseConfigured) throw new Error('No backend configured.');
  const work = Promise.resolve(supabase.rpc('public_weather_config'));
  const stop = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timed out.')), HARD_STOP_MS));
  const { data, error } = await Promise.race([work, stop]);
  if (error) throw new Error(error.message);
  return (data as { enabled?: unknown } | null)?.enabled === true;
}

async function readCache(): Promise<CachedAnswer | null> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  const v = JSON.parse(raw) as Partial<CachedAnswer>;
  return typeof v.checkedAt === 'number' ? { enabled: v.enabled === true, checkedAt: v.checkedAt } : null;
}

async function writeCache(c: CachedAnswer): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(c));
}

/** What the owner's row shows: the stored switch (null when it cannot be read). */
export async function readPublicWeatherSetting(): Promise<boolean | null> {
  try { return await fetchAnswer(); } catch { return null; }
}

/** The owner turns the public Weather experience on or off. The database refuses everyone else. */
export async function setPublicWeatherEnabled(enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Needs the live database.' };
  const { error } = await supabase.rpc('set_public_weather_enabled', { p_enabled: enabled });
  if (error) {
    const missing = /could not find the function|schema cache|does not exist/i.test(error.message);
    return { ok: false, error: missing ? 'Brighton Weather is not installed on the database yet.' : error.message };
  }
  void weatherSwitch.refresh();
  return { ok: true };
}

export const weatherSwitch = createWeatherSwitch({
  fetchAnswer,
  readCache,
  writeCache,
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
});
