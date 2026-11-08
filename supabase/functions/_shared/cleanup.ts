/**
 * Storage cleanup for permanently deleted companies (updates 68 and 74).
 *
 * The database deletes a company's rows in ONE all-or-nothing step and, in that same step, queues what must be removed from storage:
 * every file a table row pointed at ('file') and whole folders ('prefix': the company's folder, ID photos and avatars of deleted people).
 * Storage (R2) is outside the database transaction, so the two can NOT be one atomic operation. This job closes the gap: it claims queued
 * items, deletes, and records the result. A failure is retried later with a growing delay and, after 8 tries, marked failed for an
 * operator. A folder is marked done only when it is really empty. Nothing is reported deleted until storage confirms it (or says the
 * file is already gone).
 *
 * Pure logic with injected dependencies, so it is tested without Deno, a network or real storage credentials.
 */
export interface QueueItem { id: string; kind: 'file' | 'prefix'; file_key: string; attempts: number; company_id: string }

export interface CleanupDeps {
  claim: (limit: number) => Promise<QueueItem[]>;
  finish: (id: string, ok: boolean, error?: string | null, more?: boolean) => Promise<void>;
  /** Deletes one file wherever it is stored. true when it is gone (deleted now or already missing); throws or false on a failure. */
  deleteObject: (key: string) => Promise<boolean>;
  /** Deletes up to `max` files under a folder in every store. `more` = there are still files left under it. */
  deletePrefix: (prefix: string, max: number) => Promise<{ deleted: number; more: boolean }>;
}

export interface CleanupSummary { claimed: number; done: number; moreToDo: number; retrying: number; errors: string[] }

/** A key may never be empty, absolute, or climb out of its folder. */
export function isSafeKey(key: string): boolean {
  return typeof key === 'string' && key.length > 0 && !key.startsWith('/') && !key.includes('..') && !key.includes('\0');
}
/**
 * A folder must be exactly one of the three shapes the database queues, so a bad row can never empty the whole bucket:
 *   {uuid}/   ids/{uuid}/   avatars/{uuid}/
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PREFIX_RE = new RegExp(`^(?:${UUID}|ids/${UUID}|avatars/${UUID})/$`, 'i');
export const isSafePrefix = (prefix: string) => isSafeKey(prefix) && PREFIX_RE.test(prefix);

export async function runCleanup(deps: CleanupDeps, opts: { batch?: number; prefixBatch?: number } = {}): Promise<CleanupSummary> {
  const items = await deps.claim(opts.batch ?? 25);
  const prefixBatch = opts.prefixBatch ?? 200;
  const out: CleanupSummary = { claimed: items.length, done: 0, moreToDo: 0, retrying: 0, errors: [] };
  for (const item of items) {
    try {
      if (item.kind === 'prefix') {
        if (!isSafePrefix(item.file_key)) throw new Error(`Refusing an unsafe folder: ${item.file_key}`);
        const r = await deps.deletePrefix(item.file_key, prefixBatch);
        if (r.more) { await deps.finish(item.id, false, null, true); out.moreToDo++; continue; }
        await deps.finish(item.id, true);
        out.done++;
      } else {
        if (!isSafeKey(item.file_key)) throw new Error(`Refusing an unsafe file name: ${item.file_key}`);
        const ok = await deps.deleteObject(item.file_key);
        if (!ok) throw new Error('The storage refused to delete the file.');
        await deps.finish(item.id, true);
        out.done++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.errors.push(`${item.id}: ${msg}`);
      out.retrying++;
      try { await deps.finish(item.id, false, msg.slice(0, 500), false); } catch { /* the lock expires and it is claimed again */ }
    }
  }
  return out;
}
