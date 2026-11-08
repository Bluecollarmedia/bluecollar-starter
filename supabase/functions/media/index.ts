/**
 * media — one Edge Function for every photo/video that lives in Cloudflare R2.
 *
 * The app never holds R2 keys. It asks this function for a short-lived upload
 * link (action "put"), uploads straight to R2, and later asks it to remove a
 * file (action "delete"). It only needs the standard `people` and
 * `company_members` tables, nothing else.
 *
 * Secrets (supabase secrets set ...): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL (https://..., no slash).
 *
 * Who may write where:
 *   avatars/{myPersonId}/...   any signed-in person (their own picture)
 *   {companyId}/...            active members of that company
 * Snow media is private. Its permission rules already live in the database
 * (storage policies on the "snow-media" bucket), so each file keeps a 1-byte
 * stand-in in that bucket and we ask Supabase, as the signed-in person, whether
 * they may see/write it. R2 holds the real file. Actions: snow-put, snow-sign,
 * snow-delete.
 * Delete: the same prefixes; for company files, staff or the member who
 * uploaded it is not tracked, so owner/admin/manager/lead/worker may delete
 * inside their own company (customers may not).
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';
/**
 * Which stored files are private (kept in the private bucket). Written out here, identical to supabase/functions/_shared/privateKeys.ts
 * and src/lib/privateMedia.ts (a check keeps the three the same), so this one file can be pasted into the Supabase dashboard as it is.
 */
const PRIVATE_FOLDERS = new Set<string>([]);
function isPrivateKey(key: string): boolean {
  const parts = key.split('/');
  if (parts[0] === 'ids') return true;
  return parts.length >= 3 && PRIVATE_FOLDERS.has(parts[1]);
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const R2_ACCOUNT_ID = Deno.env.get('R2_ACCOUNT_ID') ?? '';
const R2_BUCKET_NAME = Deno.env.get('R2_BUCKET_NAME') ?? '';
const R2_PUBLIC_URL = (Deno.env.get('R2_PUBLIC_URL') ?? '').replace(/\/+$/, '');
/** The private bucket (no public address). When it is not set, everything stays in the one bucket exactly as before. */
const R2_PRIVATE_BUCKET_NAME = Deno.env.get('R2_PRIVATE_BUCKET_NAME') ?? '';

const r2 = new AwsClient({
  accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID') ?? '',
  secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '',
  service: 's3',
  region: 'auto',
});
const BUCKET_URL = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET_NAME}`;
const PRIVATE_BUCKET_URL = R2_PRIVATE_BUCKET_NAME ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_PRIVATE_BUCKET_NAME}` : '';

/** Where NEW files for this key are written: the private bucket for private keys (when it is set up), otherwise the normal bucket. */
const writeBase = (key: string) => (PRIVATE_BUCKET_URL && isPrivateKey(key) ? PRIVATE_BUCKET_URL : BUCKET_URL);

/**
 * Where an EXISTING file is: the private bucket first, then the normal bucket (files not yet moved across). Used for reading and signing,
 * so everything keeps working while old files are moved.
 */
async function locate(key: string): Promise<string> {
  if (PRIVATE_BUCKET_URL && isPrivateKey(key)) {
    const res = await r2.fetch(`${PRIVATE_BUCKET_URL}/${key}`, { method: 'HEAD' });
    if (res.ok) return PRIVATE_BUCKET_URL;
  }
  return BUCKET_URL;
}

const TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  // Our Work music (the owner's own tracks)
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/aiff': 'aiff',
  'audio/x-aiff': 'aiff',
  'audio/x-caf': 'caf',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  // More video containers every phone plays
  'video/x-m4v': 'm4v',
  'video/3gpp': '3gp',
};
const MAX_BYTES = 200 * 1024 * 1024;
const CAN_DELETE = new Set(['owner', 'admin', 'manager', 'lead', 'worker']);

const SNOW_BUCKET = 'snow-media';

/** A private, short-lived read link for an R2 file. */
async function presignGet(key: string, seconds: number): Promise<string> {
  const url = new URL(`${await locate(key)}/${key}`);
  url.searchParams.set('X-Amz-Expires', String(seconds));
  const signed = await r2.sign(new Request(url.toString(), { method: 'GET' }), { aws: { signQuery: true } });
  return signed.url;
}

async function inR2(key: string): Promise<boolean> {
  const res = await r2.fetch(`${await locate(key)}/${key}`, { method: 'HEAD' });
  return res.ok;
}

/** Deletes a file wherever it is (both buckets, so a half-moved file leaves nothing behind). */
async function deleteEverywhere(key: string): Promise<boolean> {
  let ok = true;
  for (const base of [BUCKET_URL, PRIVATE_BUCKET_URL].filter(Boolean)) {
    const res = await r2.fetch(`${base}/${key}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) ok = false;
  }
  return ok;
}

/** Whether the 1-byte stand-in for this Snow key is in the Supabase bucket. */
async function standInExists(key: string): Promise<boolean> {
  const slash = key.lastIndexOf('/');
  const { data } = await createClient(SUPABASE_URL, SERVICE_KEY).storage
    .from(SNOW_BUCKET)
    .list(key.slice(0, slash), { search: key.slice(slash + 1), limit: 5 });
  return (data ?? []).some((o) => o.name === key.slice(slash + 1));
}

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function whoIs(req: Request) {
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data } = await userClient.auth.getUser();
  if (!data.user) return null;
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: person } = await db.from('people').select('id').eq('user_id', data.user.id).maybeSingle();
  if (!person) return null;
  const { data: rows } = await db
    .from('company_members')
    .select('company_id, role')
    .eq('person_id', person.id)
    .eq('status', 'active');
  const roles: Record<string, string> = {};
  for (const r of rows ?? []) roles[r.company_id] = r.role;
  return { personId: person.id as string, roles };
}

/** A folder/key is safe when it is plain path segments and nothing climbs out. */
function safePath(p: unknown): p is string {
  return typeof p === 'string' && p.length > 0 && p.length < 300 && /^[A-Za-z0-9._\-/]+$/.test(p) &&
    !p.split('/').some((s) => s === '' || s === '.' || s === '..');
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  if (!R2_ACCOUNT_ID || !R2_BUCKET_NAME || !R2_PUBLIC_URL) return reply({ error: 'R2 is not set up yet' }, 503);

  try {
    const me = await whoIs(req);
    if (!me) return reply({ error: 'Please sign in again' }, 401);
    const body = await req.json();

    if (body.action === 'put') {
      const folder = body.folder;
      const ext = TYPES[String(body.contentType ?? '').toLowerCase()];
      if (!ext) return reply({ error: 'That file type is not allowed' }, 400);
      if (!safePath(folder)) return reply({ error: 'Bad folder' }, 400);
      if (typeof body.size === 'number' && body.size > MAX_BYTES) return reply({ error: 'That file is too large' }, 400);

      const [first, second] = folder.split('/');
      const mine = first === 'avatars' || first === 'ids' ? second === me.personId : first in me.roles;
      if (!mine) return reply({ error: 'You cannot upload there' }, 403);

      // The owner's max file size for this company (More > Storage). Empty = the 200 MB maximum above. Needs update 53.
      if (first !== 'avatars' && first !== 'ids' && typeof body.size === 'number') {
        const { data: co } = await createClient(SUPABASE_URL, SERVICE_KEY)
          .from('companies').select('max_file_size_mb').eq('id', first).maybeSingle();
        const limitMb = Number(co?.max_file_size_mb ?? 0);
        if (limitMb > 0 && body.size > limitMb * 1024 * 1024) {
          return reply({ error: `That file is larger than the ${limitMb} MB limit the owner set` }, 400);
        }
      }

      const key = `${folder}/${crypto.randomUUID()}.${ext}`;
      const url = new URL(`${writeBase(key)}/${key}`);
      url.searchParams.set('X-Amz-Expires', '600');
      const signed = await r2.sign(
        new Request(url.toString(), { method: 'PUT', headers: { 'Content-Type': body.contentType } }),
        { aws: { signQuery: true } },
      );
      return reply({ uploadUrl: signed.url, key, publicUrl: `${R2_PUBLIC_URL}/${key}` });
    }

    if (body.action === 'delete') {
      const key = body.key;
      if (!safePath(key)) return reply({ error: 'Bad key' }, 400);
      const [first, second] = key.split('/');
      const allowed = first === 'avatars' || first === 'ids'
        ? second === me.personId
        : first in me.roles && CAN_DELETE.has(me.roles[first]);
      if (!allowed) return reply({ error: 'You cannot delete that' }, 403);
      if (!(await deleteEverywhere(key))) return reply({ error: 'Delete failed' }, 502);
      return reply({ ok: true });
    }

    // A worker's ID photo is never served from the public address. The person themself, or the OWNER of a company they belong to
    // (or asked to join), gets a short-lived private link; nobody else does.
    if (body.action === 'id-sign') {
      const key = body.key;
      if (!safePath(key)) return reply({ error: 'Bad key' }, 400);
      const [first, pid] = key.split('/');
      if (first !== 'ids' || !pid) return reply({ error: 'Bad key' }, 400);
      let allowed = pid === me.personId;
      if (!allowed) {
        const svc = createClient(SUPABASE_URL, SERVICE_KEY);
        const [{ data: members }, { data: reqs }] = await Promise.all([
          svc.from('company_members').select('company_id').eq('person_id', pid),
          svc.from('join_requests').select('company_id').eq('person_id', pid),
        ]);
        allowed = [...(members ?? []), ...(reqs ?? [])].some((r) => me.roles[r.company_id] === 'owner');
      }
      if (!allowed) return reply({ error: 'You cannot view that' }, 403);
      return reply({ url: await presignGet(key, 300) });
    }

    // Maintenance photos opened through a short-lived private link. The database decides who may open which file
    // (maintenance_photos_i_can_open, update 71): owner/admin, the crew on the route, or the linked customer for a shared photo on a
    // finished stop. Only the keys it allows are signed. NOT used by the app yet; it only protects once the files themselves are private.
    if (body.action === 'maint-sign') {
      const keys: string[] = Array.isArray(body.keys) ? body.keys.filter(safePath).slice(0, 100) : [];
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      });
      const { data, error } = await userClient.rpc('maintenance_photos_i_can_open', { p_keys: keys });
      if (error) return reply({ error: 'Could not check access' }, 502);
      const urls: Record<string, string> = {};
      await Promise.all(((data ?? []) as string[]).map(async (k) => { urls[k] = await presignGet(k, 3600); }));
      return reply({ urls });
    }

    if (body.action === 'snow-put') {
      const key = body.key;
      const ext = TYPES[String(body.contentType ?? '').toLowerCase()];
      if (!ext || !safePath(key) || !key.endsWith(`.${ext}`)) return reply({ error: 'Bad file' }, 400);
      if (!(key.split('/')[0] in me.roles)) return reply({ error: 'You cannot upload there' }, 403);
      // The database already let this person write the stand-in, so they may write here.
      if (!(await standInExists(key))) return reply({ error: 'Upload not allowed' }, 403);
      const url = new URL(`${writeBase(key)}/${key}`);
      url.searchParams.set('X-Amz-Expires', '600');
      const signed = await r2.sign(
        new Request(url.toString(), { method: 'PUT', headers: { 'Content-Type': body.contentType } }),
        { aws: { signQuery: true } },
      );
      return reply({ uploadUrl: signed.url });
    }

    if (body.action === 'snow-sign') {
      const keys: string[] = Array.isArray(body.keys) ? body.keys.filter(safePath).slice(0, 200) : [];
      // Asking Supabase as this person applies the bucket's own permission rules.
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      });
      const { data } = await userClient.storage.from(SNOW_BUCKET).createSignedUrls(keys, 3600);
      const urls: Record<string, string> = {};
      await Promise.all((data ?? []).map(async (item) => {
        if (!item.path || !item.signedUrl || item.error) return; // not allowed to see it
        urls[item.path] = (await inR2(item.path)) ? await presignGet(item.path, 3600) : item.signedUrl;
      }));
      return reply({ urls });
    }

    if (body.action === 'snow-delete') {
      const key = body.key;
      if (!safePath(key)) return reply({ error: 'Bad key' }, 400);
      // Only once the database let the stand-in go (saved media is kept).
      if (await standInExists(key)) return reply({ ok: false, kept: true });
      return reply({ ok: await deleteEverywhere(key) });
    }

    if (body.action === 'usage') {
      // Adds up this company's files (and the caller's own avatars) in R2.
      const prefixes = [...Object.keys(me.roles).map((c) => `${c}/`), `avatars/${me.personId}/`];
      let bytes = 0;
      let photos = 0;
      let avatars = 0;
      let work = 0;
      let workBytes = 0;
      for (const base of [BUCKET_URL, PRIVATE_BUCKET_URL].filter(Boolean)) for (const prefix of prefixes) {
        let token = '';
        do {
          const u = new URL(base);
          u.searchParams.set('list-type', '2');
          u.searchParams.set('prefix', prefix);
          if (token) u.searchParams.set('continuation-token', token);
          const xml = await (await r2.fetch(u.toString())).text();
          for (const m of xml.matchAll(/<Contents>[\s\S]*?<\/Contents>/g)) {
            const size = Number(/<Size>(\d+)<\/Size>/.exec(m[0])?.[1] ?? 0);
            bytes += size;
            // Our Work files live under <company>/portfolio/ and are counted on their own line.
            if (prefix.startsWith('avatars/')) avatars++;
            else if ((/<Key>([^<]*)<\/Key>/.exec(m[0])?.[1] ?? '').includes('/portfolio/')) { work++; workBytes += size; }
            else photos++;
          }
          token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? '';
        } while (token);
      }
      return reply({ bytes, photos, avatars, work, workBytes });
    }

    return reply({ error: 'Unknown action' }, 400);
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : 'Something went wrong' }, 500);
  }
});
