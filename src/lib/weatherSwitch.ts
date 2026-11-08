/**
 * The public Weather master switch: how the app decides "on or off" from what the server says and what it remembers. Pure (no React,
 * no storage, no network of its own) so the rules can be tested in Node.
 *
 * The rules:
 *  - A fresh answer from the server always wins, and only the exact value true means ON.
 *  - Without one, a remembered ON counts only while it is younger than six hours.
 *  - A failed or slow request is NEVER proof of ON. No answer and no usable memory means OFF (the existing welcome screen).
 *  - The app never waits for the answer longer than REQUEST_CAP_MS before carrying on.
 */

export const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const REQUEST_CAP_MS = 1500;

export interface CachedAnswer { enabled: boolean; checkedAt: number }
export interface FreshAnswer { enabled: unknown }

function usable(c: CachedAnswer | null | undefined): c is CachedAnswer {
  return !!c && typeof c.checkedAt === 'number' && Number.isFinite(c.checkedAt);
}

export function decideWeatherOn(input: { fresh: FreshAnswer | null; cached: CachedAnswer | null; now: number }): boolean {
  const { fresh, cached, now } = input;
  if (fresh) return fresh.enabled === true;
  if (usable(cached) && cached.enabled === true) {
    const age = now - cached.checkedAt;
    return age >= 0 && age < CACHE_MAX_AGE_MS;
  }
  return false;
}

export interface SwitchDeps {
  /** Asks the server. Resolves true/false, rejects on any failure. */
  fetchAnswer: () => Promise<boolean>;
  readCache: () => Promise<CachedAnswer | null>;
  writeCache: (c: CachedAnswer) => Promise<void>;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
  capMs?: number;
}

export interface WeatherSwitch {
  /** Loads the remembered answer (never replaces a newer one that already arrived). */
  loadCache: () => Promise<void>;
  /** Asks the server. The returned promise settles within the time cap whatever happens; a later answer is still applied. */
  refresh: () => Promise<void>;
  getEnabled: () => boolean;
  subscribe: (fn: () => void) => () => void;
}

export function createWeatherSwitch(deps: SwitchDeps): WeatherSwitch {
  const cap = deps.capMs ?? REQUEST_CAP_MS;
  let fresh: FreshAnswer | null = null;
  let cached: CachedAnswer | null = null;
  let started = 0;
  let applied = 0;
  const listeners = new Set<() => void>();
  const emit = () => { for (const fn of [...listeners]) { try { fn(); } catch { /* a listener's problem is its own */ } } };

  async function loadCache() {
    let read: CachedAnswer | null = null;
    try { read = (await deps.readCache()) ?? null; } catch { read = null; }
    if (!cached && usable(read)) { cached = { enabled: read.enabled === true, checkedAt: read.checkedAt }; emit(); }
  }

  function refresh(): Promise<void> {
    const seq = ++started;
    return new Promise<void>((resolve) => {
      let settled = false;
      let timer: unknown;
      const finish = () => { if (!settled) { settled = true; deps.clearTimer(timer); resolve(); } };
      timer = deps.setTimer(finish, cap);
      let work: Promise<boolean>;
      try { work = deps.fetchAnswer(); } catch (e) { work = Promise.reject(e); }
      work.then(
        (enabled) => {
          // An older request that answers after a newer one is ignored.
          if (seq >= applied) {
            applied = seq;
            const on = enabled === true;
            fresh = { enabled: on };
            cached = { enabled: on, checkedAt: deps.now() };
            try { void deps.writeCache(cached).catch(() => undefined); } catch { /* storage trouble never matters here */ }
            emit();
          }
          finish();
        },
        // A failure is "no answer", never ON, and leaves what is remembered alone.
        () => finish(),
      );
    });
  }

  return {
    loadCache,
    refresh,
    getEnabled: () => decideWeatherOn({ fresh, cached, now: deps.now() }),
    subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}
