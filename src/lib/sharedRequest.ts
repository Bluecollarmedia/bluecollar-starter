/**
 * Share one request between callers that ask for the same thing at the same moment. If a request for `key` is already on its way, a second
 * caller gets that same answer instead of starting another. The entry is forgotten as soon as the request ends, so the next ask is fresh.
 */
const running = new Map<string, Promise<unknown>>();

export function shareInFlight<T>(key: string, start: () => Promise<T>): Promise<T> {
  const have = running.get(key) as Promise<T> | undefined;
  if (have) return have;
  const p = start().finally(() => { if (running.get(key) === p) running.delete(key); });
  running.set(key, p);
  return p;
}

/** How many requests are on their way right now (for tests). */
export const inFlightCount = (): number => running.size;
/** Is a request for this key on its way right now? */
export const isRunning = (key: string): boolean => running.has(key);
