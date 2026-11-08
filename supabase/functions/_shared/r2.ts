/**
 * Server-side R2 client for Supabase Edge Functions.
 * R2 credentials are ONLY accessible here — never exposed to clients.
 */
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

const R2_ACCOUNT_ID = Deno.env.get('R2_ACCOUNT_ID') ?? '';
const R2_ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID') ?? '';
const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '';
const R2_BUCKET_NAME = Deno.env.get('R2_BUCKET_NAME') ?? '';
const R2_PUBLIC_URL = Deno.env.get('R2_PUBLIC_URL') ?? '';

const r2 = new AwsClient({
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  service: 's3',
  region: 'auto',
});

const BUCKET_URL = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET_NAME}`;

export async function generatePresignedPutUrl(
  fileKey: string,
  contentType: string,
  expiresInSeconds = 300,
): Promise<string> {
  const url = new URL(`${BUCKET_URL}/${fileKey}`);
  url.searchParams.set('X-Amz-Expires', String(expiresInSeconds));

  const signed = await r2.sign(
    new Request(url.toString(), {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
    }),
    { aws: { signQuery: true } },
  );

  return signed.url;
}

export async function deleteR2Object(fileKey: string): Promise<boolean> {
  const url = `${BUCKET_URL}/${fileKey}`;
  const response = await r2.fetch(url, { method: 'DELETE' });
  return response.ok || response.status === 404;
}

export function getPublicUrl(fileKey: string): string {
  return `${R2_PUBLIC_URL}/${fileKey}`;
}

export function buildFileKey(
  purpose: string,
  entityId: string,
  fileName: string,
): string {
  const timestamp = Date.now();
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100);
  return `${purpose}/${entityId}/${timestamp}-${sanitized}`;
}

export { R2_PUBLIC_URL, R2_BUCKET_NAME };
