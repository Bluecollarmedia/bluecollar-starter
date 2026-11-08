import { supabase, isSupabaseConfigured } from '@/lib/supabase';

/**
 * Asks the storage-cleanup function to delete the stored files of everything that was deleted (update 119: the database lists a file for
 * deletion whenever a row that holds one goes, however it goes). Safe to call as often as you like: it only works on that list, never on
 * anything the caller names, and it does nothing when the list is empty. Runs a few seconds after a delete (so the delete has reached the
 * server first), a second time a little later, and once a while after the app opens, so nothing waits long. Never throws.
 */
let running = false;
let timers: ReturnType<typeof setTimeout>[] = [];

async function runBatches(): Promise<void> {
  if (running || !isSupabaseConfigured) return;
  running = true;
  try {
    for (let i = 0; i < 40; i++) {
      const { data, error } = await supabase.functions.invoke('storage-cleanup', { body: {} });
      if (error) return;
      if (!data?.summary || data.summary.claimed === 0) return;
    }
  } catch { /* the list stays; the next run picks it up */ } finally {
    running = false;
  }
}

/** Call after anything with a stored file is deleted. */
export function sweepStorageSoon(): void {
  for (const t of timers) clearTimeout(t);
  timers = [setTimeout(() => { void runBatches(); }, 5000), setTimeout(() => { void runBatches(); }, 45000)];
}
