/**
 * Edge Function: upload-url
 *
 * Generates a presigned PUT URL for uploading a file to R2.
 * Validates: auth, company membership, file type, file size, storage quota,
 * rate limits, duplicate detection, and project authorization.
 *
 * R2 credentials NEVER leave this function.
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { authenticateRequest, getServiceClient, AuthError } from '../_shared/auth.ts';
import { generatePresignedPutUrl, getPublicUrl, buildFileKey } from '../_shared/r2.ts';
import {
  validateContentType,
  validateFileSize,
  validatePurpose,
  getMaxSizeForPurpose,
} from '../_shared/validation.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonError('Method not allowed', 405);
  }

  try {
    const auth = await authenticateRequest(req);
    const body = await req.json();

    const { fileName, contentType, size, purpose, entityId, idempotencyKey } = body;

    // ── Validate inputs ─────────────────────────────────────────
    if (!fileName || !contentType || !size || !purpose) {
      return jsonError('Missing required fields: fileName, contentType, size, purpose', 400);
    }

    if (!validatePurpose(purpose)) {
      return jsonError(`Invalid purpose: ${purpose}`, 400);
    }

    if (!validateContentType(contentType)) {
      return jsonError(`File type not allowed: ${contentType}. Allowed: JPEG, PNG, WebP, HEIC`, 400);
    }

    // ── Check project authorization for project/worker photos ───
    if ((purpose === 'project-photo' || purpose === 'worker-photo') && entityId) {
      const authorized = await checkProjectAuth(auth, entityId);
      if (!authorized) {
        return jsonError('You do not have access to this project', 403);
      }
    }

    // ── Load storage settings and check file size ───────────────
    const db = getServiceClient();
    const { data: settings } = await db
      .from('storage_settings')
      .select('*')
      .eq('company_id', auth.companyId)
      .single();

    const maxSize = getMaxSizeForPurpose(
      purpose,
      settings?.max_file_size_bytes,
    );

    if (!validateFileSize(size, maxSize)) {
      const maxMB = (maxSize / (1024 * 1024)).toFixed(1);
      return jsonError(`File too large. Maximum size: ${maxMB} MB`, 400);
    }

    // ── Check storage quota ─────────────────────────────────────
    const { data: usage } = await db
      .from('storage_usage')
      .select('total_bytes, file_count')
      .eq('company_id', auth.companyId)
      .single();

    const currentBytes = usage?.total_bytes ?? 0;
    const maxBytes = settings?.max_storage_bytes ?? 5 * 1024 * 1024 * 1024;

    if (currentBytes + size > maxBytes) {
      const usedGB = (currentBytes / (1024 * 1024 * 1024)).toFixed(2);
      const maxGB = (maxBytes / (1024 * 1024 * 1024)).toFixed(1);
      return jsonError(
        `Storage quota exceeded. Using ${usedGB} GB of ${maxGB} GB. Delete files or contact your administrator.`,
        413,
      );
    }

    // ── Rate limiting ───────────────────────────────────────────
    const rateOk = await checkRateLimit(db, auth, settings);
    if (!rateOk) {
      return jsonError('Upload rate limit exceeded. Please wait before uploading more files.', 429);
    }

    // ── Duplicate detection via idempotency key ─────────────────
    if (idempotencyKey) {
      const { data: existing } = await db
        .from('upload_log')
        .select('file_key')
        .eq('idempotency_key', idempotencyKey)
        .eq('action', 'upload')
        .single();

      if (existing) {
        return jsonResponse({
          fileKey: existing.file_key,
          publicUrl: getPublicUrl(existing.file_key),
          duplicate: true,
        });
      }
    }

    // ── Generate file key (server-controlled path) ──────────────
    const resolvedEntityId = entityId || auth.userId;
    const fileKey = buildFileKey(purpose, resolvedEntityId, fileName);

    // ── Generate presigned URL ──────────────────────────────────
    const uploadUrl = await generatePresignedPutUrl(fileKey, contentType, 300);

    // ── Reserve quota (atomic increment) ────────────────────────
    const purposeColumn = purpose === 'avatar'
      ? 'avatar_count'
      : purpose.includes('photo')
        ? 'photo_count'
        : 'document_count';

    if (usage) {
      await db.rpc('increment_storage_usage', {
        p_company_id: auth.companyId,
        p_bytes: size,
        p_column: purposeColumn,
      });
    } else {
      await db.from('storage_usage').insert({
        company_id: auth.companyId,
        total_bytes: size,
        file_count: 1,
        [purposeColumn]: 1,
      });
    }

    // ── Log the upload ──────────────────────────────────────────
    await db.from('upload_log').insert({
      company_id: auth.companyId,
      person_id: auth.userId,
      action: 'upload',
      file_key: fileKey,
      file_size_bytes: size,
      content_type: contentType,
      purpose,
      entity_id: entityId || null,
      idempotency_key: idempotencyKey || null,
    });

    return jsonResponse({
      uploadUrl,
      fileKey,
      publicUrl: getPublicUrl(fileKey),
      expiresAt: Date.now() + 300_000,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.status);
    }
    console.error('upload-url error:', err);
    return jsonError('Internal server error', 500);
  }
});

async function checkProjectAuth(
  auth: { userId: string; companyId: string; role: string },
  projectId: string,
): Promise<boolean> {
  if (auth.role === 'owner' || auth.role === 'admin') return true;

  const db = getServiceClient();
  const { data } = await db
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('company_id', auth.companyId)
    .single();

  return !!data;
}

async function checkRateLimit(
  db: ReturnType<typeof getServiceClient>,
  auth: { userId: string },
  settings: { rate_limit_uploads_per_minute?: number; rate_limit_uploads_per_hour?: number } | null,
): Promise<boolean> {
  const perMinute = settings?.rate_limit_uploads_per_minute ?? 10;
  const perHour = settings?.rate_limit_uploads_per_hour ?? 100;

  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count: minuteCount } = await db
    .from('upload_log')
    .select('*', { count: 'exact', head: true })
    .eq('person_id', auth.userId)
    .eq('action', 'upload')
    .gte('created_at', oneMinuteAgo);

  if ((minuteCount ?? 0) >= perMinute) return false;

  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count: hourCount } = await db
    .from('upload_log')
    .select('*', { count: 'exact', head: true })
    .eq('person_id', auth.userId)
    .eq('action', 'upload')
    .gte('created_at', oneHourAgo);

  if ((hourCount ?? 0) >= perHour) return false;

  return true;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function jsonError(message: string, status: number) {
  return jsonResponse({ error: message }, status);
}
