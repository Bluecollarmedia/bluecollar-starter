/**
 * media — one Edge Function for every photo/video that lives in Cloudflare R2.
 *
 * The app never holds R2 keys. It asks this function for a short-lived upload
 * link (action "put"), uploads straight to R2, and later asks it to remove a
 * file (action "delete"). It only needs the standard `people` and
 * `company_members` tables, nothing else.
 *
 * Secrets (supabase secrets set ...): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL (https://..., no slash),
 * and R2_PRIVATE_BUCKET_NAME (REQUIRED for worker ID photos: without it, ID photo
 * uploads are refused; they never fall back to the public bucket).
 *
 * Who may write where:
 *   avatars/{myPersonId}/...   any signed-in person (their own picture)
 *   ids/{myPersonId}/...       any signed-in person (their own ID photo, private bucket only)
 *   {companyId}/...            active members of that company
 * New company files are named {uploaderPersonId}_{random}.{ext}, so the server knows who uploaded them.
 * Delete:
 *   avatars/ and ids/          only the person whose folder it is
 *   {companyId}/...            the company's owner/admin, or the member who uploaded that file (by its name).
 *                              Workers and customers can never delete other people's files.
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';
/**
 * Which stored files are private (kept in the private bucket). Written out here, identical to supabase/functions/_shared/privateKeys.ts
 * (a check keeps the two the same), so this one file can be pasted into the Supabase dashboard as it is.
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
/** The private bucket (no public address). REQUIRED for worker ID photos (ids/...): without it those uploads are refused. */
const R2_PRIVATE_BUCKET_NAME = Deno.env.get('R2_PRIVATE_BUCKET_NAME') ?? '';

const r2 = new AwsClient({
  accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID') ?? '',
  secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '',
  service: 's3',
  region: 'auto',
});
const BUCKET_URL = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET_NAME}`;
const PRIVATE_BUCKET_URL = R2_PRIVATE_BUCKET_NAME ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_PRIVATE_BUCKET_NAME}` : '';

const NO_PRIVATE_BUCKET = 'ID photo storage is not set up yet (the private bucket, R2_PRIVATE_BUCKET_NAME, is missing). Ask the company to finish setup.';

/**
 * Where NEW files for this key are written: private keys ONLY to the private bucket, everything else to the normal bucket.
 * There is no fallback: a private key with no private bucket set up is refused before this is reached (and throws here, to be sure).
 */
const writeBase = (key: string) => {
  if (!isPrivateKey(key)) return BUCKET_URL;
  if (!PRIVATE_BUCKET_URL) throw new Error(NO_PRIVATE_BUCKET);
  return PRIVATE_BUCKET_URL;
};

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
  // More video containers every phone plays
  'video/x-m4v': 'm4v',
  'video/3gpp': '3gp',
};
const MAX_BYTES = 200 * 1024 * 1024;
/** Who may delete ANY file in their company's folder. Everyone else may delete only the files they uploaded themselves. */
const CAN_DELETE_ANY = new Set(['owner', 'admin']);
/** True when the file's name says this person uploaded it ({personId}_{random}.{ext}, see "put"). */
const uploadedBy = (key: string, personId: string) => (key.split('/').pop() ?? '').startsWith(`${personId}_`);

/** A private, short-lived read link for an R2 file. */
async function presignGet(key: string, seconds: number): Promise<string> {
  const url = new URL(`${await locate(key)}/${key}`);
  url.searchParams.set('X-Amz-Expires', String(seconds));
  const signed = await r2.sign(new Request(url.toString(), { method: 'GET' }), { aws: { signQuery: true } });
  return signed.url;
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
      // Worker ID photos only ever go to the private bucket. No private bucket = no upload (never the public bucket).
      if (isPrivateKey(`${folder}/x`) && !PRIVATE_BUCKET_URL) return reply({ error: NO_PRIVATE_BUCKET }, 503);

      // The owner's max file size for this company (More > Storage). Empty = the 200 MB maximum above. Needs update 53.
      if (first !== 'avatars' && first !== 'ids' && typeof body.size === 'number') {
        const { data: co } = await createClient(SUPABASE_URL, SERVICE_KEY)
          .from('companies').select('max_file_size_mb').eq('id', first).maybeSingle();
        const limitMb = Number(co?.max_file_size_mb ?? 0);
        if (limitMb > 0 && body.size > limitMb * 1024 * 1024) {
          return reply({ error: `That file is larger than the ${limitMb} MB limit the owner set` }, 400);
        }
      }

      // Company files carry the uploader's person id in their name, so "delete" can tell who uploaded them.
      const name = first === 'avatars' || first === 'ids' ? crypto.randomUUID() : `${me.personId}_${crypto.randomUUID()}`;
      const key = `${folder}/${name}.${ext}`;
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
        : first in me.roles && (CAN_DELETE_ANY.has(me.roles[first]) || uploadedBy(key, me.personId));
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

    if (body.action === 'usage') {
      // Adds up this company's files (and the caller's own avatars) in R2.
      const prefixes = [...Object.keys(me.roles).map((c) => `${c}/`), `avatars/${me.personId}/`];
      let bytes = 0;
      let photos = 0;
      let avatars = 0;
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
            if (prefix.startsWith('avatars/')) avatars++;
            else photos++;
          }
          token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? '';
        } while (token);
      }
      return reply({ bytes, photos, avatars });
    }

    return reply({ error: 'Unknown action' }, 400);
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : 'Something went wrong' }, 500);
  }
});
