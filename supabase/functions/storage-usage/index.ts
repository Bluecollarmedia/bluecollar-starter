/**
 * Edge Function: storage-usage
 *
 * Returns storage usage stats and settings for the company.
 * Any authenticated company member can read usage;
 * owner/admin can update settings.
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { authenticateRequest, getServiceClient, AuthError } from '../_shared/auth.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const auth = await authenticateRequest(req);
    const db = getServiceClient();

    if (req.method === 'GET') {
      // Return current usage and settings
      const [usageResult, settingsResult] = await Promise.all([
        db.from('storage_usage')
          .select('*')
          .eq('company_id', auth.companyId)
          .single(),
        db.from('storage_settings')
          .select('*')
          .eq('company_id', auth.companyId)
          .single(),
      ]);

      const usage = usageResult.data ?? {
        total_bytes: 0,
        file_count: 0,
        photo_count: 0,
        avatar_count: 0,
        document_count: 0,
      };

      const settings = settingsResult.data ?? {
        max_storage_bytes: 5 * 1024 * 1024 * 1024,
        max_file_size_bytes: 10 * 1024 * 1024,
        rate_limit_uploads_per_minute: 10,
        rate_limit_uploads_per_hour: 100,
      };

      return jsonResponse({
        usage: {
          totalBytes: usage.total_bytes,
          fileCount: usage.file_count,
          photoCount: usage.photo_count,
          avatarCount: usage.avatar_count,
          documentCount: usage.document_count,
          percentUsed: settings.max_storage_bytes > 0
            ? Math.round((usage.total_bytes / settings.max_storage_bytes) * 100)
            : 0,
        },
        settings: {
          maxStorageBytes: settings.max_storage_bytes,
          maxFileSizeBytes: settings.max_file_size_bytes,
          rateLimitPerMinute: settings.rate_limit_uploads_per_minute,
          rateLimitPerHour: settings.rate_limit_uploads_per_hour,
        },
      });
    }

    if (req.method === 'POST') {
      // Update settings — owner/admin only
      if (auth.role !== 'owner' && auth.role !== 'admin') {
        return jsonError('Only owners and admins can update storage settings', 403);
      }

      const updates = await req.json();
      const allowedFields = [
        'max_storage_bytes',
        'max_file_size_bytes',
        'rate_limit_uploads_per_minute',
        'rate_limit_uploads_per_hour',
      ];

      const safeUpdates: Record<string, unknown> = {};
      for (const key of allowedFields) {
        if (key in updates) safeUpdates[key] = updates[key];
      }

      const { data, error } = await db
        .from('storage_settings')
        .upsert({
          company_id: auth.companyId,
          ...safeUpdates,
        }, { onConflict: 'company_id' })
        .select()
        .single();

      if (error) {
        return jsonError('Failed to update storage settings', 500);
      }

      return jsonResponse({ settings: data });
    }

    return jsonError('Method not allowed', 405);
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.status);
    }
    console.error('storage-usage error:', err);
    return jsonError('Internal server error', 500);
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function jsonError(message: string, status: number) {
  return jsonResponse({ error: message }, status);
}
