import { useEffect } from 'react';

/**
 * "Tap the tab you are already on and it goes back to the top" (like Instagram). The tab bar calls scrollTopOf(path); the screen of that tab
 * registers what to do with useScrollToTop(path, () => ...). Pure and tiny: no navigation state involved.
 */
const listeners = new Map<string, Set<() => void>>();

export function scrollTopOf(path: string): void {
  listeners.get(path)?.forEach((fn) => { try { fn(); } catch { /* a screen that is gone */ } });
}

export function onScrollTop(path: string, fn: () => void): () => void {
  const set = listeners.get(path) ?? new Set<() => void>();
  set.add(fn);
  listeners.set(path, set);
  return () => { set.delete(fn); };
}

/** For a tab screen: run `fn` (scroll its list to the top) whenever its own tab is tapped again. */
export function useScrollToTop(path: string, fn: () => void): void {
  useEffect(() => onScrollTop(path, fn), [path, fn]);
}
