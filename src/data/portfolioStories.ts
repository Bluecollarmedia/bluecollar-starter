/**
 * Which stories this phone has already watched (kept on the phone only, never sent anywhere). The ring around the profile picture is coloured
 * while something is unwatched and grey when everything has been watched.
 */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { markSeen } from '@/lib/portfolioStories';

const KEY = 'portfolio.storiesSeen.v1';
let cache: string[] | null = null;
const listeners = new Set<(ids: string[]) => void>();

async function load(): Promise<string[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    cache = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    cache = [];
  }
  return cache;
}

/** Records that a story was watched; `existing` is every story that still exists (older ids are forgotten so the list never grows). */
export async function markStorySeen(id: string, existing: string[]): Promise<void> {
  const next = markSeen(await load(), id, existing);
  cache = next;
  listeners.forEach((l) => l(next));
  try { await AsyncStorage.setItem(KEY, JSON.stringify(next)); } catch { /* best effort */ }
}

/** The watched ids, kept up to date as stories are watched. */
export function useSeenStories(): ReadonlySet<string> {
  const [ids, setIds] = useState<string[]>(cache ?? []);
  useEffect(() => {
    let alive = true;
    void load().then((v) => { if (alive) setIds(v); });
    const l = (v: string[]) => setIds(v);
    listeners.add(l);
    return () => { alive = false; listeners.delete(l); };
  }, []);
  return new Set(ids);
}
