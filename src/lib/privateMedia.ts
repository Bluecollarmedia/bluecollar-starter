/**
 * Private files (worker ID photos, `ids/...`) are not opened through their stored address. The app asks the `media` function for a
 * short-lived signed link; the function checks who is asking and signs only the ones allowed. Everything else is a normal public file,
 * opened straight from its stored address. If signing ever fails, the stored address is used so nothing breaks.
 */
import { useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from './supabase';

const PRIVATE_FOLDERS = new Set<string>([]);

/** The same rule as the server's isPrivateKey (a check keeps them identical). */
export function isPrivateKey(key: string): boolean {
  const parts = key.split('/');
  if (parts[0] === 'ids') return true;
  return parts.length >= 3 && PRIVATE_FOLDERS.has(parts[1]);
}

const TTL_MS = 50 * 60 * 1000;          // links are asked for 60 minutes; refreshed after 50
const cache = new Map<string, { url: string; at: number }>();
const waiting = new Map<string, Array<(u: string | undefined) => void>>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  timer = null;
  const keys = [...waiting.keys()];
  const batches: string[][] = [];
  for (let i = 0; i < keys.length; i += 100) batches.push(keys.slice(i, i + 100));
  for (const batch of batches) {
    let urls: Record<string, string> = {};
    try {
      const { data, error } = await supabase.functions.invoke('media', { body: { action: 'maint-sign', keys: batch } });
      if (!error) urls = (data?.urls ?? {}) as Record<string, string>;
    } catch { /* leave empty: callers fall back */ }
    for (const k of batch) {
      const url = urls[k];
      if (url) cache.set(k, { url, at: Date.now() });
      for (const cb of waiting.get(k) ?? []) cb(url);
      waiting.delete(k);
    }
  }
}

/** A signed link for one private key (several asks in the same moment are sent as one request). */
export function signedUrlFor(key: string): Promise<string | undefined> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.url);
  return new Promise((resolve) => {
    const list = waiting.get(key) ?? [];
    list.push(resolve);
    waiting.set(key, list);
    if (!timer) timer = setTimeout(flush, 30);
  });
}

/**
 * The address to show for a stored photo. A local file (not saved yet) or a normal public file is used as it is. A private file waits
 * for its signed link (returns undefined while it loads); if signing fails the stored address is used so nothing breaks mid-migration.
 */
export function useFileAddress(fileUrl: string | undefined, fileKey: string | undefined): string | undefined {
  const needsSigning = isSupabaseConfigured && !!fileKey && isPrivateKey(fileKey) && /^https?:\/\//i.test(fileUrl ?? '');
  const [signed, setSigned] = useState<string | undefined | null>(() => (needsSigning && fileKey ? (cache.get(fileKey)?.url ?? null) : null));
  useEffect(() => {
    if (!needsSigning || !fileKey) return;
    let alive = true;
    signedUrlFor(fileKey).then((u) => { if (alive) setSigned(u ?? ''); });
    return () => { alive = false; };
  }, [needsSigning, fileKey]);
  if (!needsSigning) return fileUrl;
  if (signed === null) return undefined;           // still asking
  return signed || fileUrl;                        // '' = signing failed -> stored address
}
