/**
 * Signed URL generation for private media access.
 * Public photos (customer-visible) use the R2 public URL directly.
 * Internal photos use time-limited signed URLs.
 */
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

const R2_ACCOUNT_ID = Deno.env.get('R2_ACCOUNT_ID') ?? '';
const R2_ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID') ?? '';
const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '';
const R2_BUCKET_NAME = Deno.env.get('R2_BUCKET_NAME') ?? '';

const r2 = new AwsClient({
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  service: 's3',
  region: 'auto',
});

const BUCKET_URL = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET_NAME}`;

export async function generateSignedGetUrl(
  fileKey: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const url = new URL(`${BUCKET_URL}/${fileKey}`);
  url.searchParams.set('X-Amz-Expires', String(expiresInSeconds));

  const signed = await r2.sign(
    new Request(url.toString(), { method: 'GET' }),
    { aws: { signQuery: true } },
  );

  return signed.url;
}
