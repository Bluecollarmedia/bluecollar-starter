/**
 * Our Work, as the app reads it (update 115). Visitors ask two anonymous questions: "is it on?" (public_portfolio_config) and "what is in it?"
 * (public_portfolio, which answers only while the owner's switch is on). The last good answer is kept on the phone so a dropped connection still
 * shows the feed. The owner's switch is changed here too (setPortfolioEnabled); the database refuses anyone who is not the company owner.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { shareInFlight } from '@/lib/sharedRequest';
import type { PortfolioPost, PublicPortfolio } from '@/lib/portfolio';

/** The feed as last loaded in this run of the app, so a post or video opens at once without asking again. */
let loadedFeed: PublicPortfolio | null = null;
export const getLoadedPortfolio = (): PublicPortfolio | null => loadedFeed;
export const getLoadedPost = (id: string | undefined): PortfolioPost | null => (id ? loadedFeed?.posts.find((p) => p.id === id) ?? null : null);

const SWITCH_KEY = 'portfolio.enabled.v1';
const FEED_KEY = 'portfolio.feed.v1';
const REQUEST_LIMIT_MS = 12_000;

const withLimit = <T,>(work: PromiseLike<T>): Promise<T> =>
  Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timed out.')), REQUEST_LIMIT_MS))]);

/** Is Our Work switched on? null when it cannot be read. */
export function fetchPortfolioEnabled(): Promise<boolean | null> {
  return shareInFlight('portfolio.switch', async () => {
    if (!isSupabaseConfigured) return null;
    try {
      const { data, error } = await withLimit(supabase.rpc('public_portfolio_config'));
      if (error) return null;
      return (data as { enabled?: unknown } | null)?.enabled === true;
    } catch {
      return null;
    }
  });
}

export async function readCachedPortfolioEnabled(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(SWITCH_KEY)) === '1'; } catch { return false; }
}
export async function cachePortfolioEnabled(on: boolean): Promise<void> {
  try { await AsyncStorage.setItem(SWITCH_KEY, on ? '1' : '0'); } catch { /* best effort */ }
}

/** The owner turns Our Work on or off. The database refuses everyone else. */
export async function setPortfolioEnabled(enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseConfigured) return { ok: false, error: 'Needs the live database.' };
  try {
    const { error } = await supabase.rpc('set_portfolio_enabled', { p_enabled: enabled });
    if (error) {
      const missing = /could not find the function|schema cache|does not exist/i.test(error.message);
      return { ok: false, error: missing ? 'Our Work is not installed on the database yet.' : error.message };
    }
    void cachePortfolioEnabled(enabled);
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again." };
  }
}

/** The feed visitors see. `stale` is true when this is the last saved copy because a fresh one could not be had. */
export async function loadPublicPortfolio(): Promise<{ ok: true; data: PublicPortfolio; stale: boolean } | { ok: false }> {
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await withLimit(supabase.rpc('public_portfolio'));
      const answer = data as PublicPortfolio | null;
      if (!error && answer && typeof answer.enabled === 'boolean') {
        if (answer.enabled) {
          loadedFeed = answer;
          void AsyncStorage.setItem(FEED_KEY, JSON.stringify(answer)).catch(() => {});
          return { ok: true, data: answer, stale: false };
        }
        void AsyncStorage.removeItem(FEED_KEY).catch(() => {});
        return { ok: true, data: answer, stale: false };
      }
    } catch { /* fall through to the saved copy */ }
  }
  try {
    const raw = await AsyncStorage.getItem(FEED_KEY);
    const saved = raw ? (JSON.parse(raw) as PublicPortfolio) : null;
    if (saved?.enabled) { loadedFeed = loadedFeed ?? saved; return { ok: true, data: saved, stale: true }; }
  } catch { /* nothing saved */ }
  return { ok: false };
}
