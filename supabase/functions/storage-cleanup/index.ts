/**
 * Edge Function: storage-cleanup
 *
 * Removes the stored files of permanently deleted companies: every file and every folder the database queued when the company was
 * deleted (update 74), from the public bucket, the private bucket and the Snow stand-in bucket. The app calls it right after a company
 * is deleted (and it can be called again any time; it only ever works on the queue the database wrote, so calling it is harmless).
 * No secret is needed: it cannot be told WHAT to delete. Uses the same R2 secrets as the media function (R2_PRIVATE_BUCKET_NAME is optional).
 *
 * One file on purpose, so it can be pasted into the Supabase dashboard. The cleanup rules below are the same as
 * supabase/functions/_shared/cleanup.ts, which is the tested copy (a check keeps them identical).
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ACCOUNT = Deno.env.get('R2_ACCOUNT_ID') ?? '';
const PUBLIC_BUCKET = Deno.env.get('R2_BUCKET_NAME') ?? '';
const PRIVATE_BUCKET = Deno.env.get('R2_PRIVATE_BUCKET_NAME') ?? '';
const SNOW_BUCKET = 'snow-media';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const r2 = new AwsClient({
  accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID') ?? '',
  secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '',
  service: 's3',
  region: 'auto',
});
const bases = [PUBLIC_BUCKET, PRIVATE_BUCKET].filter(Boolean).map((b) => `https://${ACCOUNT}.r2.cloudflarestorage.com/${b}`);
const enc = (key: string) => key.split('/').map(encodeURIComponent).join('/');
const db = createClient(SUPABASE_URL, SERVICE_KEY);

// ── the cleanup rules ──
interface QueueItem { id: string; kind: 'file' | 'prefix'; file_key: string; attempts: number; company_id: string }
interface CleanupDeps {
  claim: (limit: number) => Promise<QueueItem[]>;
  finish: (id: string, ok: boolean, error?: string | null, more?: boolean) => Promise<void>;
  deleteObject: (key: string) => Promise<boolean>;
  deletePrefix: (prefix: string, max: number) => Promise<{ deleted: number; more: boolean }>;
}
interface CleanupSummary { claimed: number; done: number; moreToDo: number; retrying: number; errors: string[] }
function isSafeKey(key: string): boolean {
  return typeof key === 'string' && key.length > 0 && !key.startsWith('/') && !key.includes('..') && !key.includes('\0');
}
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PREFIX_RE = new RegExp(`^(?:${UUID}|ids/${UUID}|avatars/${UUID})/$`, 'i');
const isSafePrefix = (prefix: string) => isSafeKey(prefix) && PREFIX_RE.test(prefix);
async function runCleanup(deps: CleanupDeps, opts: { batch?: number; prefixBatch?: number } = {}): Promise<CleanupSummary> {
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

// ── storage operations ──
async function deleteFromR2(key: string): Promise<boolean> {
  let ok = true;
  for (const base of bases) {
    const res = await r2.fetch(`${base}/${enc(key)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) ok = false;
  }
  return ok;
}

/** Snow media keeps a 1-byte stand-in per file in a Supabase bucket. Remove those too (best effort, recursive). */
async function deleteSnowStandIn(keyOrPrefix: string, isPrefix: boolean): Promise<void> {
  const storage = db.storage.from(SNOW_BUCKET);
  if (!isPrefix) { await storage.remove([keyOrPrefix]); return; }
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 6) return;
    const { data } = await storage.list(dir.replace(/\/$/, ''), { limit: 1000 });
    const files: string[] = [];
    for (const o of data ?? []) {
      if (o.id) files.push(`${dir}${o.name}`); else await walk(`${dir}${o.name}/`, depth + 1);
    }
    if (files.length) await storage.remove(files);
  };
  await walk(keyOrPrefix, 0);
}

function unescapeXml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, String.fromCharCode(39));
}

async function deleteFolderBatch(prefix: string, max: number): Promise<{ deleted: number; more: boolean }> {
  let deleted = 0;
  let more = false;
  for (const base of bases) {
    const u = new URL(base);
    u.searchParams.set('list-type', '2');
    u.searchParams.set('prefix', prefix);
    u.searchParams.set('max-keys', String(max));
    const res = await r2.fetch(u.toString());
    if (!res.ok) throw new Error(`List failed (${res.status})`);
    const xml = await res.text();
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => unescapeXml(m[1]));
    for (let i = 0; i < keys.length; i += 10) {
      await Promise.all(keys.slice(i, i + 10).map(async (k) => {
        const d = await r2.fetch(`${base}/${enc(k)}`, { method: 'DELETE' });
        if (!d.ok && d.status !== 404) throw new Error(`Delete failed (${d.status})`);
      }));
    }
    deleted += keys.length;
    if (/<IsTruncated>true<\/IsTruncated>/.test(xml) || keys.length >= max) more = true;
  }
  await deleteSnowStandIn(prefix, true).catch(() => undefined);
  return { deleted, more };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });
  if (!ACCOUNT || !PUBLIC_BUCKET) return new Response(JSON.stringify({ error: 'R2 is not set up yet' }), { status: 503, headers: CORS });

  const summary = await runCleanup({
    claim: async (limit) => {
      const { data, error } = await db.rpc('storage_cleanup_claim', { p_limit: limit });
      if (error) throw new Error(error.message);
      return (data ?? []) as QueueItem[];
    },
    finish: async (id, ok, error, more) => {
      const { error: e } = await db.rpc('storage_cleanup_finish', { p_id: id, p_ok: ok, p_error: error ?? null, p_more: !!more });
      if (e) throw new Error(e.message);
    },
    deleteObject: async (key) => {
      const ok = await deleteFromR2(key);
      if (ok) await deleteSnowStandIn(key, false).catch(() => undefined);
      return ok;
    },
    deletePrefix: deleteFolderBatch,
  });
  const { data: status } = await db.rpc('storage_cleanup_status');
  return new Response(JSON.stringify({ summary, status }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
});
